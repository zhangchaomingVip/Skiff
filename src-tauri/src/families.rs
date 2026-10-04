//! Model families: the user-facing way to organise providers.
//!
//! Skiff fixes three model families (DeepSeek, Kimi, GLM). A family holds any
//! number of provider channels — official endpoints, SiliconFlow, OpenRouter,
//! relay stations — each with its own display name, base URL, key, model id and
//! pricing. Selection happens on (family, channel); the request still runs
//! through pi, so this module projects every channel into pi's own
//! \`models.json\` / \`auth.json\` as a distinct provider named
//! \`skiff-<family>-<id>\`.

use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use super::crypto;
use super::providers;

/// The three families are fixed by design: users add channels, never families.
pub const FAMILY_IDS: [&str; 3] = ["deepseek", "kimi", "glm"];

/// Runtime projection prefix; kept in sync with [\`provider_key\`].
const KEY_PREFIX: &str = "skiff-";

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
	1
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
pub struct ProviderSpec {
	pub id: String,
	pub display_name: String,
	pub base_url: String,
	/// Plain text in memory and on the IPC boundary; sealed on disk.
	#[serde(default)]
	pub api_key: String,
	pub model_id: String,
	#[serde(default)]
	pub input_cost: f64,
	#[serde(default)]
	pub output_cost: f64,
	#[serde(default)]
	pub currency: Currency,
	#[serde(default)]
	pub max_tokens: Option<u64>,
	#[serde(default = "default_true")]
	pub streaming: bool,
	#[serde(default)]
	pub tools: bool,
	#[serde(default)]
	pub vision: bool,
	/// Kept but not editable in the UI: migrated channels remember reasoning.
	#[serde(default)]
	pub reasoning: bool,
	#[serde(default = "default_timeout")]
	pub timeout_seconds: u64,
	#[serde(default = "default_true")]
	pub enabled: bool,
	/// Preserve migrated context limits and provider compatibility options.
	#[serde(default)]
	pub model_config: Value,
	#[serde(default)]
	pub legacy_provider: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelFamily {
	pub id: String,
	pub display_name: String,
	#[serde(default)]
	pub providers: Vec<ProviderSpec>,
	#[serde(default)]
	pub default_provider_id: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FamiliesConfig {
	#[serde(default = "default_schema_version")]
	pub version: u64,
	#[serde(default)]
	pub families: Vec<ModelFamily>,
	#[serde(default)]
	pub auto_failover: bool,
}

impl Default for FamiliesConfig {
	fn default() -> Self {
		FamiliesConfig {
			version: default_schema_version(),
			auto_failover: false,
			families: FAMILY_IDS
				.iter()
				.map(|id| ModelFamily {
					id: id.to_string(),
					display_name: family_display(id).to_string(),
					providers: Vec::new(),
					default_provider_id: None,
				})
				.collect(),
		}
	}
}

/// One selectable (family, channel) pair, resolved for the picker and router.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeOffer {
	pub family_id: String,
	pub family_name: String,
	pub provider_id: String,
	pub display_name: String,
	pub provider_key: String,
	pub model_id: String,
	pub input_cost: f64,
	pub output_cost: f64,
	pub currency: Currency,
	pub max_tokens: Option<u64>,
	pub legacy_provider: Option<String>,
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

/// Raw view: keys still carry their on-disk ciphertext.
pub fn load(dir: &Path) -> Result<FamiliesConfig, String> {
	let path = config_path(dir);
	if !path.exists() {
		return Ok(Default::default());
	}
	let bytes = std::fs::read(&path).map_err(|_| "无法读取家族配置".to_string())?;
	let value: Value = serde_json::from_slice(&bytes)
		.map_err(|_| "家族配置不是有效 JSON，请修复或删除 skiff-families.json".to_string())?;
	let mut config: FamiliesConfig = serde_json::from_value(value.clone())
		.map_err(|_| "家族配置不是有效 JSON，请修复或删除 skiff-families.json".to_string())?;
	// Import older saved model limits once; an explicit null restores defaults.
	for (family_index, family) in config.families.iter_mut().enumerate() {
		for (provider_index, provider) in family.providers.iter_mut().enumerate() {
			if value["families"][family_index]["providers"][provider_index].get("maxTokens").is_none() {
				provider.max_tokens = provider.model_config["maxTokens"].as_u64();
			}
		}
	}
	// Older files may predate a family; reinstate it empty rather than dropping it.
	for id in FAMILY_IDS {
		if !config.families.iter().any(|family| family.id == id) {
			config.families.push(ModelFamily {
				id: id.to_string(),
				display_name: family_display(id).to_string(),
				providers: Vec::new(),
				default_provider_id: None,
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
	for family in &mut config.families {
		for provider in &mut family.providers {
			if provider.api_key.is_empty() {
				continue;
			}
			provider.api_key = crypto::open(&provider.api_key)
				.map_err(|_| format!("无法解密 {} 的密钥，请在原设备恢复配置", provider.display_name))?;
		}
	}
	Ok(())
}

/// Persists the config (sealing keys) and mirrors it into pi's configuration.
pub fn save(dir: &Path, config: &FamiliesConfig) -> Result<(), String> {
	let mut stored = config.clone();
	for family in &mut stored.families {
		for provider in &mut family.providers {
			if provider.api_key.is_empty() || crypto::is_sealed(&provider.api_key) {
				continue;
			}
			if let Some(sealed) = crypto::seal(&provider.api_key)? {
				provider.api_key = sealed;
			}
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
	let url = reqwest::Url::parse(raw.trim()).map_err(|_| "Base URL 格式不正确".to_string())?;
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

/// Validates one channel, resolving display-name collisions against siblings.
fn normalize(spec: &ProviderSpec, taken: &mut Vec<String>, fallback_id: &str) -> Result<ProviderSpec, String> {
	let context_window = spec.model_config["contextWindow"].as_u64().unwrap_or(128_000);
	if spec.max_tokens.is_some_and(|limit| limit == 0 || limit > context_window) {
		return Err("默认最大输出 Token 必须大于 0，且不能超过模型上下文窗口".into());
	}
	let base_display = display_name(&spec.display_name)?;
	let mut id: String = spec
		.id
		.chars()
		.filter(|character| character.is_ascii_alphanumeric() || *character == '-' || *character == '_')
		.collect();
	if id.is_empty() {
		id = fallback_id.to_string();
	}
	id.truncate(48);
	// Same-family display names must stay unambiguous in the picker.
	let mut display = base_display.clone();
	let mut suffix = 2;
	while taken.iter().any(|name| name.eq_ignore_ascii_case(&display)) {
		display = format!("{base_display} ({suffix})");
		suffix += 1;
	}
	taken.push(display.clone());
	Ok(ProviderSpec {
		id,
		display_name: display,
		base_url: validate_base_url(&spec.base_url)?,
		api_key: validate_api_key(&spec.api_key)?,
		model_id: validate_model_id(&spec.model_id)?,
		input_cost: money(spec.input_cost),
		output_cost: money(spec.output_cost),
		currency: spec.currency,
		max_tokens: spec.max_tokens,
		streaming: spec.streaming,
		tools: spec.tools,
		vision: spec.vision,
		reasoning: spec.reasoning,
		timeout_seconds: spec.timeout_seconds.clamp(5, 600),
		enabled: spec.enabled,
		model_config: spec.model_config.clone(),
		legacy_provider: spec.legacy_provider.clone(),
	})
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

fn next_id() -> String {
	let nanos = std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|value| value.as_nanos())
		.unwrap_or_default();
	format!("p{nanos}")
}

fn pick_default(family: &ModelFamily) -> Option<String> {
	let current = family.default_provider_id.as_deref();
	if let Some(id) = current {
		if family.providers.iter().any(|provider| provider.id == id && provider.enabled) {
			return Some(id.to_string());
		}
	}
	family.providers.iter().find(|provider| provider.enabled).map(|provider| provider.id.clone())
}

// --- projection into pi's own configuration ---------------------------------

fn sanitize_component(id: &str) -> String {
	let mut out: String = id.chars().filter(|character| character.is_ascii_alphanumeric() || *character == '-' || *character == '_').collect();
	if out.is_empty() {
		out.push('p');
	}
	out.truncate(48);
	out
}

/// pi's provider identifier for a channel; also its key in \`auth.json\`.
pub fn provider_key(family_id: &str, id: &str) -> String {
	format!("{KEY_PREFIX}{family_id}-{}", sanitize_component(id))
}

fn key_env(key: &str) -> String {
	format!("SKIFF_KEY_{}", key.replace('-', "_"))
}

/// Secrets are decrypted only into the child environment, never auth.json.
/// The runtime extension implements the channel's request capabilities.
pub fn prepare_runtime(dir: &Path, cmd: &mut std::process::Command) -> Result<(), String> {
	let _guard = providers::CONFIG_LOCK.lock().map_err(|_| "配置锁异常")?;
	let config = load_plain(dir)?;
	let models = providers::read_config(&dir.join("models.json"))?;
	let mut routes = Vec::new();
	for family in &config.families {
		for spec in family.providers.iter().filter(|provider| provider.enabled) {
			let key = provider_key(&family.id, &spec.id);
			cmd.env(key_env(&key), &spec.api_key);
			let model = models["providers"][&key]["models"][0].clone();
			routes.push(json!({ "providerKey": key, "baseUrl": spec.base_url,
				"keyEnv": key_env(&key), "streaming": spec.streaming, "tools": spec.tools,
				"timeoutSeconds": spec.timeout_seconds, "model": model }));
		}
	}
	if routes.is_empty() { return Ok(()); }
	let extension = dir.join("skiff-family-runtime.js");
	let source = include_str!("pi_extensions/model_families.js");
	if std::fs::read_to_string(&extension).ok().as_deref() != Some(source) {
		std::fs::write(&extension, source).map_err(|_| "无法安装模型家族请求适配器")?;
	}
	cmd.env("SKIFF_FAMILY_RUNTIME", serde_json::to_string(&routes).map_err(|_| "无法编码渠道配置")?);
	cmd.arg("--extension").arg(extension);
	Ok(())
}

fn is_managed_key(key: &str) -> bool {
	FAMILY_IDS.iter().any(|family| key.starts_with(&format!("{KEY_PREFIX}{family}-")))
}

fn project_model(spec: &ProviderSpec, key: &str, existing: Option<&Value>) -> Value {
	let mut model = existing.cloned().or_else(|| spec.model_config.as_object().map(|_| spec.model_config.clone())).filter(Value::is_object).unwrap_or_else(|| json!({}));
	model["id"] = json!(spec.model_id);
	model["name"] = json!(spec.display_name);
	model["api"] = json!("openai-completions");
	model["provider"] = json!(key);
	if !model["cost"].is_object() { model["cost"] = json!({}); }
	model["cost"]["input"] = json!(spec.input_cost);
	model["cost"]["output"] = json!(spec.output_cost);
	model["currency"] = json!(spec.currency);
	model["cost"]["cacheRead"] = spec.model_config["cost"].get("cacheRead").cloned().unwrap_or_else(|| json!(spec.input_cost));
	model["cost"]["cacheWrite"] = spec.model_config["cost"].get("cacheWrite").cloned().unwrap_or_else(|| json!(spec.input_cost));
	if model.get("contextWindow").is_none() { model["contextWindow"] = json!(128_000); }
	model["maxTokens"] = json!(spec.max_tokens.unwrap_or_else(|| 8192.min(model["contextWindow"].as_u64().unwrap_or(128_000))));
	model["input"] = if spec.vision { json!(["text", "image"]) } else { json!(["text"]) };
	model["reasoning"] = json!(spec.reasoning);
	model
}

/// Rewrites \`models.json\` and \`auth.json\` so pi can dispatch every enabled
/// channel. Unknown providers and unknown fields are preserved verbatim.
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

	let mut desired: Vec<(String, &ProviderSpec)> = Vec::new();
	for family in &config.families {
		for provider in &family.providers {
			desired.push((provider_key(&family.id, &provider.id), provider));
		}
	}

	{
		let map = models["providers"].as_object_mut().ok_or("pi 配置的 providers 必须是对象")?;
		// Drop channels this app no longer knows about.
		map.retain(|key, _| !is_managed_key(key) || desired.iter().any(|(wanted, _)| wanted == key));
		for (key, spec) in &desired {
			if !spec.enabled {
				map.remove(key);
				continue;
			}
			let previous = map
				.get(key)
				.and_then(|entry| entry["models"].as_array())
				.and_then(|models| models.first())
				.cloned();
			let mut entry = map.get(key).cloned().filter(Value::is_object).unwrap_or_else(|| json!({}));
			entry["api"] = json!("openai-completions");
			if let Some(fields) = entry.as_object_mut() { fields.remove("apiKey"); }
			entry["baseUrl"] = json!(spec.base_url);
			entry["models"] = json!([project_model(spec, key, previous.as_ref())]);
			map.insert(key.clone(), entry);
		}
	}

	if let Some(map) = auth.as_object_mut() {
		map.retain(|key, _| !is_managed_key(key) || desired.iter().any(|(wanted, _)| wanted == key));
		for (key, spec) in &desired {
			if !spec.api_key.trim().is_empty() {
				// Keep legacy entries readable for one release, with the same
				// child environment reference instead of a second plaintext copy.
				for credential in map.values_mut() {
					if credential["type"] == "api_key" && credential["key"].as_str() == Some(&spec.api_key) {
						credential["key"] = json!(format!("${}", key_env(key)));
					}
				}
				for entry in models["providers"].as_object_mut().into_iter().flat_map(|map| map.values_mut()) {
					if entry["apiKey"].as_str() == Some(&spec.api_key) { entry["apiKey"] = json!(format!("${}", key_env(key))); }
				}
				map.insert(key.clone(), json!({ "type": "api_key", "key": format!("${}", key_env(key)) }));
			}
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

// --- migration ---------------------------------------------------------------

fn classify(provider: &str, model: &str, display_name: &str) -> Option<&'static str> {
	let text = format!("{provider} {model} {display_name}").to_lowercase();
	if text.contains("kimi") || text.contains("moonshot") {
		Some("kimi")
	} else if text.contains("glm") || text.contains("zhipu") || text.contains("z.ai") || text.contains("chatglm") {
		Some("glm")
	} else if text.contains("deepseek") {
		Some("deepseek")
	} else {
		None
	}
}

fn unique_display(provider: &str, model: &str, multi: bool, taken: &[String]) -> String {
	let base = if multi { format!("默认 · {model}") } else { "默认".to_string() };
	if !taken.iter().any(|name| name == &base) {
		return base;
	}
	let tagged = format!("{provider} · {model}");
	if !taken.iter().any(|name| name == &tagged) {
		return tagged;
	}
	let mut suffix = 2;
	loop {
		let candidate = format!("{tagged} ({suffix})");
		if !taken.iter().any(|name| name == &candidate) {
			return candidate;
		}
		suffix += 1;
	}
}

/// Imports pi's existing OpenAI-compatible providers as the first channels of
/// their family. Runs once: an existing \`skiff-families.json\` wins.
pub fn migrate(dir: &Path) -> Result<bool, String> {
	if config_path(dir).exists() {
		// Already migrated (or the user started fresh); never clobber.
		return Ok(false);
	}
	let models = providers::read_config(&dir.join("models.json"))?;
	let auth = providers::read_config(&dir.join("auth.json"))?;
	let empty = Map::new();
	let source = models["providers"].as_object().unwrap_or(&empty);
	let mut config = FamiliesConfig::default();
	for (key, entry) in source {
		if is_managed_key(key) || entry["api"].as_str() != Some("openai-completions") {
			continue;
		}
		let base = entry["baseUrl"].as_str().unwrap_or("");
		if base.trim().is_empty() {
			continue;
		}
		let models_list = entry["models"].as_array().cloned().unwrap_or_default();
		if models_list.is_empty() {
			continue;
		}
		let raw_key = auth
			.get(key)
			.and_then(|credential| credential["key"].as_str())
			.or_else(|| entry["apiKey"].as_str())
			.unwrap_or("")
			.trim()
			.to_string();
		let raw_key = if let Some(variable) = raw_key.strip_prefix('$') {
			std::env::var(variable).map_err(|_| format!("迁移需要设置环境变量 {variable}"))?
		} else if raw_key.starts_with('!') {
			return Err("迁移不支持命令形式的密钥，请改为直接密钥或环境变量".into());
		} else { raw_key };
		let multi = models_list.len() > 1;
		for model in &models_list {
			let Some(id) = model["id"].as_str() else { continue };
			let Some(family_id) = classify(key, id, model["name"].as_str().unwrap_or("")) else { continue };
			let family = config.families.iter_mut().find(|family| family.id == family_id).expect("fixed family");
			let taken: Vec<String> = family.providers.iter().map(|provider| provider.display_name.clone()).collect();
			family.providers.push(ProviderSpec {
				id: next_id(),
				display_name: unique_display(key, id, multi, &taken),
				base_url: base.to_string(),
				api_key: raw_key.clone(),
				model_id: id.to_string(),
				input_cost: model["cost"]["input"].as_f64().unwrap_or(0.0),
				output_cost: model["cost"]["output"].as_f64().unwrap_or(0.0),
				currency: Currency::default(),
				max_tokens: model["maxTokens"].as_u64(),
				streaming: true,
				tools: true,
				vision: model["input"].as_array().is_some_and(|list| list.iter().any(|value| value == "image")),
				reasoning: model["reasoning"].as_bool().unwrap_or(false),
				timeout_seconds: default_timeout(),
				enabled: true,
				model_config: model.clone(),
				legacy_provider: Some(key.clone()),
			});
		}
	}
	if config.families.iter().all(|family| family.providers.is_empty()) {
		// Nothing to import; leave the machine untouched.
		return Ok(false);
	}
	for family in &mut config.families {
		family.default_provider_id = family.providers.iter().find(|provider| provider.enabled).map(|provider| provider.id.clone());
	}
	save(dir, &config)?;
	Ok(true)
}

// --- runtime view ------------------------------------------------------------

pub fn runtime_offers(config: &FamiliesConfig) -> Vec<RuntimeOffer> {
	let mut offers = Vec::new();
	for family in &config.families {
		for provider in &family.providers {
			if !provider.enabled {
				continue;
			}
			offers.push(RuntimeOffer {
				family_id: family.id.clone(),
				family_name: family.display_name.clone(),
				provider_id: provider.id.clone(),
				display_name: provider.display_name.clone(),
				provider_key: provider_key(&family.id, &provider.id),
				model_id: provider.model_id.clone(),
				input_cost: provider.input_cost,
				output_cost: provider.output_cost,
				currency: provider.currency,
				max_tokens: provider.max_tokens,
				legacy_provider: provider.legacy_provider.clone(),
			});
		}
	}
	offers
}

// --- mutations ---------------------------------------------------------------

/// Shared implementation behind [`save_family_provider`].
pub fn save_provider_in(dir: &Path, family_id: &str, provider: ProviderSpec) -> Result<(), String> {
	let mut config = load_plain(dir)?;
	let mut spec = provider;
	if spec.id.trim().is_empty() {
		spec.id = next_id();
	}
	let family = family_mut(&mut config, family_id)?;
	let index = family.providers.iter().position(|existing| existing.id == spec.id);
	if let Some(existing) = index.and_then(|index| family.providers.get(index)) {
		spec.model_config = existing.model_config.clone();
		spec.legacy_provider = existing.legacy_provider.clone();
	}
	// A blank key on an edit means "keep the stored one".
	if spec.api_key.trim().is_empty() {
		let Some(existing) = index.and_then(|index| family.providers.get(index)) else {
			return Err("新提供商需要 API Key".into());
		};
		spec.api_key = existing.api_key.clone();
	}
	let mut taken: Vec<String> = family
		.providers
		.iter()
		.filter(|existing| existing.id != spec.id)
		.map(|existing| existing.display_name.clone())
		.collect();
	if taken.iter().any(|name| name.eq_ignore_ascii_case(spec.display_name.trim())) {
		return Err("同家族内显示名不能重复".into());
	}
	let normalized = normalize(&spec, &mut taken, &next_id())?;
	match index {
		Some(index) => family.providers[index] = normalized,
		None => family.providers.push(normalized),
	}
	let default = pick_default(family);
	family.default_provider_id = default;
	save(dir, &config)
}

pub fn remove_provider_in(dir: &Path, family_id: &str, provider_id: &str) -> Result<(), String> {
	let mut config = load_plain(dir)?;
	let family = family_mut(&mut config, family_id)?;
	if family.providers.len() <= 1 {
		return Err("每个家族至少保留一个提供商".into());
	}
	let Some(index) = family.providers.iter().position(|provider| provider.id == provider_id) else {
		return Err("找不到要删除的提供商".into());
	};
	family.providers.remove(index);
	let default = pick_default(family);
	family.default_provider_id = default;
	save(dir, &config)
}

pub fn reorder_in(dir: &Path, family_id: &str, provider_ids: &[String]) -> Result<(), String> {
	let mut config = load_plain(dir)?;
	let family = family_mut(&mut config, family_id)?;
	if provider_ids.len() != family.providers.len() {
		return Err("排序请求与现有提供商数量不一致".into());
	}
	if provider_ids.iter().collect::<std::collections::HashSet<_>>().len() != provider_ids.len() {
		return Err("排序请求包含重复提供商".into());
	}
	let mut reordered = Vec::with_capacity(family.providers.len());
	for id in provider_ids {
		let Some(provider) = family.providers.iter().find(|provider| &provider.id == id) else {
			return Err("排序请求包含未知提供商".into());
		};
		reordered.push(provider.clone());
	}
	family.providers = reordered;
	save(dir, &config)
}

pub fn set_enabled_in(dir: &Path, family_id: &str, provider_id: &str, enabled: bool) -> Result<(), String> {
	let mut config = load_plain(dir)?;
	let family = family_mut(&mut config, family_id)?;
	let Some(provider) = family.providers.iter_mut().find(|provider| provider.id == provider_id) else {
		return Err("找不到该提供商".into());
	};
	provider.enabled = enabled;
	let default = pick_default(family);
	family.default_provider_id = default;
	save(dir, &config)
}

pub fn set_default_in(dir: &Path, family_id: &str, provider_id: Option<&str>) -> Result<(), String> {
	let mut config = load_plain(dir)?;
	let family = family_mut(&mut config, family_id)?;
	if let Some(id) = provider_id {
		if !family.providers.iter().any(|provider| provider.id == id && provider.enabled) {
			return Err("默认提供商必须是该家族内已启用的项".into());
		}
	}
	family.default_provider_id = provider_id.map(str::to_string);
	save(dir, &config)
}

pub fn set_auto_failover_in(dir: &Path, auto_failover: bool) -> Result<(), String> {
	let mut config = load_plain(dir)?;
	config.auto_failover = auto_failover;
	save(dir, &config)
}

// --- commands ----------------------------------------------------------------

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
	Ok(runtime_offers(&load(&agent_dir()?)?))
}

#[tauri::command]
pub fn migrate_provider_config() -> Result<bool, String> {
	let _guard = providers::CONFIG_LOCK.lock().map_err(|_| "配置锁异常")?;
	migrate(&agent_dir()?)
}

#[tauri::command]
pub fn save_family_provider(family_id: String, provider: ProviderSpec) -> Result<FamiliesConfig, String> {
	let _guard = providers::CONFIG_LOCK.lock().map_err(|_| "配置锁异常")?;
	let dir = agent_dir()?;
	save_provider_in(&dir, &family_id, provider)?;
	load_plain(&dir)
}

#[tauri::command]
pub fn delete_family_provider(family_id: String, provider_id: String) -> Result<FamiliesConfig, String> {
	let _guard = providers::CONFIG_LOCK.lock().map_err(|_| "配置锁异常")?;
	let dir = agent_dir()?;
	remove_provider_in(&dir, &family_id, &provider_id)?;
	load_plain(&dir)
}

#[tauri::command]
pub fn reorder_family_providers(family_id: String, provider_ids: Vec<String>) -> Result<FamiliesConfig, String> {
	let _guard = providers::CONFIG_LOCK.lock().map_err(|_| "配置锁异常")?;
	let dir = agent_dir()?;
	reorder_in(&dir, &family_id, &provider_ids)?;
	load_plain(&dir)
}

#[tauri::command]
pub fn set_family_provider_enabled(family_id: String, provider_id: String, enabled: bool) -> Result<FamiliesConfig, String> {
	let _guard = providers::CONFIG_LOCK.lock().map_err(|_| "配置锁异常")?;
	let dir = agent_dir()?;
	set_enabled_in(&dir, &family_id, &provider_id, enabled)?;
	load_plain(&dir)
}

#[tauri::command]
pub fn set_family_default_provider(family_id: String, provider_id: Option<String>) -> Result<FamiliesConfig, String> {
	let _guard = providers::CONFIG_LOCK.lock().map_err(|_| "配置锁异常")?;
	let dir = agent_dir()?;
	set_default_in(&dir, &family_id, provider_id.as_deref())?;
	load_plain(&dir)
}

#[tauri::command]
pub fn set_family_auto_failover(auto_failover: bool) -> Result<FamiliesConfig, String> {
	let _guard = providers::CONFIG_LOCK.lock().map_err(|_| "配置锁异常")?;
	let dir = agent_dir()?;
	set_auto_failover_in(&dir, auto_failover)?;
	load_plain(&dir)
}

/// Minimal round trip against one channel: `max_tokens = 1`, nothing stored.
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

/// Compatibility shim: the pre-family provider list stays available for one
/// release so older frontends and third-party automations keep working.
#[tauri::command]
pub fn list_openai_providers_legacy() -> Result<Vec<providers::ProviderInfo>, String> {
	providers::list_openai_providers()
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn currency_and_default_output_limit_round_trip_and_update_projection() {
		let dir = temp_dir("price-limits");
		let mut provider = spec("渠道", "deepseek-chat");
		provider.currency = Currency::Usd;
		provider.max_tokens = Some(4096);
		save_provider_in(&dir, "deepseek", provider).unwrap();
		let mut provider = load_plain(&dir).unwrap().families[0].providers[0].clone();
		assert_eq!(serde_json::to_value(provider.currency).unwrap(), "USD");
		assert_eq!(provider.max_tokens, Some(4096));
		let key = provider_key("deepseek", &provider.id);
		let projected = providers::read_config(&dir.join("models.json")).unwrap();
		assert_eq!(projected["providers"][&key]["models"][0]["maxTokens"], 4096);
		assert_eq!(projected["providers"][&key]["models"][0]["currency"], "USD");
		assert_eq!(runtime_offers(&load(&dir).unwrap())[0].max_tokens, Some(4096));
		provider.currency = Currency::Cny;
		provider.max_tokens = Some(12345);
		save_provider_in(&dir, "deepseek", provider.clone()).unwrap();
		let projected = providers::read_config(&dir.join("models.json")).unwrap();
		assert_eq!(projected["providers"][&key]["models"][0]["maxTokens"], 12345);
		provider.max_tokens = Some(0);
		assert!(save_provider_in(&dir, "deepseek", provider.clone()).is_err());
		provider.max_tokens = Some(128001);
		assert!(save_provider_in(&dir, "deepseek", provider.clone()).is_err());
		provider.max_tokens = None;
		save_provider_in(&dir, "deepseek", provider).unwrap();
		let projected = providers::read_config(&dir.join("models.json")).unwrap();
		assert_eq!(projected["providers"][&key]["models"][0]["maxTokens"], 8192);
		assert_eq!(projected["providers"][&key]["models"][0]["currency"], "CNY");
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[test]
	fn old_family_config_gets_yuan_and_preserves_migrated_output_limit() {
		let dir = temp_dir("old-price-limits");
		let mut config = FamiliesConfig::default();
		let mut provider = spec("旧渠道", "deepseek-chat");
		provider.model_config = json!({ "maxTokens": 4096 });
		config.families[0].providers.push(provider);
		let mut value = serde_json::to_value(config).unwrap();
		value["families"][0]["providers"][0].as_object_mut().unwrap().remove("currency");
		value["families"][0]["providers"][0].as_object_mut().unwrap().remove("maxTokens");
		providers::atomic_write(&config_path(&dir), &value).unwrap();
		let loaded = load(&dir).unwrap();
		assert_eq!(serde_json::to_value(loaded.families[0].providers[0].currency).unwrap(), "CNY");
		assert_eq!(loaded.families[0].providers[0].max_tokens, Some(4096));
		std::fs::remove_dir_all(dir).unwrap();
	}

	fn spec(name: &str, model: &str) -> ProviderSpec {
		ProviderSpec {
			id: String::new(),
			display_name: name.into(),
			base_url: "https://api.example.com/v1/".into(),
			api_key: "sk-secret-abcd".into(),
			model_id: model.into(),
			input_cost: 1.25,
			output_cost: 2.5,
			currency: Currency::default(),
			max_tokens: None,
			streaming: true,
			tools: false,
			vision: true,
			reasoning: false,
			timeout_seconds: 90,
			enabled: true,
			model_config: json!({}),
			legacy_provider: None,
		}
	}

	fn temp_dir(tag: &str) -> std::path::PathBuf {
		let dir = std::env::temp_dir().join(format!(
			"skiff-families-{tag}-{}-{}",
			std::process::id(),
			std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
		));
		std::fs::create_dir_all(&dir).unwrap();
		dir
	}

	#[test]
	fn saves_without_plaintext_keys_and_projects_one_provider_per_channel() {
		let dir = temp_dir("save");
		let mut config = FamiliesConfig::default();
		let family = family_mut(&mut config, "deepseek").unwrap();
		family.providers.push(normalize(&spec("官方直连", "deepseek-chat"), &mut Vec::new(), "p1").unwrap());
		family.providers.push(normalize(&spec("硅基低价", "deepseek-v4.1"), &mut Vec::new(), "p2").unwrap());
		save(&dir, &config).unwrap();

		let raw = std::fs::read_to_string(config_path(&dir)).unwrap();
		assert!(!raw.contains("sk-secret-abcd"), "key must not be stored in plain text");
		let models = providers::read_config(&dir.join("models.json")).unwrap();
		let keys: Vec<String> = models["providers"].as_object().unwrap().keys().cloned().collect();
		assert_eq!(keys.len(), 2);
		assert!(keys.iter().any(|key| key == "skiff-deepseek-p1"));
		assert!(keys.iter().any(|key| key == "skiff-deepseek-p2"));
		let entry = &models["providers"]["skiff-deepseek-p1"];
		assert_eq!(entry["baseUrl"], "https://api.example.com/v1");
		assert_eq!(entry["api"], "openai-completions");
		assert_eq!(entry["models"][0]["id"], "deepseek-chat");
		assert_eq!(entry["models"][0]["cost"]["input"], 1.25);
		assert_eq!(entry["models"][0]["input"][0], "text");
		assert_eq!(entry["models"][0]["input"][1], "image");
		let auth = providers::read_config(&dir.join("auth.json")).unwrap();
		assert_eq!(auth["skiff-deepseek-p1"]["key"], "$SKIFF_KEY_skiff_deepseek_p1");
		assert!(!std::fs::read_to_string(dir.join("auth.json")).unwrap().contains("sk-secret-abcd"));
		let mut command = std::process::Command::new("pi");
		prepare_runtime(&dir, &mut command).unwrap();
		assert!(command.get_envs().any(|(name, value)| name == "SKIFF_KEY_skiff_deepseek_p1" && value == Some(std::ffi::OsStr::new("sk-secret-abcd"))));
		// Round trip restores plaintext to the caller.
		let loaded = load_plain(&dir).unwrap();
		assert_eq!(loaded.families[0].providers[0].api_key, "sk-secret-abcd");
		let _ = std::fs::remove_dir_all(dir);
	}

	#[test]
	fn several_save_cycles_do_not_double_seal_or_lose_keys() {
		let dir = temp_dir("cycles");
		let mut config = FamiliesConfig::default();
		let family = family_mut(&mut config, "deepseek").unwrap();
		family.providers.push(normalize(&spec("一", "deepseek-chat"), &mut Vec::new(), "a").unwrap());
		family.providers.push(normalize(&spec("二", "deepseek-chat"), &mut Vec::new(), "b").unwrap());
		save(&dir, &config).unwrap();
		// Two mutations load from disk and re-save, which used to re-seal blobs.
		set_enabled_in(&dir, "deepseek", "b", false).unwrap();
		set_enabled_in(&dir, "deepseek", "b", true).unwrap();
		let config = load_plain(&dir).unwrap();
		assert_eq!(config.families[0].providers[1].api_key, "sk-secret-abcd");
		let auth = providers::read_config(&dir.join("auth.json")).unwrap();
		assert_eq!(auth["skiff-deepseek-b"]["key"], "$SKIFF_KEY_skiff_deepseek_b");
		assert!(!std::fs::read_to_string(config_path(&dir)).unwrap().contains("dpapi1:dpapi1:"));
		let _ = std::fs::remove_dir_all(dir);
	}

	#[test]
	fn disabled_channels_leave_pi_and_deleted_channels_drop_credentials() {
		let dir = temp_dir("disable");
		let mut config = FamiliesConfig::default();
		let family = family_mut(&mut config, "glm").unwrap();
		family.providers.push(normalize(&spec("主力", "glm-4.6"), &mut Vec::new(), "a").unwrap());
		family.providers.push(normalize(&spec("备用", "glm-4-air"), &mut Vec::new(), "b").unwrap());
		save(&dir, &config).unwrap();
		set_enabled_in(&dir, "glm", "b", false).unwrap();
		let models = providers::read_config(&dir.join("models.json")).unwrap();
		assert!(models["providers"].get("skiff-glm-b").is_none(), "disabled channels must not be selectable");
		assert!(models["providers"].get("skiff-glm-a").is_some());
		let auth = providers::read_config(&dir.join("auth.json")).unwrap();
		assert!(auth.get("skiff-glm-b").is_some(), "disabling keeps the key for re-enabling");
		remove_provider_in(&dir, "glm", "b").unwrap();
		assert!(remove_provider_in(&dir, "glm", "a").is_err(), "last channel is protected");
		let auth = providers::read_config(&dir.join("auth.json")).unwrap();
		assert!(auth.get("skiff-glm-b").is_none(), "deleting removes the credential");
		assert_eq!(load_plain(&dir).unwrap().families[2].providers.len(), 1);
		let _ = std::fs::remove_dir_all(dir);
	}

	#[test]
	fn rejects_bad_input_and_deduplicates_display_names() {
		let mut request = spec("中转", "glm-4.6");
		request.base_url = "ftp://api.example.com".into();
		assert!(normalize(&request, &mut Vec::new(), "x").is_err());
		let request = spec("中转", "");
		assert!(normalize(&request, &mut Vec::new(), "x").is_err());
		let mut taken = vec!["中转".to_string()];
		let deduped = normalize(&spec("中转", "glm-4.6"), &mut taken, "x").unwrap();
		assert_eq!(deduped.display_name, "中转 (2)");
		let mut request = spec("   ", "glm-4.6");
		assert!(normalize(&request, &mut Vec::new(), "x").is_err());
		request.display_name = "好名字".into();
		let clamped = normalize(&request, &mut Vec::new(), "x").unwrap();
		assert_eq!(clamped.timeout_seconds, 90);
		let mut slow = request.clone();
		slow.timeout_seconds = 100_000;
		assert_eq!(normalize(&slow, &mut Vec::new(), "y").unwrap().timeout_seconds, 600);
		let mut strange = spec("名字", "glm-4.6");
		strange.id = "!!".into();
		assert_eq!(normalize(&strange, &mut Vec::new(), "fallback").unwrap().id, "fallback");
		let mut blank = spec("名字", "glm-4.6");
		blank.api_key = "sk-a
b".into();
		assert!(normalize(&blank, &mut Vec::new(), "z").is_err());
	}

	#[test]
	fn reorder_and_default_selection_follow_the_family() {
		let dir = temp_dir("order");
		let mut config = FamiliesConfig::default();
		let family = family_mut(&mut config, "kimi").unwrap();
		family.providers.push(normalize(&spec("一", "kimi-k2"), &mut Vec::new(), "one").unwrap());
		family.providers.push(normalize(&spec("二", "kimi-k2-turbo"), &mut Vec::new(), "two").unwrap());
		save(&dir, &config).unwrap();
		assert!(reorder_in(&dir, "kimi", &["two".to_string(), "two".to_string()]).is_err());
		reorder_in(&dir, "kimi", &["two".to_string(), "one".to_string()]).unwrap();
		let config = load_plain(&dir).unwrap();
		assert_eq!(config.families[1].providers[0].id, "two");
		assert!(reorder_in(&dir, "kimi", &["two".to_string()]).is_err());
		set_default_in(&dir, "kimi", Some("two")).unwrap();
		assert_eq!(load_plain(&dir).unwrap().families[1].default_provider_id.as_deref(), Some("two"));
		assert!(set_default_in(&dir, "kimi", Some("missing")).is_err());
		let _ = std::fs::remove_dir_all(dir);
	}

	#[test]
	fn deleting_or_disabling_the_default_channel_reassigns_it() {
		let dir = temp_dir("default");
		let mut config = FamiliesConfig::default();
		let family = family_mut(&mut config, "kimi").unwrap();
		family.providers.push(normalize(&spec("一", "kimi-k2"), &mut Vec::new(), "one").unwrap());
		family.providers.push(normalize(&spec("二", "kimi-k2-turbo"), &mut Vec::new(), "two").unwrap());
		save(&dir, &config).unwrap();
		set_default_in(&dir, "kimi", Some("one")).unwrap();
		let config = load_plain(&dir).unwrap();
		assert_eq!(config.families[1].default_provider_id.as_deref(), Some("one"));
		remove_provider_in(&dir, "kimi", "one").unwrap();
		assert_eq!(load_plain(&dir).unwrap().families[1].default_provider_id.as_deref(), Some("two"));
		// Disabling the default also moves it.
		set_default_in(&dir, "kimi", Some("two")).unwrap();
		set_enabled_in(&dir, "kimi", "two", false).unwrap();
		// The only remaining channel is disabled, so no default can be chosen.
		assert_eq!(load_plain(&dir).unwrap().families[1].default_provider_id, None);
		let _ = std::fs::remove_dir_all(dir);
	}

	#[test]
	fn auto_failover_is_stored() {
		let dir = temp_dir("failover");
		set_auto_failover_in(&dir, true).unwrap();
		assert!(load_plain(&dir).unwrap().auto_failover);
		set_auto_failover_in(&dir, false).unwrap();
		assert!(!load_plain(&dir).unwrap().auto_failover);
		let _ = std::fs::remove_dir_all(dir);
	}

	#[test]
	fn migrates_existing_openai_providers_into_their_family_once() {
		let dir = temp_dir("migrate");
		providers::atomic_write(&dir.join("models.json"), &json!({
			"providers": {
				"yaoonion": { "api": "openai-completions", "baseUrl": "https://relay.example.com/v1", "models": [
					{ "id": "deepseek-flash", "cost": { "input": 0.3, "output": 1.2 }, "input": ["text", "image"], "reasoning": true },
					{ "id": "deepseek-v4-pro", "cost": { "input": 0.6, "output": 2.4 } }
				] },
				"moonshot": { "api": "openai-completions", "baseUrl": "https://api.moonshot.cn/v1", "models": [{ "id": "kimi-k2" }] },
				"unrelated": { "api": "anthropic-messages", "baseUrl": "https://api.anthropic.com", "models": [{ "id": "claude" }] }
			}
		})).unwrap();
		providers::atomic_write(&dir.join("auth.json"), &json!({ "yaoonion": { "type": "api_key", "key": "sk-relay" } })).unwrap();

		assert!(migrate(&dir).unwrap());
		let config = load_plain(&dir).unwrap();
		let deepseek = config.families.iter().find(|family| family.id == "deepseek").unwrap();
		assert_eq!(deepseek.providers.len(), 2, "one channel per model");
		assert!(deepseek.providers.iter().all(|provider| provider.display_name.starts_with("默认")));
		assert_eq!(deepseek.providers[0].input_cost, 0.3);
		assert!(deepseek.providers[0].vision);
		assert!(deepseek.providers[0].reasoning);
		assert_eq!(deepseek.providers[0].api_key, "sk-relay");
		let kimi = config.families.iter().find(|family| family.id == "kimi").unwrap();
		assert_eq!(kimi.providers.len(), 1);
		assert!(config.families.iter().find(|family| family.id == "glm").unwrap().providers.is_empty());
		// Migration is idempotent and keeps the legacy provider readable.
		assert!(!migrate(&dir).unwrap());
		let legacy = providers::read_config(&dir.join("models.json")).unwrap();
		assert_eq!(legacy["providers"]["yaoonion"]["baseUrl"], "https://relay.example.com/v1");
		let projected = format!("skiff-deepseek-{}", deepseek.providers[0].id);
		assert!(legacy["providers"].get(&projected).is_some());
		assert!(!std::fs::read_to_string(config_path(&dir)).unwrap().contains("sk-relay"));
		let _ = std::fs::remove_dir_all(dir);
	}

	#[test]
	fn runtime_offers_list_enabled_channels_in_order() {
		let mut config = FamiliesConfig::default();
		let family = family_mut(&mut config, "deepseek").unwrap();
		family.providers.push(normalize(&spec("官方", "deepseek-chat"), &mut Vec::new(), "a").unwrap());
		let mut hidden = normalize(&spec("停用", "deepseek-chat"), &mut Vec::new(), "b").unwrap();
		hidden.enabled = false;
		family.providers.push(hidden);
		let offers = runtime_offers(&config);
		assert_eq!(offers.len(), 1);
		assert_eq!(offers[0].provider_key, "skiff-deepseek-a");
		assert_eq!(offers[0].family_name, "DeepSeek");
		assert_eq!(offers[0].input_cost, 1.25);
	}

	#[test]
	fn a_corrupt_config_is_reported_instead_of_silently_replaced() {
		let dir = temp_dir("corrupt");
		std::fs::write(config_path(&dir), "{not json").unwrap();
		assert!(load(&dir).is_err());
		let _ = std::fs::remove_dir_all(dir);
	}

	#[test]
	fn invalid_ciphertext_blocks_mutations_without_losing_the_key() {
		let dir = temp_dir("invalid-key");
		let mut config = FamiliesConfig::default();
		let mut provider = spec("原配置", "deepseek-chat");
		provider.id = "a".into(); provider.api_key = "dpapi1:not-hex".into();
		config.families[0].providers.push(provider);
		providers::atomic_write(&config_path(&dir), &serde_json::to_value(config).unwrap()).unwrap();
		let before = std::fs::read(config_path(&dir)).unwrap();
		assert!(set_enabled_in(&dir, "deepseek", "a", false).is_err());
		assert_eq!(std::fs::read(config_path(&dir)).unwrap(), before);
		let _ = std::fs::remove_dir_all(dir);
	}

	#[test]
	fn failed_projection_preserves_all_config_files() {
		let dir = temp_dir("rollback");
		let mut config = FamiliesConfig::default();
		config.families[0].providers.push(normalize(&spec("原配置", "deepseek-chat"), &mut Vec::new(), "a").unwrap());
		save(&dir, &config).unwrap();
		std::fs::write(dir.join("auth.json"), "invalid JSON").unwrap();
		let paths = [config_path(&dir), dir.join("models.json"), dir.join("auth.json")];
		let before: Vec<_> = paths.iter().map(|path| std::fs::read(path).unwrap()).collect();
		assert!(set_enabled_in(&dir, "deepseek", "a", false).is_err());
		assert_eq!(paths.iter().map(|path| std::fs::read(path).unwrap()).collect::<Vec<_>>(), before);
		let _ = std::fs::remove_dir_all(dir);
	}

	#[cfg(windows)]
	#[test]
	fn failed_family_write_rolls_back_the_pi_projection() {
		let dir = temp_dir("late-rollback");
		let mut config = FamiliesConfig::default();
		config.families[0].providers.push(normalize(&spec("原配置", "deepseek-chat"), &mut Vec::new(), "a").unwrap());
		save(&dir, &config).unwrap();
		let paths = [config_path(&dir), dir.join("models.json"), dir.join("auth.json")];
		let before: Vec<_> = paths.iter().map(|path| std::fs::read(path).unwrap()).collect();
		let original_permissions = std::fs::metadata(&paths[0]).unwrap().permissions();
		let mut readonly = original_permissions.clone(); readonly.set_readonly(true);
		std::fs::set_permissions(&paths[0], readonly).unwrap();
		let result = set_enabled_in(&dir, "deepseek", "a", false);
		std::fs::set_permissions(&paths[0], original_permissions).unwrap();
		assert!(result.is_err());
		assert_eq!(paths.iter().map(|path| std::fs::read(path).unwrap()).collect::<Vec<_>>(), before);
		let _ = std::fs::remove_dir_all(dir);
	}

	#[test]
	fn migration_keeps_model_limits_and_skips_unrelated_openai_models() {
		let dir = temp_dir("metadata");
		providers::atomic_write(&dir.join("models.json"), &json!({ "providers": { "relay": {
			"api": "openai-completions", "baseUrl": "https://relay.example.com/v1", "apiKey": "dummy-inline-key",
			"models": [ { "id": "deepseek-chat", "contextWindow": 64000, "maxTokens": 4096, "compat": { "supportsStore": false } }, { "id": "gpt-example" } ]
		} } })).unwrap();
		migrate(&dir).unwrap();
		let config = load_plain(&dir).unwrap();
		assert_eq!(config.families[0].providers.len(), 1);
		let projected = providers::read_config(&dir.join("models.json")).unwrap();
		let model = &projected["providers"][provider_key("deepseek", &config.families[0].providers[0].id)]["models"][0];
		assert_eq!(model["contextWindow"], 64000); assert_eq!(model["maxTokens"], 4096);
		assert_eq!(model["compat"]["supportsStore"], false);
		for path in [config_path(&dir), dir.join("auth.json"), dir.join("models.json")] {
			assert!(!std::fs::read_to_string(path).unwrap().contains("dummy-inline-key"));
		}
		let duplicate = spec(&config.families[0].providers[0].display_name, "deepseek-chat");
		assert!(save_provider_in(&dir, "deepseek", duplicate).is_err());
		let _ = std::fs::remove_dir_all(dir);
	}
}
