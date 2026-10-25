//! Model families: the user-facing way to organise models.
//!
//! Skiff fixes four model families (DeepSeek, Kimi, GLM, Auto). Endpoints live
//! in relays — one base URL plus one API key. A route binds a relay to a family
//! and lists the models (with per-model prices and limits) the relay serves
//! for that family, so one relay can back all four families without retyping
//! credentials. The routes array order is the family's priority: the first
//! enabled, available route serves a model, and later routes provide failover.
//! Selection happens on (family, model)
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

/// The families are fixed by design: users add relays and routes, never families.
pub const FAMILY_IDS: [&str; 4] = ["deepseek", "kimi", "glm", "auto"];

/// Route projection prefix; keys look like `skiff-relay-<relay>-<family>`.
const KEY_PREFIX: &str = "skiff-relay-";
/// Anything under this prefix is managed by Skiff and may be garbage-collected.
const MANAGED_PREFIX: &str = "skiff-";

/// pi's thinking levels in ascending order. `off` is implicit: it is always
/// selectable, and the levels after it are the ones a model may support.
const THINKING_LEVELS: [&str; 6] = ["minimal", "low", "medium", "high", "xhigh", "max"];

/// Relay protocols in display order: stored id plus the pi API that speaks it.
const PROTOCOLS: [(&str, &str); 6] = [
	("kimi", "openai-completions"),
	("openai", "openai-completions"),
	("openai-responses", "openai-responses"),
	("anthropic", "anthropic-messages"),
	("google-genai", "google-generative-ai"),
	("vertex", "google-vertex"),
];

/// Unknown, absent or mixed-case values fall back to the legacy default.
pub(crate) fn normalize_protocol(raw: Option<&str>) -> String {
	let candidate = raw.unwrap_or("").trim().to_ascii_lowercase();
	PROTOCOLS.iter().find(|(id, _)| *id == candidate).map(|(id, _)| (*id).to_string()).unwrap_or_else(|| "openai".into())
}

/// The pi API name a relay's protocol speaks.
pub fn protocol_api(relay: &RelaySpec) -> &'static str {
	let protocol = normalize_protocol(relay.protocol.as_deref());
	PROTOCOLS.iter().find(|(id, _)| *id == protocol).map(|(_, api)| *api).unwrap_or("openai-completions")
}

/// Anthropic's SDK appends `/v1` itself, so a relay typed as
/// `https://api.anthropic.com/v1` must lose that suffix before use.
pub(crate) fn anthropic_root(base: &str) -> String {
	let trimmed = base.trim_end_matches('/');
	match trimmed.strip_suffix("/v1") {
		Some(root) if !root.is_empty() => root.to_string(),
		_ => trimmed.to_string(),
	}
}

/// The messages endpoint the SDK will actually call for a stored base URL.
fn anthropic_messages_url(base: &str) -> String {
	format!("{}/v1/messages", anthropic_root(base))
}

/// The base URL pi should use for a relay, which differs per adapter.
pub(crate) fn runtime_base_url(relay: &RelaySpec) -> String {
	if protocol_api(relay) == "anthropic-messages" { anthropic_root(&relay.base_url) } else { relay.base_url.clone() }
}

/// pi only lists `xhigh` and `max` when `thinkingLevelMap` declares them, and
/// otherwise offers every remaining level unconditionally. Projecting real
/// capabilities therefore means writing the map explicitly.
fn thinking_level_map(levels: &[String]) -> Value {
	let mut map = serde_json::Map::new();
	for level in THINKING_LEVELS.iter() {
		// A level the model lacks is declared `null`, which is how pi hides it;
		// omission would leave it enabled.
		let available = levels.iter().any(|declared| declared == level);
		map.insert((*level).to_string(), if available { Value::String((*level).to_string()) } else { Value::Null });
	}
	Value::Object(map)
}

/// Accepts every level a model is declared to support, dropping `off` (which
/// is implicit) and returning the levels in pi's order.
fn normalize_thinking_levels(levels: Option<&[String]>) -> Result<Vec<String>, String> {
	let mut accepted = std::collections::HashSet::new();
	for level in levels.unwrap_or_default() {
		let level = level.trim().to_ascii_lowercase();
		if level == "off" || level.is_empty() { continue; }
		if !THINKING_LEVELS.contains(&level.as_str()) {
			return Err(format!("不支持的推理等级：{level}"));
		}
		accepted.insert(level);
	}
	Ok(THINKING_LEVELS.iter().filter(|level| accepted.contains(**level)).map(|level| (*level).to_string()).collect())
}

pub fn family_display(id: &str) -> &'static str {
	match id {
		"deepseek" => "DeepSeek",
		"kimi" => "Kimi",
		"glm" => "GLM",
		"auto" => "Auto",
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
	5
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
	/// Thinking levels this model supports; absent inherits the route default.
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub thinking_levels: Option<Vec<String>>,
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
	/// Wire protocol: `openai` (default), `kimi`, `openai-responses`,
	/// `anthropic`, `google-genai` or `vertex`. Absent means the legacy
	/// OpenAI-compatible behaviour.
	#[serde(default)]
	pub protocol: Option<String>,
	#[serde(default = "default_timeout")]
	pub timeout_seconds: u64,
	#[serde(default = "default_true")]
	pub enabled: bool,
	#[serde(default)]
	pub billing_account_id: String,
	/// Applied to official model prices for runtime billing; absent preserves legacy prices.
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub price_multiplier: Option<f64>,
	#[serde(default)]
	pub excluded_model_ids: Vec<String>,
	/// Discovered models that belong to no family yet. They stay attached to the
	/// relay (never projected, never offered) so a provider can be saved before
	/// the family it needs exists.
	#[serde(default, skip_serializing_if = "Vec::is_empty")]
	pub unassigned_models: Vec<ModelSpec>,
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
	/// Thinking levels offered by every model of this route unless a model
	/// overrides it. Empty keeps pi's historical five-level set.
	#[serde(default, skip_serializing_if = "Vec::is_empty")]
	pub thinking_levels: Vec<String>,
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
	/// Array order is the family's priority for initial selection and failover.
	#[serde(default)]
	pub routes: Vec<RouteSpec>,
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
	#[serde(skip_serializing_if = "Option::is_none")]
	pub price_multiplier: Option<f64>,
	pub route_order: usize,
	pub streaming: bool,
	pub tools: bool,
	pub vision: bool,
	pub reasoning: bool,
	/// Resolved thinking levels, `off` included: what the picker will offer.
	pub thinking_levels: Vec<String>,
	pub input_cost: f64,
	pub output_cost: f64,
	pub cache_read_cost: f64,
	pub cache_write_cost: f64,
	pub currency: Currency,
	pub max_tokens: u64,
	pub context_window: u64,
}

#[derive(Clone, Serialize)]
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

/// Adds route identity and pricing fields, and converts the legacy explicit
/// route choice into the new ordering rule before serde deserializes the file.
fn migrate_value_to_v5(value: &mut Value) {
	let Some(root) = value.as_object_mut() else { return };
	let mut families = root.get_mut("families").and_then(Value::as_array_mut);
	if let Some(families) = families.as_deref_mut() {
		for family in families {
			let Some(family_obj) = family.as_object_mut() else { continue };
			let family_id = family_obj.get("id").and_then(Value::as_str).unwrap_or("family").to_string();
			let preferred_route = family_obj.remove("defaultRouteId").filter(Value::is_string).or_else(|| family_obj.remove("defaultRelayId"));
			let routes = family_obj.get_mut("routes").and_then(Value::as_array_mut);
			if let Some(routes) = routes {
				for route in routes {
					let Some(route_obj) = route.as_object_mut() else { continue };
					let relay_id = route_obj.get("relayId").and_then(Value::as_str).unwrap_or("relay").to_string();
					let route_id = route_obj.get("id").and_then(Value::as_str).filter(|id| !id.is_empty()).map(str::to_string)
						.unwrap_or_else(|| route_id_seed(&family_id, &relay_id));
					route_obj.insert("id".into(), Value::String(route_id.clone()));
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
			if let (Some(preferred), Some(routes)) = (preferred_route.as_ref().and_then(Value::as_str), family_obj.get_mut("routes").and_then(Value::as_array_mut)) {
				if let Some(index) = routes.iter().position(|route| route.get("id").and_then(Value::as_str) == Some(preferred) || route.get("relayId").and_then(Value::as_str) == Some(preferred)) {
					routes.swap(0, index);
				}
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
	root.insert("version".into(), Value::from(5));
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
	migrate_value_to_v5(&mut value);
	let mut config: FamiliesConfig = serde_json::from_value(value)
		.map_err(|_| "家族配置不是有效 JSON，请修复或删除 skiff-families.json".to_string())?;
	// Older files may predate a family; reinstate it empty rather than dropping it.
	for id in FAMILY_IDS {
		if !config.families.iter().any(|family| family.id == id) {
			config.families.push(ModelFamily {
				id: id.to_string(),
				display_name: family_display(id).to_string(),
				routes: Vec::new(),
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
	if relay.price_multiplier.is_some_and(|value| !value.is_finite() || value < 0.0) {
		return Err("价格倍率必须为非负数".into());
	}
	relay.timeout_seconds = relay.timeout_seconds.clamp(5, 600);
	relay.excluded_model_ids = relay.excluded_model_ids.iter().map(|id| validate_model_id(id)).collect::<Result<Vec<_>, _>>()?;
	relay.excluded_model_ids.sort();
	relay.excluded_model_ids.dedup();
	relay.unassigned_models = normalize_models(&relay.unassigned_models)?;
	relay.protocol = Some(normalize_protocol(relay.protocol.as_deref()));
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
		let thinking_levels = model.thinking_levels.as_deref().map(|levels| normalize_thinking_levels(Some(levels))).transpose()?;
		let input_cost = money(model.input_cost);
		let cache_read_cost = if model.cache_read_cost == 0.0 && input_cost > 0.0 { input_cost } else { money(model.cache_read_cost) };
		let cache_write_cost = if model.cache_write_cost == 0.0 && input_cost > 0.0 { input_cost } else { money(model.cache_write_cost) };
		normalized.push(ModelSpec {
			model_id,
			vision: model.vision,
			thinking_levels,
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
	for relay in &config.relays {
		if relay.price_multiplier.is_some_and(|value| !value.is_finite() || value < 0.0) {
			return Err("价格倍率必须为非负数".into());
		}
		let multiplier = relay.price_multiplier.unwrap_or(1.0);
		if relay_models(config, &relay.id).iter().any(|(_, model)| [model.input_cost, model.output_cost, model.cache_read_cost, model.cache_write_cost].iter().any(|cost| !(cost * multiplier).is_finite())) {
			return Err("模型单价与价格倍率的乘积超出范围".into());
		}
	}
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
	Ok(RouteSpec { id, relay_id: route.relay_id.clone(), enabled: route.enabled, models, streaming: route.streaming, tools: route.tools, vision: route.vision, reasoning: route.reasoning, thinking_levels: normalize_thinking_levels(Some(&route.thinking_levels))? })
}

fn family_mut<'a>(config: &'a mut FamiliesConfig, family_id: &str) -> Result<&'a mut ModelFamily, String> {
	// Any family present in the config qualifies: the built-ins are reinstated on
	// load, and users can create additional families from the provider editor.
	config
		.families
		.iter_mut()
		.find(|family| family.id == family_id)
		.ok_or_else(|| format!("找不到模型家族：{family_id}"))
}

// --- projection into pi's own configuration ---------------------------------

/// pi's provider identifier for one route; also its key in `auth.json`.
pub fn provider_key(family_id: &str, relay_id: &str) -> String {
	format!("{KEY_PREFIX}{}-{family_id}", sanitize_component(relay_id))
}

fn key_env(key: &str) -> String {
	format!("SKIFF_KEY_{}", key.replace('-', "_"))
}

/// The levels a model advertises: its own declaration, else the route default.
fn model_thinking_levels(route: &RouteSpec, item: &ModelSpec) -> Vec<String> {
	if let Some(levels) = &item.thinking_levels {
		return levels.clone();
	}
	route.thinking_levels.clone()
}

fn project_model(family_id: &str, route: &RouteSpec, item: &ModelSpec, key: &str, api: &str, multiplier: f64) -> Value {
	let vision = if item.vision.unwrap_or(route.vision) { json!(["text", "image"]) } else { json!(["text"]) };
	let reasoning = route.reasoning;
	let compat = if api == "openai-completions" {
		let mut compat = json!({ "supportsDeveloperRole": false });
		// Custom relay provider names and URLs hide DeepSeek from pi-ai's
		// built-in detection. LiteLLM requires reasoning_content on every
		// assistant turn, including assistant tool-call messages with no
		// reasoning block, so explicitly retain DeepSeek's wire format.
		if family_id == "deepseek" {
			compat["requiresReasoningContentOnAssistantMessages"] = json!(true);
			compat["thinkingFormat"] = json!("deepseek");
		}
		compat
	} else {
		Value::Null
	};
	// A level list that is empty (or absent) is "not declared"; pi then keeps its
	// own five-level default instead of losing `minimal`.
	let declared = item.thinking_levels.as_ref().filter(|levels| !levels.is_empty()).cloned().unwrap_or_else(|| route.thinking_levels.clone());
	json!({
		"id": item.model_id, "name": if item.alias.is_empty() { item.model_id.clone() } else { item.alias.clone() }, "api": api, "provider": key,
		"cost": { "input": item.input_cost * multiplier, "output": item.output_cost * multiplier, "cacheRead": item.cache_read_cost * multiplier, "cacheWrite": item.cache_write_cost * multiplier },
		"currency": item.currency, "contextWindow": item.context_window, "maxTokens": item.max_tokens,
		"input": vision, "reasoning": reasoning,
		// Only reasoning models get a map: pi lists `xhigh` and `max` from it.
		"thinkingLevelMap": if reasoning && !declared.is_empty() { thinking_level_map(&declared) } else { Value::Null },
		// Only OpenAI-compatible relays need the developer-role opt-out; the
		// other adapters build their own request shapes.
		"compat": compat,
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
	// A pi agent can write files in its workspace, including models.json. Restore
	// Skiff-owned provider entries before pi reads its config so a model editing
	// that file cannot leave the next connection with stale or missing routes.
	// `project` preserves providers and fields that Skiff does not own.
	project(dir, &config)?;
	prepare_retry(dir)?;
	prepare_shell_prefix(dir)?;
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
				let api = protocol_api(relay);
				// Every route of a relay shares one key environment variable.
				cmd.env(key_env(&route_key), &relay.api_key);
				routes.push(json!({ "providerKey": route_key, "baseUrl": runtime_base_url(relay), "api": api,
					"keyEnv": key_env(&route_key), "streaming": route.streaming, "tools": route.tools,
					"timeoutSeconds": relay.timeout_seconds,
				"models": models.iter().map(|model| project_model(&family.id, route, model, &route_key, api, relay.price_multiplier.unwrap_or(1.0))).collect::<Vec<_>>() }));
			}
		}
	}
	eprintln!("[skiff] prepare_runtime: {} enabled route(s) to project", routes.len());
	if routes.is_empty() {
		eprintln!("[skiff] prepare_runtime: no enabled routes; pi will start without managed providers");
		return Ok(());
	}
	let extension = dir.join("skiff-family-runtime.js");
	let source = include_str!("pi_extensions/model_families.js");
	if std::fs::read_to_string(&extension).ok().as_deref() != Some(source) {
		std::fs::write(&extension, source).map_err(|_| "无法安装模型家族请求适配器")?;
	}
	let encoded = serde_json::to_string(&routes).map_err(|_| "无法编码线路配置")?;
	// Windows limits the complete child environment to roughly 32 KiB. A
	// workspace with many routes/models can exceed that when the whole runtime
	// projection is placed in one environment variable, leaving pi with no
	// registered managed providers and misleading "Model not found" errors.
	// Keep the JSON environment path for small configurations and use a local,
	// key-free file for larger projections.
	let runtime_file = dir.join("skiff-family-runtime.json");
	std::fs::write(&runtime_file, &encoded).map_err(|_| "无法写入模型家族运行时配置")?;
	eprintln!("[skiff] prepare_runtime: extension={} runtime_file={} encoded_bytes={}", extension.display(), runtime_file.display(), encoded.len());
	cmd.env("SKIFF_FAMILY_RUNTIME_FILE", &runtime_file);
	if encoded.len() <= 24_000 { cmd.env("SKIFF_FAMILY_RUNTIME", encoded); }
	else { cmd.env_remove("SKIFF_FAMILY_RUNTIME"); }
	cmd.arg("--extension").arg(extension);
	Ok(())
}

/// Let pi own continuation, backoff and cancellation; never resend user prompts.
fn prepare_retry(dir: &Path) -> Result<(), String> {
	let path = dir.join("settings.json");
	let original = providers::read_config(&path)?;
	let mut settings = original.clone();
	if !settings["retry"].is_object() { settings["retry"] = json!({}); }
	settings["retry"]["enabled"] = json!(true);
	settings["retry"]["maxRetries"] = json!(5);
	if settings != original { providers::atomic_write(&path, &settings)?; }
	Ok(())
}

/// Windows native commands (`ping`, `ipconfig`, `systeminfo`) write their
/// console code page, which is GBK on a Chinese system. pi decodes child output
/// as UTF-8, so those bytes turn into U+FFFD replacement characters before
/// Skiff ever sees them. Switching the shell's console to UTF-8 first makes the
/// bytes match pi's decoder; Windows then falls back to English messages for
/// commands whose resources have no 65001 table.
#[cfg(windows)]
const SHELL_COMMAND_PREFIX: Option<&str> = Some("chcp.com 65001 >/dev/null 2>&1");
#[cfg(not(windows))]
const SHELL_COMMAND_PREFIX: Option<&str> = None;

/// A prefix the user set themselves wins: it may already switch code pages or
/// prepare the shell in a way that matters to their workflows.
fn prepare_shell_prefix(dir: &Path) -> Result<(), String> {
	let Some(prefix) = SHELL_COMMAND_PREFIX else { return Ok(()); };
	let path = dir.join("settings.json");
	let original = providers::read_config(&path)?;
	if original["shellCommandPrefix"].is_string() {
		return Ok(());
	}
	let mut settings = original.clone();
	settings["shellCommandPrefix"] = json!(prefix);
	providers::atomic_write(&path, &settings)?;
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
	let mut desired: Vec<(String, &str, &RelaySpec, &RouteSpec)> = Vec::new();
	for family in &config.families {
		for route in &family.routes {
			if !route.enabled || route.models.is_empty() { continue; }
			let Some(relay) = config.relays.iter().find(|relay| relay.id == route.relay_id) else { continue };
			if !relay.enabled || route.models.iter().all(|model| relay.excluded_model_ids.contains(&model.model_id)) { continue; }
			desired.push((provider_key(&family.id, &relay.id), &family.id, relay, route));
		}
	}

	{
		let map = models["providers"].as_object_mut().ok_or("pi 配置的 providers 必须是对象")?;
		map.retain(|key, _| !is_managed_key(key) || desired.iter().any(|(wanted, _, _, _)| wanted == key));
		for (key, family_id, relay, route) in &desired {
			let api = protocol_api(relay);
			let entry = json!({
				"api": api,
				"baseUrl": runtime_base_url(relay),
				"models": route.models.iter().filter(|item| !relay.excluded_model_ids.contains(&item.model_id)).map(|item| project_model(family_id, route, item, key, api, relay.price_multiplier.unwrap_or(1.0))).collect::<Vec<_>>(),
			});
			map.insert(key.clone(), entry);
		}
	}

	if let Some(map) = auth.as_object_mut() {
		map.retain(|key, _| !is_managed_key(key) || desired.iter().any(|(wanted, _, _, _)| wanted == key));
		for (key, _, relay, _) in &desired {
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
					price_multiplier: relay.price_multiplier,
					route_order,
					streaming: route.streaming,
					tools: route.tools,
					vision: model.vision.unwrap_or(route.vision),
					reasoning: route.reasoning,
					thinking_levels: if route.reasoning {
						let declared = model_thinking_levels(route, model);
						["off".to_string()].into_iter().chain(declared).collect()
					} else {
						vec!["off".to_string()]
					},
					input_cost: model.input_cost * relay.price_multiplier.unwrap_or(1.0),
					output_cost: model.output_cost * relay.price_multiplier.unwrap_or(1.0),
					cache_read_cost: model.cache_read_cost * relay.price_multiplier.unwrap_or(1.0),
					cache_write_cost: model.cache_write_cost * relay.price_multiplier.unwrap_or(1.0),
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
	crate::settings_metadata::reconcile(dir, &config);
	Ok(config)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayBatchPreview {
	pub token: String,
	pub names: Vec<String>,
	pub route_count: usize,
}

pub fn relay_batch_preview(config: &FamiliesConfig, relay_ids: &[String]) -> Result<RelayBatchPreview, String> {
	use sha2::{Digest, Sha256};
	if relay_ids.is_empty() || relay_ids.iter().collect::<std::collections::HashSet<_>>().len() != relay_ids.len() { return Err("请选择供应商，且不能重复选择".into()); }
	let mut names = Vec::new();
	for id in relay_ids { names.push(config.relays.iter().find(|relay| &relay.id == id).ok_or("所选供应商已不存在，请重新加载预览")?.name.clone()); }
	let route_count = config.families.iter().flat_map(|family| &family.routes).filter(|route| relay_ids.contains(&route.relay_id)).count();
	let token = format!("{:x}", Sha256::digest(serde_json::to_vec(config).map_err(|_| "无法生成确认预览")?));
	Ok(RelayBatchPreview { token, names, route_count })
}

pub fn batch_relays_in(dir: &Path, relay_ids: &[String], operation: &str, expected_token: &str) -> Result<FamiliesConfig, String> {
	apply(dir, |config| {
		let preview = relay_batch_preview(config, relay_ids)?;
		if preview.token != expected_token { return Err("配置已变化，操作未提交，请重新确认影响预览".into()); }
		match operation {
			"enable" | "disable" => { for relay in &mut config.relays { if relay_ids.contains(&relay.id) { relay.enabled = operation == "enable"; } } }
			"delete" => {
				config.relays.retain(|relay| !relay_ids.contains(&relay.id));
				for family in &mut config.families { family.routes.retain(|route| !relay_ids.contains(&route.relay_id)); }
			}
			_ => return Err("未知批量操作".into()),
		}
		Ok(())
	})
}

#[tauri::command]
pub fn preview_relay_batch(relay_ids: Vec<String>) -> Result<RelayBatchPreview, String> {
	let _guard = providers::CONFIG_LOCK.lock().map_err(|_| "配置锁异常")?;
	relay_batch_preview(&load_plain(&agent_dir()?)?, &relay_ids)
}

#[tauri::command]
pub fn batch_relays(relay_ids: Vec<String>, operation: String, expected_token: String) -> Result<FamiliesConfig, String> {
	let _guard = providers::CONFIG_LOCK.lock().map_err(|_| "配置锁异常")?;
	batch_relays_in(&agent_dir()?, &relay_ids, &operation, &expected_token)
}

fn upsert_relay(config: &mut FamiliesConfig, relay: RelaySpec) {
	match config.relays.iter_mut().find(|existing| existing.id == relay.id) {
		Some(existing) => *existing = relay,
		None => config.relays.push(relay),
	}
}

/// Commit the relay and route changes together. Empty route IDs add routes;
/// explicit IDs update a matching route for this relay.
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
			let existing_id = family_mut(config, &item.family_id)?.routes.iter()
				.find(|route| !item.route.id.is_empty() && route.id == item.route.id && route.relay_id == relay_id)
				.map(|route| route.id.clone());
			if let Some(existing_id) = existing_id {
				item.route.relay_id = relay_id.clone();
				let route = normalize_route(&item.route, config, &item.family_id, Some((&item.family_id, &existing_id)))?;
				let existing = family_mut(config, &item.family_id)?.routes.iter_mut().find(|route| route.id == existing_id).ok_or("找不到要更新的路线")?;
				*existing = route;
				continue;
			}
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
		config.relays.retain(|relay| relay.id != relay_id);
		for family in &mut config.families {
			family.routes.retain(|route| route.relay_id != relay_id);
		}
		Ok(())
	})
}

/// Stopping a relay never rewrites its routes; runtime selection skips them
/// until the relay is enabled again.
pub fn set_relay_enabled_in(dir: &Path, relay_id: &str, enabled: bool) -> Result<FamiliesConfig, String> {
	apply(dir, |config| {
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
			let Some(route) = family.routes.iter().find(|route| &route.id == id) else {
				return Err("排序请求包含未知线路".into());
			};
			reordered.push(route.clone());
		}
		family.routes = reordered;
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

/// Family ids feed pi provider keys (`skiff-relay-<relay>-<family>`) and route
/// id seeds, so they must be safe lowercase path-free components.
fn sanitize_family_id(raw: &str) -> Result<String, String> {
	let id: String = raw
		.trim()
		.to_ascii_lowercase()
		.chars()
		.filter(|character| character.is_ascii_alphanumeric() || *character == '-' || *character == '_')
		.collect();
	if id.is_empty() || !id.chars().next().is_some_and(|first| first.is_ascii_alphabetic()) || id.len() > 32 {
		return Err("家族 ID 需以字母开头，仅含字母、数字、- 或 _，最长 32 个字符".into());
	}
	Ok(id)
}

/// Creates an empty family for models no built-in family claims. Routes bind
/// relays to it afterwards; on load it sorts after the built-ins.
pub fn create_family_in(dir: &Path, id: &str, label: &str) -> Result<FamiliesConfig, String> {
	apply(dir, |config| {
		let id = sanitize_family_id(id)?;
		if config.families.iter().any(|family| family.id == id) {
			return Err(format!("家族已存在：{id}"));
		}
		let display_name = display_name(label)?;
		config.families.push(ModelFamily { id: id.clone(), display_name, routes: Vec::new() });
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
pub fn save_relay(relay: RelaySpec, routes: Option<Vec<RelayRouteSpec>>, test_request_ids: Option<Vec<String>>) -> Result<FamiliesConfig, String> {
	let _guard = providers::CONFIG_LOCK.lock().map_err(|_| "配置锁异常")?;
	let dir = agent_dir()?;
	let name = relay.name.trim().to_lowercase();
	let config = save_relay_with_routes_in(&dir, relay, routes.unwrap_or_default())?;
	if let Some(saved) = config.relays.iter().find(|relay| relay.name.to_lowercase() == name) { crate::settings_metadata::promote(&dir, &config, &saved.id, &test_request_ids.unwrap_or_default()); }
	Ok(config)
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

#[tauri::command]
pub fn create_family(id: String, display_name: String) -> Result<FamiliesConfig, String> {
	let _guard = providers::CONFIG_LOCK.lock().map_err(|_| "配置锁异常")?;
	create_family_in(&agent_dir()?, &id, &display_name)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn reconnect_policy_preserves_other_pi_settings() {
		let dir = std::env::temp_dir().join(format!("skiff-retry-{}", next_id()));
		std::fs::create_dir_all(&dir).unwrap();
		let path = dir.join("settings.json");
		providers::atomic_write(&path, &json!({ "theme": "dark", "retry": { "enabled": false, "maxRetries": 20, "baseDelayMs": 1000 }, "compaction": { "enabled": false } })).unwrap();
		prepare_retry(&dir).unwrap();
		assert_eq!(providers::read_config(&path).unwrap(), json!({ "theme": "dark", "retry": { "enabled": true, "maxRetries": 5, "baseDelayMs": 1000 }, "compaction": { "enabled": false } }));
		std::fs::write(&path, "invalid json").unwrap();
		assert!(prepare_retry(&dir).is_err());
		assert_eq!(std::fs::read_to_string(&path).unwrap(), "invalid json");
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[test]
	fn shell_prefix_switches_console_to_utf8_without_touching_other_settings() {
		let dir = std::env::temp_dir().join(format!("skiff-shell-prefix-{}", next_id()));
		std::fs::create_dir_all(&dir).unwrap();
		let path = dir.join("settings.json");
		providers::atomic_write(&path, &json!({ "theme": "dark", "retry": { "enabled": true } })).unwrap();
		prepare_shell_prefix(&dir).unwrap();
		let written = providers::read_config(&path).unwrap();
		assert_eq!(written["theme"], json!("dark"));
		assert_eq!(written["retry"]["enabled"], json!(true));
		#[cfg(windows)]
		assert_eq!(written["shellCommandPrefix"], json!("chcp.com 65001 >/dev/null 2>&1"));
		prepare_shell_prefix(&dir).unwrap();
		assert_eq!(providers::read_config(&path).unwrap(), written);
		providers::atomic_write(&path, &json!({ "shellCommandPrefix": "set -e" })).unwrap();
		prepare_shell_prefix(&dir).unwrap();
		assert_eq!(providers::read_config(&path).unwrap()["shellCommandPrefix"], json!("set -e"));
		std::fs::write(&path, "invalid json").unwrap();
		assert!(prepare_shell_prefix(&dir).is_err());
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[test]
	fn provider_multiplier_scales_billing_and_projection_without_changing_official_prices() {
		let dir = std::env::temp_dir().join(format!("skiff-price-multiplier-{}", std::process::id()));
		std::fs::create_dir_all(&dir).unwrap();
		let relay: RelaySpec = serde_json::from_value(json!({ "id": "discount", "name": "Discount", "baseUrl": "https://relay.example/v1", "apiKey": "sk-test-multiplier", "priceMultiplier": 0.5 })).unwrap();
		let routes: Vec<RelayRouteSpec> = serde_json::from_value(json!([{ "familyId": "kimi", "route": { "relayId": "discount", "models": [{ "modelId": "kimi-k3", "inputCost": 2, "outputCost": 8, "cacheReadCost": 0.4, "cacheWriteCost": 3, "currency": "CNY", "maxTokens": 8192, "contextWindow": 128000 }] } }])).unwrap();
		let saved = save_relay_with_routes_in(&dir, relay, routes).unwrap();
		let reloaded = load_plain(&dir).unwrap();
		assert_eq!(reloaded.relays[0].price_multiplier, Some(0.5));
		let kimi = reloaded.families.iter().find(|family| family.id == "kimi").unwrap();
		assert_eq!(kimi.routes[0].models[0].input_cost, 2.0);
		let offers = runtime_offers(&reloaded);
		assert_eq!((offers[0].input_cost, offers[0].output_cost, offers[0].cache_read_cost, offers[0].cache_write_cost), (1.0, 4.0, 0.2, 1.5));
		assert_eq!(offers[0].price_multiplier, Some(0.5));
		let projection = providers::read_config(&dir.join("models.json")).unwrap();
		assert_eq!(projection["providers"][provider_key("kimi", "discount")]["models"][0]["cost"], json!({ "input": 1.0, "output": 4.0, "cacheRead": 0.2, "cacheWrite": 1.5 }));
		for multiplier in [None, Some(1.0), Some(0.25), Some(0.0), Some(1.5)] {
			let mut relay = saved.relays[0].clone();
			relay.price_multiplier = multiplier;
			let updated = save_relay_with_routes_in(&dir, relay, vec![]).unwrap();
			assert_eq!(runtime_offers(&updated)[0].input_cost, 2.0 * multiplier.unwrap_or(1.0));
		}
		for multiplier in [-0.5, f64::NAN, f64::INFINITY] {
			let mut relay = saved.relays[0].clone();
			relay.price_multiplier = Some(multiplier);
			assert!(save_relay_with_routes_in(&dir, relay, vec![]).is_err());
		}
		std::fs::remove_dir_all(dir).unwrap();
	}

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
		assert_eq!(projected["providers"][provider_key("glm", &relay.id)]["models"][0]["compat"]["supportsDeveloperRole"], false);
		assert!(!std::fs::read_to_string(config_path(&dir)).unwrap().contains("sk-test-discovery"));

		// Retesting must preserve manual route edits and ordering.
		let mut edited = saved.families[0].routes[0].clone();
		edited.models[0].input_cost = 7.0;
		save_route_in(&dir, "deepseek", edited.clone()).unwrap();
		let mut edit_relay = relay.clone();
		edit_relay.api_key.clear();
		edit_relay.excluded_model_ids.clear();
		let repaired = save_relay_with_routes_in(&dir, edit_relay, routes()).unwrap();
		assert_eq!(repaired.relays[0].api_key, "sk-test-discovery");
		assert_eq!(repaired.families[0].routes.len(), 1);
		assert_eq!(repaired.families[0].routes[0].models[0].input_cost, 7.0);
		assert_eq!(runtime_offers(&repaired).len(), 3);

		let mut provider_edit = repaired.families[0].routes[0].clone();
		provider_edit.models[0].alias = "编辑后的显示名".into();
		provider_edit.models[0].context_window = 196_000;
		let updated = save_relay_with_routes_in(&dir, relay.clone(), vec![RelayRouteSpec { family_id: "deepseek".into(), route: provider_edit }]).unwrap();
		assert_eq!(updated.families[0].routes[0].models[0].alias, "编辑后的显示名");
		assert_eq!(updated.families[0].routes[0].models[0].context_window, 196_000);
		assert_eq!(updated.families[0].routes[0].models[0].input_cost, 7.0);
		assert_eq!(updated.families[0].routes[0].id, edited.id);

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
	fn relay_protocol_normalizes_projects_and_shapes_requests() {
		// Absent and unknown values keep the legacy OpenAI-compatible default.
		assert_eq!(normalize_protocol(None), "openai");
		assert_eq!(normalize_protocol(Some("nonsense")), "openai");
		assert_eq!(normalize_protocol(Some(" Anthropic ")), "anthropic");
		assert_eq!(normalize_protocol(Some("google-genai")), "google-genai");

		let model = ModelSpec { model_id: "claude-sonnet-4".into(), vision: None, thinking_levels: None, alias: String::new(), input_cost: 1.0, output_cost: 4.0, cache_read_cost: 1.0, cache_write_cost: 1.0, currency: Currency::Cny, max_tokens: 8192, context_window: 200_000 };
		let route = RouteSpec { id: "route-kimi-r1".into(), relay_id: "r1".into(), enabled: true, models: vec![model], streaming: true, tools: true, vision: false, reasoning: false, thinking_levels: Vec::new() };
		let mut relay = RelaySpec { id: "r1".into(), name: "Anthropic relay".into(), base_url: "https://api.anthropic.com/v1".into(), api_key: "key".into(), protocol: Some("Anthropic".into()), timeout_seconds: 60, enabled: true, billing_account_id: String::new(), price_multiplier: None, excluded_model_ids: Vec::new(), unassigned_models: Vec::new() };
		let normalized = normalize_relay(relay.clone(), &FamiliesConfig { version: 5, relays: Vec::new(), families: Vec::new(), auto_failover: false, auto_retry: false, usd_cny_rate: 7.2 }).unwrap();
		assert_eq!(normalized.protocol.as_deref(), Some("anthropic"));
		assert_eq!(protocol_api(&normalized), "anthropic-messages");
		// Other adapters build their own shapes, so no OpenAI compat block leaks in.
		assert_eq!(project_model("kimi", &route, &route.models[0], "skiff-test", "anthropic-messages", 1.0)["compat"], Value::Null);

		relay.protocol = Some("google-genai".into());
		assert_eq!(protocol_api(&relay), "google-generative-ai");
		relay.protocol = Some("openai-responses".into());
		assert_eq!(protocol_api(&relay), "openai-responses");
		relay.protocol = None;
		assert_eq!(protocol_api(&relay), "openai-completions");

		// Anthropic's SDK appends `/v1`; the stored `/v1` suffix must not double up.
		relay.protocol = Some("anthropic".into());
		assert_eq!(runtime_base_url(&relay), "https://api.anthropic.com");
		relay.base_url = "https://claude-proxy.example".into();
		assert_eq!(runtime_base_url(&relay), "https://claude-proxy.example");
		assert_eq!(anthropic_root("https://x/v1/"), "https://x");
		relay.base_url = "https://api.openai.com/v1".into();
		relay.protocol = Some("openai".into());
		assert_eq!(runtime_base_url(&relay), "https://api.openai.com/v1");

		// Each protocol gets its own one-shot request shape for the connection test.
		let (url, body, auth) = connection_test_request("anthropic", "https://api.anthropic.com/v1", "k", "claude-3");
		assert_eq!(url, "https://api.anthropic.com/v1/messages");
		assert_eq!(auth, "anthropic");
		assert_eq!(body["max_tokens"], 1);
		// The test and the SDK must agree on the endpoint for a suffix-less relay.
		let (url, _, _) = connection_test_request("anthropic", "https://claude-proxy.example", "k", "claude-3");
		assert_eq!(url, "https://claude-proxy.example/v1/messages");
		let (url, body, auth) = connection_test_request("openai-responses", "https://api.openai.com/v1", "k", "gpt-5");
		assert_eq!(url, "https://api.openai.com/v1/responses");
		assert_eq!(auth, "bearer");
		assert_eq!(body["max_output_tokens"], 16);
		let (url, body, auth) = connection_test_request("google-genai", "https://generativelanguage.googleapis.com/v1beta", "k", "gemini-2.5-pro");
		assert_eq!(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=k");
		assert_eq!(auth, "query");
		assert_eq!(body["generationConfig"]["maxOutputTokens"], 1);
		let (url, body, auth) = connection_test_request("openai", "https://api.example.com/v1", "k", "m");
		assert_eq!(url, "https://api.example.com/v1/chat/completions");
		assert_eq!(auth, "bearer");
		assert_eq!(body["max_tokens"], 1);
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
	fn migrates_legacy_route_choice_into_order_and_removes_it() {
		let mut value = json!({
			"version": 3,
			"relays": [{"id": "r1", "name": "Relay", "baseUrl": "https://relay.example/v1", "apiKey": "sealed", "enabled": true}],
			"families": [{"id": "kimi", "displayName": "Kimi", "defaultRelayId": "r2", "routes": [
				{"relayId": "r1", "models": [{"modelId": "kimi-k3", "inputCost": 1, "outputCost": 4, "currency": "CNY", "maxTokens": 8192, "contextWindow": 128000}]},
				{"relayId": "r2", "models": [{"modelId": "kimi-k2", "inputCost": 1, "outputCost": 4, "currency": "CNY", "maxTokens": 8192, "contextWindow": 128000}]}
			]}]
		});
		migrate_value_to_v5(&mut value);
		assert_eq!(value["version"], 5);
		assert_eq!(value["relays"][0]["billingAccountId"], "");
		assert!(value["families"][0].get("defaultRouteId").is_none());
		assert!(value["families"][0].get("defaultRelayId").is_none());
		assert_eq!(value["families"][0]["routes"][0]["id"], "route-kimi-r2");
		assert_eq!(value["families"][0]["routes"][0]["enabled"], true);
		assert_eq!(value["families"][0]["routes"][0]["models"][0]["alias"], "");
		assert_eq!(value["families"][0]["routes"][0]["models"][0]["cacheReadCost"], 1);
		assert_eq!(value["families"][0]["routes"][0]["models"][0]["cacheWriteCost"], 1);
	}

	#[test]
	fn runtime_offers_skip_disabled_routes_and_expose_offer_identity() {
		let relay = RelaySpec { id: "r1".into(), name: "Relay".into(), base_url: "https://relay.example/v1".into(), api_key: String::new(), protocol: None, timeout_seconds: 60, enabled: true, billing_account_id: "wallet-a".into(), price_multiplier: None, excluded_model_ids: Vec::new(), unassigned_models: Vec::new() };
		let model = ModelSpec { model_id: "kimi-k3".into(), vision: None, thinking_levels: None, alias: "k3-便宜".into(), input_cost: 1.0, output_cost: 4.0, cache_read_cost: 0.5, cache_write_cost: 0.7, currency: Currency::Cny, max_tokens: 8192, context_window: 128000 };
		let route = RouteSpec { id: "route-kimi-r1".into(), relay_id: "r1".into(), enabled: true, models: vec![model], streaming: true, tools: true, vision: false, reasoning: true, thinking_levels: Vec::new() };
		let disabled = RouteSpec { id: "route-kimi-r2".into(), relay_id: "r1".into(), enabled: false, models: vec![], streaming: true, tools: true, vision: false, reasoning: false, thinking_levels: Vec::new() };
		let family = ModelFamily { id: "kimi".into(), display_name: "Kimi".into(), routes: vec![route, disabled] };
		let config = FamiliesConfig { version: 5, relays: vec![relay], families: vec![family], auto_failover: false, auto_retry: false, usd_cny_rate: 7.2 };
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
		let model = ModelSpec { model_id: "kimi-k3".into(), vision: None, thinking_levels: None, alias: "k3".into(), input_cost: 1.0, output_cost: 4.0, cache_read_cost: 1.0, cache_write_cost: 1.0, currency: Currency::Cny, max_tokens: 8192, context_window: 128000 };
		let active = RouteSpec { id: "route-kimi-r1".into(), relay_id: "r1".into(), enabled: true, models: vec![model.clone()], streaming: true, tools: true, vision: false, reasoning: false, thinking_levels: Vec::new() };
		let stopped_route = RouteSpec { id: "route-kimi-stopped".into(), relay_id: "r1".into(), enabled: false, models: vec![model.clone()], streaming: true, tools: true, vision: false, reasoning: false, thinking_levels: Vec::new() };
		let stopped_relay_route = RouteSpec { id: "route-kimi-r2".into(), relay_id: "r2".into(), enabled: true, models: vec![model], streaming: true, tools: true, vision: false, reasoning: false, thinking_levels: Vec::new() };
		let deepseek_model = ModelSpec { model_id: "deepseek-chat".into(), vision: None, thinking_levels: None, alias: String::new(), input_cost: 0.3, output_cost: 1.2, cache_read_cost: 0.3, cache_write_cost: 0.3, currency: Currency::Cny, max_tokens: 8192, context_window: 128000 };
		let config = FamiliesConfig {
			version: 5,
			relays: vec![
				RelaySpec { id: "r1".into(), name: "Active".into(), base_url: "https://active.example/v1".into(), api_key: "key-active".into(), protocol: None, timeout_seconds: 60, enabled: true, billing_account_id: "wallet-a".into(), price_multiplier: None, excluded_model_ids: Vec::new(), unassigned_models: Vec::new() },
				RelaySpec { id: "r2".into(), name: "Stopped".into(), base_url: "https://stopped.example/v1".into(), api_key: "key-stopped".into(), protocol: None, timeout_seconds: 60, enabled: false, billing_account_id: "wallet-b".into(), price_multiplier: None, excluded_model_ids: Vec::new(), unassigned_models: Vec::new() },
			],
			families: vec![
				ModelFamily { id: "kimi".into(), display_name: "Kimi".into(), routes: vec![active, stopped_route, stopped_relay_route] },
				ModelFamily { id: "deepseek".into(), display_name: "DeepSeek".into(), routes: vec![RouteSpec { id: "route-deepseek-r1".into(), relay_id: "r1".into(), enabled: true, models: vec![deepseek_model], streaming: true, tools: true, vision: false, reasoning: false, thinking_levels: Vec::new() }] },
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
	fn route_order_allows_disabling_and_deleting_routes() {
		let dir = std::env::temp_dir().join(format!("skiff-route-choice-test-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&dir);
		std::fs::create_dir_all(&dir).unwrap();
		let model = ModelSpec { model_id: "kimi-k3".into(), vision: None, thinking_levels: None, alias: String::new(), input_cost: 1.0, output_cost: 4.0, cache_read_cost: 1.0, cache_write_cost: 1.0, currency: Currency::Cny, max_tokens: 8192, context_window: 128000 };
		let config = FamiliesConfig {
			version: 5,
			relays: vec![
				RelaySpec { id: "r1".into(), name: "Primary".into(), base_url: "https://primary.example/v1".into(), api_key: "key-1".into(), protocol: None, timeout_seconds: 60, enabled: true, billing_account_id: String::new(), price_multiplier: None, excluded_model_ids: Vec::new(), unassigned_models: Vec::new() },
				RelaySpec { id: "r2".into(), name: "Backup".into(), base_url: "https://backup.example/v1".into(), api_key: "key-2".into(), protocol: None, timeout_seconds: 60, enabled: true, billing_account_id: String::new(), price_multiplier: None, excluded_model_ids: Vec::new(), unassigned_models: Vec::new() },
			],
			families: vec![ModelFamily { id: "kimi".into(), display_name: "Kimi".into(), routes: vec![
				RouteSpec { id: "route-kimi-r1".into(), relay_id: "r1".into(), enabled: true, models: vec![model.clone()], streaming: true, tools: true, vision: false, reasoning: false, thinking_levels: Vec::new() },
				RouteSpec { id: "route-kimi-r2".into(), relay_id: "r2".into(), enabled: true, models: vec![model], streaming: true, tools: true, vision: false, reasoning: false, thinking_levels: Vec::new() },
			] }],
			auto_failover: false,
			auto_retry: false,
			usd_cny_rate: 7.2,
		};
		std::fs::write(config_path(&dir), serde_json::to_vec(&config).unwrap()).unwrap();
		// A stopped relay or route is skipped until it is enabled again.
		assert!(set_relay_enabled_in(&dir, "r1", false).is_ok());
		assert!(!load_plain(&dir).unwrap().relays[0].enabled);
		assert!(set_relay_enabled_in(&dir, "r1", true).is_ok());
		let mut stopped = load_plain(&dir).unwrap().families.iter().find(|family| family.id == "kimi").unwrap().routes[0].clone();
		stopped.enabled = false;
		assert!(save_route_in(&dir, "kimi", stopped).is_ok());
		assert!(runtime_offers(&load_plain(&dir).unwrap()).iter().all(|offer| offer.route_id != "route-kimi-r1"));
		assert!(delete_route_in(&dir, "kimi", "route-kimi-r1").is_ok());
		let _ = std::fs::remove_dir_all(&dir);
	}
}

/// models.dev 公共模型目录（官方牌价），带 24h 磁盘缓存；refresh 跳过缓存并在成功后重写。
#[tauri::command]
pub async fn fetch_public_catalog(refresh: Option<bool>) -> Result<providers::CatalogResponse, String> {
	providers::public_catalog(&agent_dir()?, refresh.unwrap_or(false)).await
}

///模型发现按供应商协议选择接口：OpenAI 兼容 `/models`、Anthropic `/models` 或 Google `models`。
#[tauri::command]
pub async fn discover_relay_models(base_url: String, api_key: String, protocol: Option<String>) -> Result<Vec<providers::DiscoveredModel>, String> {
	providers::discover(&base_url, &api_key, protocol.as_deref()).await
}

/// Measures the model-list HTTP round trip without making a generation request.
#[tauri::command]
pub async fn probe_relay_endpoint(base_url: String, api_key: String, protocol: Option<String>) -> Result<TestResult, String> {
	let mut base = validate_base_url(&base_url)?;
	let key = validate_api_key(&api_key)?;
	let protocol = normalize_protocol(protocol.as_deref());
	if matches!(protocol.as_str(), "openai" | "kimi" | "openai-responses" | "anthropic") {
		let url = reqwest::Url::parse(&base).map_err(|_| "接口地址格式不正确")?;
		if url.path().trim_matches('/').is_empty() { base.push_str("/v1"); }
	}
	let client = reqwest::Client::builder()
		.timeout(std::time::Duration::from_secs(10))
		.redirect(reqwest::redirect::Policy::none())
		.build().map_err(|_| "无法初始化连接")?;
	let mut url = reqwest::Url::parse(&format!("{base}/models")).map_err(|_| "接口地址格式不正确")?;
	if matches!(protocol.as_str(), "google-genai" | "vertex") { url.query_pairs_mut().append_pair("key", &key); }
	let request = client.get(url);
	let request = match protocol.as_str() {
		"anthropic" => request.header("x-api-key", &key).header("anthropic-version", "2023-06-01"),
		"google-genai" | "vertex" => request,
		_ if !key.is_empty() => request.bearer_auth(&key),
		_ => request,
	};
	let started = std::time::Instant::now();
	let response = request.send().await;
	let latency_ms = started.elapsed().as_millis() as u64;
	Ok(match response {
		Ok(response) => {
			let status = response.status();
			let error = if status.is_success() { None } else { Some(match status.as_u16() {
				401 => "密钥无效".into(),
				403 => "访问被拒绝".into(),
				404 => "端点不支持模型列表接口".into(),
				429 => "请求过于频繁，请稍后重试".into(),
				_ => "端点请求失败".into(),
			}) };
			TestResult { ok: status.is_success(), latency_ms, status: Some(status.as_u16()), error }
		}
		Err(error) => TestResult { ok: false, latency_ms, status: None, error: Some(if error.is_timeout() { "连接超时".into() } else { "连接失败，请检查地址和网络".into() }) },
	})
}

/// 各家族官方模型页（6h 缓存），由前端解析出最新在售模型；失败回退过期缓存。
/// refresh 跳过缓存，成功后重写缓存使 TTL 重新计时。
#[tauri::command]
pub async fn fetch_official_pages(refresh: Option<bool>) -> Result<providers::OfficialPagesResponse, String> {
	providers::official_pages(&agent_dir()?, refresh.unwrap_or(false)).await
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
pub async fn test_settings_connection(relay: RelaySpec, model_id: String, request_id: String, draft: bool) -> Result<TestResult, String> {
	let dir = agent_dir()?;
	test_settings_connection_in(&dir, relay, model_id, request_id, draft).await
}

async fn test_settings_connection_in(dir: &Path, relay: RelaySpec, model_id: String, request_id: String, draft: bool) -> Result<TestResult, String> {
	let ticket = {
		let _guard = providers::CONFIG_LOCK.lock().map_err(|_| "配置锁异常")?;
		crate::settings_metadata::begin(&dir, &load_plain(&dir)?, &relay, &model_id)
	};
	let result = test_provider_connection(relay.base_url, relay.api_key, model_id, relay.protocol, Some(relay.timeout_seconds), Some(request_id.clone())).await?;
	if let Ok(_guard) = providers::CONFIG_LOCK.lock() { if let Ok(config) = load_plain(&dir) { crate::settings_metadata::finish(&dir, &config, &request_id, ticket, &result, draft); } }
	Ok(result)
}

/// One `max_tokens=1` completion proves the relay endpoint, key and model work.
/// `protocol` selects the request shape; absent means OpenAI Chat Completions.
#[tauri::command]
pub async fn test_provider_connection(base_url: String, api_key: String, model_id: String, protocol: Option<String>, timeout_seconds: Option<u64>, request_id: Option<String>) -> Result<TestResult, String> {
	let protocol = normalize_protocol(protocol.as_deref());
	let Some(request_id) = request_id else {
		return run_provider_test(base_url, api_key, model_id, protocol, timeout_seconds).await;
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
	let mut pending = Box::pin(run_provider_test(base_url, api_key, model_id, protocol, timeout_seconds));
	let result = std::future::poll_fn(|context| {
		if receiver.poll_recv(context).is_ready() { return Poll::Ready(Err("测试已停止".into())); }
		pending.as_mut().poll(context)
	}).await;
	if let Ok(mut requests) = provider_test_requests().lock() { requests.running.remove(&request_id); }
	result
}

/// The request a protocol's connection test sends: endpoint, JSON body and the
/// auth style. Anthropic and Google each use a different one-shot shape.
fn connection_test_request(protocol: &str, base: &str, key: &str, model: &str) -> (String, Value, &'static str) {
	match protocol {
		"anthropic" => (anthropic_messages_url(base), json!({
			"model": model, "max_tokens": 1,
			"messages": [{ "role": "user", "content": "ping" }],
		}), "anthropic"),
		"openai-responses" => (format!("{base}/responses"), json!({
			"model": model, "input": "ping", "max_output_tokens": 16,
		}), "bearer"),
		"google-genai" | "vertex" => (format!("{base}/models/{model}:generateContent?key={key}"), json!({
			"contents": [{ "role": "user", "parts": [{ "text": "ping" }] }],
			"generationConfig": { "maxOutputTokens": 1 },
		}), "query"),
		_ => (format!("{base}/chat/completions"), json!({
			"model": model, "messages": [{ "role": "user", "content": "ping" }], "max_tokens": 1,
		}), "bearer"),
	}
}

async fn run_provider_test(base_url: String, api_key: String, model_id: String, protocol: String, timeout_seconds: Option<u64>) -> Result<TestResult, String> {
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
	let (url, body, auth) = connection_test_request(&protocol, &base, &key, &model);
	let mut request = client.post(url).json(&body);
	request = match auth {
		"anthropic" => request.header("x-api-key", &key).header("anthropic-version", "2023-06-01"),
		"query" => request,
		_ => request.bearer_auth(&key),
	};
	let response = request.send().await;
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
			let result = test_provider_connection(format!("http://{address}/v1"), "test-key".into(), "test-model".into(), None, Some(60), Some(token)).await;
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
		let result = tauri::async_runtime::block_on(test_provider_connection("http://127.0.0.1:1/v1".into(), "test-key".into(), "test-model".into(), None, Some(60), Some(request_id)));
		assert_eq!(result.err().unwrap(), "测试已停止");
	}

	#[test]
	fn settings_tests_persist_protocol_specific_results_and_cancellation_keeps_history() {
		let dir = std::env::temp_dir().join(format!("skiff-settings-http-{}", next_id()));
		for (index, protocol) in ["openai", "kimi", "openai-responses", "anthropic", "google-genai", "vertex"].iter().enumerate() {
			let listener = TcpListener::bind("127.0.0.1:0").unwrap();
			let address = listener.local_addr().unwrap();
			let server = std::thread::spawn(move || {
				let (mut socket, _) = listener.accept().unwrap();
				socket.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
				let mut bytes = Vec::new(); let mut buffer = [0u8; 4096];
				loop {
					let n = socket.read(&mut buffer).unwrap(); if n == 0 { break; } bytes.extend_from_slice(&buffer[..n]);
					if let Some(offset) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
						let headers = String::from_utf8_lossy(&bytes[..offset]).to_lowercase();
						let length = headers.lines().find_map(|line| line.strip_prefix("content-length:").and_then(|s| s.trim().parse::<usize>().ok())).unwrap();
						if bytes.len() >= offset + 4 + length { break; }
					}
				}
				socket.write_all(if index == 5 { b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 2\r\n\r\n{}" } else { b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}" }).unwrap();
				String::from_utf8(bytes).unwrap()
			});
			let mut config = FamiliesConfig::default();
			config.relays.push(serde_json::from_value(json!({"id":"test", "name":"Test", "baseUrl":format!("http://{address}/v1"), "apiKey":"dummy-only", "protocol":protocol, "timeoutSeconds":5})).unwrap());
			config.families[0].routes.push(serde_json::from_value(json!({"id":"route-test", "relayId":"test", "models":[{"modelId":"actual/model", "contextWindow":32000, "maxTokens":4096}]})).unwrap());
			save(&dir, &config).unwrap();
			let result = tauri::async_runtime::block_on(test_settings_connection_in(&dir, config.relays[0].clone(), "actual/model".into(), format!("settings-{protocol}"), false)).unwrap();
			assert_eq!(result.ok, index != 5);
			let request = server.join().unwrap().to_lowercase();
			if *protocol == "anthropic" { assert!(request.contains("x-api-key: dummy-only")); assert!(request.contains("/v1/messages")); }
			else if ["google-genai", "vertex"].contains(protocol) { assert!(request.contains("generatecontent?key=dummy-only")); assert!(!request.contains("authorization:")); }
			else { assert!(request.contains("authorization: bearer dummy-only")); }
			let records = crate::settings_metadata::query(&dir, &config).tests;
			assert_eq!(records.len(), 1); assert_eq!(records[0].ok, result.ok); assert!(!records[0].config_changed);
			let cancelled = format!("settings-cancel-{protocol}"); cancel_provider_test(cancelled.clone()).unwrap();
			assert!(tauri::async_runtime::block_on(test_settings_connection_in(&dir, config.relays[0].clone(), "actual/model".into(), cancelled, false)).is_err());
			assert_eq!(crate::settings_metadata::query(&dir, &config).tests[0].completed_at, records[0].completed_at);
		}
		let _ = std::fs::remove_dir_all(dir);
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

	#[test]
	fn auto_family_is_fixed_displayed_and_accepts_routes_and_projection() {
		let dir = std::env::temp_dir().join(format!("skiff-auto-family-{}", next_id()));
		std::fs::create_dir_all(&dir).unwrap();
		assert_eq!(family_display("auto"), "Auto");
		let relay: RelaySpec = serde_json::from_value(json!({
			"id": "", "name": "Router", "baseUrl": "https://router.example/v1", "apiKey": "sk-test-auto"
		})).unwrap();
		let saved = save_relay_with_routes_in(&dir, relay, vec![serde_json::from_value(json!({
			"familyId": "auto", "route": { "relayId": "",
				"models": [{ "modelId": "auto", "contextWindow": 128000, "maxTokens": 8192 }]
			}
		})).unwrap()]).unwrap();
		let relay = saved.relays[0].clone();
		assert_eq!(runtime_offers(&saved).iter().map(|offer| (offer.family_id.as_str(), offer.model_id.as_str())).collect::<Vec<_>>(), [("auto", "auto")]);
		let projected = providers::read_config(&dir.join("models.json")).unwrap();
		assert_eq!(projected["providers"][provider_key("auto", &relay.id)]["models"][0]["id"], "auto");

		// Older files predating the auto family get it reinstated empty on load.
		save(&dir, &serde_json::from_value::<FamiliesConfig>(json!({
			"version": 4, "relays": [], "families": [{ "id": "kimi", "displayName": "Kimi", "routes": [] }]
		})).unwrap()).unwrap();
		let loaded = load_plain(&dir).unwrap();
		assert_eq!(loaded.families.iter().map(|family| family.id.as_str()).collect::<Vec<_>>(), ["deepseek", "kimi", "glm", "auto"]);
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[test]
	fn thinking_levels_project_into_pi_map_and_offer_extended_levels() {
		let dir = std::env::temp_dir().join(format!("skiff-thinking-levels-{}", next_id()));
		std::fs::create_dir_all(&dir).unwrap();
		let relay: RelaySpec = serde_json::from_value(json!({
			"id": "", "name": "Router", "baseUrl": "http://127.0.0.1:8787/v1", "apiKey": "sk-local"
		})).unwrap();
		// Duplicates and `off` collapse; order follows pi's ladder, not the input.
		let saved = save_relay_with_routes_in(&dir, relay, vec![serde_json::from_value(json!({
			"familyId": "deepseek", "route": {
				"relayId": "", "reasoning": true, "thinkingLevels": ["max", "low", "off", "low"],
				"models": [
					{ "modelId": "deepseek-v4.1-flash", "contextWindow": 128000, "maxTokens": 8192 },
					{ "modelId": "deepseek-v4-flash", "contextWindow": 128000, "maxTokens": 8192, "thinkingLevels": ["minimal"] }
				]
			}
		})).unwrap()]).unwrap();
		let route = &saved.families.iter().find(|family| family.id == "deepseek").unwrap().routes[0];
		assert_eq!(route.thinking_levels, ["low", "max"]);
		assert_eq!(route.models[0].thinking_levels, None);
		assert_eq!(route.models[1].thinking_levels.as_deref(), Some(&["minimal".to_string()][..]));

		let key = provider_key("deepseek", &saved.relays[0].id);
		let projected = providers::read_config(&dir.join("models.json")).unwrap();
		let models = projected["providers"][&key]["models"].as_array().unwrap();
		// Declared levels map to themselves; the rest are null so pi hides them.
		assert_eq!(models[0]["thinkingLevelMap"], json!({
			"minimal": null, "low": "low", "medium": null, "high": null, "xhigh": null, "max": "max"
		}));
		assert_eq!(models[1]["thinkingLevelMap"], json!({
			"minimal": "minimal", "low": null, "medium": null, "high": null, "xhigh": null, "max": null
		}));

		let levels: Vec<_> = runtime_offers(&saved).iter().map(|offer| offer.thinking_levels.clone()).collect();
		assert_eq!(levels, [vec!["off", "low", "max"], vec!["off", "minimal"]]);
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[test]
	fn thinking_levels_default_to_pi_ladder_and_reject_unknown_levels() {
		let model = ModelSpec { model_id: "m".into(), vision: None, thinking_levels: None, alias: String::new(), input_cost: 0.0, output_cost: 0.0, cache_read_cost: 0.0, cache_write_cost: 0.0, currency: Currency::Cny, max_tokens: 8192, context_window: 128000 };
		// Undeclared routes stay map-free so pi keeps its five-level default.
		let route = RouteSpec { id: "r".into(), relay_id: "r1".into(), enabled: true, models: vec![model.clone()], streaming: true, tools: true, vision: false, reasoning: true, thinking_levels: Vec::new() };
		assert_eq!(project_model("auto", &route, &model, "skiff-test", "openai-completions", 1.0)["thinkingLevelMap"], Value::Null);

		let declared = RouteSpec { thinking_levels: vec!["low".into(), "high".into()], ..route.clone() };
		let map = project_model("auto", &declared, &model, "skiff-test", "openai-completions", 1.0)["thinkingLevelMap"].clone();
		assert_eq!(map["low"], "low");
		assert_eq!(map["high"], "high");
		assert_eq!(map["minimal"], Value::Null);
		assert_eq!(map["max"], Value::Null);

		let mut silent = declared.clone();
		silent.reasoning = false;
		assert_eq!(project_model("auto", &silent, &model, "skiff-test", "openai-completions", 1.0)["thinkingLevelMap"], Value::Null);

		assert_eq!(normalize_thinking_levels(Some(&["HIGH".into(), "XHigh".into()])).unwrap(), ["high", "xhigh"]);
		assert!(normalize_thinking_levels(Some(&["ultra".into()])).is_err());
	}

	#[test]
	fn create_family_adds_custom_family_and_routes_can_reference_it() {
		let dir = std::env::temp_dir().join(format!("skiff-create-family-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&dir);
		std::fs::create_dir_all(&dir).unwrap();
		let saved = create_family_in(&dir, " GPT ", "GPT").unwrap();
		assert_eq!(saved.families.iter().find(|family| family.id == "gpt").unwrap().display_name, "GPT");
		// Reload keeps the custom family after the built-ins.
		let reloaded = load_plain(&dir).unwrap();
		assert_eq!(reloaded.families.last().unwrap().id, "gpt");
		assert!(FAMILY_IDS.iter().all(|id| reloaded.families.iter().any(|family| family.id == *id)));

		let relay: RelaySpec = serde_json::from_value(json!({ "id": "", "name": "OpenAI", "baseUrl": "https://api.openai.com/v1", "apiKey": "sk-test-family", "unassignedModels": [{ "modelId": "o4-mini", "contextWindow": 128000, "maxTokens": 8192 }] })).unwrap();
		let routes = vec![serde_json::from_value::<RelayRouteSpec>(json!({
			"familyId": "gpt", "route": { "relayId": "", "models": [{ "modelId": "gpt-5.2", "contextWindow": 128000, "maxTokens": 8192 }] }
		})).unwrap()];
		let saved = save_relay_with_routes_in(&dir, relay, routes).unwrap();
		let relay_id = saved.relays[0].id.clone();
		let gpt = saved.families.iter().find(|family| family.id == "gpt").unwrap();
		assert_eq!(gpt.routes[0].models[0].model_id, "gpt-5.2");
		let projected = providers::read_config(&dir.join("models.json")).unwrap();
		assert_eq!(projected["providers"][provider_key("gpt", &relay_id)]["models"][0]["id"], "gpt-5.2");

		assert!(create_family_in(&dir, "gpt", "重复").is_err());
		assert!(create_family_in(&dir, "9bad", "数字开头").is_err());
		assert!(create_family_in(&dir, "this-family-id-is-far-too-long-for-provider-keys", "超长").is_err());
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[test]
	fn relay_saves_unassigned_models_without_projecting_or_offering_them() {
		let dir = std::env::temp_dir().join(format!("skiff-unassigned-models-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&dir);
		std::fs::create_dir_all(&dir).unwrap();
		let relay: RelaySpec = serde_json::from_value(json!({
			"id": "", "name": "OpenAI", "baseUrl": "https://api.openai.com/v1", "apiKey": "sk-test-unassigned",
			"unassignedModels": [
				{ "modelId": "gpt-5.2", "contextWindow": 128000, "maxTokens": 8192 },
				{ "modelId": "text-embedding-3-small", "contextWindow": 8192, "maxTokens": 8192 }
			]
		})).unwrap();
		let saved = save_relay_with_routes_in(&dir, relay, vec![]).unwrap();
		assert_eq!(saved.relays[0].unassigned_models.len(), 2);
		// Unassigned models stay invisible to selection and to pi's projection.
		assert!(runtime_offers(&saved).is_empty());
		let projected = providers::read_config(&dir.join("models.json")).unwrap();
		assert!(projected["providers"].as_object().unwrap().is_empty());
		// Duplicate ids inside the unassigned list are rejected like route models.
		let mut edited = saved.relays[0].clone();
		edited.api_key.clear();
		edited.unassigned_models.push(serde_json::from_value(json!({ "modelId": "gpt-5.2", "contextWindow": 128000, "maxTokens": 8192 })).unwrap());
		assert!(save_relay_with_routes_in(&dir, edited, vec![]).is_err());
		std::fs::remove_dir_all(dir).unwrap();
	}
}
