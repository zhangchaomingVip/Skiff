//! Shared configuration IO for pi's `models.json` / `auth.json` plus the
//! OpenAI-compatible `/models` discovery used when adding relays and routes.
//!
//! Provider CRUD lives in [`super::families`]; nothing in this module writes
//! provider configuration on its own.

use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;
use serde::Serialize;
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

/// Sends with the system proxy first, then retries direct: proxy clients
/// (Clash etc., common on CN desktops) sometimes route specific hosts badly
/// while a direct connection works fine.
async fn send_with_direct_retry<F>(build: F, timeout: Duration, noun: &str) -> Result<reqwest::Response, String>
where
	F: Fn(&reqwest::Client) -> reqwest::RequestBuilder,
{
	let new_client = |direct: bool| {
		let mut builder = reqwest::Client::builder()
			.timeout(timeout)
			.redirect(reqwest::redirect::Policy::limited(5));
		if direct { builder = builder.no_proxy(); }
		builder.build()
	};
	let client = new_client(false).map_err(|_| "无法初始化连接")?;
	match build(&client).send().await {
		Ok(response) => Ok(response),
		Err(first) => {
			let direct = new_client(true).map_err(|_| "无法初始化连接")?;
			build(&direct).send().await.map_err(|second| {
				let error = if first.is_timeout() || second.is_timeout() { first } else { second };
				if error.is_timeout() { format!("获取{noun}超时，请重试") } else { format!("无法获取{noun}，请检查网络") }
			})
		}
	}
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

/// A model reported by an OpenAI-compatible `/models` endpoint. Only the
/// capability flags Skiff can act on are kept; everything else is ignored.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiscoveredModel {
	pub id: String,
	pub reasoning: bool,
	pub vision: bool,
	pub tools: bool,
}

pub(crate) async fn discover(base: &str, key: &str) -> Result<Vec<DiscoveredModel>, String> {
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
	let mut models: Vec<DiscoveredModel> = value["data"].as_array().ok_or("模型列表应包含 data 数组")?.iter().filter_map(|m| {
		let id = m["id"].as_str()?;
		if id.trim().is_empty() { return None; }
		Some(DiscoveredModel {
			id: id.to_string(),
			// Most providers omit these; only adopt them when the endpoint
			// actually reports the capability, otherwise default to false.
			reasoning: m["reasoning"].as_bool().unwrap_or(false),
			vision: m["vision"].as_bool().unwrap_or(false),
			tools: m["tools"].as_bool().unwrap_or(false),
		})
	}).collect();
	models.sort_by(|a, b| a.id.cmp(&b.id));
	models.dedup_by(|a, b| a.id == b.id);
	if models.is_empty() { return Err("接口未返回模型，请手动填写模型 ID".into()); }
	Ok(models)
}

/// A pricing source page fetched for the import flow: the final URL after
/// redirects, the media type, and a size-capped body the frontend parses.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FetchedPage {
	pub url: String,
	pub content_type: String,
	pub body: String,
}

fn validate_page_url(raw: &str) -> Result<String, String> {
	let url = reqwest::Url::parse(raw.trim()).map_err(|_| "网页地址格式不正确")?;
	if !["http", "https"].contains(&url.scheme()) || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() {
		return Err("请输入 HTTP(S) 网页地址，不包含凭据".into());
	}
	Ok(url.to_string())
}

/// Fetches a user-supplied public pricing page (HTML or JSON). No credentials
/// are attached; anything under 2 MiB is handed to the frontend verbatim.
pub(crate) async fn fetch_pricing_page(raw: &str) -> Result<FetchedPage, String> {
	let url = validate_page_url(raw)?;
	let mut response = send_with_direct_retry(|client| client.get(&url), Duration::from_secs(15), "网页").await?;
	let status = response.status();
	if !status.is_success() {
		return Err(format!("HTTP {} · 网页获取失败，请确认地址可公开访问", status.as_u16()));
	}
	let content_type = response.headers().get(reqwest::header::CONTENT_TYPE)
		.and_then(|value| value.to_str().ok())
		.map(|value| value.split(';').next().unwrap_or("").trim().to_string())
		.unwrap_or_default();
	let mut bytes = Vec::new();
	while let Some(chunk) = response.chunk().await.map_err(|_| "读取网页内容失败，请重试")? {
		if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
			return Err("网页内容过大（超过 2 MB），请改用接口地址".into());
		}
		bytes.extend_from_slice(&chunk);
	}
	Ok(FetchedPage { url: response.url().to_string(), content_type, body: String::from_utf8_lossy(&bytes).into_owned() })
}

/// Result of a one-shot vision extraction: the assistant text plus whatever
/// usage the relay reported, so the UI can show the actual spend.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExtractedTable {
	pub text: String,
	pub prompt_tokens: Option<u64>,
	pub completion_tokens: Option<u64>,
}

fn validate_data_url(raw: &str) -> Result<(), String> {
	const MAX_IMAGE_CHARS: usize = 7_000_000; // ~5 MiB of base64
	let Some(rest) = raw.strip_prefix("data:image/") else { return Err("仅支持 PNG/JPEG/WebP/GIF 图片".into()) };
	let Some((mime, data)) = rest.split_once(";base64,") else { return Err("图片必须是 base64 编码的 data URL".into()) };
	if !["png", "jpeg", "webp", "gif"].contains(&mime) { return Err("仅支持 PNG/JPEG/WebP/GIF 图片".into()) }
	if data.len() > MAX_IMAGE_CHARS { return Err("单张图片过大（超过 5 MB），请压缩后重试".into()) }
	Ok(())
}

/// Sends the screenshot(s) plus the caller-supplied instruction to the relay's
/// `/chat/completions` with a vision model. The instruction and the response
/// parsing live on the frontend so they stay in sync with the table parser.
pub(crate) async fn extract_pricing_table(base: &str, key: &str, model_id: &str, instruction: &str, images: &[String]) -> Result<ExtractedTable, String> {
	let base = base_url(base)?;
	validate_key(key)?;
	if key.trim().is_empty() { return Err("请先填写 API Key".into()) }
	let model = model_id.trim();
	if model.is_empty() || model.len() > 256 || model.chars().any(char::is_control) { return Err("模型 ID 无效".into()) }
	if instruction.trim().is_empty() { return Err("识别指令不能为空".into()) }
	if images.is_empty() || images.len() > 4 { return Err("请提供 1~4 张图片".into()) }
	for image in images { validate_data_url(image)? }

	let mut content: Vec<Value> = vec![json!({ "type": "text", "text": instruction.trim() })];
	for image in images { content.push(json!({ "type": "image_url", "image_url": { "url": image } })); }
	let body = json!({
		"model": model,
		"temperature": 0,
		"max_tokens": 4096,
		"messages": [
			{ "role": "system", "content": "You are a precise data-extraction assistant. Follow the user's formatting instructions exactly and output nothing else." },
			{ "role": "user", "content": content }
		]
	});

	let mut response = send_with_direct_retry(|client| client.post(format!("{base}/chat/completions")).bearer_auth(key.trim()).json(&body), Duration::from_secs(90), "识别结果").await?;
	let status = response.status();
	let mut bytes = Vec::new();
	while let Some(chunk) = response.chunk().await.map_err(|_| "读取识别结果失败，请重试")? {
		if bytes.len() + chunk.len() > 512 * 1024 {
			return Err("识别结果过大，请换用粘贴方式导入".into());
		}
		bytes.extend_from_slice(&chunk);
	}
	if !status.is_success() { return Err(discovery_http_error(status.as_u16(), &bytes, key.trim())); }
	let value: Value = serde_json::from_slice(&bytes).map_err(|_| "识别接口返回的不是有效 JSON")?;
	let content = &value["choices"][0]["message"]["content"];
	let text = match content.as_str() {
		Some(text) => text.to_string(),
		None => content.as_array().map(|parts| parts.iter().filter_map(|part| part["text"].as_str()).collect::<Vec<_>>().join("")).unwrap_or_default(),
	};
	if text.trim().is_empty() { return Err("识别未返回内容，请换更清晰的截图重试".into()) }
	Ok(ExtractedTable {
		text,
		prompt_tokens: value["usage"]["prompt_tokens"].as_u64(),
		completion_tokens: value["usage"]["completion_tokens"].as_u64(),
	})
}

/// One official-price entry pruned from the models.dev catalog, USD per 1M tokens.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CatalogModel {
	pub provider: String,
	pub model_id: String,
	pub name: String,
	pub input_cost: f64,
	pub output_cost: f64,
	pub context_window: u64,
	pub max_tokens: u64,
	pub vision: bool,
	pub tools: bool,
	pub reasoning: bool,
	pub status: Option<String>,
	pub updated: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CatalogResponse {
	pub models: Vec<CatalogModel>,
	/// True when the network fetch failed and an expired cache was served.
	pub stale: bool,
	pub fetched_at: i64,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct CatalogCache {
	fetched_at: i64,
	models: Vec<CatalogModel>,
}

const CATALOG_URL: &str = "https://models.dev/api.json";
const CATALOG_TTL_SECS: i64 = 24 * 60 * 60;
/// Keep CN moonshot before the global twin so dedupe prefers it.
const CATALOG_PROVIDERS: [&str; 4] = ["deepseek", "moonshotai-cn", "moonshotai", "zhipuai"];

fn prune_catalog(value: &Value) -> Vec<CatalogModel> {
	let mut models: Vec<CatalogModel> = Vec::new();
	let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
	for provider in CATALOG_PROVIDERS {
		let Some(entries) = value[provider]["models"].as_object() else { continue };
		let short = provider.trim_end_matches("-cn");
		for (id, model) in entries {
			if !seen.insert(id.to_lowercase()) { continue }
			let cost = &model["cost"];
			let (Some(input), Some(output)) = (cost["input"].as_f64(), cost["output"].as_f64()) else { continue };
			let modalities = model["modalities"]["input"].as_array().map(|items| items.iter().filter_map(|item| item.as_str()).collect::<Vec<_>>()).unwrap_or_default();
			models.push(CatalogModel {
				provider: short.to_string(),
				model_id: id.clone(),
				name: model["name"].as_str().unwrap_or(id).to_string(),
				input_cost: input,
				output_cost: output,
				context_window: model["limit"]["context"].as_u64().unwrap_or(0),
				max_tokens: model["limit"]["output"].as_u64().unwrap_or(0),
				vision: modalities.iter().any(|item| *item == "image"),
				tools: model["tool_call"].as_bool().unwrap_or(false),
				reasoning: model["reasoning"].as_bool().unwrap_or(false),
				status: model["status"].as_str().map(str::to_string),
				updated: model["last_updated"].as_str().map(str::to_string),
			});
		}
	}
	models
}

fn catalog_cache_path(dir: &Path) -> std::path::PathBuf {
	dir.join("public-catalog.json")
}

fn read_catalog_cache(path: &Path) -> Option<CatalogCache> {
	let bytes = std::fs::read(path).ok()?;
	serde_json::from_slice(&bytes).ok()
}

fn now_unix() -> i64 {
	std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|duration| duration.as_secs() as i64).unwrap_or(0)
}

/// Official prices for the configured families, pruned from models.dev.
/// Fresh cache (24h) short-circuits the network; on failure an expired cache
/// is served so the import flow degrades instead of breaking.
pub(crate) async fn public_catalog(dir: &Path) -> Result<CatalogResponse, String> {
	let cache_path = catalog_cache_path(dir);
	if let Some(cache) = read_catalog_cache(&cache_path) {
		if now_unix() - cache.fetched_at < CATALOG_TTL_SECS {
			return Ok(CatalogResponse { stale: false, fetched_at: cache.fetched_at, models: cache.models });
		}
	}
	match fetch_catalog_json().await {
		Ok(value) => {
			let models = prune_catalog(&value);
			if models.is_empty() {
				return Err("公共目录未包含可用模型".into());
			}
			let fetched_at = now_unix();
			let cache = CatalogCache { fetched_at, models: models.clone() };
			if let Ok(bytes) = serde_json::to_vec(&cache) {
				let _ = std::fs::write(&cache_path, bytes);
			}
			Ok(CatalogResponse { stale: false, fetched_at, models })
		}
		Err(error) => {
			if let Some(cache) = read_catalog_cache(&cache_path) {
				return Ok(CatalogResponse { stale: true, fetched_at: cache.fetched_at, models: cache.models });
			}
			Err(error)
		}
	}
}

async fn fetch_catalog_json() -> Result<Value, String> {
	let mut response = send_with_direct_retry(|client| client.get(CATALOG_URL), Duration::from_secs(30), "公共目录").await?;
	let status = response.status();
	let mut bytes = Vec::new();
	while let Some(chunk) = response.chunk().await.map_err(|_| "读取公共目录失败，请重试")? {
		if bytes.len() + chunk.len() > 8 * 1024 * 1024 {
			return Err("公共目录响应过大，请稍后重试".into());
		}
		bytes.extend_from_slice(&chunk);
	}
	if !status.is_success() {
		return Err(format!("HTTP {} · 公共目录获取失败", status.as_u16()));
	}
	serde_json::from_slice(&bytes).map_err(|_| "公共目录不是有效 JSON".to_string())
}

/// Latest-model source pages: one official docs page per family, fetched with
/// a 6h disk cache so the frontend can parse fresh model IDs without hammering
/// the vendors. models.dev (`public_catalog`) remains the structured fallback.
pub(crate) const OFFICIAL_PAGES: [(&str, &str); 3] = [
	("glm", "https://docs.bigmodel.cn/cn/guide/start/model-overview"),
	("deepseek", "https://api-docs.deepseek.com/zh-cn/quick_start/pricing"),
	("kimi", "https://platform.moonshot.cn/docs/pricing/chat"),
];

const OFFICIAL_PAGE_TTL_SECS: i64 = 6 * 60 * 60;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OfficialPage {
	pub family_id: String,
	pub url: String,
	pub body: String,
	pub fetched_at: i64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OfficialPagesResponse {
	pub pages: Vec<OfficialPage>,
	/// True when at least one family fell back to an expired cache entry.
	pub stale: bool,
}

fn official_pages_cache_path(dir: &Path) -> std::path::PathBuf {
	dir.join("official-pages.json")
}

#[derive(serde::Serialize, serde::Deserialize)]
struct OfficialPagesCache {
	fetched_at: i64,
	pages: Vec<OfficialPage>,
}

/// Fetches every official page independently; a family whose page fails keeps
/// its expired cache entry (or drops out entirely), so one redesign never
/// blanks the whole catalog.
pub(crate) async fn official_pages(dir: &Path) -> Result<OfficialPagesResponse, String> {
	official_pages_with_urls(dir, OFFICIAL_PAGES.iter().map(|(family, url)| (*family, url.to_string())).collect()).await
}

async fn official_pages_with_urls(dir: &Path, targets: Vec<(&str, String)>) -> Result<OfficialPagesResponse, String> {
	let cache_path = official_pages_cache_path(dir);
	let cache = std::fs::read(&cache_path).ok()
		.and_then(|bytes| serde_json::from_slice::<OfficialPagesCache>(&bytes).ok());
	let now = now_unix();
	let mut pages: Vec<OfficialPage> = Vec::new();
	let mut stale = false;
	for (family_id, url) in targets {
		let cached = cache.as_ref().and_then(|cache| cache.pages.iter().find(|page| page.family_id == family_id));
		if let Some(cached) = cached {
			if now - cached.fetched_at < OFFICIAL_PAGE_TTL_SECS {
				pages.push(cached.clone());
				continue;
			}
		}
		match fetch_page_body(&url).await {
			Ok(body) => pages.push(OfficialPage { family_id: family_id.to_string(), url, body, fetched_at: now }),
			Err(_) => {
				if let Some(cached) = cached {
					stale = true;
					pages.push(cached.clone());
				}
			}
		}
	}
	if pages.is_empty() { return Err("官方模型页获取失败，请检查网络".into()); }
	let fetched_at = pages.iter().map(|page| page.fetched_at).min().unwrap_or(now);
	if let Ok(bytes) = serde_json::to_vec(&OfficialPagesCache { fetched_at, pages: pages.clone() }) {
		let _ = std::fs::write(&cache_path, bytes);
	}
	Ok(OfficialPagesResponse { pages, stale })
}

async fn fetch_page_body(url: &str) -> Result<String, String> {
	let mut response = send_with_direct_retry(|client| client.get(url), Duration::from_secs(15), "官方模型页").await?;
	let status = response.status();
	if !status.is_success() { return Err(format!("HTTP {}", status.as_u16())); }
	let mut bytes = Vec::new();
	while let Some(chunk) = response.chunk().await.map_err(|_| "读取官方模型页失败")? {
		if bytes.len() + chunk.len() > 2 * 1024 * 1024 { return Err("官方模型页响应过大".into()); }
		bytes.extend_from_slice(&chunk);
	}
	Ok(String::from_utf8_lossy(&bytes).into_owned())
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
		use std::io::Read;
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
		assert_eq!(models.iter().map(|model| model.id.as_str()).collect::<Vec<_>>(), ["a-model", "z-model"]); server.join().unwrap();
	}
	#[test]
	fn fetched_page_serializes_camel_case_for_the_frontend_contract() {
		let page = FetchedPage { url: "https://example.com/models".into(), content_type: "application/json".into(), body: "{}".into() };
		let value = serde_json::to_value(&page).unwrap();
		assert!(value.get("contentType").is_some());
		assert!(value.get("url").is_some() && value.get("body").is_some());
		assert!(value.get("content_type").is_none());
	}
	#[test]
	fn prunes_catalog_to_family_providers_with_dedupe_and_flags() {
		let value = serde_json::json!({
			"deepseek": { "models": {
				"deepseek-flash": { "name": "DeepSeek Flash", "cost": { "input": 0.15, "output": 0.6, "cache_read": 0.003 }, "limit": { "context": 1000000, "output": 8192 }, "modalities": { "input": ["text"] }, "tool_call": true, "last_updated": "2026-09-10" },
				"no-price": { "name": "Skipped" }
			}},
			"moonshotai-cn": { "models": {
				"kimi-k2.6": { "cost": { "input": 0.95, "output": 4 }, "limit": { "context": 256000 }, "modalities": { "input": ["text", "image"] }, "reasoning": true }
			}},
			"moonshotai": { "models": {
				"kimi-k2.6": { "cost": { "input": 999, "output": 999 } }
			}},
			"zhipuai": { "models": {
				"glm-old": { "cost": { "input": 1, "output": 2 }, "status": "deprecated" }
			}},
			"openai": { "models": { "gpt-x": { "cost": { "input": 1, "output": 1 } } }}
		});
		let models = prune_catalog(&value);
		assert_eq!(models.len(), 3);
		let flash = models.iter().find(|model| model.model_id == "deepseek-flash").unwrap();
		assert_eq!(flash.provider, "deepseek");
		assert_eq!(flash.input_cost, 0.15);
		assert_eq!(flash.context_window, 1_000_000);
		assert!(flash.tools && !flash.vision && !flash.reasoning);
		let kimi = models.iter().find(|model| model.model_id == "kimi-k2.6").unwrap();
		assert_eq!(kimi.provider, "moonshotai");
		assert_eq!(kimi.input_cost, 0.95);
		assert!(kimi.vision && kimi.reasoning);
		assert!(models.iter().any(|model| model.model_id == "glm-old" && model.status.as_deref() == Some("deprecated")));
		assert!(!models.iter().any(|model| model.model_id == "gpt-x" || model.model_id == "no-price"));
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

	/// One-shot HTTP server answering every connection with `status`/`body`.
	fn page_server(status: u16, body: &'static str) -> std::net::SocketAddr {
		let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
		let address = listener.local_addr().unwrap();
		std::thread::spawn(move || {
			for _ in 0..3 {
				let Ok((mut stream, _)) = listener.accept() else { break };
				let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
				let mut request = [0; 4096];
				let _ = std::io::Read::read(&mut stream, &mut request);
				let response = format!("HTTP/1.1 {status} T\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
				let _ = std::io::Write::write_all(&mut stream, response.as_bytes());
			}
		});
		address
	}

	// The real OFFICIAL_PAGES hosts cannot be reached from unit tests; the
	// test drives the shared loop with loopback URLs instead.
	async fn official_pages_with_hosts(dir: &Path, hosts: [&str; 3]) -> Result<OfficialPagesResponse, String> {
		let targets = OFFICIAL_PAGES.iter().zip(hosts).map(|((family, _), host)| (*family, format!("http://{host}/page"))).collect();
		official_pages_with_urls(dir, targets).await
	}

	#[test]
	fn official_pages_cache_within_ttl_and_falls_back_to_stale() {
		let dir = std::env::temp_dir().join(format!("skiff-official-{}-{}", std::process::id(), now_unix()));
		std::fs::create_dir_all(&dir).unwrap();
		let good = page_server(200, "<html>glm-5.4</html>");
		let bad = page_server(500, "");
		let hosts: [String; 3] = [good.to_string(), bad.to_string(), bad.to_string()];
		let host_refs: [&str; 3] = [hosts[0].as_str(), hosts[1].as_str(), hosts[2].as_str()];
		let first = tauri::async_runtime::block_on(official_pages_with_hosts(&dir, host_refs)).unwrap();
		assert_eq!(first.pages.len(), 1);
		assert!(!first.stale);
		assert_eq!(first.pages[0].family_id, "glm");

		// Within TTL no network happens; the cache answer covers every family.
		let mut cached_pages = first.pages.clone();
		cached_pages.push(OfficialPage { family_id: "deepseek".into(), url: "https://example/deepseek".into(), body: "cached".into(), fetched_at: first.pages[0].fetched_at });
		serde_json::to_writer(std::fs::File::create(official_pages_cache_path(&dir)).unwrap(), &OfficialPagesCache { fetched_at: first.pages[0].fetched_at, pages: cached_pages.clone() }).unwrap();
		let second = tauri::async_runtime::block_on(official_pages_with_hosts(&dir, host_refs)).unwrap();
		assert_eq!(second.pages.len(), 2);
		assert!(!second.stale);

		// Past TTL the failing families keep their expired entries and flag stale.
		let expired: Vec<OfficialPage> = cached_pages.iter().map(|page| OfficialPage { fetched_at: page.fetched_at - OFFICIAL_PAGE_TTL_SECS - 1, ..page.clone() }).collect();
		serde_json::to_writer(std::fs::File::create(official_pages_cache_path(&dir)).unwrap(), &OfficialPagesCache { fetched_at: now_unix(), pages: expired }).unwrap();
		let third = tauri::async_runtime::block_on(official_pages_with_hosts(&dir, host_refs)).unwrap();
		assert!(third.stale);
		assert_eq!(third.pages.len(), 2);
		assert_eq!(third.pages.iter().find(|page| page.family_id == "deepseek").unwrap().body, "cached");
		std::fs::remove_dir_all(dir).unwrap();
	}
}
