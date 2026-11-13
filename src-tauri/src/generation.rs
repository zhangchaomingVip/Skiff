//! Image generation is independent of pi. Credentials never leave Rust on reads;
//! jobs and originals survive WebView reloads and application restarts.
use std::{collections::HashMap, path::{Path, PathBuf}, sync::{Arc, Mutex}, time::{Duration, SystemTime, UNIX_EPOCH}};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};
use tokio::sync::watch;

const MAX_IMAGE: usize = 32 * 1024 * 1024;
const MAX_RESPONSE: usize = 48 * 1024 * 1024;
const MAX_REFERENCE: usize = 20 * 1024 * 1024;

#[derive(Default)]
pub struct GenerationState {
	// Lock order: gate, then active. No lock is held across an await.
	gate: Mutex<()>,
	active: Arc<Mutex<HashMap<String, watch::Sender<bool>>>>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageModel { pub id: String, pub sizes: Vec<String> }

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Service {
	id: String, name: String, base_url: String, api_key: String,
	models: Vec<ImageModel>, default_model: String,
}

fn default_concurrency_limit() -> usize { 5 }

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Config {
	services: Vec<Service>, default_service_id: String,
	#[serde(default = "default_concurrency_limit")]
	concurrency_limit: usize,
}

impl Default for Config {
	fn default() -> Self { Self { services: vec![], default_service_id: String::new(), concurrency_limit: default_concurrency_limit() } }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceView {
	id: String, name: String, base_url: String, configured: bool, key_hint: String,
	models: Vec<ImageModel>, default_model: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigView { services: Vec<ServiceView>, default_service_id: String, concurrency_limit: usize }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceInput {
	id: Option<String>, name: String, base_url: String, api_key: Option<String>,
	models: Vec<ImageModel>, default_model: String, make_default: bool,
}

impl Config {
	fn view(&self) -> ConfigView {
		ConfigView { concurrency_limit: self.concurrency_limit, default_service_id: self.default_service_id.clone(), services: self.services.iter().map(|service| ServiceView {
			id: service.id.clone(), name: service.name.clone(), base_url: service.base_url.clone(), models: service.models.clone(), default_model: service.default_model.clone(),
			configured: !service.api_key.is_empty(),
			key_hint: super::crypto::open(&service.api_key).map(|key| format!("…{}", key.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect::<String>())).unwrap_or_else(|_| "密钥需重新填写".into()),
		}).collect() }
	}
}

pub fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
	// Full-chain tests supply a private directory; never write developer config.
	if let Some(path) = std::env::var_os("SKIFF_GENERATION_DIR") { return Ok(PathBuf::from(path)); }
	app.path().app_data_dir().map(|dir| dir.join("generation")).map_err(|_| "无法定位图片生成目录".into())
}

pub fn setup(app: &AppHandle) -> Result<(), String> {
	let assets = data_dir(app)?.join("assets");
	std::fs::create_dir_all(&assets).map_err(|_| "无法创建图片目录")?;
	// Only originals are exposed through asset://, never keys or job metadata.
	app.asset_protocol_scope().allow_directory(assets, false).map_err(|_| "无法授权图片预览".into())
}

fn read_config(dir: &Path) -> Result<Config, String> {
	let path = dir.join("config.json");
	if !path.exists() { return Ok(Config::default()); }
	serde_json::from_slice(&std::fs::read(path).map_err(|_| "无法读取图片生成配置")?).map_err(|_| "图片生成配置损坏，请恢复配置文件".into())
}

fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
	std::fs::create_dir_all(path.parent().ok_or("保存路径无效")?).map_err(|_| "无法创建图片生成目录")?;
	super::providers::atomic_write(path, &serde_json::to_value(value).map_err(|_| "无法编码图片生成数据")?).map_err(|_| "无法保存图片生成数据，请检查目录权限和磁盘空间".into())
}

fn valid_id(id: &str) -> Result<(), String> { uuid::Uuid::parse_str(id).map(|_| ()).map_err(|_| "作品 ID 无效".into()) }

fn base_url(raw: &str) -> Result<String, String> {
	let url = reqwest::Url::parse(raw.trim()).map_err(|_| "请输入有效的 API 地址")?;
	if !["https", "http"].contains(&url.scheme()) || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
		return Err("API 地址须为 HTTP(S) 地址，不包含凭据、查询参数或片段".into());
	}
	Ok(url.as_str().trim_end_matches('/').into())
}

fn dimensions(size: &str) -> Option<(u32, u32)> {
	let (width, height) = size.split_once('x')?;
	let (width, height): (u32, u32) = (width.parse().ok()?, height.parse().ok()?);
	(width >= 256 && height >= 256 && width <= 4096 && height <= 4096 && width % 16 == 0 && height % 16 == 0 && width <= height * 3 && height <= width * 3).then_some((width, height))
}

fn save_service(dir: &Path, input: ServiceInput) -> Result<ConfigView, String> {
	let mut config = read_config(dir)?;
	let existing = input.id.as_ref().and_then(|id| config.services.iter().find(|service| &service.id == id));
	if input.id.is_some() && existing.is_none() { return Err("生成服务已被删除，请重新读取".into()); }
	let name = input.name.trim().to_string();
	if name.is_empty() || name.chars().count() > 64 { return Err("服务名称须为 1–64 个字符".into()); }
	let base_url = base_url(&input.base_url)?;
	let mut ids = std::collections::HashSet::new();
	if input.models.is_empty() || input.models.len() > 32 { return Err("请配置 1–32 个图片模型".into()); }
	for model in &input.models {
		if model.id.trim().is_empty() || model.id != model.id.trim() || model.id.len() > 200 || model.id.chars().any(char::is_control) || !ids.insert(&model.id) { return Err("模型 ID 不能为空、包含控制字符或重复".into()); }
		if model.sizes.is_empty() || model.sizes.len() > 32 || model.sizes.iter().any(|size| dimensions(size).is_none()) { return Err("每个模型请填写 1–32 个有效尺寸，例如 1024x1024；边长须为 256–4096 的 16 倍数，宽高比在 1:3 到 3:1 之间".into()); }
	}
	if !ids.contains(&input.default_model) { return Err("默认模型必须在模型列表中".into()); }
	let key = input.api_key.as_deref().unwrap_or("").trim();
	if key.len() > 4096 || key.chars().any(char::is_control) { return Err("API Key 格式无效".into()); }
	let api_key = if key.is_empty() { existing.map(|service| service.api_key.clone()).unwrap_or_default() } else { super::crypto::seal(key)?.ok_or("API Key 不能为空")? };
	if api_key.is_empty() { return Err("请填写图片生成服务的 API Key".into()); }
	let id = input.id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
	let service = Service { id: id.clone(), name, base_url, api_key, models: input.models, default_model: input.default_model };
	if let Some(index) = config.services.iter().position(|item| item.id == id) { config.services[index] = service; } else { config.services.push(service); }
	if input.make_default || config.default_service_id.is_empty() { config.default_service_id = id; }
	write_json(&dir.join("config.json"), &config)?;
	Ok(config.view())
}

#[tauri::command]
pub fn get_image_generation_config(app: AppHandle, state: State<'_, GenerationState>) -> Result<ConfigView, String> {
	let _gate = state.gate.lock().map_err(|_| "图片配置正在使用")?;
	Ok(read_config(&data_dir(&app)?)?.view())
}

#[tauri::command]
pub fn save_image_generation_service(app: AppHandle, state: State<'_, GenerationState>, input: ServiceInput) -> Result<ConfigView, String> {
	let _gate = state.gate.lock().map_err(|_| "图片配置正在使用")?;
	save_service(&data_dir(&app)?, input)
}

#[tauri::command]
pub fn delete_image_generation_service(app: AppHandle, state: State<'_, GenerationState>, id: String) -> Result<ConfigView, String> {
	let _gate = state.gate.lock().map_err(|_| "图片配置正在使用")?;
	let dir = data_dir(&app)?;
	let mut config = read_config(&dir)?;
	config.services.retain(|service| service.id != id);
	if config.default_service_id == id { config.default_service_id = config.services.first().map(|s| s.id.clone()).unwrap_or_default(); }
	write_json(&dir.join("config.json"), &config)?;
	Ok(config.view())
}

fn save_concurrency_limit(dir: &Path, limit: usize) -> Result<ConfigView, String> {
	if ![0, 3, 5, 10].contains(&limit) { return Err("图片并发数须为 3、5、10 或不限".into()); }
	let mut config = read_config(dir)?;
	config.concurrency_limit = limit;
	write_json(&dir.join("config.json"), &config)?;
	Ok(config.view())
}

#[tauri::command]
pub fn set_image_generation_concurrency(app: AppHandle, state: State<'_, GenerationState>, limit: usize) -> Result<ConfigView, String> {
	let _gate = state.gate.lock().map_err(|_| "图片配置正在使用")?;
	save_concurrency_limit(&data_dir(&app)?, limit)
}

fn check_capacity(limit: usize, active_count: usize) -> Result<(), String> {
	if limit > 0 && active_count >= limit { return Err(format!("已有 {active_count} 个图片任务进行中，已达到并发上限 {limit}；请等待完成或在图片生成设置中调整")); }
	Ok(())
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageJob {
	id: String, status: String, prompt: String, service_id: String, service_name: String,
	model_id: String, size: String, quality: String, created_at: u64,
	#[serde(default)] message: Option<String>,
	#[serde(default)] path: Option<String>,
	#[serde(default)] usage: Option<Value>,
	#[serde(default)] revised_prompt: Option<String>,
	#[serde(default)] actual_size: Option<String>,
	#[serde(default)] reference: Option<ImageReference>,
	#[serde(default)] removed: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageReference { name: String, mime: String, width: u32, height: u32 }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceInput { name: String, data_url: String }

fn reference_extension(mime: &str) -> Result<&'static str, String> {
	match mime { "image/png" => Ok("png"), "image/jpeg" => Ok("jpg"), "image/webp" => Ok("webp"), _ => Err("参考图仅支持 PNG、JPEG 或 WebP".into()) }
}

fn validate_reference(input: ReferenceInput) -> Result<(ImageReference, Vec<u8>), String> {
	let (prefix, encoded) = input.data_url.split_once(",").ok_or("参考图编码无效")?;
	let mime = prefix.strip_prefix("data:").and_then(|s| s.strip_suffix(";base64")).ok_or("参考图须为本机图片数据")?;
	reference_extension(mime)?;
	if encoded.len() > MAX_REFERENCE * 4 / 3 + 4 { return Err("参考图超过 20 MB，请使用较小图片".into()); }
	let bytes = STANDARD.decode(encoded).map_err(|_| "参考图编码无效")?;
	if bytes.is_empty() || bytes.len() > MAX_REFERENCE { return Err("参考图为空或超过 20 MB".into()); }
	let format = image::guess_format(&bytes).map_err(|_| "无法识别参考图格式")?;
	if format.to_mime_type() != mime { return Err("参考图格式与文件内容不符".into()); }
	let (width, height) = image::ImageReader::with_format(std::io::Cursor::new(&bytes), format).into_dimensions().map_err(|_| "参考图尺寸无效")?;
	if width == 0 || height == 0 || width > 8192 || height > 8192 || width as u64 * height as u64 > 16 * 1024 * 1024 { return Err("参考图须不超过 1600 万像素，单边不超过 8192 像素".into()); }
	let mut reader = image::ImageReader::with_format(std::io::Cursor::new(&bytes), format);
	let mut limits = image::Limits::default(); limits.max_alloc = Some(128 * 1024 * 1024); limits.max_image_width = Some(8192); limits.max_image_height = Some(8192); reader.limits(limits);
	reader.decode().map_err(|_| "参考图无法解码，请重新选择有效图片")?;
	let name: String = input.name.rsplit(['/', '\\']).next().unwrap_or("参考图").chars().filter(|c| !c.is_control()).take(200).collect();
	Ok((ImageReference { name: if name.is_empty() { "参考图".into() } else { name }, mime: mime.into(), width, height }, bytes))
}

fn reference_path(dir: &Path, job: &ImageJob) -> Result<PathBuf, String> {
	valid_id(&job.id)?;
	let reference = job.reference.as_ref().ok_or("任务没有参考图")?;
	Ok(dir.join("image-inputs").join(format!("{}.{}", job.id, reference_extension(&reference.mime)?)))
}

fn save_reference(dir: &Path, job: &ImageJob, bytes: &[u8]) -> Result<(), String> {
	let path = reference_path(dir, job)?;
	std::fs::create_dir_all(path.parent().unwrap()).map_err(|_| "无法创建参考图目录")?;
	let temporary = path.with_extension("tmp");
	std::fs::write(&temporary, bytes).map_err(|_| "无法保存参考图快照")?;
	std::fs::rename(&temporary, path).map_err(|_| "无法完成参考图保存")?;
	Ok(())
}

impl ImageJob {
	fn pending(&self) -> bool { matches!(self.status.as_str(), "generating" | "saving") }
	fn save(&self, dir: &Path) -> Result<(), String> { write_json(&dir.join("jobs").join(format!("{}.json", self.id)), self) }
}

fn read_job(dir: &Path, id: &str) -> Result<ImageJob, String> {
	valid_id(id)?;
	serde_json::from_slice(&std::fs::read(dir.join("jobs").join(format!("{id}.json"))).map_err(|_| "无法读取作品记录")?).map_err(|_| "作品记录损坏".into())
}

fn list_jobs(dir: &Path, active: &HashMap<String, watch::Sender<bool>>) -> Result<Vec<ImageJob>, String> {
	let jobs = dir.join("jobs");
	if !jobs.exists() { return Ok(Vec::new()); }
	let mut result = Vec::new();
	for entry in std::fs::read_dir(jobs).map_err(|_| "无法读取作品目录")? {
		let entry = entry.map_err(|_| "无法读取作品记录")?;
		let path = entry.path();
		if path.extension().and_then(|s| s.to_str()) != Some("json") { continue; }
		let Some(id) = path.file_stem().and_then(|s| s.to_str()) else { continue };
		let mut job = read_job(dir, id)?;
		if job.pending() && !active.contains_key(&job.id) {
			job.status = "interrupted".into();
			job.message = Some("应用在生成过程中退出，服务端可能仍在处理；请确认后再重新生成。".into());
			job.save(dir)?;
		}
		result.push(job);
	}
	result.sort_by(|a, b| b.created_at.cmp(&a.created_at));
	Ok(result)
}

#[tauri::command]
pub fn list_image_generation_jobs(app: AppHandle, state: State<'_, GenerationState>) -> Result<Vec<ImageJob>, String> {
	let _gate = state.gate.lock().map_err(|_| "作品目录正在使用")?;
	let active = state.active.lock().map_err(|_| "生成状态不可用")?;
	list_jobs(&data_dir(&app)?, &active)
}

fn set_asset_removed(dir: &Path, id: &str, removed: bool) -> Result<ImageJob, String> {
	let mut job = read_job(dir, id)?;
	if job.status != "completed" { return Err("只能移除或恢复已完成的图片作品".into()); }
	job.removed = removed;
	job.save(dir)?;
	Ok(job)
}

#[tauri::command]
pub fn set_image_generation_asset_removed(app: AppHandle, state: State<'_, GenerationState>, id: String, removed: bool) -> Result<ImageJob, String> {
	let _gate = state.gate.lock().map_err(|_| "作品目录正在使用")?;
	set_asset_removed(&data_dir(&app)?, &id, removed)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateInput { id: String, service_id: String, model_id: String, prompt: String, size: String, quality: String, reference: Option<ReferenceInput> }

#[tauri::command]
pub async fn start_image_generation(app: AppHandle, input: GenerateInput) -> Result<ImageJob, String> {
	// Decoding a reference and writing its snapshot must not block the UI thread.
	tauri::async_runtime::spawn_blocking(move || start_image_generation_inner(app, input)).await.map_err(|_| "无法提交图片任务".to_string())?
}

fn start_image_generation_inner(app: AppHandle, input: GenerateInput) -> Result<ImageJob, String> {
	let state = app.state::<GenerationState>();
	let _gate = state.gate.lock().map_err(|_| "生成服务正在使用")?;
	let dir = data_dir(&app)?;
	valid_id(&input.id)?;
	// The client request ID makes retries of the IPC submission idempotent.
	if dir.join("jobs").join(format!("{}.json", input.id)).exists() { return read_job(&dir, &input.id); }
	let mut active = state.active.lock().map_err(|_| "生成状态不可用")?;
	let config = read_config(&dir)?;
	check_capacity(config.concurrency_limit, active.len())?;
	let service = config.services.iter().find(|service| service.id == input.service_id).ok_or("请先配置图片生成服务")?.clone();
	let model = service.models.iter().find(|model| model.id == input.model_id).ok_or("请选择有效的图片模型")?;
	if !model.sizes.contains(&input.size) { return Err("所选模型未配置此尺寸".into()); }
	if !["auto", "low", "medium", "high"].contains(&input.quality.as_str()) { return Err("图片质量无效".into()); }
	let prompt = input.prompt.trim().to_string();
	if prompt.is_empty() || prompt.chars().count() > 32000 { return Err("提示词须为 1–32000 个字符".into()); }
	let key = super::crypto::open(&service.api_key).map_err(|_| "无法解密生图 Key，请在设置中重新填写")?;
	let reference = input.reference.map(validate_reference).transpose()?;
	let job = ImageJob { id: input.id, status: "generating".into(), prompt, service_id: service.id.clone(), service_name: service.name.clone(), model_id: input.model_id, size: input.size, quality: input.quality, created_at: SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64, message: None, path: None, usage: None, revised_prompt: None, actual_size: None, reference: reference.as_ref().map(|(info, _)| info.clone()), removed: false };
	if let Some((_, bytes)) = reference { save_reference(&dir, &job, &bytes)?; }
	job.save(&dir)?;
	let (sender, mut cancel) = watch::channel(false);
	active.insert(job.id.clone(), sender);
	let active_jobs = state.active.clone();
	let mut task = job.clone();
	tauri::async_runtime::spawn(async move {
		let result = tokio::select! {
			biased;
			_ = cancel.changed() => Err("已停止等待；服务端可能仍在生成并计费。".to_string()),
			result = generate(&dir, &service, &key, &mut task) => result,
		};
		if let Err(error) = result {
			task.status = if *cancel.borrow() { "cancelled" } else { "failed" }.into();
			task.message = Some(error);
		}
		// Hold the active map through the final write so a poll cannot mark this
		// job interrupted or release its capacity before final persistence finishes.
		if let Ok(mut active) = active_jobs.lock() {
			if task.save(&dir).is_err() {
				// Keep the previous durable pending record: next read reports interruption.
				eprintln!("[skiff] failed to persist image task completion");
			}
			active.remove(&task.id);
		}
	});
	Ok(job)
}

#[tauri::command]
pub fn cancel_image_generation(state: State<'_, GenerationState>, id: String) -> Result<(), String> {
	let active = state.active.lock().map_err(|_| "生成状态不可用")?;
	if let Some(sender) = active.get(&id) { let _ = sender.send(true); }
	Ok(())
}

fn client() -> Result<reqwest::Client, String> {
	reqwest::Client::builder().connect_timeout(Duration::from_secs(20)).timeout(Duration::from_secs(600)).redirect(reqwest::redirect::Policy::none()).retry(reqwest::retry::never()).build().map_err(|_| "无法创建图片请求")
		.map_err(str::to_string)
}

async fn bounded_body(mut response: reqwest::Response, max: usize) -> Result<Vec<u8>, String> {
	if response.content_length().is_some_and(|size| size > max as u64) { return Err("图片响应过大".into()); }
	let mut result = Vec::new();
	while let Some(chunk) = response.chunk().await.map_err(|_| "读取图片响应失败，请确认服务状态后再试")? {
		if result.len() + chunk.len() > max { return Err("图片响应过大".into()); }
		result.extend_from_slice(&chunk);
	}
	Ok(result)
}

fn network_error(error: reqwest::Error) -> String {
	if error.is_timeout() { "生成等待超时；服务端可能仍在生成并计费，请确认后再试。".into() }
	else { "无法连接图片服务或连接中断，请检查地址与网络；未自动重试。".into() }
}

fn response_error(status: u16, body: &[u8], key: &str) -> String {
	let detail = serde_json::from_slice::<Value>(body).ok().and_then(|value| value.pointer("/error/message").and_then(Value::as_str).map(str::to_string)).unwrap_or_default();
	let detail: String = detail.replace(key, "[已隐藏]").chars().filter(|c| !c.is_control()).take(400).collect();
	let reason = match status { 401 | 403 => "密钥无效、无权限或模型尚未开通", 429 => "额度不足或请求过于频繁", 400 | 404 => "请检查模型、尺寸与接口地址", _ => "图片服务请求失败；未自动重试" };
	format!("{reason}（HTTP {status}）{}", if detail.is_empty() { String::new() } else { format!("：{detail}") })
}

async fn generate(dir: &Path, service: &Service, key: &str, job: &mut ImageJob) -> Result<(), String> {
	let client = client()?;
	generate_with_client(dir, service, key, job, &client).await
}

async fn generate_with_client(dir: &Path, service: &Service, key: &str, job: &mut ImageJob, client: &reqwest::Client) -> Result<(), String> {
	let request = if let Some(reference) = &job.reference {
		let path = reference_path(dir, job)?;
		if std::fs::metadata(&path).map_err(|_| "参考图快照丢失，未提交生成")?.len() > MAX_REFERENCE as u64 { return Err("参考图快照超过 20 MB，未提交生成".into()); }
		let bytes = std::fs::read(&path).map_err(|_| "无法读取参考图快照，未提交生成")?;
		let part = reqwest::multipart::Part::bytes(bytes).file_name(format!("reference.{}", reference_extension(&reference.mime)?)).mime_str(&reference.mime).map_err(|_| "参考图类型无效")?;
		let form = reqwest::multipart::Form::new().text("model", job.model_id.clone()).text("prompt", job.prompt.clone()).text("size", job.size.clone()).text("quality", job.quality.clone()).text("n", "1").text("output_format", "png").part("image", part);
		client.post(format!("{}/images/edits", service.base_url)).bearer_auth(key).multipart(form)
	} else {
		client.post(format!("{}/images/generations", service.base_url)).bearer_auth(key).json(&json!({
			"model": job.model_id, "prompt": job.prompt, "size": job.size, "quality": job.quality, "n": 1, "output_format": "png"
		}))
	};
	let response = request.send().await.map_err(network_error)?;
	let status = response.status();
	let body = bounded_body(response, if status.is_success() { MAX_RESPONSE } else { 64 * 1024 }).await?;
	if !status.is_success() {
		let error = response_error(status.as_u16(), &body, key);
		return Err(if job.reference.is_some() { format!("图生图失败：{error}；请确认服务和模型支持图片编辑接口，未自动改为文生图。") } else { error });
	}
	let payload: Value = serde_json::from_slice(&body).map_err(|_| "图片服务没有返回有效的 JSON 数据，请检查 API 地址")?;
	if payload.get("error").is_some() { return Err(response_error(200, &body, key)); }
	let image = payload.pointer("/data/0").ok_or("图片服务未返回图片")?;
	job.status = "saving".into();
	job.save(dir)?;
	let bytes = if let Some(encoded) = image.get("b64_json").and_then(Value::as_str) {
		if encoded.len() > MAX_RESPONSE { return Err("图片数据过大".into()); }
		STANDARD.decode(encoded).map_err(|_| "图片编码无效")?
	} else if let Some(url) = image.get("url").and_then(Value::as_str) {
		let parsed = reqwest::Url::parse(url).map_err(|_| "图片下载地址无效")?;
		if !["https", "http"].contains(&parsed.scheme()) || !parsed.username().is_empty() || parsed.password().is_some() { return Err("图片下载地址无效".into()); }
		// A returned CDN URL must never receive the provider's Authorization header.
		let response = client.get(parsed).send().await.map_err(network_error)?;
		if !response.status().is_success() { return Err("生成已返回，但图片下载失败；未重新发起生成。".into()); }
		bounded_body(response, MAX_IMAGE).await?
	} else { return Err("图片响应缺少 b64_json 或下载地址".into()); };
	if bytes.len() > MAX_IMAGE { return Err("图片文件超过 32 MB".into()); }
	// The first release requests PNG explicitly. Validate its header and dimensions
	// before exposing any returned bytes as a local image.
	if bytes.len() < 33 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") || &bytes[12..16] != b"IHDR" { return Err("服务返回的文件不是有效的 PNG 图片".into()); }
	let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
	let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
	if width == 0 || height == 0 || width as u64 * height as u64 > 64 * 1024 * 1024 { return Err("返回的图片尺寸无效或过大".into()); }
	let path = dir.join("assets").join(format!("{}.png", job.id));
	std::fs::create_dir_all(path.parent().unwrap()).map_err(|_| "无法创建作品目录")?;
	let temporary = path.with_extension("png.tmp");
	std::fs::write(&temporary, bytes).map_err(|_| "无法保存生成图片")?;
	std::fs::rename(&temporary, &path).map_err(|_| "无法完成图片保存")?;
	job.path = Some(path.to_string_lossy().into());
	job.actual_size = Some(format!("{width}x{height}"));
	job.usage = payload.get("usage").cloned();
	job.revised_prompt = image.get("revised_prompt").and_then(Value::as_str).map(str::to_string);
	job.status = "completed".into();
	Ok(())
}

fn asset_path(dir: &Path, id: &str) -> Result<PathBuf, String> {
	let job = read_job(dir, id)?;
	if job.status != "completed" { return Err("图片尚未保存完成".into()); }
	let path = dir.join("assets").join(format!("{id}.png"));
	if !path.is_file() { return Err("图片文件不存在".into()); }
	Ok(path)
}

#[tauri::command]
pub fn reveal_image_generation_asset(app: AppHandle, id: String) -> Result<(), String> {
	let path = asset_path(&data_dir(&app)?, &id)?;
	#[cfg(windows)] {
		use std::os::windows::process::CommandExt;
		std::process::Command::new("explorer.exe").arg(format!("/select,{}", path.display())).creation_flags(0x08000000).spawn().map_err(|_| "无法打开图片所在目录")?;
	}
	#[cfg(not(windows))] { open::that(path.parent().unwrap()).map_err(|_| "无法打开图片所在目录")?; }
	Ok(())
}

#[tauri::command]
pub async fn export_image_generation_asset(app: AppHandle, id: String) -> Result<bool, String> {
	use tauri_plugin_dialog::DialogExt;
	let path = asset_path(&data_dir(&app)?, &id)?;
	let (sender, receiver) = tokio::sync::oneshot::channel();
	app.dialog().file().add_filter("PNG 图片", &["png"]).set_file_name(format!("skiff-{id}.png")).save_file(move |target| { let _ = sender.send(target); });
	let Some(target) = receiver.await.map_err(|_| "保存窗口已关闭")? else { return Ok(false); };
	let target = target.into_path().map_err(|_| "请选择本地保存位置")?;
	if target == path { return Ok(true); }
	std::fs::copy(path, target).map_err(|_| "无法另存图片")?;
	Ok(true)
}

#[cfg(test)]
mod tests;
