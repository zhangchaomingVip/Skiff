//! Web search configuration and the bundled `pi` extension that powers it.
//!
//! Skiff owns three pieces here:
//!  - `<pi dir>/extensions/web-search.js` — the pi extension registering the
//!    `web_search` tool and the `/web on|off` command (source is embedded in
//!    the binary so upgrades always ship the matching version).
//!  - `<pi dir>/skiff-web-search.json` — user's Tavily key written by Skiff.
//!  - `<pi dir>/skiff-web-search-state.json` — written by the extension; holds
//!    whether the tool should be active so forks and restarts keep the choice.
//!
//! The key is write-only: no command ever returns it, only a short hint.

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
	configured: bool,
	/// Trailing characters of the stored key, enough to tell keys apart.
	key_hint: Option<String>,
	/// Whether the extension file is already installed and up to date.
	extension_installed: bool,
	/// Last value persisted by the extension through `/web on|off`.
	enabled: bool,
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

fn read_stored_key(dir: &Path) -> Option<String> {
	read_json(&dir.join(KEY_FILE))
		.get("apiKey")
		.and_then(Value::as_str)
		.map(str::trim)
		.filter(|key| !key.is_empty())
		.map(str::to_string)
}

#[tauri::command]
pub fn get_web_search_status() -> Result<WebSearchStatus, String> {
	let agent_dir = super::get_pi_agent_dir();
	let key = agent_dir.as_deref().and_then(read_stored_key);
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
		.map(|dir| read_json(&dir.join(STATE_FILE)).get("enabled").and_then(Value::as_bool).unwrap_or(false))
		.unwrap_or(false);
	Ok(WebSearchStatus { agent_dir: agent_dir.map(|p| p.to_string_lossy().to_string()), configured: key.is_some(), key_hint, extension_installed, enabled })
}

#[tauri::command]
pub fn save_web_search_key(api_key: String) -> Result<(), String> {
	let trimmed = api_key.trim().to_string();
	if trimmed.is_empty() { return Err("请填写 Tavily API Key".into()); }
	if trimmed.contains(['\r', '\n']) || trimmed.starts_with(['!', '$']) {
		return Err("API Key 必须是直接填写的密钥，不能是命令或变量表达式".into());
	}
	let dir = super::get_pi_agent_dir().ok_or("无法确定 pi 配置目录")?;
	let path = dir.join(KEY_FILE);
	let mut config = read_json(&path);
	config["apiKey"] = json!(trimmed);
	write_json(&path, &config)
}

#[tauri::command]
pub fn clear_web_search_key() -> Result<(), String> {
	let dir = super::get_pi_agent_dir().ok_or("无法确定 pi 配置目录")?;
	let path = dir.join(KEY_FILE);
	let mut config = read_json(&path);
	config["apiKey"] = Value::Null;
	write_json(&path, &config)
}

/// Installs the bundled extension. Returns true when the file actually changed,
/// which means any running pi session must be restarted to pick it up.
#[tauri::command]
pub fn install_web_search_extension() -> Result<bool, String> {
	let dir = super::get_pi_agent_dir().ok_or("无法确定 pi 配置目录")?;
	let path = dir.join("extensions").join(EXTENSION_NAME);
	if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|e| format!("无法创建扩展目录：{e}"))?; }
	if fs::read_to_string(&path).map(|text| text == EXTENSION_SOURCE).unwrap_or(false) { return Ok(false); }
	fs::write(&path, EXTENSION_SOURCE).map_err(|e| format!("写入扩展文件失败：{e}"))?;
	Ok(true)
}
