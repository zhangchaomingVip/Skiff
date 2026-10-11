//! Model families: the user-facing way to organise models.
//!
//! Skiff fixes three model families (DeepSeek, Kimi, GLM). Endpoints live in
//! relays — one base URL plus one API key. A route binds a relay to a family
//! and lists the models (with per-model prices and limits) the relay serves
//! for that family, so one relay can back all three families without retyping
//! credentials. The routes array order is the family's priority: it drives
//! default-route resolution and failover. Selection happens on (family, model)
//! and pins the concrete route; each route is projected into pi's
//! `models.json` / `auth.json` as `skiff-relay-<relay>-<family>`, with every
//! route of a relay sharing one key environment variable.

use std::collections::HashMap;
use std::future::Future;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::task::Poll;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::crypto;
use super::providers;

/// The three families are fixed by design: users add relays and routes, never families.
pub const FAMILY_IDS: [&str; 3] = ["deepseek", "kimi", "glm"];

/// Route projection prefix; keys look like `skiff-relay-<relay>-<family>`.
const KEY_PREFIX: &str = "skiff-relay-";
/// Anything under this prefix is managed by Skiff and may be garbage-collected.
const MANAGED_PREFIX: &str = "skiff-";

pub fn family_display(id: &str) -> &'static str {
	match id {
		"deepseek" => "DeepSeek",
		"kimi" => "Kimi",
		"glm" => "GLM",
		_ => "未知家族",
	}
}

fn default_true() -> bool {
	true
}

fn default_timeout() -> u64 {
	60
}

fn default_schema_version() -> u64 {
	4
}

/// Fallback USD→CNY rate for the public catalog; user-adjustable, not fetched online.
fn default_usd_cny_rate() -> f64 {
	7.2
}

#[derive(Clone, Copy, Default, Serialize, Deserialize)]
pub enum Currency {
	#[default]
	#[serde(rename = "CNY")]
	Cny,
	#[serde(rename = "USD")]
	Usd,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSpec {
	pub model_id: String,
	/// Per-model image capability; old configurations retain the route default.
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub vision: Option<bool>,
	#[serde(default)]
	pub alias: String,
	#[serde(default)]
	pub input_cost: f64,
	#[serde(default)]
	pub output_cost: f64,
	#[serde(default)]
	pub cache_read_cost: f64,
	#[serde(default)]
	pub cache_write_cost: f64,
	#[serde(default)]
	pub currency: Currency,
	#[serde(default)]
	pub max_tokens: u64,
	pub context_window: u64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelaySpec {
	pub id: String,
	/// Unique across relays; shown in settings, route rows and the picker.
	pub name: String,
	pub base_url: String,
	/// Plain text in memory and on the IPC boundary; sealed on disk.
	#[serde(default)]
	pub api_key: String,
	#[serde(default = "default_timeout")]
	pub timeout_seconds: u64,
	#[serde(default = "default_true")]
	pub enabled: bool,
	#[serde(default)]
	pub billing_account_id: String,
	#[serde(default)]
	pub excluded_model_ids: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteSpec {
	#[serde(default)]
	pub id: String,
	pub relay_id: String,
	#[serde(default = "default_true")]
	pub enabled: bool,
	#[serde(default)]
	pub models: Vec<ModelSpec>,
	#[serde(default = "default_true")]
	pub streaming: bool,
	#[serde(default)]
	pub tools: bool,
	#[serde(default)]
	pub vision: bool,
	#[serde(default)]
	pub reasoning: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayRouteSpec {
	pub family_id: String,
	pub route: RouteSpec,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelFamily {
	pub id: String,
	pub display_name: String,
	/// Array order is the family's priority: default-route fallback then failover.
	#[serde(default)]
	pub routes: Vec<RouteSpec>,
	#[serde(default)]
	#[serde(alias = "defaultRelayId")]
	pub default_route_id: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FamiliesConfig {
	#[serde(default = "default_schema_version")]
	pub version: u64,
	#[serde(default)]
	pub relays: Vec<RelaySpec>,
	#[serde(default)]
	pub families: Vec<ModelFamily>,
	#[serde(default)]
	pub auto_failover: bool,
	#[serde(default)]
	pub auto_retry: bool,
	/// USD→CNY conversion applied when prefilling official catalog prices.
	#[serde(default = "default_usd_cny_rate")]
	pub usd_cny_rate: f64,
}

impl Default for FamiliesConfig {
	fn default() -> Self {
		FamiliesConfig {
			version: default_schema_version(),
			relays: Vec::new(),
			auto_failover: false,
				auto_retry: false,
			usd_cny_rate: default_usd_cny_rate(),
			families: FAMILY_IDS
				.iter()
				.map(|id| ModelFamily {
					id: id.to_string(),
					display_name: family_display(id).to_string(),
					routes: Vec::new(),
					default_route_id: None,
				})
				.collect(),
		}
	}
}

/// One selectable (family, relay, model) entry, resolved for the picker and router.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeOffer {
	pub offer_id: String,
	pub route_id: String,
	pub family_id: String,
	pub family_name: String,
	pub relay_id: String,
	pub relay_name: String,
	pub provider_key: String,
	pub model_id: String,
	pub alias: String,
	pub billing_account_id: String,
	pub route_order: usize,
	pub streaming: bool,
	pub tools: bool,
	pub vision: bool,
	pub reasoning: bool,
	pub input_cost: f64,
	pub output_cost: f64,
	pub cache_read_cost: f64,
	pub cache_write_cost: f64,
	pub currency: Currency,
	pub max_tokens: u64,
	pub context_window: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
	pub ok: bool,
	pub latency_ms: u64,
	pub status: Option<u16>,
	pub error: Option<String>,
}

// --- storage -----------------------------------------------------------------

pub fn config_path(dir: &Path) -> std::path::PathBuf {
	dir.join("skiff-families.json")
}

/// Legacy file kept next to the config when a pre-v3 file is discarded.
fn legacy_backup_path(dir: &Path) -> std::path::PathBuf {
	dir.join("skiff-families.v2.bak.json")
}

fn route_id_seed(family_id: &str, relay_id: &str) -> String {
	format!("route-{}-{}", sanitize_component(family_id), sanitize_component(relay_id))
}

/// Adds the v4 identity and pricing fields before serde deserializes the
/// configuration. This keeps the migration deterministic while preserving the
/// old route order, credentials and model prices.
fn migrate_value_to_v4(value: &mut Value) {
	let Some(root) = value.as_object_mut() else { return };
	let mut families = root.get_mut("families").and_then(Value::as_array_mut);
	if let Some(families) = families.as_deref_mut() {
		for family in families {
			let Some(family_obj) = family.as_object_mut() else { continue };
			let family_id = family_obj.get("id").and_then(Value::as_str).unwrap_or("family").to_string();
			let legacy_default = family_obj.remove("defaultRelayId");
			let routes = family_obj.get_mut("routes").and_then(Value::as_array_mut);
			let mut route_ids = Vec::new();
			if let Some(routes) = routes {
				for route in routes {
					let Some(route_obj) = route.as_object_mut() else { continue };
					let relay_id = route_obj.get("relayId").and_then(Value::as_str).unwrap_or("relay").to_string();
					let route_id = route_obj.get("id").and_then(Value::as_str).filter(|id| !id.is_empty()).map(str::to_string)
						.unwrap_or_else(|| route_id_seed(&family_id, &relay_id));
					route_obj.insert("id".into(), Value::String(route_id.clone()));
					route_ids.push((relay_id, route_id));
					route_obj.entry("enabled").or_insert_with(|| Value::Bool(true));
					if let Some(models) = route_obj.get_mut("models").and_then(Value::as_array_mut) {
						for model in models {
							let Some(model_obj) = model.as_object_mut() else { continue };
							model_obj.entry("alias").or_insert_with(|| Value::String(String::new()));
							let input = model_obj.get("inputCost").cloned().unwrap_or_else(|| Value::from(0));
							model_obj.entry("cacheReadCost").or_insert_with(|| input.clone());
							model_obj.entry("cacheWriteCost").or_insert(input);
						}
					}
				}
			}
			if !family_obj.contains_key("defaultRouteId") {
				let mapped = legacy_default.and_then(|value| value.as_str().and_then(|relay| route_ids.iter().find(|(id, _)| id == relay).map(|(_, route)| Value::String(route.clone()))));
				family_obj.insert("defaultRouteId".into(), mapped.unwrap_or(Value::Null));
			}
		}
	}
	if let Some(relays) = root.get_mut("relays").and_then(Value::as_array_mut) {
		for relay in relays {
			if let Some(object) = relay.as_object_mut() {
				object.entry("billingAccountId").or_insert_with(|| Value::String(String::new()));
			}
		}
	}
	root.insert("version".into(), Value::from(4));
}

/// Raw view: keys still carry their on-disk ciphertext.
pub fn load(dir: &Path) -> Result<FamiliesConfig, String> {
	let path = config_path(dir);
	if !path.exists() {
		return Ok(Default::default());
	}
	let bytes = std::fs::read(&path).map_err(|_| "无法读取家族配置".to_string())?;
	let mut value: Value = serde_json::from_slice(&bytes)
		.map_err(|_| "家族配置不是有效 JSON，请修复或删除 skiff-families.json".to_string())?;
	// Testing-environment reset: a pre-v3 file is backed up verbatim and the
	// app starts fresh; no data migration is attempted.
	if value["version"].as_u64().unwrap_or(1) < 3 {
		std::fs::rename(&path, legacy_backup_path(dir))
			.map_err(|_| "无法备份旧版家族配置，请手动处理 skiff-families.json".to_string())?;
		return Ok(Default::default());
	}
	migrate_value_to_v4(&mut value);
	let mut config: FamiliesConfig = serde_json::from_value(value)
		.map_err(|_| "家族配置不是有效 JSON，请修复或删除 skiff-families.json".to_string())?;
	// Older files may predate a family; reinstate it empty rather than dropping it.
	for id in FAMILY_IDS {
		if !config.families.iter().any(|family| family.id == id) {
			config.families.push(ModelFamily {
				id: id.to_string(),
				display_name: family_display(id).to_string(),
				routes: Vec::new(),
				default_route_id: None,
			});
		}
	}
	config.families.sort_by_key(|family| FAMILY_IDS.iter().position(|id| *id == family.id).unwrap_or(usize::MAX));
	validate_config(&config)?;
	Ok(config)
}

/// Plaintext view for IPC and for anything that will be re-saved.
pub fn load_plain(dir: &Path) -> Result<FamiliesConfig, String> {
	let mut config = load(dir)?;
	unsealed(&mut config)?;
	Ok(config)
}

fn unsealed(config: &mut FamiliesConfig) -> Result<(), String> {
	for relay in &mut config.relays {
		if relay.api_key.is_empty() {
			continue;
		}
		relay.api_key = crypto::open(&relay.api_key)
			.map_err(|_| format!("无法解密 {} 的密钥，请在原设备恢复配置", relay.name))?;
	}
	Ok(())
}

/// Persists the config (sealing keys) and mirrors it into pi's configuration.
pub fn save(dir: &Path, config: &FamiliesConfig) -> Result<(), String> {
	let mut stored = config.clone();
	for relay in &mut stored.relays {
		if relay.api_key.is_empty() || crypto::is_sealed(&relay.api_key) {
			continue;
		}
		if let Some(sealed) = crypto::seal(&relay.api_key)? {
			relay.api_key = sealed;
		}
	}
	std::fs::create_dir_all(dir).map_err(|_| "无法创建配置目录".to_string())?;
	let encoded = serde_json::to_value(&stored).map_err(|_| "无法编码家族配置")?;
	let paths = [dir.join("models.json"), dir.join("auth.json"), config_path(dir)];
	let backups = paths.iter().map(|path| {
		if path.exists() { std::fs::read(path).map(Some).map_err(|_| "无法备份配置".to_string()) } else { Ok(None) }
	}).collect::<Result<Vec<_>, _>>()?;
	let result = project(dir, config).and_then(|_| providers::atomic_write(&config_path(dir), &encoded));
	if let Err(error) = result {
		let mut failed = false;
		for (path, backup) in paths.iter().zip(backups) {
			if std::fs::read(path).ok().as_ref() == backup.as_ref() { continue; }
			let restored = match backup {
				Some(bytes) => std::fs::write(path, bytes),
				None if path.exists() => std::fs::remove_file(path),
				None => Ok(()),
			};
			failed |= restored.is_err();
		}
		return Err(if failed { format!("{error}；配置恢复失败，请检查配置目录") } else { error });
	}
	Ok(())
}

// --- validation --------------------------------------------------------------

fn validate_base_url(raw: &str) -> Result<String, String> {
	let url = reqwest::Url::parse(raw.trim()).map_err(|_| "Base URL 必须以 http:// 或 https:// 开头".to_string())?;
	if !["http", "https"].contains(&url.scheme()) || url.host_str().is_none() {
		return Err("Base URL 必须以 http:// 或 https:// 开头".into());
	}
	if !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
		return Err("Base URL 不能包含凭据、查询参数或片段".into());
	}
	Ok(url.as_str().trim_end_matches('/').to_string())
}

fn validate_model_id(raw: &str) -> Result<String, String> {
	let trimmed = raw.trim();
	if trimmed.is_empty() {
		return Err("模型 ID 不能为空".into());
	}
	if trimmed.len() > 256 || trimmed.chars().any(char::is_control) {
		return Err("模型 ID 无效".into());
	}
	Ok(trimmed.to_string())
}

fn validate_alias(raw: &str) -> Result<String, String> {
	let trimmed = raw.trim();
	if trimmed.chars().count() > 64 || trimmed.chars().any(char::is_control) {
		return Err("模型别名不能超过 64 个字符或包含控制字符".into());
	}
	Ok(trimmed.to_string())
}

fn display_name(raw: &str) -> Result<String, String> {
	let trimmed = raw.trim();
	let length = trimmed.chars().count();
	if length == 0 || length > 32 {
		return Err("显示名需为 1–32 个字符".into());
	}
	if trimmed.chars().any(char::is_control) {
		return Err("显示名不能包含控制字符".into());
	}
	Ok(trimmed.to_string())
}

fn validate_api_key(raw: &str) -> Result<String, String> {
	let trimmed = raw.trim();
	if trimmed.contains(['\r', '\n']) || trimmed.starts_with(['!', '$']) {
		return Err("API Key 必须是直接填写的密钥，不能是命令或变量表达式".into());
	}
	Ok(trimmed.to_string())
}

fn money(value: f64) -> f64 {
	if value.is_finite() && value >= 0.0 { (value * 1_000_000.0).round() / 1_000_000.0 } else { 0.0 }
}

fn next_id() -> String {
	let nanos = std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|value| value.as_nanos())
		.unwrap_or_default();
	format!("r{nanos}")
}

fn sanitize_component(id: &str) -> String {
	let mut out: String = id.chars().filter(|character| character.is_ascii_alphanumeric() || *character == '-' || *character == '_').collect();
	if out.is_empty() {
		out.push('r');
	}
	out.truncate(48);
	out
}

/// Validates one relay, resolving the name against the other relays.
fn normalize_relay(mut relay: RelaySpec, config: &FamiliesConfig) -> Result<RelaySpec, String> {
	let name = display_name(&relay.name)?;
	if config.relays.iter().any(|other| other.id != relay.id && other.name.eq_ignore_ascii_case(&name)) {
		return Err("中转名称不能重复".into());
	}
	let mut id: String = relay.id.chars().filter(|character| character.is_ascii_alphanumeric() || *character == '-' || *character == '_').collect();
	if id.is_empty() {
		id = next_id();
	}
	id.truncate(48);
	relay.id = id;
	relay.name = name;
	relay.base_url = validate_base_url(&relay.base_url)?;
	relay.api_key = validate_api_key(&relay.api_key)?;
	relay.timeout_seconds = relay.timeout_seconds.clamp(5, 600);
	relay.excluded_model_ids = relay.excluded_model_ids.iter().map(|id| validate_model_id(id)).collect::<Result<Vec<_>, _>>()?;
	relay.excluded_model_ids.sort();
	relay.excluded_model_ids.dedup();
	Ok(relay)
}

/// Validates the models of one route and their uniqueness within the route.
fn normalize_models(models: &[ModelSpec]) -> Result<Vec<ModelSpec>, String> {
	let mut normalized = Vec::with_capacity(models.len());
	let mut ids = std::collections::HashSet::new();
	for model in models {
		let model_id = validate_model_id(&model.model_id)?;
		if !ids.insert(model_id.clone()) {
			return Err("同一线路内模型 ID 不能重复".into());
		}
		if model.context_window == 0 || model.max_tokens == 0 || model.max_tokens > model.context_window {
			return Err("上下文窗口和默认最大输出必须为正整数，且最大输出不能超过上下文窗口".into());
		}
		let alias = validate_alias(&model.alias)?;
		let input_cost = money(model.input_cost);
		let cache_read_cost = if model.cache_read_cost == 0.0 && input_cost > 0.0 { input_cost } else { money(model.cache_read_cost) };
		let cache_write_cost = if model.cache_write_cost == 0.0 && input_cost > 0.0 { input_cost } else { money(model.cache_write_cost) };
		normalized.push(ModelSpec {
			model_id,
			vision: model.vision,
			alias,
			input_cost,
			output_cost: money(model.output_cost),
			cache_read_cost,
			cache_write_cost,
			currency: model.currency,
			max_tokens: model.max_tokens,
			context_window: model.context_window,
		});
	}
	Ok(normalized)
}

fn validate_config(config: &FamiliesConfig) -> Result<(), String> {
	let mut route_ids = std::collections::HashSet::new();
	let mut offer_ids = std::collections::HashSet::new();
	for family in &config.families {
		for route in &family.routes {
			if route.id.trim().is_empty() || !route_ids.insert(route.id.clone()) {
				return Err("线路 ID 必须全局唯一".into());
			}
			normalize_models(&route.models)?;
			for model in &route.models {
				if !offer_ids.insert(format!("{}/{}", route.id, model.model_id)) {
					return Err("可选项 ID 必须全局唯一".into());
				}
			}
		}
		if let Some(default_id) = &family.default_route_id {
			let valid = family.routes.iter().find(|route| &route.id == default_id).is_some_and(|route| {
				route.enabled && !route.models.is_empty() && relay_enabled_with_models(config, &route.relay_id)
			});
			if !valid { return Err("默认线路必须是已启用且包含模型的线路".into()); }
		}
	}
	Ok(())
}

/// Validates one route, including model-ID uniqueness across every route of
/// the same relay: the projected (provider, model) pair must stay unambiguous.
fn normalize_route(route: &RouteSpec, config: &FamiliesConfig, family_id: &str, replacing: Option<(&str, &str)>) -> Result<RouteSpec, String> {
	if !config.relays.iter().any(|relay| relay.id == route.relay_id) {
		return Err("线路的中转不存在，请先添加中转".into());
	}
	let models = normalize_models(&route.models)?;
	let mut id = route.id.trim().to_string();
	if id.is_empty() { id = route_id_seed(family_id, &route.relay_id); }
	if id.chars().any(char::is_control) || id.len() > 96 { return Err("线路 ID 无效".into()); }
	for family in &config.families {
		for existing in &family.routes {
			if replacing == Some((family.id.as_str(), existing.id.as_str())) || replacing == Some((family.id.as_str(), existing.relay_id.as_str())) { continue; }
			if existing.id == id { return Err("线路 ID 不能重复".into()); }
		}
	}
	Ok(RouteSpec { id, relay_id: route.relay_id.clone(), enabled: route.enabled, models, streaming: route.streaming, tools: route.tools, vision: route.vision, reasoning: route.reasoning })
}

fn family_mut<'a>(config: &'a mut FamiliesConfig, family_id: &str) -> Result<&'a mut ModelFamily, String> {
	if !FAMILY_IDS.contains(&family_id) {
		return Err(format!("未知模型家族：{family_id}"));
	}
	config
		.families
		.iter_mut()
		.find(|family| family.id == family_id)
		.ok_or_else(|| format!("找不到模型家族：{family_id}"))
}

/// True when the relay is enabled and serves at least one model on some route.
fn relay_enabled_with_models(config: &FamiliesConfig, relay_id: &str) -> bool {
	config.relays.iter().any(|relay| relay.id == relay_id && relay.enabled)
		&& config.families.iter().any(|family| family.routes.iter().any(|route| route.relay_id == relay_id && route.enabled && !route.models.is_empty()))
}

/// Keeps the default pointing at a usable route; falls back to route order.
// --- projection into pi's own configuration ---------------------------------

/// pi's provider identifier for one route; also its key in `auth.json`.
pub fn provider_key(family_id: &str, relay_id: &str) -> String {
	format!("{KEY_PREFIX}{}-{family_id}", sanitize_component(relay_id))
}

fn key_env(key: &str) -> String {
	format!("SKIFF_KEY_{}", key.replace('-', "_"))
}

fn project_model(route: &RouteSpec, item: &ModelSpec, key: &str) -> Value {
	let vision = if item.vision.unwrap_or(route.vision) { json!(["text", "image"]) } else { json!(["text"]) };
	json!({
		"id": item.model_id, "name": if item.alias.is_empty() { item.model_id.clone() } else { item.alias.clone() }, "api": "openai-completions", "provider": key,
		"cost": { "input": item.input_cost, "output": item.output_cost, "cacheRead": item.cache_read_cost, "cacheWrite": item.cache_write_cost },
		"currency": item.currency, "contextWindow": item.context_window, "maxTokens": item.max_tokens,
		"input": vision, "reasoning": route.reasoning,
	})
}

/// Every (route, model) pair of one relay across all families.
fn relay_models<'a>(config: &'a FamiliesConfig, relay_id: &str) -> Vec<(&'a RouteSpec, &'a ModelSpec)> {
	config
		.families
		.iter()
		.flat_map(|family| family.routes.iter())
		.filter(|route| route.relay_id == relay_id)
		.flat_map(|route| route.models.iter().map(move |model| (route, model)))
		.collect()
}

fn is_managed_key(key: &str) -> bool {
	key.starts_with(MANAGED_PREFIX)
}

/// Secrets are decrypted only into the child environment, never auth.json.
/// The runtime extension implements each route's request capabilities.
pub fn prepare_runtime(dir: &Path, cmd: &mut std::process::Command) -> Result<(), String> {
	let _guard = providers::CONFIG_LOCK.lock().map_err(|_| "配置锁异常")?;
	let config = load_plain(dir)?;
	let mut routes = Vec::new();
	for relay in &config.relays {
		if relay_models(&config, &relay.id).is_empty() {
			continue;
		}
		for family in &config.families {
			for route in family.routes.iter().filter(|route| route.relay_id == relay.id) {
				let models: Vec<_> = route.models.iter().filter(|model| !relay.excluded_model_ids.contains(&model.model_id)).collect();
				if !route.enabled || models.is_empty() || !relay.enabled {
					continue;
				}
				let route_key = provider_key(&family.id, &relay.id);
				// Every route of a relay shares one key environment variable.
				cmd.env(key_env(&route_key), &relay.api_key);
				routes.push(json!({ "providerKey": route_key, "baseUrl": relay.base_url,
					"keyEnv": key_env(&route_key), "streaming": route.streaming, "tools": route.tools,
					"timeoutSeconds": relay.timeout_seconds,
					"models": models.iter().map(|model| project_model(route, model, &route_key)).collect::<Vec<_>>() }));
			}
		}
	}
	if routes.is_empty() { return Ok(()); }
	let extension = dir.join("skiff-family-runtime.js");
	let source = include_str!("pi_extensions/model_families.js");
	if std::fs::read_to_string(&extension).ok().as_deref() != Some(source) {
		std::fs::write(&extension, source).map_err(|_| "无法安装模型家族请求适配器")?;
	}
	cmd.env("SKIFF_FAMILY_RUNTIME", serde_json::to_string(&routes).map_err(|_| "无法编码线路配置")?);
	cmd.arg("--extension").arg(extension);
	Ok(())
}

/// Rewrites `models.json` and `auth.json` so pi can dispatch every enabled
/// route. Unknown providers and unknown fields are preserved verbatim; stale
/// `skiff-` keys (including v2 leftovers) are dropped.
pub fn project(dir: &Path, config: &FamiliesConfig) -> Result<(), String> {
	let models_path = dir.join("models.json");
	let auth_path = dir.join("auth.json");
	let models_existed = models_path.exists();
	let original = providers::read_config(&models_path)?;
	let mut models = original.clone();
	let mut auth = providers::read_config(&auth_path)?;
	if models.get("providers").is_none() {
		models["providers"] = json!({});
	}

	// Only valid routes are projected; disabled routes remain in this config so
	// they can be restored without losing their credentials.
	let mut desired: Vec<(String, &RelaySpec, &RouteSpec)> = Vec::new();
	for family in &config.families {
		for route in &family.routes {
			if !route.enabled || route.models.is_empty() { continue; }
			let Some(relay) = config.relays.iter().find(|relay| relay.id == route.relay_id) else { continue };
			if !relay.enabled || route.models.iter().all(|model| relay.excluded_model_ids.contains(&model.model_id)) { continue; }
			desired.push((provider_key(&family.id, &relay.id), relay, route));
		}
	}

	{
		let map = models["providers"].as_object_mut().ok_or("pi 配置的 providers 必须是对象")?;
		map.retain(|key, _| !is_managed_key(key) || desired.iter().any(|(wanted, _, _)| wanted == key));
		for (key, relay, route) in &desired {
			let entry = json!({
				"api": "openai-completions",
				"baseUrl": relay.base_url,
				"models": route.models.iter().filter(|item| !relay.excluded_model_ids.contains(&item.model_id)).map(|item| project_model(route, item, key)).collect::<Vec<_>>(),
			});
			map.insert(key.clone(), entry);
		}
	}

	if let Some(map) = auth.as_object_mut() {
		map.retain(|key, _| !is_managed_key(key) || desired.iter().any(|(wanted, _, _)| wanted == key));
		for (key, relay, _) in &desired {
			if relay.api_key.trim().is_empty() { continue; }
			map.insert(key.clone(), json!({ "type": "api_key", "key": format!("${}", key_env(key)) }));
		}
	}

	providers::atomic_write(&models_path, &models)?;
	if let Err(error) = providers::atomic_write(&auth_path, &auth) {
		let rollback = if models_existed {
			providers::atomic_write(&models_path, &original)
		} else {
			std::fs::remove_file(&models_path).map_err(|_| "无法恢复模型配置".to_string())
		};
		if rollback.is_err() {
			return Err("凭据保存失败，且无法恢复模型配置，请检查 pi 配置文件".into());
		}
		return Err(error);
	}
	Ok(())
}

// --- runtime view ------------------------------------------------------------

pub fn runtime_offers(config: &FamiliesConfig) -> Vec<RuntimeOffer> {
	let mut offers = Vec::new();
	for family in &config.families {
		for (route_order, route) in family.routes.iter().enumerate() {
			let Some(relay) = config.relays.iter().find(|relay| relay.id == route.relay_id) else { continue };
			if !relay.enabled || !route.enabled {
				continue;
			}
			for model in &route.models {
				if relay.excluded_model_ids.contains(&model.model_id) { continue; }
				offers.push(RuntimeOffer {
					offer_id: format!("{}/{}", route.id, model.model_id),
					route_id: route.id.clone(),
					family_id: family.id.clone(),
					family_name: family.display_name.clone(),
					relay_id: relay.id.clone(),
					relay_name: relay.name.clone(),
					provider_key: provider_key(&family.id, &relay.id),
					model_id: model.model_id.clone(),
					alias: model.alias.clone(),
					billing_account_id: relay.billing_account_id.clone(),
					route_order,
					streaming: route.streaming,
					tools: route.tools,
					vision: model.vision.unwrap_or(route.vision),
					reasoning: route.reasoning,
					input_cost: model.input_cost,
					output_cost: model.output_cost,
					cache_read_cost: model.cache_read_cost,
					cache_write_cost: model.cache_write_cost,
					currency: model.currency,
					max_tokens: model.max_tokens,
					context_window: model.context_window,
				});
			}
		}
	}
	offers
}

// --- mutations ---------------------------------------------------------------

fn apply(dir: &Path, mutate: impl FnOnce(&mut FamiliesConfig) -> Result<(), String>) -> Result<FamiliesConfig, String> {
	let mut config = load_plain(dir)?;
	mutate(&mut config)?;
	validate_config(&config)?;
	save(dir, &config)?;
	Ok(config)
}

fn upsert_relay(config: &mut FamiliesConfig, relay: RelaySpec) {
	match config.relays.iter_mut().find(|existing| existing.id == relay.id) {
		Some(existing) => *existing = relay,
		None => config.relays.push(relay),
	}
}

/// Commit the relay and discovered routes together, avoiding a saved provider
/// with no routes if any model fails validation. Discovery never replaces edits.
pub fn save_relay_with_routes_in(dir: &Path, relay: RelaySpec, routes: Vec<RelayRouteSpec>) -> Result<FamiliesConfig, String> {
	apply(dir, |config| {
		let mut normalized = normalize_relay(relay, config)?;
		// A blank key on an edit means "keep the stored one".
		if normalized.api_key.trim().is_empty() {
			let Some(existing) = config.relays.iter().find(|existing| existing.id == normalized.id) else {
				return Err("新中转需要 API Key".into());
			};
			normalized.api_key = existing.api_key.clone();
		}
		let relay_id = normalized.id.clone();
		let excluded = normalized.excluded_model_ids.clone();
		upsert_relay(config, normalized);
		for mut item in routes {
			let family = family_mut(config, &item.family_id)?;
			if family.routes.iter().any(|route| route.relay_id == relay_id) { continue; }
			item.route.id.clear();
			item.route.relay_id = relay_id.clone();
			item.route.models.retain(|model| !excluded.contains(&model.model_id.trim().to_string()));
			if item.route.models.is_empty() { continue; }
			let route = normalize_route(&item.route, config, &item.family_id, None)?;
			family_mut(config, &item.family_id)?.routes.push(route);
		}
		Ok(())
	})
}

pub fn delete_relay_in(dir: &Path, relay_id: &str) -> Result<FamiliesConfig, String> {
	apply(dir, |config| {
		if !config.relays.iter().any(|relay| relay.id == relay_id) {
			return Err("找不到要删除的中转".into());
		}
		if config.families.iter().any(|family| family.routes.iter().any(|route| route.relay_id == relay_id && family.default_route_id.as_deref() == Some(route.id.as_str()))) {
			return Err("该中转包含默认线路，请先选择替代线路或明确清空默认值".into());
		}
		config.relays.retain(|relay| relay.id != relay_id);
		for family in &mut config.families {
			let removed_default = family.routes.iter().any(|route| route.relay_id == relay_id && family.default_route_id.as_deref() == Some(route.id.as_str()));
			family.routes.retain(|route| route.relay_id != relay_id);
			if removed_default {
				family.default_route_id = None;
			}
		}
		Ok(())
	})
}

pub fn set_relay_enabled_in(dir: &Path, relay_id: &str, enabled: bool) -> Result<FamiliesConfig, String> {
	apply(dir, |config| {
		if !enabled && config.families.iter().any(|family| family.routes.iter().any(|route| route.relay_id == relay_id && family.default_route_id.as_deref() == Some(route.id.as_str()))) {
			return Err("该中转包含默认线路，请先选择替代线路或明确清空默认值".into());
		}
		let Some(relay) = config.relays.iter_mut().find(|relay| relay.id == relay_id) else {
			return Err("找不到该中转".into());
		};
		relay.enabled = enabled;
		Ok(())
	})
}

/// One route per relay within a family: saving an existing relay's route replaces it.
pub fn save_route_in(dir: &Path, family_id: &str, route: RouteSpec) -> Result<FamiliesConfig, String> {
	apply(dir, |config| {
		let replacing = config.families.iter().find(|family| family.id == family_id)
			.and_then(|family| family.routes.iter().find(|existing| existing.id == route.id || (route.id.is_empty() && existing.relay_id == route.relay_id)))
			.map(|existing| (family_id, existing.id.as_str()));
		let normalized = normalize_route(&route, config, family_id, replacing)?;
		let family = family_mut(config, family_id)?;
		if !normalized.enabled && family.default_route_id.as_deref() == Some(normalized.id.as_str()) {
			return Err("不能停用默认线路，请先选择替代线路或明确清空默认值".into());
		}
		match family.routes.iter_mut().find(|existing| existing.id == normalized.id || existing.relay_id == normalized.relay_id) {
			Some(existing) => *existing = normalized,
			None => family.routes.push(normalized),
		}
		Ok(())
	})
}

pub fn delete_route_in(dir: &Path, family_id: &str, relay_id: &str) -> Result<FamiliesConfig, String> {
	apply(dir, |config| {
		let family = family_mut(config, family_id)?;
		let before = family.routes.len();
		let removed = family.routes.iter().find(|route| route.id == relay_id || route.relay_id == relay_id).map(|route| route.id.clone());
		family.routes.retain(|route| removed.as_deref() != Some(route.id.as_str()));
		if family.routes.len() == before {
			return Err("找不到要删除的线路".into());
		}
		if family.default_route_id.as_deref() == removed.as_deref() { return Err("不能删除默认线路，请先选择替代线路或明确清空默认值".into()); }
		Ok(())
	})
}

pub fn reorder_routes_in(dir: &Path, family_id: &str, relay_ids: &[String]) -> Result<FamiliesConfig, String> {
	apply(dir, |config| {
		let family = family_mut(config, family_id)?;
		if relay_ids.len() != family.routes.len() {
			return Err("排序请求与现有线路数量不一致".into());
		}
		if relay_ids.iter().collect::<std::collections::HashSet<_>>().len() != relay_ids.len() {
			return Err("排序请求包含重复线路".into());
		}
		let mut reordered = Vec::with_capacity(family.routes.len());
		for id in relay_ids {
			let Some(route) = family.routes.iter().find(|route| &route.id == id || &route.relay_id == id) else {
				return Err("排序请求包含未知线路".into());
			};
			reordered.push(route.clone());
		}
		family.routes = reordered;
		Ok(())
	})
}

pub fn set_default_route_in(dir: &Path, family_id: &str, route_id: Option<&str>) -> Result<FamiliesConfig, String> {
	apply(dir, |config| {
		let Some(id) = route_id else {
			family_mut(config, family_id)?.default_route_id = None;
			return Ok(());
		};
		let relay_for_route = config.families.iter().find(|family| family.id == family_id)
			.and_then(|family| family.routes.iter().find(|route| route.id == id || route.relay_id == id))
			.filter(|route| route.enabled && !route.models.is_empty())
			.map(|route| route.relay_id.clone());
		let usable = relay_for_route.as_deref().is_some_and(|relay| relay_enabled_with_models(config, relay));
		if !usable {
			return Err("默认线路必须是该家族内已启用中转上的线路".into());
		}
		let resolved = config.families.iter().find(|family| family.id == family_id).and_then(|family| family.routes.iter().find(|route| route.id == id || route.relay_id == id)).map(|route| route.id.clone()).unwrap();
		family_mut(config, family_id)?.default_route_id = Some(resolved);
		Ok(())
	})
}

pub fn set_auto_failover_in(dir: &Path, auto_failover: bool) -> Result<FamiliesConfig, String> {
	apply(dir, |config| {
		config.auto_failover = auto_failover;
		Ok(())
	})
}

pub fn set_auto_retry_in(dir: &Path, auto_retry: bool) -> Result<FamiliesConfig, String> {
	apply(dir, |config| {
		config.auto_retry = auto_retry;
		Ok(())
	})
}

pub fn set_usd_cny_rate_in(dir: &Path, rate: f64) -> Result<FamiliesConfig, String> {
	apply(dir, |config| {
		config.usd_cny_rate = rate;
		Ok(())
	})
}

// --- tauri commands ----------------------------------------------------------

fn agent_dir() -> Result<std::path::PathBuf, String> {
	super::get_pi_agent_dir().ok_or("无法确定 pi 配置目录".to_string())
}

#[tauri::command]
pub fn list_model_families() -> Result<FamiliesConfig, String> {
	let _guard = providers::CONFIG_LOCK.lock().map_err(|_| "配置锁异常")?;
	load_plain(&agent_dir()?)
}

#[tauri::command]
pub fn list_model_runtime() -> Result<Vec<RuntimeOffer>, String> {
	let _guard = providers::CONFIG_LOCK.lock().map_err(|_| "配置锁异常")?;
	Ok(runtime_offers(&load_plain(&agent_dir()?)?))
}

#[tauri::command]
pub fn save_relay(relay: RelaySpec, routes: Option<Vec<RelayRouteSpec>>) -> Result<FamiliesConfig, String> {
	let _guard = providers::CONFIG_LOCK.lock().map_err(|_| "配置锁异常")?;
	save_relay_with_routes_in(&agent_dir()?, relay, routes.unwrap_or_default())
}

#[tauri::command]
pub fn delete_relay(relay_id: String) -> Result<FamiliesConfig, String> {
	let _guard = providers::CONFIG_LOCK.lock().map_err(|_| "配置锁异常")?;
	delete_relay_in(&agent_dir()?, &relay_id)
}

#[tauri::command]
pub fn set_relay_enabled(relay_id: String, enabled: bool) -> Result<FamiliesConfig, String> {
	let _guard = providers::CONFIG_LOCK.lock().map_err(|_| "配置锁异常")?;
	set_relay_enabled_in(&agent_dir()?, &relay_id, enabled)
}

#[tauri::command]
pub fn save_route(family_id: String, route: RouteSpec) -> Result<FamiliesConfig, String> {
	let _guard = providers::CONFIG_LOCK.lock().map_err(|_| "配置锁异常")?;
	save_route_in(&agent_dir()?, &family_id, route)
}

#[tauri::command]
pub fn delete_route(family_id: String, relay_id: String) -> Result<FamiliesConfig, String> {
	let _guard = providers::CONFIG_LOCK.lock().map_err(|_| "配置锁异常")?;
	delete_route_in(&agent_dir()?, &family_id, &relay_id)
}

#[tauri::command]
pub fn reorder_routes(family_id: String, relay_ids: Vec<String>) -> Result<FamiliesConfig, String> {
	let _guard = providers::CONFIG_LOCK.lock().map_err(|_| "配置锁异常")?;
	reorder_routes_in(&agent_dir()?, &family_id, &relay_ids)
}

#[tauri::command]
pub fn set_default_route(family_id: String, relay_id: Option<String>) -> Result<FamiliesConfig, String> {
	let _guard = providers::CONFIG_LOCK.lock().map_err(|_| "配置锁异常")?;
	set_default_route_in(&agent_dir()?, &family_id, relay_id.as_deref())
}

#[tauri::command]
pub fn set_family_auto_failover(auto_failover: bool) -> Result<FamiliesConfig, String> {
	let _guard = providers::CONFIG_LOCK.lock().map_err(|_| "配置锁异常")?;
	set_auto_failover_in(&agent_dir()?, auto_failover)
}

#[tauri::command]
pub fn set_family_auto_retry(auto_retry: bool) -> Result<FamiliesConfig, String> {
	let _guard = providers::CONFIG_LOCK.lock().map_err(|_| "配置锁异常")?;
	set_auto_retry_in(&agent_dir()?, auto_retry)
}

#[tauri::command]
pub fn set_usd_cny_rate(rate: f64) -> Result<FamiliesConfig, String> {
	if !rate.is_finite() || !(0.01..=100.0).contains(&rate) {
		return Err("汇率必须在 0.01 到 100 之间".into());
	}
	let _guard = providers::CONFIG_LOCK.lock().map_err(|_| "配置锁异常")?;
	set_usd_cny_rate_in(&agent_dir()?, rate)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn relay_and_discovered_routes_save_together_and_preserve_existing_settings() {
		let dir = std::env::temp_dir().join(format!("skiff-discovered-routes-test-{}", std::process::id()));
		std::fs::create_dir_all(&dir).unwrap();
		let relay: RelaySpec = serde_json::from_value(json!({
			"id": "", "name": "Bailian", "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
			"apiKey": "sk-test-discovery", "excludedModelIds": ["kimi-k3"]
		})).unwrap();
		let routes = || -> Vec<RelayRouteSpec> {
			["deepseek", "kimi", "glm"].iter().map(|id| serde_json::from_value(json!({
				"familyId": id, "route": { "relayId": "", "tools": true, "models": [{
					"modelId": if *id == "kimi" { "kimi-k3".to_string() } else { format!("vendor/{id}-chat") },
					"inputCost": 1.5, "contextWindow": 128000, "maxTokens": 8192
				}] }
			})).unwrap()).collect()
		};
		let saved = save_relay_with_routes_in(&dir, relay, routes()).unwrap();
		let relay = saved.relays[0].clone();
		assert!(!relay.id.is_empty());
		assert_eq!(runtime_offers(&saved).len(), 2);
		let projected = providers::read_config(&dir.join("models.json")).unwrap();
		assert_eq!(projected["providers"][provider_key("glm", &relay.id)]["models"][0]["id"], "vendor/glm-chat");
		assert!(!std::fs::read_to_string(config_path(&dir)).unwrap().contains("sk-test-discovery"));

		// Retesting must preserve manual edits and explicit defaults.
		let mut edited = saved.families[0].routes[0].clone();
		edited.models[0].input_cost = 7.0;
		save_route_in(&dir, "deepseek", edited.clone()).unwrap();
		set_default_route_in(&dir, "deepseek", Some(&edited.id)).unwrap();
		let mut edit_relay = relay.clone();
		edit_relay.api_key.clear();
		edit_relay.excluded_model_ids.clear();
		let repaired = save_relay_with_routes_in(&dir, edit_relay, routes()).unwrap();
		assert_eq!(repaired.relays[0].api_key, "sk-test-discovery");
		assert_eq!(repaired.families[0].routes.len(), 1);
		assert_eq!(repaired.families[0].routes[0].models[0].input_cost, 7.0);
		assert_eq!(repaired.families[0].default_route_id.as_deref(), Some(edited.id.as_str()));
		assert_eq!(runtime_offers(&repaired).len(), 3);

		// A malformed discovered route must not leave a partially saved relay.
		let before = std::fs::read(config_path(&dir)).unwrap();
		let models_before = std::fs::read(dir.join("models.json")).unwrap();
		let mut invalid_relay = relay;
		invalid_relay.id.clear(); invalid_relay.name = "Invalid relay".into();
		let mut invalid_routes = routes();
		invalid_routes[2].route.models[0].max_tokens = 0;
		assert!(save_relay_with_routes_in(&dir, invalid_relay, invalid_routes).is_err());
		assert_eq!(std::fs::read(config_path(&dir)).unwrap(), before);
		assert_eq!(std::fs::read(dir.join("models.json")).unwrap(), models_before);
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[test]
	fn model_vision_survives_save_and_controls_projection_and_runtime_independently() {
		let dir = std::env::temp_dir().join(format!("skiff-model-vision-test-{}", std::process::id()));
		std::fs::create_dir_all(&dir).unwrap();
		let mut config: FamiliesConfig = serde_json::from_value(json!({
			"version": 4,
			"relays": [{ "id": "r1", "name": "Relay", "baseUrl": "https://relay.example/v1", "enabled": true }],
			"families": [{ "id": "glm", "displayName": "GLM", "routes": [{
				"id": "route-glm-r1", "relayId": "r1", "vision": false,
				"models": [
					{ "modelId": "glm-5.3", "vision": false, "contextWindow": 128000, "maxTokens": 8192 },
					{ "modelId": "glm-5.3-flash", "vision": true, "contextWindow": 128000, "maxTokens": 8192 },
					{ "modelId": "legacy", "contextWindow": 128000, "maxTokens": 8192 }
				]
			}] }]
		})).unwrap();
		config.families[0].routes[0].models = normalize_models(&config.families[0].routes[0].models).unwrap();
		for default_vision in [false, true] {
			config.families[0].routes[0].vision = default_vision;
			save(&dir, &config).unwrap();
			let saved = load_plain(&dir).unwrap();
			let route = &saved.families.iter().find(|family| family.id == "glm").unwrap().routes[0];
			assert_eq!(route.models.iter().map(|model| model.vision).collect::<Vec<_>>(), vec![Some(false), Some(true), None]);
			assert_eq!(runtime_offers(&saved).iter().map(|offer| offer.vision).collect::<Vec<_>>(), vec![false, true, default_vision]);
			let expected = vec![json!(["text"]), json!(["text", "image"]), if default_vision { json!(["text", "image"]) } else { json!(["text"]) }];
			let projected = providers::read_config(&dir.join("models.json")).unwrap();
			assert_eq!(projected["providers"]["skiff-relay-r1-glm"]["models"].as_array().unwrap().iter().map(|model| model["input"].clone()).collect::<Vec<_>>(), expected);
			let mut command = std::process::Command::new("pi");
			prepare_runtime(&dir, &mut command).unwrap();
			let runtime: Value = serde_json::from_str(command.get_envs().find(|(name, _)| *name == "SKIFF_FAMILY_RUNTIME").unwrap().1.unwrap().to_str().unwrap()).unwrap();
			assert_eq!(runtime[0]["models"].as_array().unwrap().iter().map(|model| model["input"].clone()).collect::<Vec<_>>(), expected);
		}
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[test]
	fn migrates_v3_route_and_model_fields_without_losing_default() {
		let mut value = json!({
			"version": 3,
			"relays": [{"id": "r1", "name": "Relay", "baseUrl": "https://relay.example/v1", "apiKey": "sealed", "enabled": true}],
			"families": [{"id": "kimi", "displayName": "Kimi", "defaultRelayId": "r1", "routes": [{"relayId": "r1", "models": [{"modelId": "kimi-k3", "inputCost": 1, "outputCost": 4, "currency": "CNY", "maxTokens": 8192, "contextWindow": 128000}]}]}]
		});
		migrate_value_to_v4(&mut value);
		assert_eq!(value["version"], 4);
		assert_eq!(value["relays"][0]["billingAccountId"], "");
		assert_eq!(value["families"][0]["defaultRouteId"], "route-kimi-r1");
		assert_eq!(value["families"][0]["routes"][0]["id"], "route-kimi-r1");
		assert_eq!(value["families"][0]["routes"][0]["enabled"], true);
		assert_eq!(value["families"][0]["routes"][0]["models"][0]["alias"], "");
		assert_eq!(value["families"][0]["routes"][0]["models"][0]["cacheReadCost"], 1);
		assert_eq!(value["families"][0]["routes"][0]["models"][0]["cacheWriteCost"], 1);
	}

	#[test]
	fn runtime_offers_skip_disabled_routes_and_expose_offer_identity() {
		let relay = RelaySpec { id: "r1".into(), name: "Relay".into(), base_url: "https://relay.example/v1".into(), api_key: String::new(), timeout_seconds: 60, enabled: true, billing_account_id: "wallet-a".into(), excluded_model_ids: Vec::new() };
		let model = ModelSpec { model_id: "kimi-k3".into(), vision: None, alias: "k3-便宜".into(), input_cost: 1.0, output_cost: 4.0, cache_read_cost: 0.5, cache_write_cost: 0.7, currency: Currency::Cny, max_tokens: 8192, context_window: 128000 };
		let route = RouteSpec { id: "route-kimi-r1".into(), relay_id: "r1".into(), enabled: true, models: vec![model], streaming: true, tools: true, vision: false, reasoning: true };
		let disabled = RouteSpec { id: "route-kimi-r2".into(), relay_id: "r1".into(), enabled: false, models: vec![], streaming: true, tools: true, vision: false, reasoning: false };
		let family = ModelFamily { id: "kimi".into(), display_name: "Kimi".into(), routes: vec![route, disabled], default_route_id: Some("route-kimi-r1".into()) };
		let config = FamiliesConfig { version: 4, relays: vec![relay], families: vec![family], auto_failover: false, auto_retry: false, usd_cny_rate: 7.2 };
		let offers = runtime_offers(&config);
		assert_eq!(offers.len(), 1);
		assert_eq!(offers[0].offer_id, "route-kimi-r1/kimi-k3");
		assert_eq!(offers[0].billing_account_id, "wallet-a");
		assert_eq!(offers[0].cache_read_cost, 0.5);
	}

	#[test]
	fn projection_and_runtime_drop_disabled_relays_and_routes() {
		let dir = std::env::temp_dir().join(format!("skiff-route-test-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&dir);
		std::fs::create_dir_all(&dir).unwrap();
		std::fs::write(dir.join("models.json"), json!({
			"providers": {
				"custom": {"api": "openai-completions"},
				"skiff-relay-stale-kimi": {"api": "old"}
			}
		}).to_string()).unwrap();
		std::fs::write(dir.join("auth.json"), json!({
			"custom": {"type": "oauth"},
			"skiff-relay-stale-kimi": {"type": "api_key", "key": "old"}
		}).to_string()).unwrap();
		let model = ModelSpec { model_id: "kimi-k3".into(), vision: None, alias: "k3".into(), input_cost: 1.0, output_cost: 4.0, cache_read_cost: 1.0, cache_write_cost: 1.0, currency: Currency::Cny, max_tokens: 8192, context_window: 128000 };
		let active = RouteSpec { id: "route-kimi-r1".into(), relay_id: "r1".into(), enabled: true, models: vec![model.clone()], streaming: true, tools: true, vision: false, reasoning: false };
		let stopped_route = RouteSpec { id: "route-kimi-stopped".into(), relay_id: "r1".into(), enabled: false, models: vec![model.clone()], streaming: true, tools: true, vision: false, reasoning: false };
		let stopped_relay_route = RouteSpec { id: "route-kimi-r2".into(), relay_id: "r2".into(), enabled: true, models: vec![model], streaming: true, tools: true, vision: false, reasoning: false };
		let deepseek_model = ModelSpec { model_id: "deepseek-chat".into(), vision: None, alias: String::new(), input_cost: 0.3, output_cost: 1.2, cache_read_cost: 0.3, cache_write_cost: 0.3, currency: Currency::Cny, max_tokens: 8192, context_window: 128000 };
		let config = FamiliesConfig {
			version: 4,
			relays: vec![
				RelaySpec { id: "r1".into(), name: "Active".into(), base_url: "https://active.example/v1".into(), api_key: "key-active".into(), timeout_seconds: 60, enabled: true, billing_account_id: "wallet-a".into(), excluded_model_ids: Vec::new() },
				RelaySpec { id: "r2".into(), name: "Stopped".into(), base_url: "https://stopped.example/v1".into(), api_key: "key-stopped".into(), timeout_seconds: 60, enabled: false, billing_account_id: "wallet-b".into(), excluded_model_ids: Vec::new() },
			],
			families: vec![
				ModelFamily { id: "kimi".into(), display_name: "Kimi".into(), routes: vec![active, stopped_route, stopped_relay_route], default_route_id: Some("route-kimi-r1".into()) },
				ModelFamily { id: "deepseek".into(), display_name: "DeepSeek".into(), routes: vec![RouteSpec { id: "route-deepseek-r1".into(), relay_id: "r1".into(), enabled: true, models: vec![deepseek_model], streaming: true, tools: true, vision: false, reasoning: false }], default_route_id: Some("route-deepseek-r1".into()) },
			],
			auto_failover: false,
			auto_retry: false,
			usd_cny_rate: 7.2,
		};
		project(&dir, &config).unwrap();
		let projected_models: Value = serde_json::from_slice(&std::fs::read(dir.join("models.json")).unwrap()).unwrap();
		let projected_auth: Value = serde_json::from_slice(&std::fs::read(dir.join("auth.json")).unwrap()).unwrap();
		assert!(projected_models["providers"]["skiff-relay-r1-kimi"].is_object());
		assert!(projected_models["providers"]["skiff-relay-r1-deepseek"].is_object());
		assert!(projected_models["providers"]["skiff-relay-stale-kimi"].is_null());
		assert!(projected_models["providers"]["custom"].is_object());
		assert!(projected_auth["skiff-relay-r1-kimi"].is_object());
		assert!(projected_auth["skiff-relay-stale-kimi"].is_null());
		std::fs::write(config_path(&dir), serde_json::to_vec(&config).unwrap()).unwrap();
		let mut command = std::process::Command::new("pi");
		prepare_runtime(&dir, &mut command).unwrap();
		let env_names: Vec<String> = command.get_envs().filter_map(|(key, _)| key.to_str().map(str::to_string)).collect();
		assert!(env_names.iter().any(|key| key == "SKIFF_KEY_skiff_relay_r1_kimi"));
		assert!(env_names.iter().any(|key| key == "SKIFF_KEY_skiff_relay_r1_deepseek"));
		assert!(!env_names.iter().any(|key| key == "SKIFF_KEY_skiff_relay_r2_kimi"));
		let _ = std::fs::remove_dir_all(&dir);
	}

	#[test]
	fn default_route_changes_require_an_explicit_replacement_or_clear() {
		let dir = std::env::temp_dir().join(format!("skiff-default-test-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&dir);
		std::fs::create_dir_all(&dir).unwrap();
		let model = ModelSpec { model_id: "kimi-k3".into(), vision: None, alias: String::new(), input_cost: 1.0, output_cost: 4.0, cache_read_cost: 1.0, cache_write_cost: 1.0, currency: Currency::Cny, max_tokens: 8192, context_window: 128000 };
		let config = FamiliesConfig {
			version: 4,
			relays: vec![
				RelaySpec { id: "r1".into(), name: "Primary".into(), base_url: "https://primary.example/v1".into(), api_key: "key-1".into(), timeout_seconds: 60, enabled: true, billing_account_id: String::new(), excluded_model_ids: Vec::new() },
				RelaySpec { id: "r2".into(), name: "Backup".into(), base_url: "https://backup.example/v1".into(), api_key: "key-2".into(), timeout_seconds: 60, enabled: true, billing_account_id: String::new(), excluded_model_ids: Vec::new() },
			],
			families: vec![ModelFamily { id: "kimi".into(), display_name: "Kimi".into(), routes: vec![
				RouteSpec { id: "route-kimi-r1".into(), relay_id: "r1".into(), enabled: true, models: vec![model.clone()], streaming: true, tools: true, vision: false, reasoning: false },
				RouteSpec { id: "route-kimi-r2".into(), relay_id: "r2".into(), enabled: true, models: vec![model], streaming: true, tools: true, vision: false, reasoning: false },
			], default_route_id: Some("route-kimi-r1".into()) }],
			auto_failover: false,
			auto_retry: false,
			usd_cny_rate: 7.2,
		};
		std::fs::write(config_path(&dir), serde_json::to_vec(&config).unwrap()).unwrap();
		assert!(set_relay_enabled_in(&dir, "r1", false).is_err());
		assert!(delete_route_in(&dir, "kimi", "route-kimi-r1").is_err());
		let _ = std::fs::remove_dir_all(&dir);
	}
}

/// models.dev 公共模型目录（官方牌价），带 24h 磁盘缓存。
#[tauri::command]
pub async fn fetch_public_catalog() -> Result<providers::CatalogResponse, String> {
	providers::public_catalog(&agent_dir()?).await
}

///模型发现沿用 OpenAI 兼容 `/models`，供线路添加时拉取模型 ID。
#[tauri::command]
pub async fn discover_relay_models(base_url: String, api_key: String) -> Result<Vec<String>, String> {
	providers::discover(&base_url, &api_key).await
}

/// 抓取用户提供的公开模型定价页，由前端解析出模型与价格。
#[tauri::command]
pub async fn fetch_pricing_page(url: String) -> Result<providers::FetchedPage, String> {
	providers::fetch_pricing_page(&url).await
}

/// 截图识别导入：把图片与识别指令发给中转的视觉模型，返回原文与用量。
#[tauri::command]
pub async fn extract_pricing_table(base_url: String, api_key: String, model_id: String, instruction: String, images: Vec<String>) -> Result<providers::ExtractedTable, String> {
	providers::extract_pricing_table(&base_url, &api_key, &model_id, &instruction, &images).await
}

#[derive(Default)]
struct ProviderTestRequests {
	running: HashMap<String, tauri::async_runtime::Sender<()>>,
	// IPC cancellation can arrive before the test command starts running.
	cancelled: HashMap<String, std::time::Instant>,
}

fn provider_test_requests() -> &'static Mutex<ProviderTestRequests> {
	static REQUESTS: OnceLock<Mutex<ProviderTestRequests>> = OnceLock::new();
	REQUESTS.get_or_init(|| Mutex::new(ProviderTestRequests::default()))
}

/// Dropping the request future closes an in-flight HTTP request, including body reads.
#[tauri::command]
pub fn cancel_provider_test(request_id: String) -> Result<(), String> {
	if request_id.is_empty() || request_id.len() > 128 { return Err("测试请求标识无效".into()); }
	let mut requests = provider_test_requests().lock().map_err(|_| "无法停止测试")?;
	requests.cancelled.retain(|_, time| time.elapsed().as_secs() < 60);
	if let Some(sender) = requests.running.get(&request_id) { let _ = sender.try_send(()); }
	else { requests.cancelled.insert(request_id, std::time::Instant::now()); }
	Ok(())
}

/// One `max_tokens=1` completion proves the relay endpoint, key and model work.
#[tauri::command]
pub async fn test_provider_connection(base_url: String, api_key: String, model_id: String, timeout_seconds: Option<u64>, request_id: Option<String>) -> Result<TestResult, String> {
	let Some(request_id) = request_id else {
		return run_provider_test(base_url, api_key, model_id, timeout_seconds).await;
	};
	if request_id.is_empty() || request_id.len() > 128 { return Err("测试请求标识无效".into()); }
	let (sender, mut receiver) = tauri::async_runtime::channel(1);
	{
		let mut requests = provider_test_requests().lock().map_err(|_| "无法初始化测试")?;
		requests.cancelled.retain(|_, time| time.elapsed().as_secs() < 60);
		if requests.cancelled.remove(&request_id).is_some() { return Err("测试已停止".into()); }
		if requests.running.contains_key(&request_id) { return Err("测试请求标识重复".into()); }
		requests.running.insert(request_id.clone(), sender);
	}
	let mut pending = Box::pin(run_provider_test(base_url, api_key, model_id, timeout_seconds));
	let result = std::future::poll_fn(|context| {
		if receiver.poll_recv(context).is_ready() { return Poll::Ready(Err("测试已停止".into())); }
		pending.as_mut().poll(context)
	}).await;
	if let Ok(mut requests) = provider_test_requests().lock() { requests.running.remove(&request_id); }
	result
}

async fn run_provider_test(base_url: String, api_key: String, model_id: String, timeout_seconds: Option<u64>) -> Result<TestResult, String> {
	let base = validate_base_url(&base_url)?;
	let model = validate_model_id(&model_id)?;
	let key = validate_api_key(&api_key)?;
	if key.is_empty() {
		return Err("请先填写 API Key".into());
	}
	let timeout = timeout_seconds.unwrap_or(20).clamp(5, 600);
	let client = reqwest::Client::builder()
		.timeout(std::time::Duration::from_secs(timeout))
		.redirect(reqwest::redirect::Policy::none())
		.build()
		.map_err(|_| "无法初始化连接".to_string())?;
	let started = std::time::Instant::now();
	let response = client
		.post(format!("{base}/chat/completions"))
		.bearer_auth(&key)
		.json(&json!({
			"model": model,
			"messages": [{ "role": "user", "content": "ping" }],
			"max_tokens": 1,
		}))
		.send()
		.await;
	let latency_ms = started.elapsed().as_millis() as u64;
	match response {
		Ok(mut response) => {
			let status = response.status();
			let mut bytes = Vec::new();
			loop {
				match response.chunk().await {
					Ok(Some(chunk)) => {
						let remaining = 16_384 - bytes.len();
						bytes.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
						if bytes.len() == 16_384 { break; }
					}
					Ok(None) => break,
					Err(error) => return Ok(TestResult { ok: false, latency_ms: started.elapsed().as_millis() as u64,
						status: Some(status.as_u16()), error: Some(network_error(&error)) }),
				}
			}
			let latency_ms = started.elapsed().as_millis() as u64;
			let body = String::from_utf8_lossy(&bytes);
			if status.is_success() {
				Ok(TestResult { ok: true, latency_ms, status: Some(status.as_u16()), error: None })
			} else {
				Ok(TestResult { ok: false, latency_ms, status: Some(status.as_u16()), error: Some(summarize(&body.replace(&key, "[密钥已隐藏]"))) })
			}
		}
		Err(error) => Ok(TestResult { ok: false, latency_ms, status: None, error: Some(network_error(&error)) }),
	}
}

/// Short, log-safe excerpt of a provider error body.
fn summarize(body: &str) -> String {
	let collapsed: String = body.split_whitespace().collect::<Vec<_>>().join(" ");
	if collapsed.is_empty() {
		return "响应体为空".into();
	}
	let mut text: String = collapsed.chars().take(200).collect();
	if collapsed.chars().count() > 200 {
		text.push('…');
	}
	text
}

fn network_error(error: &reqwest::Error) -> String {
	if error.is_timeout() {
		"请求超时".into()
	} else if error.is_connect() {
		"无法连接，请检查 Base URL 与网络".into()
	} else {
		"请求失败".into()
	}
}

#[cfg(test)]
mod connection_test_tests {
	use super::*;
	use std::io::{Read, Write};
	use std::net::TcpListener;
	use std::sync::mpsc;
	use std::time::{Duration, Instant};

	fn stops_stalled_request(send_headers: bool) {
		let listener = TcpListener::bind("127.0.0.1:0").unwrap();
		let address = listener.local_addr().unwrap();
		let (ready_tx, ready_rx) = mpsc::channel();
		let (release_tx, release_rx) = mpsc::channel();
		let server = std::thread::spawn(move || {
			let (mut socket, _) = listener.accept().unwrap();
			socket.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
			let mut buffer = [0; 4096];
			let _ = socket.read(&mut buffer).unwrap();
			if send_headers {
				socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n{").unwrap();
			}
			ready_tx.send(()).unwrap();
			let _ = release_rx.recv_timeout(Duration::from_secs(5));
		});
		let request_id = format!("cancel-{address}-{send_headers}");
		let token = request_id.clone();
		let (done_tx, done_rx) = mpsc::channel();
		tauri::async_runtime::spawn(async move {
			let result = test_provider_connection(format!("http://{address}/v1"), "test-key".into(), "test-model".into(), Some(60), Some(token)).await;
			let _ = done_tx.send(result);
		});
		ready_rx.recv_timeout(Duration::from_secs(5)).unwrap();
		let stopped = Instant::now();
		cancel_provider_test(request_id.clone()).unwrap();
		let result = done_rx.recv_timeout(Duration::from_secs(2));
		let _ = release_tx.send(());
		server.join().unwrap();
		assert_eq!(result.unwrap().err().unwrap(), "测试已停止");
		assert!(stopped.elapsed() < Duration::from_secs(2));
		assert!(!provider_test_requests().lock().unwrap().running.contains_key(&request_id));
	}

	#[test]
	fn stopping_cancels_waiting_for_headers() { stops_stalled_request(false); }

	#[test]
	fn stopping_cancels_waiting_for_body() { stops_stalled_request(true); }

	#[test]
	fn stopping_before_registration_does_not_send_a_request() {
		let request_id = "cancel-before-start".to_string();
		cancel_provider_test(request_id.clone()).unwrap();
		let result = tauri::async_runtime::block_on(test_provider_connection("http://127.0.0.1:1/v1".into(), "test-key".into(), "test-model".into(), Some(60), Some(request_id)));
		assert_eq!(result.err().unwrap(), "测试已停止");
	}

	#[test]
	fn exclusions_persist_filter_runtime_and_projection_and_can_be_restored() {
		let dir = std::env::temp_dir().join(format!("skiff-exclusions-{}", next_id()));
		let mut config: FamiliesConfig = serde_json::from_value(json!({
			"relays": [
				{ "id": "r1", "name": "One", "baseUrl": "https://one.example/v1", "apiKey": "test-key", "excludedModelIds": ["slow"] },
				{ "id": "r2", "name": "Two", "baseUrl": "https://two.example/v1" }
			],
			"families": [{ "id": "deepseek", "displayName": "DeepSeek", "routes": [
				{ "id": "route-one", "relayId": "r1", "models": [
					{ "modelId": "fast", "contextWindow": 1000, "maxTokens": 100 },
					{ "modelId": "slow", "contextWindow": 1000, "maxTokens": 100 }
				] },
				{ "id": "route-two", "relayId": "r2", "models": [{ "modelId": "slow", "contextWindow": 1000, "maxTokens": 100 }] }
			] }]
		})).unwrap();
		save(&dir, &config).unwrap();
		let saved = load_plain(&dir).unwrap();
		assert_eq!(saved.relays[0].excluded_model_ids, ["slow"]);
		assert_eq!(runtime_offers(&saved).iter().map(|offer| (offer.relay_id.as_str(), offer.model_id.as_str())).collect::<Vec<_>>(), [("r1", "fast"), ("r2", "slow")]);
		let projected = providers::read_config(&dir.join("models.json")).unwrap();
		assert_eq!(projected["providers"]["skiff-relay-r1-deepseek"]["models"].as_array().unwrap().len(), 1);
		let mut command = std::process::Command::new("pi");
		prepare_runtime(&dir, &mut command).unwrap();
		let runtime: Value = serde_json::from_str(command.get_envs().find(|(name, _)| *name == "SKIFF_FAMILY_RUNTIME").unwrap().1.unwrap().to_str().unwrap()).unwrap();
		assert_eq!(runtime[0]["models"].as_array().unwrap().len(), 1);
		assert_eq!(saved.families[0].routes[0].models.len(), 2);
		config.relays[0].excluded_model_ids.push("fast".into());
		save(&dir, &config).unwrap();
		assert!(providers::read_config(&dir.join("models.json")).unwrap()["providers"]["skiff-relay-r1-deepseek"].is_null());
		config.relays[0].excluded_model_ids.clear();
		save(&dir, &config).unwrap();
		assert_eq!(runtime_offers(&load_plain(&dir).unwrap()).len(), 3);
		std::fs::remove_dir_all(dir).unwrap();
	}
}
