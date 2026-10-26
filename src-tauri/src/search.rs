//! Web search configuration and the bundled `pi` extension that powers it.
//!
//! Skiff owns three pieces here:
//!  - `<pi dir>/extensions/web-search.js` — the pi extension registering the
//!    `web_search` tool and the `/web on|off` command (source is embedded in
//!    the binary so upgrades always ship the matching version).
//!  - `<pi dir>/skiff-web-search.json` — the selected search engine
//!    (`provider`: `tavily` | `exa`) plus one API key per engine, written by
//!    Skiff. A legacy bare `apiKey` from before engines existed counts as the
//!    Tavily key. `readUrlEnabled` switches the `read_url` tool on; the tool
//!    itself reads through the active engine (Exa Contents or Tavily Extract).
//!  - `<pi dir>/skiff-web-search-state.json` — written by the extension; holds
//!    whether the tool should be active so forks and restarts keep the choice.
//!
//! Keys are write-only: no command ever returns them, only a short hint.

use std::fs;
use std::path::Path;
use serde::Serialize;
use serde_json::{json, Value};

const EXTENSION_SOURCE: &str = include_str!("pi_extensions/web_search.js");
const EXTENSION_NAME: &str = "web-search.js";
const KEY_FILE: &str = "skiff-web-search.json";
const STATE_FILE: &str = "skiff-web-search-state.json";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchStatus {
	agent_dir: Option<String>,
	/// Currently selected engine; the key fields and validation follow it.
	provider: String,
	configured: bool,
	/// Trailing characters of the stored key, enough to tell keys apart.
	key_hint: Option<String>,
	/// Whether the extension file is already installed and up to date.
	extension_installed: bool,
	/// Last value persisted by the extension through `/web on|off`.
	enabled: bool,
	/// Whether the `read_url` tool is switched on in settings.
	read_url_enabled: bool,
	/// Whether the stored key was validated against the selected engine.
	validated: Option<bool>,
	/// Human-readable validation message (error or success).
	validation_message: Option<String>,
}

fn read_json(path: &Path) -> Value {
	if !path.exists() { return json!({}); }
	let Ok(bytes) = fs::read(path) else { return json!({}) };
	serde_json::from_slice::<Value>(&bytes).unwrap_or_else(|_| json!({}))
}

fn write_json(path: &Path, value: &Value) -> Result<(), String> {
	let text = serde_json::to_string_pretty(value).map_err(|_| "序列化配置失败")?;
	let parent = path.parent().ok_or("配置路径无效")?;
	fs::create_dir_all(parent).map_err(|e| format!("无法创建配置目录：{e}"))?;
	// Write-then-rename so an interrupted write cannot leave a half-written file.
	let temp = path.with_extension("json.tmp");
	fs::write(&temp, format!("{text}\n")).map_err(|e| format!("写入临时文件失败：{e}"))?;
	fs::rename(&temp, path).map_err(|e| format!("替换配置文件失败：{e}"))?;
	Ok(())
}

/// Strict provider parse for writes; unknown names are rejected.
fn parse_provider(value: Option<&str>) -> Option<&'static str> {
	match value.map(str::trim) {
		Some("tavily") => Some("tavily"),
		Some("exa") => Some("exa"),
		_ => None,
	}
}

/// Lenient provider read for stored config; anything unknown falls back to Tavily.
fn read_provider(config: &Value) -> &'static str {
	parse_provider(config.get("provider").and_then(Value::as_str)).unwrap_or("tavily")
}

fn provider_label(provider: &str) -> &'static str {
	if provider == "exa" { "Exa" } else { "Tavily" }
}

fn provider_key_field(provider: &str) -> &'static str {
	if provider == "exa" { "exaApiKey" } else { "tavilyApiKey" }
}

/// Reads one engine's stored key; a legacy bare `apiKey` counts as the Tavily key.
fn read_provider_key(config: &Value, provider: &str) -> Option<String> {
	let stored = config.get(provider_key_field(provider)).and_then(Value::as_str);
	let legacy = if provider == "tavily" { config.get("apiKey").and_then(Value::as_str) } else { None };
	stored.or(legacy).map(str::trim).filter(|key| !key.is_empty()).map(str::to_string)
}

/// Lightweight Tavily validation: call their API with a dummy query.
async fn validate_tavily_key(api_key: &str) -> Result<(), String> {
	let client = reqwest::Client::builder()
		.timeout(std::time::Duration::from_secs(12))
		.build()
		.map_err(|e| format!("无法初始化 Tavily 请求：{e}"))?;
	let response = client
		.post("https://api.tavily.com/search")
		.json(&json!({
			"api_key": api_key,
			"query": "Skiff API key validation",
			"max_results": 1,
			"search_depth": "basic"
		}))
		.send()
		.await
		.map_err(|e| {
			if e.is_timeout() {
				"连接 Tavily 超时，请检查网络后重试".to_string()
			} else {
				"无法连接到 Tavily，请检查网络后重试".to_string()
			}
		})?;

	let status = response.status();
	if status.is_success() {
		return Ok(());
	}
	if status.as_u16() == 401 || status.as_u16() == 403 {
		return Err("API Key 无效或无权访问 Tavily，请检查密钥和账户权限".into());
	}
	if status.as_u16() == 429 {
		return Err("Tavily 请求过于频繁，请稍后重试".into());
	}
	Err(format!("Tavily 验证请求失败（HTTP {status}）"))
}

/// Cheapest deterministic Exa check: read one tiny URL instead of searching.
/// A search costs $0.007 per call, a one-page Contents read $0.001, and a bad
/// key still comes back as 401 so the verdict is identical.
async fn validate_exa_key(api_key: &str) -> Result<(), String> {
	let client = reqwest::Client::builder()
		.timeout(std::time::Duration::from_secs(12))
		.build()
		.map_err(|e| format!("无法初始化 Exa 请求：{e}"))?;
	let response = client
		.post("https://api.exa.ai/contents")
		.header("x-api-key", api_key)
		.json(&json!({ "ids": ["https://example.com"], "text": { "maxCharacters": 200 } }))
		.send()
		.await
		.map_err(|e| {
			if e.is_timeout() {
				"连接 Exa 超时，请检查网络后重试".to_string()
			} else {
				"无法连接到 Exa，请检查网络后重试".to_string()
			}
		})?;

	let status = response.status();
	if status.is_success() {
		return Ok(());
	}
	if status.as_u16() == 401 || status.as_u16() == 403 {
		return Err("API Key 无效或无权访问 Exa，请检查密钥和账户权限".into());
	}
	if status.as_u16() == 429 {
		return Err("Exa 请求过于频繁，请稍后重试".into());
	}
	Err(format!("Exa 验证请求失败（HTTP {status}）"))
}

async fn validate_provider_key(provider: &str, api_key: &str) -> Result<(), String> {
	if provider == "exa" { validate_exa_key(api_key).await } else { validate_tavily_key(api_key).await }
}

/// The `read_url` toggle; missing or malformed values mean off.
fn read_read_url_flag(config: &Value) -> bool {
	config.get("readUrlEnabled").and_then(Value::as_bool).unwrap_or(false)
}

/// The `/web on|off` switch; a missing state file means off, so a new install
/// has to be switched on explicitly before the tool is exposed.
fn read_enabled_flag(state: &Value) -> bool {
	state.get("enabled").and_then(Value::as_bool).unwrap_or(false)
}

fn read_web_search_status() -> (WebSearchStatus, Option<String>) {
	let agent_dir = super::get_pi_agent_dir();
	let config = agent_dir.as_ref().map(|dir| read_json(&dir.join(KEY_FILE))).unwrap_or_else(|| json!({}));
	let provider = read_provider(&config);
	let key = read_provider_key(&config, provider);
	let read_url_enabled = read_read_url_flag(&config);
	let key_hint = key.as_ref().map(|value| {
		let tail: String = value.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
		format!("…{tail}")
	});
	let extension_installed = agent_dir
		.as_ref()
		.map(|dir| fs::read_to_string(dir.join("extensions").join(EXTENSION_NAME)).map(|text| text == EXTENSION_SOURCE).unwrap_or(false))
		.unwrap_or(false);
	let enabled = agent_dir
		.as_deref()
		.map(|dir| read_enabled_flag(&read_json(&dir.join(STATE_FILE))))
		.unwrap_or(true);

	let status = WebSearchStatus {
		agent_dir: agent_dir.map(|p| p.to_string_lossy().to_string()),
		provider: provider.to_string(),
		configured: key.is_some(),
		key_hint,
		extension_installed,
		enabled,
		read_url_enabled,
		validated: None,
		validation_message: None,
	};
	(status, key)
}

#[tauri::command]
pub fn get_web_search_status() -> Result<WebSearchStatus, String> {
	Ok(read_web_search_status().0)
}

/// Validate the saved key without returning it to the frontend.
#[tauri::command]
pub async fn validate_web_search() -> Result<WebSearchStatus, String> {
	let (mut status, key) = read_web_search_status();
	let label = provider_label(&status.provider);
	let Some(key) = key else {
		status.validated = Some(false);
		status.validation_message = Some(format!("尚未配置 {label} API Key"));
		return Ok(status);
	};

	match validate_provider_key(&status.provider, &key).await {
		Ok(()) => {
			status.validated = Some(true);
			status.validation_message = Some(format!("{label} API Key 验证通过"));
		}
		Err(message) => {
			status.validated = Some(false);
			status.validation_message = Some(message);
		}
	}
	Ok(status)
}

/// Stores the key under the engine's own field and makes that engine active;
/// each engine keeps its key so switching back never needs a re-entry.
#[tauri::command]
pub fn save_web_search_key(provider: String, api_key: String) -> Result<(), String> {
	let Some(provider) = parse_provider(Some(&provider)) else {
		return Err("不支持的搜索引擎".into());
	};
	let trimmed = api_key.trim().to_string();
	if trimmed.is_empty() { return Err(format!("请填写 {} API Key", provider_label(provider))); }
	if trimmed.contains(['\r', '\n']) || trimmed.starts_with(['!', '$']) {
		return Err("API Key 必须是直接填写的密钥，不能是命令或变量表达式".into());
	}
	let dir = super::get_pi_agent_dir().ok_or("无法确定 pi 配置目录")?;
	let path = dir.join(KEY_FILE);
	let mut config = read_json(&path);
	config["provider"] = json!(provider);
	config[provider_key_field(provider)] = json!(trimmed);
	write_json(&path, &config)
}

/// Switches the active engine without touching either engine's stored key.
#[tauri::command]
pub fn set_web_search_provider(provider: String) -> Result<(), String> {
	let Some(provider) = parse_provider(Some(&provider)) else {
		return Err("不支持的搜索引擎".into());
	};
	let dir = super::get_pi_agent_dir().ok_or("无法确定 pi 配置目录")?;
	let path = dir.join(KEY_FILE);
	let mut config = read_json(&path);
	config["provider"] = json!(provider);
	write_json(&path, &config)
}

/// Switches the `read_url` tool on or off; both engines have a read endpoint,
/// so the flag applies to whichever engine is active.
#[tauri::command]
pub fn set_web_search_read_url(enabled: bool) -> Result<(), String> {
	let dir = super::get_pi_agent_dir().ok_or("无法确定 pi 配置目录")?;
	let path = dir.join(KEY_FILE);
	let mut config = read_json(&path);
	config["readUrlEnabled"] = json!(enabled);
	write_json(&path, &config)
}

/// Clears the active engine's stored key; the engine selection is kept.
#[tauri::command]
pub fn clear_web_search_key() -> Result<(), String> {
	let dir = super::get_pi_agent_dir().ok_or("无法确定 pi 配置目录")?;
	let path = dir.join(KEY_FILE);
	let mut config = read_json(&path);
	let provider = read_provider(&config);
	config[provider_key_field(provider)] = Value::Null;
	if provider == "tavily" { config["apiKey"] = Value::Null; }
	write_json(&path, &config)
}

/// Writes the bundled extension when it is missing or stale. Returns true when
/// the file actually changed, which means a running pi session needs a restart.
fn write_extension(dir: &Path) -> Result<bool, String> {
	let path = dir.join("extensions").join(EXTENSION_NAME);
	if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|e| format!("无法创建扩展目录：{e}"))?; }
	if fs::read_to_string(&path).map(|text| text == EXTENSION_SOURCE).unwrap_or(false) { return Ok(false); }
	fs::write(&path, EXTENSION_SOURCE).map_err(|e| format!("写入扩展文件失败：{e}"))?;
	Ok(true)
}

/// Installs the lookup extension before pi starts, so a new install needs no
/// manual "install extension" step. Failures are non-fatal: a session without
/// the tool still works, and the settings button remains as a manual repair.
pub(crate) fn ensure_extension() -> Result<bool, String> {
	let dir = super::get_pi_agent_dir().ok_or("无法确定 pi 配置目录")?;
	write_extension(&dir)
}

#[tauri::command]
pub fn install_web_search_extension() -> Result<bool, String> {
	ensure_extension()
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn provider_defaults_to_tavily_for_missing_or_unknown() {
		assert_eq!(read_provider(&json!({})), "tavily");
		assert_eq!(read_provider(&json!({ "provider": "bing" })), "tavily");
		assert_eq!(read_provider(&json!({ "provider": " exa " })), "exa");
		assert_eq!(read_provider(&json!({ "provider": "exa" })), "exa");
	}

	#[test]
	fn legacy_api_key_counts_as_tavily_only() {
		let config = json!({ "apiKey": "tvly-legacy" });
		assert_eq!(read_provider_key(&config, "tavily").as_deref(), Some("tvly-legacy"));
		assert_eq!(read_provider_key(&config, "exa"), None);
	}

	#[test]
	fn engine_keys_stay_separate() {
		let config = json!({ "provider": "exa", "tavilyApiKey": "tvly-1", "exaApiKey": "exa-2" });
		assert_eq!(read_provider_key(&config, "tavily").as_deref(), Some("tvly-1"));
		assert_eq!(read_provider_key(&config, "exa").as_deref(), Some("exa-2"));
		assert_eq!(read_provider(&config), "exa");
	}

	#[test]
	fn blank_keys_are_not_configured() {
		assert_eq!(read_provider_key(&json!({ "tavilyApiKey": "   " }), "tavily"), None);
		assert_eq!(read_provider_key(&json!({ "exaApiKey": "" }), "exa"), None);
		assert_eq!(read_provider_key(&json!({ "apiKey": "  " }), "tavily"), None);
	}

	#[test]
	fn a_new_install_starts_with_web_search_off() {
		assert!(!read_enabled_flag(&json!({})));
		assert!(read_enabled_flag(&json!({ "enabled": true })));
		assert!(!read_enabled_flag(&json!({ "enabled": false })));
		assert!(!read_enabled_flag(&json!({ "enabled": "true" })));
	}

	#[test]
	fn read_url_flag_defaults_to_off_and_ignores_junk() {
		assert!(!read_read_url_flag(&json!({})));
		assert!(!read_read_url_flag(&json!({ "readUrlEnabled": "true" })));
		assert!(read_read_url_flag(&json!({ "readUrlEnabled": true })));
		assert!(!read_read_url_flag(&json!({ "readUrlEnabled": false })));
	}

	#[test]
	fn provider_parse_is_strict_for_writes() {
		assert_eq!(parse_provider(Some("tavily")), Some("tavily"));
		assert_eq!(parse_provider(Some(" exa ")), Some("exa"));
		assert_eq!(parse_provider(Some("bing")), None);
		assert_eq!(parse_provider(None), None);
	}
}
