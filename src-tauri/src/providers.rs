//! Shared configuration IO for pi's `models.json` / `auth.json` plus the
//! OpenAI-compatible `/models` discovery used when adding relays and routes.
//!
//! Provider CRUD lives in [`super::families`]; nothing in this module writes
//! provider configuration on its own.

use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;
use serde_json::{json, Value};

pub(crate) static CONFIG_LOCK: Mutex<()> = Mutex::new(());

pub(crate) fn read_config(path: &Path) -> Result<Value, String> {
	if !path.exists() { return Ok(json!({})); }
	let bytes = std::fs::read(path).map_err(|_| "无法读取 pi 配置文件")?;
	let value: Value = serde_json::from_slice(&bytes).map_err(|_| "pi 配置不是有效 JSON，请先修复原文件")?;
	if !value.is_object() { return Err("pi 配置根节点必须是对象".into()); }
	Ok(value)
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

pub(crate) async fn discover(base: &str, key: &str) -> Result<Vec<String>, String> {
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
			let mut bytes = [0; 4096]; let size = stream.read(&mut bytes).unwrap();
			let _ = size;
			std::thread::sleep(Duration::from_secs(11));
			let _ = stream;
		});
		let start = std::time::Instant::now();
		let error = tauri::async_runtime::block_on(discover(&format!("http://{address}/v1"), "test-key")).unwrap_err();
		assert!(error.contains("超时（10 秒）"));
		assert!(start.elapsed() >= Duration::from_secs(9));
		server.join().unwrap();
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
	#[test]
	fn rejects_unsafe_urls_and_keys() {
		assert!(base_url("file:///tmp").is_err());
		assert!(base_url("https://key@host/v1").is_err());
		assert!(base_url("https://host/v1?key=secret").is_err());
		assert!(validate_key("!run-command").is_err());
		assert!(validate_key("$VAR").is_err());
		assert!(validate_key("sk-ok").is_ok());
	}
	#[test]
	fn atomic_write_replaces_and_cleans_up() {
		let path = std::env::temp_dir().join(format!("skiff-atomic-{}-{}.json", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
		atomic_write(&path, &json!({ "a": 1 })).unwrap();
		assert_eq!(read_config(&path).unwrap()["a"], 1);
		atomic_write(&path, &json!({ "a": 2 })).unwrap();
		assert_eq!(read_config(&path).unwrap()["a"], 2);
		std::fs::remove_file(&path).unwrap();
	}
}
