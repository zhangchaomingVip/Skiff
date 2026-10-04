use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub(crate) static CONFIG_LOCK: Mutex<()> = Mutex::new(());

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInput {
	name: String,
	base_url: String,
	api_key: String,
	model_ids: Vec<String>,
	reasoning: bool,
	vision: bool,
	max_thinking: String,
	context_window: u64,
	max_tokens: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
	name: String,
	base_url: String,
	has_key: bool,
	model_ids: Vec<String>,
	reasoning: bool,
	vision: bool,
	max_thinking: String,
	context_window: u64,
	max_tokens: Option<u64>,
}

pub(crate) fn read_config(path: &Path) -> Result<Value, String> {
	if !path.exists() { return Ok(json!({})); }
	let bytes = std::fs::read(path).map_err(|_| "无法读取 pi 配置文件")?;
	let value: Value = serde_json::from_slice(&bytes).map_err(|_| "pi 配置不是有效 JSON，请先修复原文件")?;
	if !value.is_object() { return Err("pi 配置根节点必须是对象".into()); }
	Ok(value)
}

fn base_url(raw: &str) -> Result<String, String> {
	let url = reqwest::Url::parse(raw.trim()).map_err(|_| "Base URL 格式不正确")?;
	if !["http", "https"].contains(&url.scheme()) || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
		return Err("请输入 HTTP(S) API 根地址，不包含凭据、查询参数或片段".into());
	}
	Ok(url.as_str().trim_end_matches('/').to_string())
}

fn validate_key(key: &str) -> Result<(), String> {
	if key.contains(['\r', '\n']) || key.trim_start().starts_with(['!', '$']) {
		return Err("API Key 必须是直接填写的密钥，不能是命令或变量表达式".into());
	}
	Ok(())
}

fn discovery_network_error(error: reqwest::Error) -> String {
	// Do not expose reqwest debug output, request headers, or credentials.
	if error.is_timeout() { "获取模型列表超时（10 秒），请重试或手动填写模型 ID".into() }
	else { "无法获取模型，请检查地址和网络；也可手动填写模型 ID".into() }
}

fn discovery_http_error(status: u16, bytes: &[u8], key: &str) -> String {
	match status {
		401 => return "密钥无效或未授权".into(),
		404 => return "该地址不支持 /models 接口，请手动填写".into(),
		_ => {}
	}
	let value: Option<Value> = serde_json::from_slice(bytes).ok();
	let message = value.as_ref().and_then(|value| value["error"]["message"].as_str()
		.or_else(|| value["message"].as_str()).or_else(|| value["error"].as_str()));
	let text = String::from_utf8_lossy(bytes);
	let summary = message.unwrap_or(&text).replace(key, "[已隐藏]");
	let summary = summary.split_whitespace().collect::<Vec<_>>().join(" ");
	let summary: String = summary.chars().take(180).collect();
	let summary = if summary.is_empty() { "接口请求失败，请重试或手动填写模型 ID" } else { &summary };
	format!("HTTP {status} · {summary}")
}

async fn discover(base: &str, key: &str) -> Result<Vec<String>, String> {
	let base = base_url(base)?;
	validate_key(key)?;
	if key.trim().is_empty() { return Err("请先填写 API Key".into()); }
	let client = reqwest::Client::builder().timeout(Duration::from_secs(10)).redirect(reqwest::redirect::Policy::none()).build().map_err(|_| "无法初始化连接")?;
	let mut response = client.get(format!("{base}/models")).bearer_auth(key.trim()).send().await.map_err(discovery_network_error)?;
	let status = response.status();
	if [401, 404].contains(&status.as_u16()) { return Err(discovery_http_error(status.as_u16(), &[], key.trim())); }
	let mut bytes = Vec::new();
	while let Some(chunk) = response.chunk().await.map_err(|error| {
		let message = discovery_network_error(error);
		if status.is_success() { message } else { format!("HTTP {} · {message}", status.as_u16()) }
	})? {
		if bytes.len() + chunk.len() > 1024 * 1024 {
			return Err(format!("HTTP {} · 模型列表响应过大，请手动填写模型 ID", status.as_u16()));
		}
		bytes.extend_from_slice(&chunk);
	}
	if !status.is_success() { return Err(discovery_http_error(status.as_u16(), &bytes, key.trim())); }
	let value: Value = serde_json::from_slice(&bytes).map_err(|_| "模型列表不是有效 JSON")?;
	let mut ids: Vec<String> = value["data"].as_array().ok_or("模型列表应包含 data 数组")?.iter().filter_map(|m| m["id"].as_str()).filter(|id| !id.trim().is_empty()).map(str::to_string).collect();
	ids.sort(); ids.dedup();
	if ids.is_empty() { return Err("接口未返回模型，请手动填写模型 ID".into()); }
	Ok(ids)
}

#[tauri::command]
pub async fn discover_openai_models(base_url: String, api_key: String) -> Result<Vec<String>, String> {
	discover(&base_url, &api_key).await
}

fn info(name: &str, provider: &Value, auth: &Value) -> ProviderInfo {
	let models = provider["models"].as_array().cloned().unwrap_or_default();
	let first = models.first().cloned().unwrap_or(json!({}));
	ProviderInfo {
		name: name.into(), base_url: provider["baseUrl"].as_str().unwrap_or("").into(),
		has_key: auth.get(name).is_some() || provider.get("apiKey").is_some(),
		model_ids: models.iter().filter_map(|m| m["id"].as_str().map(str::to_string)).collect(),
		reasoning: first["reasoning"].as_bool().unwrap_or(false),
		vision: first["input"].as_array().is_some_and(|a| a.iter().any(|v| v == "image")),
		max_thinking: if first["thinkingLevelMap"]["max"].is_string() { "max" } else if first["thinkingLevelMap"]["xhigh"].is_string() { "xhigh" } else { "high" }.into(),
		context_window: first["contextWindow"].as_u64().unwrap_or(128000),
		max_tokens: first["maxTokens"].as_u64(),
	}
}

#[tauri::command]
pub fn list_openai_providers() -> Result<Vec<ProviderInfo>, String> {
	let _guard = CONFIG_LOCK.lock().map_err(|_| "配置锁异常")?;
	let dir = super::get_pi_agent_dir().ok_or("无法确定 pi 配置目录")?;
	let config = read_config(&dir.join("models.json"))?;
	let auth = read_config(&dir.join("auth.json"))?;
	Ok(config["providers"].as_object().map(|p| p.iter().filter(|(_, v)| v["api"] == "openai-completions").map(|(n, v)| info(n, v, &auth)).collect()).unwrap_or_default())
}

fn merge(config: &mut Value, auth: &mut Value, input: &ProviderInput) -> Result<(), String> {
	let name = input.name.trim();
	if name.is_empty() || name.len() > 64 || !name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
		return Err("提供商名称使用 1–64 个字母、数字、连字符或下划线".into());
	}
	let base = base_url(&input.base_url)?;
	validate_key(&input.api_key)?;
	if !["high", "xhigh", "max"].contains(&input.max_thinking.as_str()) || input.context_window < 1024 || input.max_tokens.is_some_and(|value| value == 0 || value > input.context_window) {
		return Err("请检查推理上限、上下文窗口与最大输出 Token".into());
	}
	if input.model_ids.is_empty() || input.model_ids.len() > 500 || input.model_ids.iter().any(|id| id.trim().is_empty() || id.len() > 256 || id.chars().any(char::is_control)) {
		return Err("请提供有效模型 ID，最多 500 个".into());
	}
	if config.get("providers").is_none() { config["providers"] = json!({}); }
	let providers = config["providers"].as_object_mut().ok_or("providers 配置必须是对象")?;
	let mut provider = providers.get(name).cloned().unwrap_or(json!({}));
	if !provider.is_object() { return Err("原提供商配置必须是对象".into()); }
	if provider.get("api").is_some_and(|api| api != "openai-completions") { return Err("同名提供商使用其他 API，请换一个名称".into()); }
	if input.api_key.trim().is_empty() && auth.get(name).is_none() && provider.get("apiKey").is_none() { return Err("新提供商需要 API Key".into()); }
	let previous = provider["models"].as_array().cloned().unwrap_or_default();
	let mut seen = std::collections::HashSet::new();
	let models: Vec<Value> = input.model_ids.iter().map(|id| id.trim()).filter(|id| seen.insert(*id)).map(|id| {
		let mut model = previous.iter().find(|m| m["id"] == id).cloned().unwrap_or(json!({ "id": id, "name": id }));
		model["reasoning"] = json!(input.reasoning);
		model["input"] = if input.vision { json!(["text", "image"]) } else { json!(["text"]) };
		model["contextWindow"] = json!(input.context_window);
		match input.max_tokens {
			Some(value) => model["maxTokens"] = json!(value),
			// Empty means "use the adapter/model default": drop any previous override.
			None => { if let Some(object) = model.as_object_mut() { object.remove("maxTokens"); } }
		}
		if input.reasoning {
			let mut levels = model["thinkingLevelMap"].as_object().cloned().unwrap_or_default();
			levels.insert("xhigh".into(), if input.max_thinking == "high" { Value::Null } else { levels.get("xhigh").filter(|v| v.is_string()).cloned().unwrap_or(json!("xhigh")) });
			levels.insert("max".into(), if input.max_thinking == "max" { levels.get("max").filter(|v| v.is_string()).cloned().unwrap_or(json!("max")) } else { Value::Null });
			model["thinkingLevelMap"] = json!(levels);
		}
		model
	}).collect();
	provider["baseUrl"] = json!(base); provider["api"] = json!("openai-completions"); provider["models"] = json!(models);
	providers.insert(name.into(), provider);
	if !input.api_key.trim().is_empty() { auth[name] = json!({ "type": "api_key", "key": input.api_key.trim() }); }
	Ok(())
}

pub(crate) fn atomic_write(path: &Path, value: &Value) -> Result<(), String> {
	let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos();
	let temp = path.with_extension(format!("skiff-{}-{nonce}.tmp", std::process::id()));
	let result = (|| {
		use std::io::Write;
		let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|_| "无法写入 pi 配置")?;
		#[cfg(unix)] { use std::os::unix::fs::PermissionsExt; file.set_permissions(std::fs::Permissions::from_mode(0o600)).map_err(|_| "无法设置配置权限")?; }
		file.write_all(&serde_json::to_vec_pretty(value).map_err(|_| "无法编码配置")?).map_err(|_| "无法写入 pi 配置")?;
		file.sync_all().map_err(|_| "无法保存 pi 配置")?;
		drop(file);
		std::fs::rename(&temp, path).map_err(|_| "无法替换 pi 配置，请确认文件未被锁定")
	})();
	if result.is_err() { let _ = std::fs::remove_file(temp); }
	result.map_err(str::to_string)
}

fn save_in(dir: &Path, input: &ProviderInput) -> Result<ProviderInfo, String> {
	let _guard = CONFIG_LOCK.lock().map_err(|_| "配置锁异常")?;
	let models_path = dir.join("models.json"); let auth_path = dir.join("auth.json");
	let existed = models_path.exists();
	let original = read_config(&models_path)?;
	let mut config = original.clone(); let mut auth = read_config(&auth_path)?;
	merge(&mut config, &mut auth, input)?;
	std::fs::create_dir_all(dir).map_err(|_| "无法创建 pi 配置目录")?;
	atomic_write(&models_path, &config)?;
	if !input.api_key.trim().is_empty() {
		if let Err(error) = atomic_write(&auth_path, &auth) {
			let rollback = if existed { atomic_write(&models_path, &original) } else { std::fs::remove_file(&models_path).map_err(|_| "无法恢复模型配置".into()) };
			if rollback.is_err() { return Err("凭据保存失败，且无法恢复模型配置，请检查 pi 配置文件".into()); }
			return Err(error);
		}
	}
	Ok(info(input.name.trim(), &config["providers"][input.name.trim()], &auth))
}

#[tauri::command]
pub async fn save_openai_provider(mut input: ProviderInput) -> Result<ProviderInfo, String> {
	if input.model_ids.is_empty() { input.model_ids = discover(&input.base_url, &input.api_key).await?; }
	let dir: PathBuf = super::get_pi_agent_dir().ok_or("无法确定 pi 配置目录")?;
	tauri::async_runtime::spawn_blocking(move || save_in(&dir, &input)).await.map_err(|_| "保存配置失败")?
}

fn set_max_tokens_in(dir: &Path, provider: &str, model_id: &str, max_tokens: Option<u64>) -> Result<Option<u64>, String> {
	if max_tokens == Some(0) { return Err("最大输出 Token 必须大于 0".into()); }
	let _guard = CONFIG_LOCK.lock().map_err(|_| "配置锁异常")?;
	let path = dir.join("models.json");
	if !path.exists() { return Err("pi 尚未生成 models.json，请先在 pi 中配置该模型".into()); }
	let mut config = read_config(&path)?;
	let providers = config["providers"].as_object_mut().ok_or("pi 配置缺少 providers")?;
	let entry = providers.get_mut(provider).ok_or_else(|| format!("pi 配置中没有提供商 {provider}"))?;
	let models = entry["models"].as_array_mut().ok_or("该提供商没有模型列表")?;
	let model = models.iter_mut().find(|m| m["id"].as_str() == Some(model_id)).ok_or_else(|| format!("没有找到模型 {model_id}"))?;
	let context = model["contextWindow"].as_u64().unwrap_or(0);
	match max_tokens {
		Some(value) => {
			if context > 0 && value > context { return Err("最大输出 Token 不能超过上下文窗口".into()); }
			model["maxTokens"] = json!(value);
		}
		// Clearing the field restores the adapter/model default.
		None => { if let Some(object) = model.as_object_mut() { object.remove("maxTokens"); } }
	}
	atomic_write(&path, &config)?;
	Ok(max_tokens)
}

#[tauri::command]
pub fn set_model_max_tokens(provider: String, model_id: String, max_tokens: Option<u64>) -> Result<Option<u64>, String> {
	let dir: PathBuf = super::get_pi_agent_dir().ok_or("无法确定 pi 配置目录")?;
	set_max_tokens_in(&dir, &provider, &model_id, max_tokens)
}

#[cfg(test)]
mod tests {
	use super::*;
	#[test]
	fn discovery_reports_http_errors_without_credentials() {
		use std::io::{Read, Write};
		for (status, body, expected) in [
			(401, "", "密钥无效或未授权"),
			(404, "", "该地址不支持 /models 接口，请手动填写"),
			(429, r#"{"error":{"message":"rate limited for test-key"}}"#, "HTTP 429 · rate limited for [已隐藏]"),
			(500, "upstream unavailable", "HTTP 500 · upstream unavailable"),
		] {
			let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
			let address = listener.local_addr().unwrap();
			let server = std::thread::spawn(move || {
				let (mut stream, _) = listener.accept().unwrap();
				stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
				let mut request = [0; 4096]; stream.read(&mut request).unwrap();
				write!(stream, "HTTP/1.1 {status} Error\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
			});
			let error = tauri::async_runtime::block_on(discover(&format!("http://{address}/v1/"), "test-key")).unwrap_err();
			assert_eq!(error, expected); assert!(!error.contains("test-key"));
			server.join().unwrap();
		}
	}
	#[test]
	fn discovery_times_out_while_reading_the_body() {
		use std::io::{Read, Write};
		let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
		let address = listener.local_addr().unwrap();
		let server = std::thread::spawn(move || {
			let (mut stream, _) = listener.accept().unwrap();
			stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
			let mut request = [0; 4096]; stream.read(&mut request).unwrap();
			write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n").unwrap();
			std::thread::sleep(Duration::from_secs(11));
		});
		let start = std::time::Instant::now();
		let error = tauri::async_runtime::block_on(discover(&format!("http://{address}/v1"), "test-key")).unwrap_err();
		assert!(error.contains("超时（10 秒）"));
		assert!(start.elapsed() >= Duration::from_secs(9));
		server.join().unwrap();
	}
	fn input() -> ProviderInput { ProviderInput { name: "gateway".into(), base_url: "http://localhost:1234/v1/".into(), api_key: "test-key".into(), model_ids: vec!["vision-test".into()], reasoning: true, vision: true, max_thinking: "max".into(), context_window: 128000, max_tokens: Some(8192) } }
	#[test]
	fn merges_without_exposing_keys_or_removing_other_config() {
		let mut config = json!({ "custom": 42, "providers": { "other": { "baseUrl": "existing" }, "gateway": { "api": "openai-completions", "headers": { "x-custom": "keep" }, "models": [{ "id": "vision-test", "cost": { "input": 2 } }] } } });
		let mut auth = json!({ "other": { "type": "oauth", "token": "untouched" } });
		merge(&mut config, &mut auth, &input()).unwrap();
		assert_eq!(config["custom"], 42); assert_eq!(config["providers"]["other"]["baseUrl"], "existing");
		assert_eq!(config["providers"]["gateway"]["headers"]["x-custom"], "keep");
		assert_eq!(config["providers"]["gateway"]["models"][0]["cost"]["input"], 2);
		assert_eq!(auth["other"]["token"], "untouched");
		assert_eq!(auth["gateway"]["key"], "test-key");
		let public = serde_json::to_string(&info("gateway", &config["providers"]["gateway"], &auth)).unwrap();
		assert!(!public.contains("test-key"));
		let mut update = input(); update.api_key.clear(); merge(&mut config, &mut auth, &update).unwrap(); assert_eq!(auth["gateway"]["key"], "test-key");
	}
	#[test]
	fn updates_max_tokens_without_touching_other_fields() {
		let dir = std::env::temp_dir().join(format!("skiff-limits-test-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
		std::fs::create_dir_all(&dir).unwrap();
		atomic_write(&dir.join("models.json"), &json!({ "providers": { "deepseek": { "api": "openai", "models": [{ "id": "deepseek-chat", "contextWindow": 64000, "maxTokens": 8192, "cost": { "input": 1 } }] } } })).unwrap();
		assert_eq!(set_max_tokens_in(&dir, "deepseek", "deepseek-chat", Some(32768)).unwrap(), Some(32768));
		let config = read_config(&dir.join("models.json")).unwrap();
		assert_eq!(config["providers"]["deepseek"]["models"][0]["maxTokens"], 32768);
		assert_eq!(config["providers"]["deepseek"]["models"][0]["cost"]["input"], 1);
		assert!(set_max_tokens_in(&dir, "deepseek", "deepseek-chat", Some(100000)).is_err());
		assert_eq!(set_max_tokens_in(&dir, "deepseek", "deepseek-chat", None).unwrap(), None);
		let config = read_config(&dir.join("models.json")).unwrap();
		assert!(config["providers"]["deepseek"]["models"][0].get("maxTokens").is_none());
		assert_eq!(config["providers"]["deepseek"]["models"][0]["contextWindow"], 64000);
		let _ = std::fs::remove_dir_all(dir);
	}
	#[test]
	fn rejects_unsafe_or_invalid_input() {
		assert!(base_url("file:///tmp").is_err()); assert!(base_url("https://key@host/v1").is_err()); assert!(base_url("https://host/v1?key=secret").is_err());
		let mut request = input(); request.api_key = "!run-command".into(); assert!(merge(&mut json!({}), &mut json!({}), &request).is_err());
		request = input(); request.api_key.clear(); assert!(merge(&mut json!({}), &mut json!({}), &request).is_err());
	}
	#[test]
	fn saves_and_updates_files_without_losing_credentials_or_level_mappings() {
		let dir = std::env::temp_dir().join(format!("skiff-provider-test-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
		let saved = save_in(&dir, &input()).unwrap(); assert!(saved.has_key);
		let mut config = read_config(&dir.join("models.json")).unwrap();
		config["providers"]["gateway"]["models"][0]["thinkingLevelMap"]["low"] = json!("minimal");
		atomic_write(&dir.join("models.json"), &config).unwrap();
		let mut update = input(); update.api_key.clear(); update.max_thinking = "high".into();
		save_in(&dir, &update).unwrap();
		assert_eq!(read_config(&dir.join("auth.json")).unwrap()["gateway"]["key"], "test-key");
		let config = read_config(&dir.join("models.json")).unwrap();
		assert_eq!(config["providers"]["gateway"]["models"][0]["thinkingLevelMap"]["low"], "minimal");
		assert!(config["providers"]["gateway"]["models"][0]["thinkingLevelMap"]["max"].is_null());
		std::fs::write(dir.join("models.json"), "invalid").unwrap();
		assert!(save_in(&dir, &update).is_err());
		assert_eq!(std::fs::read_to_string(dir.join("models.json")).unwrap(), "invalid");
		std::fs::remove_dir_all(dir).unwrap();
	}
	#[test]
	fn discovers_models_over_http_with_bearer_auth_and_deduplication() {
		use std::io::{Read, Write};
		let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
		let address = listener.local_addr().unwrap();
		let server = std::thread::spawn(move || {
			let (mut stream, _) = listener.accept().unwrap();
			stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
			let mut bytes = [0; 4096]; let size = stream.read(&mut bytes).unwrap();
			let request = String::from_utf8_lossy(&bytes[..size]);
			assert!(request.starts_with("GET /v1/models "));
			assert!(request.to_lowercase().contains("authorization: bearer test-key"));
			let body = r#"{"data":[{"id":"z-model"},{"id":"a-model"},{"id":"a-model"}]}"#;
			write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
		});
		let models = tauri::async_runtime::block_on(discover(&format!("http://{address}/v1"), "test-key")).unwrap();
		assert_eq!(models, ["a-model", "z-model"]); server.join().unwrap();
	}
}
