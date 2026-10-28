//! Local, best-effort observations. Never used for routing or authorization.
use std::{collections::{HashMap, HashSet}, path::Path, sync::{Mutex, OnceLock, atomic::{AtomicU64, Ordering}}};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use crate::{families::{FamiliesConfig, RelaySpec, TestResult}, providers};

const FILE: &str = "skiff-settings-metadata.v1.json";
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Connection { fingerprint: String, version: String }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestRecord {
	pub relay_id: String, pub model_id: String, pub completed_at: u64,
	pub config_version: String, pub ok: bool, pub latency_ms: u64,
	pub status: Option<u16>, pub error_category: Option<String>,
	pub started_order: u64,
	#[serde(default)] pub config_changed: bool,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UseRecord { pub relay_id: String, pub route_id: String, pub used_at: u64 }
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Metadata { pub version: u32, pub tests: Vec<TestRecord>, pub usage: Vec<UseRecord>, #[serde(default)] connections: HashMap<String, Connection> }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataView { pub version: u32, pub tests: Vec<TestRecord>, pub usage: Vec<UseRecord> }

pub fn now() -> u64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }
fn order() -> u64 {
	static ORDER: AtomicU64 = AtomicU64::new(0);
	loop {
		let old = ORDER.load(Ordering::SeqCst);
		let next = now().saturating_mul(1000).max(old + 1);
		if ORDER.compare_exchange(old, next, Ordering::SeqCst, Ordering::SeqCst).is_ok() { return next; }
	}
}
pub fn fingerprint(relay: &RelaySpec) -> String {
	// HTTP-only test results predate reply validation and cannot prove a model works.
	// Invalidate their connection version so the UI asks for a fresh test.
	let fields = serde_json::json!(["model-reply-v2", relay.base_url.trim().trim_end_matches('/'), relay.api_key.trim(), crate::families::normalize_protocol(relay.protocol.as_deref()), relay.timeout_seconds]);
	format!("{:x}", Sha256::digest(fields.to_string().as_bytes()))
}
fn read(dir: &Path) -> Metadata {
	std::fs::read(dir.join(FILE)).ok().and_then(|bytes| serde_json::from_slice::<Metadata>(&bytes).ok()).filter(|value| value.version == 1).unwrap_or_default()
}
fn write(dir: &Path, value: &Metadata) -> Result<(), String> {
	std::fs::create_dir_all(dir).map_err(|_| "无法创建本地记录目录")?;
	providers::atomic_write(&dir.join(FILE), &serde_json::to_value(value).map_err(|_| "无法编码本地记录")?)
}
fn referenced(config: &FamiliesConfig, relay: &str, model: &str) -> bool {
	config.families.iter().any(|family| family.routes.iter().any(|route| route.relay_id == relay && route.models.iter().any(|item| item.model_id == model)))
}
fn sync(value: &mut Metadata, config: &FamiliesConfig) {
	value.version = 1;
	value.connections.retain(|id, _| config.relays.iter().any(|relay| &relay.id == id));
	for relay in &config.relays {
		let fingerprint = fingerprint(relay);
		if value.connections.get(&relay.id).is_none_or(|entry| entry.fingerprint != fingerprint) {
			value.connections.insert(relay.id.clone(), Connection { fingerprint, version: format!("{}-{}", now(), order()) });
		}
	}
	value.tests.retain(|test| referenced(config, &test.relay_id, &test.model_id));
	value.usage.retain(|usage| config.relays.iter().any(|relay| relay.id == usage.relay_id) && config.families.iter().any(|family| family.routes.iter().any(|route| route.id == usage.route_id && route.relay_id == usage.relay_id)));
}
/// Caller holds CONFIG_LOCK, including config commits and concurrent sessions.
pub fn reconcile(dir: &Path, config: &FamiliesConfig) {
	let mut value = read(dir); sync(&mut value, config); let _ = write(dir, &value);
}
pub fn query(dir: &Path, config: &FamiliesConfig) -> MetadataView {
	let mut value = read(dir); sync(&mut value, config); let _ = write(dir, &value);
	for test in &mut value.tests { test.config_changed = value.connections.get(&test.relay_id).is_none_or(|entry| entry.version != test.config_version); }
	MetadataView { version: 1, tests: value.tests, usage: value.usage }
}

#[derive(Clone)]
pub struct Ticket { scope: String, relay_id: Option<String>, model_id: String, fingerprint: String, version: Option<String>, order: u64, completed_at: u64, result: Option<TestResult> }
#[derive(Default)]
struct Tickets { completed: HashMap<String, Ticket>, latest: HashMap<(String, String, String), u64> }
fn tickets() -> &'static Mutex<Tickets> { static TICKETS: OnceLock<Mutex<Tickets>> = OnceLock::new(); TICKETS.get_or_init(|| Mutex::new(Tickets::default())) }
pub fn begin(dir: &Path, config: &FamiliesConfig, relay: &RelaySpec, model_id: &str) -> Ticket {
	let mut value = read(dir); sync(&mut value, config); let _ = write(dir, &value);
	let connection = value.connections.get(&relay.id).filter(|entry| entry.fingerprint == fingerprint(relay));
	let ticket = Ticket { scope: dir.to_string_lossy().into_owned(), relay_id: (!relay.id.is_empty()).then(|| relay.id.clone()), model_id: model_id.into(), fingerprint: fingerprint(relay), version: connection.map(|entry| entry.version.clone()), order: order(), completed_at: 0, result: None };
	if let Ok(mut state) = tickets().lock() { state.latest.insert((ticket.scope.clone(), relay.id.clone(), model_id.into()), ticket.order); }
	ticket
}
fn insert(value: &mut Metadata, config: &FamiliesConfig, relay_id: &str, ticket: &Ticket) {
	let Some(result) = &ticket.result else { return; };
	let Some(connection) = value.connections.get(relay_id) else { return; };
	if connection.fingerprint != ticket.fingerprint || !referenced(config, relay_id, &ticket.model_id) { return; }
	// Existing objects must retain the version bound at launch, even if edited back.
	if ticket.relay_id.as_deref() == Some(relay_id) && ticket.version.as_ref().is_some_and(|version| version != &connection.version) { return; }
	let latest = tickets().lock().ok().and_then(|state| state.latest.get(&(ticket.scope.clone(), ticket.relay_id.clone().unwrap_or_default(), ticket.model_id.clone())).copied());
	if latest.is_some_and(|order| order > ticket.order) { return; }
	if value.tests.iter().any(|test| test.relay_id == relay_id && test.model_id == ticket.model_id && test.started_order > ticket.order) { return; }
	let config_version = connection.version.clone();
	value.tests.retain(|test| test.relay_id != relay_id || test.model_id != ticket.model_id);
	value.tests.push(TestRecord { relay_id: relay_id.into(), model_id: ticket.model_id.clone(), completed_at: ticket.completed_at, config_version, ok: result.ok, latency_ms: result.latency_ms, status: result.status, error_category: if result.ok { None } else { Some(if result.error.as_deref() == Some("请求超时") { "请求超时" } else if result.status.is_some_and(|status| (200..300).contains(&status)) { "模型回复无效" } else if result.status.is_some() { "HTTP 请求失败" } else { "连接失败" }.into()) }, started_order: ticket.order, config_changed: false });
}
pub fn finish(dir: &Path, config: &FamiliesConfig, request_id: &str, mut ticket: Ticket, result: &TestResult, draft: bool) {
	ticket.result = Some(result.clone()); ticket.completed_at = now();
	if !draft && ticket.version.is_some() {
		let mut value = read(dir); sync(&mut value, config);
		if let Some(id) = &ticket.relay_id { insert(&mut value, config, id, &ticket); }
		let _ = write(dir, &value);
	}
	if draft { if let Ok(mut state) = tickets().lock() {
		state.completed.retain(|_, entry| now().saturating_sub(entry.completed_at) < 3_600_000);
		if state.completed.len() < 4096 { state.completed.insert(request_id.into(), ticket); }
	} }
}
pub fn promote(dir: &Path, config: &FamiliesConfig, relay_id: &str, ids: &[String]) {
	let completed: Vec<Ticket> = if let Ok(mut state) = tickets().lock() { ids.iter().filter_map(|id| state.completed.remove(id)).collect() } else { vec![] };
	let mut value = read(dir); sync(&mut value, config);
	for ticket in completed { if ticket.scope == dir.to_string_lossy() && ticket.relay_id.as_deref().is_none_or(|id| id == relay_id) { insert(&mut value, config, relay_id, &ticket); } }
	let _ = write(dir, &value);
}

/// Only live message_end events reach this function; history RPC payloads do not.
pub fn record_response(dir: &Path, config: &FamiliesConfig, event: &serde_json::Value, seen: &mut HashSet<String>) -> bool {
	if event["type"] != "message_end" { return false; }
	let message = &event["message"];
	if message["role"] != "assistant" || matches!(message["stopReason"].as_str(), Some("error" | "aborted")) { return false; }
	let valid = message["content"].as_array().is_some_and(|content| content.iter().any(|part| part["type"] == "toolCall" || part["type"] == "text" && part["text"].as_str().is_some_and(|text| !text.trim().is_empty()) || part["type"] == "thinking" && part["thinking"].as_str().is_some_and(|text| !text.trim().is_empty())));
	if !valid { return false; }
	let (Some(provider), Some(model), Some(timestamp)) = (message["provider"].as_str(), message["model"].as_str(), message["timestamp"].as_u64()) else { return false; };
	let key = format!("{provider}\0{model}\0{timestamp}");
	if !seen.insert(key) { return false; }
	let offers = crate::families::runtime_offers(config);
	let matches: Vec<_> = offers.iter().filter(|offer| offer.provider_key == provider && offer.model_id == model).collect();
	if matches.len() != 1 { return false; }
	let offer = matches[0];
	let mut value = read(dir); sync(&mut value, config);
	let used_at = now();
	if let Some(entry) = value.usage.iter_mut().find(|entry| entry.route_id == offer.route_id && entry.relay_id == offer.relay_id) { entry.used_at = entry.used_at.max(used_at); }
	else { value.usage.push(UseRecord { relay_id: offer.relay_id.clone(), route_id: offer.route_id.clone(), used_at }); }
	write(dir, &value).is_ok()
}

#[tauri::command]
pub fn list_settings_metadata() -> Result<MetadataView, String> {
	let _guard = providers::CONFIG_LOCK.lock().map_err(|_| "配置锁异常")?;
	let dir = crate::get_pi_agent_dir().ok_or("无法确定 pi 配置目录")?;
	Ok(query(&dir, &crate::families::load_plain(&dir)?))
}

#[cfg(test)]
mod tests {
	use super::*;
	use serde_json::json;
	struct Fixture { dir: std::path::PathBuf, config: FamiliesConfig }
	impl Drop for Fixture { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.dir); } }
	fn fixture() -> Fixture {
		let dir = std::env::temp_dir().join(format!("skiff-metadata-{}-{}", std::process::id(), order()));
		let mut config = FamiliesConfig::default();
		config.relays = serde_json::from_value(json!([
			{"id":"a", "name":"A", "baseUrl":"http://127.0.0.1:1/v1", "apiKey":"never-store-key", "timeoutSeconds":5},
			{"id":"b", "name":"B", "baseUrl":"http://127.0.0.1:2/v1", "apiKey":"another-key", "timeoutSeconds":5}
		])).unwrap();
		config.families[0].routes = serde_json::from_value(json!([
			{"id":"ra", "relayId":"a", "models":[{"modelId":"actual/model", "contextWindow":32000,"maxTokens":4096}]},
			{"id":"rb", "relayId":"b", "models":[{"modelId":"actual/model", "contextWindow":32000,"maxTokens":4096}]}
		])).unwrap();
		crate::families::save(&dir, &config).unwrap();
		Fixture { dir, config }
	}
	fn result(ok: bool) -> TestResult { TestResult { ok, latency_ms: 19, status: Some(if ok {200} else {401}), error: Some("never-store-key raw secret response body".into()) } }

	#[test]
	fn http_only_test_history_requires_retesting_after_reply_validation_upgrade() {
		let f = fixture();
		let relay = &f.config.relays[0];
		let ticket = begin(&f.dir, &f.config, relay, "actual/model");
		finish(&f.dir, &f.config, "baseline", ticket, &result(true), false);
		let mut old = read(&f.dir);
		let fields = json!([relay.base_url.trim().trim_end_matches('/'), relay.api_key.trim(), crate::families::normalize_protocol(relay.protocol.as_deref()), relay.timeout_seconds]);
		old.connections.get_mut(&relay.id).unwrap().fingerprint = format!("{:x}", Sha256::digest(fields.to_string().as_bytes()));
		write(&f.dir, &old).unwrap();
		assert!(query(&f.dir, &f.config).tests[0].config_changed);
		let ticket = begin(&f.dir, &f.config, relay, "actual/model");
		finish(&f.dir, &f.config, "retested", ticket, &result(true), false);
		assert!(!query(&f.dir, &f.config).tests[0].config_changed);
	}

	#[test]
	fn invalid_http_200_reply_persists_as_a_model_failure_without_raw_content() {
		let f = fixture();
		let ticket = begin(&f.dir, &f.config, &f.config.relays[0], "actual/model");
		let mut failed = result(false); failed.status = Some(200);
		finish(&f.dir, &f.config, "invalid-reply", ticket, &failed, false);
		let tests = query(&f.dir, &f.config).tests;
		assert!(!tests[0].ok);
		assert_eq!(tests[0].status, Some(200));
		assert_eq!(tests[0].error_category.as_deref(), Some("模型回复无效"));
		assert!(!std::fs::read_to_string(f.dir.join(FILE)).unwrap().contains("raw secret"));
	}

	#[test]
	fn observations_preserve_latest_failure_order_and_exact_identity_without_secrets() {
		let f = fixture();
		let first = begin(&f.dir, &f.config, &f.config.relays[0], "actual/model");
		let newer = begin(&f.dir, &f.config, &f.config.relays[0], "actual/model");
		finish(&f.dir, &f.config, "new", newer, &result(false), false);
		finish(&f.dir, &f.config, "old", first, &result(true), false);
		let b = begin(&f.dir, &f.config, &f.config.relays[1], "actual/model");
		finish(&f.dir, &f.config, "b", b, &result(true), false);
		let value = query(&f.dir, &f.config);
		assert_eq!(value.tests.len(), 2);
		assert!(!value.tests.iter().find(|t| t.relay_id == "a").unwrap().ok);
		let text = std::fs::read_to_string(f.dir.join(FILE)).unwrap();
		assert!(!text.contains("never-store-key")); assert!(!text.contains("raw secret")); assert!(!text.contains("http://"));
		// A newly begun request that is cancelled never replaces the completed one.
		let _cancelled = begin(&f.dir, &f.config, &f.config.relays[0], "actual/model");
		assert_eq!(query(&f.dir, &f.config).tests.len(), 2);
	}

	#[test]
	fn connection_versions_ignore_labels_prices_but_invalidate_edits_and_late_results() {
		let mut f = fixture();
		let ticket = begin(&f.dir, &f.config, &f.config.relays[0], "actual/model");
		finish(&f.dir, &f.config, "baseline", ticket, &result(true), false);
		f.config.relays[0].name = "Renamed".into(); f.config.families[0].routes[0].models[0].input_cost = 99.0;
		assert!(!query(&f.dir, &f.config).tests[0].config_changed);
		for field in 0..4 {
			let pending = begin(&f.dir, &f.config, &f.config.relays[0], "actual/model");
			match field { 0 => f.config.relays[0].api_key = "changed".into(), 1 => f.config.relays[0].base_url.push_str("/changed"), 2 => f.config.relays[0].protocol = Some("anthropic".into()), _ => f.config.relays[0].timeout_seconds = 6 };
			assert!(query(&f.dir, &f.config).tests[0].config_changed);
			finish(&f.dir, &f.config, "late", pending, &result(false), false);
			assert!(query(&f.dir, &f.config).tests[0].ok);
		}
		f.config.families[0].routes[0].models[0].model_id = "new-model".into();
		assert!(query(&f.dir, &f.config).tests.is_empty());
	}

	#[test]
	fn drafts_only_promote_when_saved_target_matches_and_model_still_exists() {
		let mut f = fixture();
		let mut draft = f.config.relays[0].clone(); draft.api_key = "unsaved-key".into();
		let ticket = begin(&f.dir, &f.config, &draft, "actual/model");
		finish(&f.dir, &f.config, "draft-wrong", ticket.clone(), &result(true), true);
		assert!(query(&f.dir, &f.config).tests.is_empty());
		promote(&f.dir, &f.config, "a", &["draft-wrong".into()]);
		assert!(query(&f.dir, &f.config).tests.is_empty());
		finish(&f.dir, &f.config, "draft-match", ticket, &result(false), true);
		f.config.relays[0] = draft;
		promote(&f.dir, &f.config, "a", &["draft-match".into()]);
		assert!(!query(&f.dir, &f.config).tests[0].ok);
		assert!(!query(&f.dir, &f.config).tests[0].config_changed);
		let mut new_relay = f.config.relays[1].clone(); new_relay.id.clear();
		let ticket = begin(&f.dir, &f.config, &new_relay, "actual/model");
		finish(&f.dir, &f.config, "new-draft", ticket, &result(true), true);
		promote(&f.dir, &f.config, "b", &["new-draft".into()]);
		assert_eq!(query(&f.dir, &f.config).tests.len(), 2);
	}

	#[test]
	fn use_records_require_live_valid_managed_responses_and_dedupe_tools() {
		let mut f = fixture(); let mut seen = HashSet::new();
		let mut event = json!({"type":"message_end", "message":{"role":"assistant", "provider":"skiff-relay-b-deepseek", "model":"actual/model", "timestamp":123, "stopReason":"toolUse", "content":[{"type":"toolCall", "id":"call"}]}});
		record_response(&f.dir, &f.config, &event, &mut seen);
		let first = query(&f.dir, &f.config).usage[0].used_at;
		record_response(&f.dir, &f.config, &event, &mut seen);
		assert_eq!(query(&f.dir, &f.config).usage[0].used_at, first);
		for kind in ["response", "message_start", "message_update"] { event["type"] = json!(kind); record_response(&f.dir, &f.config, &event, &mut seen); }
		event["type"] = json!("message_end");
		for reason in ["error", "aborted"] { event["message"]["stopReason"] = json!(reason); record_response(&f.dir, &f.config, &event, &mut seen); }
		event["message"]["stopReason"] = json!("stop"); event["message"]["timestamp"] = json!(124);
		event["message"]["provider"] = json!("unmanaged"); record_response(&f.dir, &f.config, &event, &mut seen);
		assert_eq!(query(&f.dir, &f.config).usage.len(), 1);
		assert_eq!(query(&f.dir, &f.config).usage[0].relay_id, "b");
		assert_eq!(query(&f.dir, &f.config).usage[0].route_id, "rb");
		f.config.families[0].routes.pop(); reconcile(&f.dir, &f.config);
		assert!(query(&f.dir, &f.config).usage.is_empty());
	}

	#[test]
	fn missing_corrupt_and_unwritable_metadata_never_block_configuration() {
		let f = fixture(); assert!(query(&f.dir, &f.config).tests.is_empty());
		std::fs::write(f.dir.join(FILE), "broken json").unwrap();
		assert!(query(&f.dir, &f.config).tests.is_empty());
		std::fs::remove_file(f.dir.join(FILE)).unwrap(); std::fs::create_dir(f.dir.join(FILE)).unwrap();
		assert!(crate::families::set_relay_enabled_in(&f.dir, "b", false).is_ok());
		let ticket = begin(&f.dir, &f.config, &f.config.relays[0], "actual/model");
		finish(&f.dir, &f.config, "unwritable", ticket, &result(true), false);
		assert!(query(&f.dir, &f.config).tests.is_empty());
	}

	#[test]
	fn concurrent_sessions_merge_observations_under_the_shared_config_lock() {
		let f = fixture();
		std::thread::scope(|scope| { for index in 0..8 { let dir = &f.dir; let config = &f.config; scope.spawn(move || {
			let _guard = providers::CONFIG_LOCK.lock().unwrap();
			let event = json!({"type":"message_end", "message":{"role":"assistant", "provider":if index % 2 == 0 {"skiff-relay-a-deepseek"} else {"skiff-relay-b-deepseek"}, "model":"actual/model", "timestamp":index, "content":[{"type":"text","text":"valid"}]}});
			record_response(dir, config, &event, &mut HashSet::new());
		}); } });
		assert_eq!(query(&f.dir, &f.config).usage.len(), 2);
	}

	#[test]
	fn batch_transactions_refresh_previews_and_allow_deleting_routes() {
		let f = fixture();
		crate::families::save(&f.dir, &f.config).unwrap();
		let ids = vec!["a".into(), "b".into()];
		let preview = crate::families::relay_batch_preview(&f.config, &ids).unwrap();
		assert_eq!(preview.route_count, 2);
		assert!(crate::families::batch_relays_in(&f.dir, &["a".into(), "missing".into()], "disable", &preview.token).is_err());
		let disabled = crate::families::batch_relays_in(&f.dir, &ids, "disable", &preview.token).unwrap();
		assert!(disabled.relays.iter().all(|r| !r.enabled));
		assert_eq!(serde_json::to_value(&disabled.families).unwrap(), serde_json::to_value(&f.config.families).unwrap());
		assert!(crate::families::batch_relays_in(&f.dir, &ids, "enable", &preview.token).is_err());
		let token = crate::families::relay_batch_preview(&disabled, &ids).unwrap().token;
		std::fs::write(f.dir.join("auth.json"), "corrupt").unwrap();
		assert!(crate::families::batch_relays_in(&f.dir, &ids, "enable", &token).is_err());
		assert!(crate::families::load_plain(&f.dir).unwrap().relays.iter().all(|r| !r.enabled));
		std::fs::write(f.dir.join("auth.json"), "{}").unwrap();
		let token = crate::families::relay_batch_preview(&disabled, &ids).unwrap().token;
		let deleted = crate::families::batch_relays_in(&f.dir, &ids, "delete", &token).unwrap();
		assert!(deleted.relays.is_empty()); assert!(deleted.families[0].routes.is_empty());
	}

	#[test]
	fn route_order_rejects_incomplete_duplicate_alias_and_replaced_route_sets() {
		let mut f = fixture();
		f.config.relays[1].enabled = false;
		f.config.families[0].routes[1].enabled = false;
		f.config.families[0].routes[1].models.clear();
		crate::families::save(&f.dir, &f.config).unwrap();
		for ids in [vec!["ra".into()], vec!["ra".into(), "ra".into()], vec!["a".into(), "b".into()], vec!["ra".into(), "new".into()]] { assert!(crate::families::reorder_routes_in(&f.dir, "deepseek", &ids).is_err()); }
		let saved = crate::families::reorder_routes_in(&f.dir, "deepseek", &["rb".into(), "ra".into()]).unwrap();
		assert_eq!(saved.families[0].routes[0].id, "rb");
		assert!(!saved.families[0].routes[0].enabled);
		assert!(saved.families[0].routes[0].models.is_empty());
		assert_eq!(serde_json::to_value(&saved.families[0].routes[1]).unwrap(), serde_json::to_value(&f.config.families[0].routes[0]).unwrap());
	}

	/// Explicit opt-in: real pi, temporary agent directory and loopback service only.
	#[test]
	#[ignore = "set SKIFF_TEST_PI_CLI and run this test explicitly"]
	fn real_pi_responses_flow_through_native_metadata_observer() {
		let f = fixture();
		let capture = f.dir.join("events.json");
		let cli = std::env::var("SKIFF_TEST_PI_CLI").expect("SKIFF_TEST_PI_CLI required");
		let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
		let status = std::process::Command::new("node").arg(root.join("tests/pi.families.integration.mjs")).arg(cli).env("SKIFF_SETTINGS_CAPTURE", &capture).current_dir(root).status().unwrap();
		assert!(status.success());
		let captured: serde_json::Value = serde_json::from_slice(&std::fs::read(capture).unwrap()).unwrap();
		let mut config = FamiliesConfig::default();
		for (index, route) in captured["routes"].as_array().unwrap().iter().enumerate() {
			let id = ["a", "b", "c", "d"][index];
			config.relays.push(serde_json::from_value(json!({"id":id,"name":id,"baseUrl":route["baseUrl"],"apiKey":"dummy"})).unwrap());
			config.families[0].routes.push(serde_json::from_value(json!({"id":format!("route-{id}"),"relayId":id,"models":route["models"].as_array().unwrap().iter().map(|model| json!({"modelId":model["id"],"contextWindow":model["contextWindow"],"maxTokens":model["maxTokens"]})).collect::<Vec<_>>()})).unwrap());
		}
		crate::families::save(&f.dir, &config).unwrap();
		// Reordering changes explicit priority, without changing attribution.
		config = crate::families::reorder_routes_in(&f.dir, "deepseek", &["route-b".into(),"route-a".into(),"route-c".into(),"route-d".into()]).unwrap();
		let mut seen = HashSet::new();
		for event in captured["events"].as_array().unwrap() { record_response(&f.dir, &config, event, &mut seen); }
		let records = query(&f.dir, &config).usage;
		assert_eq!(records.len(), 2, "401 and timeout routes must not count");
		assert!(records.iter().any(|entry| entry.relay_id == "a" && entry.route_id == "route-a"));
		assert!(records.iter().any(|entry| entry.relay_id == "b" && entry.route_id == "route-b"));
		let before = serde_json::to_value(&records).unwrap();
		for event in captured["events"].as_array().unwrap() { record_response(&f.dir, &config, event, &mut seen); }
		assert_eq!(serde_json::to_value(query(&f.dir, &config).usage).unwrap(), before);
	}
}
