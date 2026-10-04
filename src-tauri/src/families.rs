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

use std::path::Path;

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
	3
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
	#[serde(default)]
	pub input_cost: f64,
	#[serde(default)]
	pub output_cost: f64,
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
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteSpec {
	pub relay_id: String,
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

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelFamily {
	pub id: String,
	pub display_name: String,
	/// Array order is the family's priority: default-route fallback then failover.
	#[serde(default)]
	pub routes: Vec<RouteSpec>,
	#[serde(default)]
	pub default_relay_id: Option<String>,
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
}

impl Default for FamiliesConfig {
	fn default() -> Self {
		FamiliesConfig {
			version: default_schema_version(),
			relays: Vec::new(),
			auto_failover: false,
			families: FAMILY_IDS
				.iter()
				.map(|id| ModelFamily {
					id: id.to_string(),
					display_name: family_display(id).to_string(),
					routes: Vec::new(),
					default_relay_id: None,
				})
				.collect(),
		}
	}
}

/// One selectable (family, relay, model) entry, resolved for the picker and router.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeOffer {
	pub family_id: String,
	pub family_name: String,
	pub relay_id: String,
	pub relay_name: String,
	pub provider_key: String,
	pub model_id: String,
	pub input_cost: f64,
	pub output_cost: f64,
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

/// Raw view: keys still carry their on-disk ciphertext.
pub fn load(dir: &Path) -> Result<FamiliesConfig, String> {
	let path = config_path(dir);
	if !path.exists() {
		return Ok(Default::default());
	}
	let bytes = std::fs::read(&path).map_err(|_| "无法读取家族配置".to_string())?;
	let value: Value = serde_json::from_slice(&bytes)
		.map_err(|_| "家族配置不是有效 JSON，请修复或删除 skiff-families.json".to_string())?;
	// Testing-environment reset: a pre-v3 file is backed up verbatim and the
	// app starts fresh; no data migration is attempted.
	if value["version"].as_u64().unwrap_or(1) < 3 {
		std::fs::rename(&path, legacy_backup_path(dir))
			.map_err(|_| "无法备份旧版家族配置，请手动处理 skiff-families.json".to_string())?;
		return Ok(Default::default());
	}
	let mut config: FamiliesConfig = serde_json::from_value(value)
		.map_err(|_| "家族配置不是有效 JSON，请修复或删除 skiff-families.json".to_string())?;
	// Older files may predate a family; reinstate it empty rather than dropping it.
	for id in FAMILY_IDS {
		if !config.families.iter().any(|family| family.id == id) {
			config.families.push(ModelFamily {
				id: id.to_string(),
				display_name: family_display(id).to_string(),
				routes: Vec::new(),
				default_relay_id: None,
			});
		}
	}
	config.families.sort_by_key(|family| FAMILY_IDS.iter().position(|id| *id == family.id).unwrap_or(usize::MAX));
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
		normalized.push(ModelSpec {
			model_id,
			input_cost: money(model.input_cost),
			output_cost: money(model.output_cost),
			currency: model.currency,
			max_tokens: model.max_tokens,
			context_window: model.context_window,
		});
	}
	Ok(normalized)
}

/// Validates one route, including model-ID uniqueness across every route of
/// the same relay: the projected (provider, model) pair must stay unambiguous.
fn normalize_route(route: &RouteSpec, config: &FamiliesConfig, replacing: Option<(&str, &str)>) -> Result<RouteSpec, String> {
	if !config.relays.iter().any(|relay| relay.id == route.relay_id) {
		return Err("线路的中转不存在，请先添加中转".into());
	}
	let models = normalize_models(&route.models)?;
	for family in &config.families {
		for existing in &family.routes {
			if replacing == Some((family.id.as_str(), existing.relay_id.as_str())) {
				continue;
			}
			if existing.relay_id != route.relay_id {
				continue;
			}
			if let Some(duplicate) = existing.models.iter().find(|model| models.iter().any(|item| item.model_id == model.model_id)) {
				return Err(format!("同一中转上模型 ID 不能重复：{}", duplicate.model_id));
			}
		}
	}
	Ok(RouteSpec { relay_id: route.relay_id.clone(), models, streaming: route.streaming, tools: route.tools, vision: route.vision, reasoning: route.reasoning })
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
		&& config.families.iter().any(|family| family.routes.iter().any(|route| route.relay_id == relay_id && !route.models.is_empty()))
}

/// Keeps the default pointing at a usable route; falls back to route order.
fn pick_default(family: &mut ModelFamily, config: &FamiliesConfig) {
	let current = family.default_relay_id.clone();
	let valid = current.as_deref().is_some_and(|id| {
		family.routes.iter().any(|route| route.relay_id == id && !route.models.is_empty()) && relay_enabled_with_models(config, id)
	});
	if !valid {
		family.default_relay_id = family
			.routes
			.iter()
			.find(|route| !route.models.is_empty() && relay_enabled_with_models(config, &route.relay_id))
			.map(|route| route.relay_id.clone());
	}
}

fn re_pick_defaults(config: &mut FamiliesConfig) {
	let snapshot = config.clone();
	for family in &mut config.families {
		pick_default(family, &snapshot);
	}
}

// --- projection into pi's own configuration ---------------------------------

/// pi's provider identifier for one route; also its key in `auth.json`.
pub fn provider_key(family_id: &str, relay_id: &str) -> String {
	format!("{KEY_PREFIX}{}-{family_id}", sanitize_component(relay_id))
}

fn key_env(key: &str) -> String {
	format!("SKIFF_KEY_{}", key.replace('-', "_"))
}

fn project_model(route: &RouteSpec, item: &ModelSpec, key: &str) -> Value {
	let vision = if route.vision { json!(["text", "image"]) } else { json!(["text"]) };
	json!({
		"id": item.model_id, "name": item.model_id, "api": "openai-completions", "provider": key,
		"cost": { "input": item.input_cost, "output": item.output_cost, "cacheRead": item.input_cost, "cacheWrite": item.input_cost },
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
				if route.models.is_empty() {
					continue;
				}
				let route_key = provider_key(&family.id, &relay.id);
				// Every route of a relay shares one key environment variable.
				cmd.env(key_env(&route_key), &relay.api_key);
				routes.push(json!({ "providerKey": route_key, "baseUrl": relay.base_url,
					"keyEnv": key_env(&route_key), "streaming": route.streaming, "tools": route.tools,
					"timeoutSeconds": relay.timeout_seconds,
					"models": route.models.iter().map(|model| project_model(route, model, &route_key)).collect::<Vec<_>>() }));
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

	// (route key, relay, route) for every route with models, enabled or not:
	// disabled routes keep their credential but lose their provider entry.
	let mut desired: Vec<(String, &RelaySpec, &RouteSpec)> = Vec::new();
	for family in &config.families {
		for route in &family.routes {
			if route.models.is_empty() { continue; }
			let Some(relay) = config.relays.iter().find(|relay| relay.id == route.relay_id) else { continue };
			desired.push((provider_key(&family.id, &relay.id), relay, route));
		}
	}

	{
		let map = models["providers"].as_object_mut().ok_or("pi 配置的 providers 必须是对象")?;
		map.retain(|key, _| !is_managed_key(key) || desired.iter().any(|(wanted, _, _)| wanted == key));
		for (key, relay, route) in &desired {
			if !relay.enabled {
				map.remove(key);
				continue;
			}
			let entry = json!({
				"api": "openai-completions",
				"baseUrl": relay.base_url,
				"models": route.models.iter().map(|item| project_model(route, item, key)).collect::<Vec<_>>(),
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
		for route in &family.routes {
			let Some(relay) = config.relays.iter().find(|relay| relay.id == route.relay_id) else { continue };
			if !relay.enabled {
				continue;
			}
			for model in &route.models {
				offers.push(RuntimeOffer {
					family_id: family.id.clone(),
					family_name: family.display_name.clone(),
					relay_id: relay.id.clone(),
					relay_name: relay.name.clone(),
					provider_key: provider_key(&family.id, &relay.id),
					model_id: model.model_id.clone(),
					input_cost: model.input_cost,
					output_cost: model.output_cost,
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
	re_pick_defaults(&mut config);
	save(dir, &config)?;
	Ok(config)
}

fn upsert_relay(config: &mut FamiliesConfig, relay: RelaySpec) {
	match config.relays.iter_mut().find(|existing| existing.id == relay.id) {
		Some(existing) => *existing = relay,
		None => config.relays.push(relay),
	}
}

pub fn save_relay_in(dir: &Path, relay: RelaySpec) -> Result<FamiliesConfig, String> {
	apply(dir, |config| {
		let normalized = normalize_relay(relay, config)?;
		// A blank key on an edit means "keep the stored one".
		if normalized.api_key.trim().is_empty() {
			let Some(existing) = config.relays.iter().find(|existing| existing.id == normalized.id) else {
				return Err("新中转需要 API Key".into());
			};
			let mut with_key = normalized;
			with_key.api_key = existing.api_key.clone();
			upsert_relay(config, with_key);
			return Ok(());
		}
		upsert_relay(config, normalized);
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
			if family.default_relay_id.as_deref() == Some(relay_id) {
				family.default_relay_id = None;
			}
		}
		Ok(())
	})
}

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
		let normalized = normalize_route(&route, config, None)?;
		let family = family_mut(config, family_id)?;
		match family.routes.iter_mut().find(|existing| existing.relay_id == normalized.relay_id) {
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
		family.routes.retain(|route| route.relay_id != relay_id);
		if family.routes.len() == before {
			return Err("找不到要删除的线路".into());
		}
		if family.default_relay_id.as_deref() == Some(relay_id) {
			family.default_relay_id = None;
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
			let Some(route) = family.routes.iter().find(|route| &route.relay_id == id) else {
				return Err("排序请求包含未知线路".into());
			};
			reordered.push(route.clone());
		}
		family.routes = reordered;
		Ok(())
	})
}

pub fn set_default_route_in(dir: &Path, family_id: &str, relay_id: Option<&str>) -> Result<FamiliesConfig, String> {
	apply(dir, |config| {
		let Some(id) = relay_id else {
			family_mut(config, family_id)?.default_relay_id = None;
			return Ok(());
		};
		let usable = {
			let family = family_mut(config, family_id)?;
			family.routes.iter().any(|route| route.relay_id == id && !route.models.is_empty())
		} && relay_enabled_with_models(config, id);
		if !usable {
			return Err("默认线路必须是该家族内已启用中转上的线路".into());
		}
		family_mut(config, family_id)?.default_relay_id = Some(id.to_string());
		Ok(())
	})
}

pub fn set_auto_failover_in(dir: &Path, auto_failover: bool) -> Result<FamiliesConfig, String> {
	apply(dir, |config| {
		config.auto_failover = auto_failover;
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
pub fn save_relay(relay: RelaySpec) -> Result<FamiliesConfig, String> {
	let _guard = providers::CONFIG_LOCK.lock().map_err(|_| "配置锁异常")?;
	save_relay_in(&agent_dir()?, relay)
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

/// One `max_tokens=1` completion proves the relay endpoint, key and model work.
#[tauri::command]
pub async fn test_provider_connection(base_url: String, api_key: String, model_id: String, timeout_seconds: Option<u64>) -> Result<TestResult, String> {
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
