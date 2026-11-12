//! Durable remote video tasks. Only POST creates work; recovery uses GET only.
use std::{collections::HashMap, io::Write, path::{Path, PathBuf}, sync::{Arc, Mutex}, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, State};
use tokio::sync::watch;

mod media;
#[cfg(test)] mod tests;

const MAX_VIDEO: u64 = 256 * 1024 * 1024;
const MAX_REFERENCE: usize = 2 * 1024 * 1024;
type Active = Arc<Mutex<HashMap<String, watch::Sender<bool>>>>;
#[derive(Default)]
pub struct VideoState { active: Active }

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoModel { id: String, durations: Vec<u32>, ratios: Vec<String>, #[serde(default)] reference_enabled: bool }

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Service { id: String, name: String, base_url: String, api_key: String, models: Vec<VideoModel>, default_model: String }
#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Config { services: Vec<Service>, default_service_id: String }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceView { id: String, name: String, base_url: String, configured: bool, key_hint: String, models: Vec<VideoModel>, default_model: String }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigView { services: Vec<ServiceView>, default_service_id: String }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceInput { id: Option<String>, name: String, base_url: String, api_key: Option<String>, models: Vec<VideoModel>, default_model: String, make_default: bool }

fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
	std::fs::create_dir_all(path.parent().ok_or("保存路径无效")?).map_err(|_| "无法创建视频目录")?;
	super::providers::atomic_write(path, &serde_json::to_value(value).map_err(|_| "无法编码视频数据")?).map_err(|_| "无法保存视频数据，请检查磁盘空间和权限".into())
}
fn read_config(dir: &Path) -> Result<Config, String> {
	let path = dir.join("video-config.json");
	if !path.exists() { return Ok(Config::default()); }
	serde_json::from_slice(&std::fs::read(path).map_err(|_| "无法读取视频配置")?).map_err(|_| "视频配置损坏，请恢复配置文件".into())
}
impl Config {
	fn view(&self) -> ConfigView {
		ConfigView { default_service_id: self.default_service_id.clone(), services: self.services.iter().map(|s| {
			let key = super::crypto::open(&s.api_key).ok().filter(|v| !v.is_empty());
			ServiceView { id: s.id.clone(), name: s.name.clone(), base_url: s.base_url.clone(), configured: key.is_some(), key_hint: key.map(|v| format!("…{}", v.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect::<String>())).unwrap_or_else(|| "请重新填写".into()), models: s.models.clone(), default_model: s.default_model.clone() }
		}).collect() }
	}
}
fn valid_id(id: &str) -> Result<(), String> { uuid::Uuid::parse_str(id).map(|_| ()).map_err(|_| "视频任务 ID 无效".into()) }
fn base_url(raw: &str) -> Result<String, String> {
	let url = reqwest::Url::parse(raw.trim()).map_err(|_| "请输入有效的 API 地址")?;
	if !["https", "http"].contains(&url.scheme()) || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() { return Err("API 地址须为 HTTP(S)，不包含凭据、查询参数或片段".into()); }
	let value = url.as_str().trim_end_matches('/');
	if value.ends_with("/videos") { return Err("请填写 API 根地址，不包含 /videos".into()); }
	Ok(if value.ends_with("/v1") { value.into() } else { format!("{value}/v1") })
}
fn save_service(dir: &Path, input: ServiceInput) -> Result<ConfigView, String> {
	let mut config = read_config(dir)?;
	let old = input.id.as_ref().and_then(|id| config.services.iter().find(|s| &s.id == id));
	if input.id.is_some() && old.is_none() { return Err("服务已删除，请重新读取".into()); }
	let name = input.name.trim().to_string();
	if name.is_empty() || name.chars().count() > 64 { return Err("服务名称须为 1–64 个字符".into()); }
	let url = base_url(&input.base_url)?;
	let mut ids = std::collections::HashSet::new();
	if input.models.is_empty() || input.models.len() > 32 { return Err("请配置 1–32 个视频模型".into()); }
	for model in &input.models {
		if model.id.is_empty() || model.id != model.id.trim() || model.id.len() > 200 || model.id.chars().any(char::is_control) || !ids.insert(&model.id) { return Err("模型 ID 无效或重复".into()); }
		// Only combinations covered by the first Muse integration are exposed.
		if model.durations != [5] || model.ratios != ["9:16"] { return Err("首版仅开放已验证的 5 秒、9:16 组合".into()); }
	}
	if !ids.contains(&input.default_model) { return Err("默认模型须在模型列表中".into()); }
	let key = input.api_key.as_deref().unwrap_or("").trim();
	if key.len() > 4096 || key.chars().any(char::is_control) { return Err("API Key 格式无效".into()); }
	let api_key = if key.is_empty() { old.map(|s| s.api_key.clone()).unwrap_or_default() } else { super::crypto::seal(key)?.ok_or("请填写 Key")? };
	if api_key.is_empty() { return Err("请填写视频服务的 API Key".into()); }
	let id = input.id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
	let service = Service { id: id.clone(), name, base_url: url, api_key, models: input.models, default_model: input.default_model };
	if let Some(index) = config.services.iter().position(|s| s.id == id) { config.services[index] = service; } else { config.services.push(service); }
	if input.make_default || config.default_service_id.is_empty() { config.default_service_id = id; }
	write_json(&dir.join("video-config.json"), &config)?;
	Ok(config.view())
}
#[tauri::command]
pub fn get_video_generation_config(app: AppHandle, state: State<'_, VideoState>) -> Result<ConfigView, String> {
	let _guard = state.active.lock().map_err(|_| "视频状态不可用")?;
	Ok(read_config(&super::generation::data_dir(&app)?)?.view())
}
#[tauri::command]
pub fn save_video_generation_service(app: AppHandle, state: State<'_, VideoState>, input: ServiceInput) -> Result<ConfigView, String> {
	let _guard = state.active.lock().map_err(|_| "视频状态不可用")?;
	save_service(&super::generation::data_dir(&app)?, input)
}
#[tauri::command]
pub fn delete_video_generation_service(app: AppHandle, state: State<'_, VideoState>, id: String) -> Result<ConfigView, String> {
	let _guard = state.active.lock().map_err(|_| "视频状态不可用")?;
	let dir = super::generation::data_dir(&app)?;
	let mut config = read_config(&dir)?;
	config.services.retain(|s| s.id != id);
	if config.default_service_id == id { config.default_service_id = config.services.first().map(|s| s.id.clone()).unwrap_or_default(); }
	write_json(&dir.join("video-config.json"), &config)?;
	Ok(config.view())
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoJob {
	id: String, status: String, prompt: String, service_id: String, service_name: String, base_url: String,
	model_id: String, duration: u32, ratio: String, resolution: String, created_at: u64, completed_at: Option<u64>,
	remote_id: Option<String>, remote_status: Option<String>, progress: Option<f64>,
	message: Option<String>, path: Option<String>, usage: Option<Value>, has_reference: bool,
	actual_width: Option<u32>, actual_height: Option<u32>, actual_duration: Option<f64>, actual_fps: Option<f64>,
}
impl VideoJob {
	fn active(&self) -> bool { matches!(self.status.as_str(), "submitting" | "queued" | "in_progress" | "downloading") }
	fn blocks_submission(&self) -> bool { !matches!(self.status.as_str(), "completed" | "failed" | "abandoned" | "download_failed") && self.remote_status.as_deref() != Some("completed") }
	fn save(&self, dir: &Path) -> Result<(), String> { write_json(&dir.join("video-jobs").join(format!("{}.json", self.id)), self) }
}
fn read_job(dir: &Path, id: &str) -> Result<VideoJob, String> {
	valid_id(id)?;
	serde_json::from_slice(&std::fs::read(dir.join("video-jobs").join(format!("{id}.json"))).map_err(|_| "无法读取视频任务")?).map_err(|_| "视频任务记录损坏".into())
}
fn read_jobs(dir: &Path) -> Result<Vec<VideoJob>, String> {
	let path = dir.join("video-jobs");
	if !path.exists() { return Ok(vec![]); }
	let mut jobs = vec![];
	for entry in std::fs::read_dir(path).map_err(|_| "无法读取视频目录")? {
		let path = entry.map_err(|_| "无法读取视频任务")?.path();
		if path.extension().and_then(|v| v.to_str()) != Some("json") { continue; }
		jobs.push(read_job(dir, path.file_stem().and_then(|v| v.to_str()).ok_or("任务文件名无效")?)?);
	}
	jobs.sort_by(|a, b| b.created_at.cmp(&a.created_at));
	Ok(jobs)
}
fn credentials(dir: &Path, job: &VideoJob) -> Result<String, String> {
	let config = read_config(dir)?;
	let service = config.services.iter().find(|s| s.id == job.service_id && s.base_url == job.base_url).ok_or("原视频服务已删除或地址已修改；请恢复原服务后继续查询")?;
	super::crypto::open(&service.api_key).ok().filter(|s| !s.is_empty()).ok_or("无法读取视频 Key，请重新配置原服务".into())
}
#[tauri::command]
pub fn list_video_generation_jobs(app: AppHandle, state: State<'_, VideoState>) -> Result<Vec<VideoJob>, String> {
	let dir = super::generation::data_dir(&app)?;
	let mut active = state.active.lock().map_err(|_| "视频状态不可用")?;
	let mut jobs = read_jobs(&dir)?;
	for job in &mut jobs {
		if !job.active() || active.contains_key(&job.id) { continue; }
		if job.remote_id.is_none() {
			job.status = "submission_unknown".into();
			job.message = Some("应用在提交期间退出，无法确认服务端是否已接单；未重新提交，请先核对服务记录。".into());
			job.save(&dir)?;
		} else {
			match credentials(&dir, job) {
				Ok(key) => launch(&dir, job.clone(), key, &state.active, &mut active, false),
				Err(error) => { job.status = "paused".into(); job.message = Some(error); job.save(&dir)?; }
			}
		}
	}
	Ok(jobs)
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateInput { id: String, service_id: String, model_id: String, prompt: String, duration: u32, ratio: String, reference: Option<String> }
fn reference_bytes(raw: &str) -> Result<Vec<u8>, String> {
	let encoded = raw.strip_prefix("data:image/jpeg;base64,").ok_or("参考图须为预处理后的 JPEG")?;
	if encoded.len() > MAX_REFERENCE * 4 / 3 + 4 { return Err("压缩后的参考图超过 2 MB，请使用较小图片".into()); }
	let bytes = STANDARD.decode(encoded).map_err(|_| "参考图编码无效")?;
	if bytes.len() > MAX_REFERENCE { return Err("参考图超过 2 MB".into()); }
	let reader = image::ImageReader::with_format(std::io::Cursor::new(&bytes), image::ImageFormat::Jpeg);
	let (w, h) = reader.into_dimensions().map_err(|_| "参考图不是有效的 JPEG")?;
	if w == 0 || h == 0 || w > 2048 || h > 2048 { return Err("参考图边长须为 1–2048 像素".into()); }
	image::load_from_memory_with_format(&bytes, image::ImageFormat::Jpeg).map_err(|_| "参考图解码失败")?;
	Ok(bytes)
}
fn prepare(dir: &Path, input: GenerateInput) -> Result<(VideoJob, String, bool), String> {
	valid_id(&input.id)?;
	if dir.join("video-jobs").join(format!("{}.json", input.id)).exists() { return Ok((read_job(dir, &input.id)?, String::new(), false)); }
	if read_jobs(dir)?.iter().any(VideoJob::blocks_submission) { return Err("已有未确认结束的视频任务，请先继续查询或核对记录".into()); }
	let config = read_config(dir)?;
	let service = config.services.iter().find(|s| s.id == input.service_id).ok_or("请先配置视频生成服务")?;
	let model = service.models.iter().find(|m| m.id == input.model_id).ok_or("请选择有效的视频模型")?;
	if !model.durations.contains(&input.duration) || !model.ratios.contains(&input.ratio) { return Err("模型不支持所选时长或比例".into()); }
	let prompt = input.prompt.trim().to_string();
	if prompt.is_empty() || prompt.chars().count() > 32000 { return Err("提示词须为 1–32000 个字符".into()); }
	let key = super::crypto::open(&service.api_key).map_err(|_| "无法解密视频 Key")?;
	if key.is_empty() { return Err("请重新配置视频 Key".into()); }
	if input.reference.is_some() && !model.reference_enabled { return Err("此模型尚未启用实验性单图参考，请先移除参考图或在视频设置中启用".into()); }
	let reference = input.reference.as_deref().map(reference_bytes).transpose()?;
	let job = VideoJob { id: input.id, status: "submitting".into(), prompt, service_id: service.id.clone(), service_name: service.name.clone(), base_url: service.base_url.clone(), model_id: input.model_id, duration: input.duration, ratio: input.ratio, resolution: "1080p".into(), created_at: SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64, completed_at: None, remote_id: None, remote_status: None, progress: None, message: None, path: None, usage: None, has_reference: reference.is_some(), actual_width: None, actual_height: None, actual_duration: None, actual_fps: None };
	if let Some(bytes) = reference {
		std::fs::create_dir_all(dir.join("video-inputs")).map_err(|_| "无法创建参考图目录")?;
		std::fs::write(dir.join("video-inputs").join(format!("{}.jpg", job.id)), bytes).map_err(|_| "无法保存参考图快照")?;
	}
	job.save(dir)?;
	Ok((job, key, true))
}
#[tauri::command]
pub fn start_video_generation(app: AppHandle, state: State<'_, VideoState>, input: GenerateInput) -> Result<VideoJob, String> {
	let dir = super::generation::data_dir(&app)?;
	let mut active = state.active.lock().map_err(|_| "视频状态不可用")?;
	let (job, key, created) = prepare(&dir, input)?;
	if created { launch(&dir, job.clone(), key, &state.active, &mut active, true); }
	Ok(job)
}
#[tauri::command]
pub fn control_video_generation(app: AppHandle, state: State<'_, VideoState>, id: String, action: String) -> Result<(), String> {
	let dir = super::generation::data_dir(&app)?;
	let mut active = state.active.lock().map_err(|_| "视频状态不可用")?;
	let mut job = read_job(&dir, &id)?;
	if action == "pause" {
		if job.status == "submitting" { return Err("正在提交，请等待服务接单结果".into()); }
		if let Some(sender) = active.get(&id) { let _ = sender.send(true); }
	} else if action == "resume" {
		if active.contains_key(&id) { return Ok(()); }
		if !matches!(job.status.as_str(), "paused" | "download_failed") || job.remote_id.is_none() { return Err("此任务没有可恢复的远端记录".into()); }
		let key = credentials(&dir, &job)?;
		job.status = if job.remote_status.as_deref() == Some("completed") { "downloading" } else { "queued" }.into();
		job.message = None; job.save(&dir)?;
		launch(&dir, job, key, &state.active, &mut active, false);
	} else if action == "abandon" {
		if active.contains_key(&id) || !matches!(job.status.as_str(), "paused" | "submission_unknown") { return Err("请先暂停查询并核对服务记录".into()); }
		job.status = "abandoned".into(); job.message = Some("已结束本地跟踪；服务端可能继续生成并计费。".into()); job.save(&dir)?;
	} else { return Err("未知的视频任务操作".into()); }
	Ok(())
}
fn launch(dir: &Path, mut job: VideoJob, key: String, shared: &Active, active: &mut HashMap<String, watch::Sender<bool>>, create: bool) {
	let (sender, mut cancel) = watch::channel(false);
	active.insert(job.id.clone(), sender);
	let shared = shared.clone(); let dir = dir.to_path_buf();
	tauri::async_runtime::spawn(async move {
		let result = if create {
			match create_remote(&dir, &mut job, &key, &shared).await {
				Ok(()) => follow(&dir, &mut job, &key, &shared, &mut cancel).await,
				Err(error) => Err(error),
			}
		} else { follow(&dir, &mut job, &key, &shared, &mut cancel).await };
		if let Err(error) = result {
			job.status = if job.remote_id.is_none() { if job.status == "failed" { "failed" } else { "submission_unknown" } } else if job.remote_status.as_deref() == Some("completed") { "download_failed" } else if job.status == "failed" { "failed" } else { "paused" }.into();
			job.message = Some(error);
		}
		if let Ok(mut active) = shared.lock() {
			if job.save(&dir).is_err() { eprintln!("[skiff] failed to persist video task status"); }
			active.remove(&job.id);
		}
	});
}
fn persist(dir: &Path, job: &VideoJob, active: &Active) -> Result<(), String> {
	let _guard = active.lock().map_err(|_| "视频状态不可用")?; job.save(dir)
}
fn client() -> Result<reqwest::Client, String> {
	reqwest::Client::builder().connect_timeout(Duration::from_secs(20)).timeout(Duration::from_secs(90)).redirect(reqwest::redirect::Policy::none()).retry(reqwest::retry::never()).build().map_err(|_| "无法创建视频请求".into())
}
async fn json_response(mut response: reqwest::Response) -> Result<Value, String> {
	let mut bytes = vec![];
	while let Some(chunk) = response.chunk().await.map_err(|_| "无法读取视频服务响应；未重新提交")? {
		if bytes.len() + chunk.len() > 1024 * 1024 { return Err("视频服务响应过大".into()); }
		bytes.extend_from_slice(&chunk);
	}
	serde_json::from_slice(&bytes).map_err(|_| "视频服务返回无效 JSON；未重新提交".into())
}
fn remote_id(value: &Value) -> Result<String, String> {
	let id = value.get("id").or_else(|| value.get("task_id")).and_then(Value::as_str).ok_or("服务未返回任务 ID，请核对服务记录；未重新提交")?;
	if id.is_empty() || id.len() > 200 || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-') { return Err("服务返回无效任务 ID，请核对服务记录".into()); }
	Ok(id.into())
}
fn http_error(code: u16) -> String { format!("视频服务 HTTP {code}；请检查地址、权限或额度。未重新发起生成。") }
async fn create_remote(dir: &Path, job: &mut VideoJob, key: &str, active: &Active) -> Result<(), String> {
	let mut payload = json!({"model": job.model_id, "prompt": job.prompt, "duration": job.duration, "aspect_ratio": job.ratio, "resolution": job.resolution});
	if job.has_reference {
		let bytes = std::fs::read(dir.join("video-inputs").join(format!("{}.jpg", job.id))).map_err(|_| "参考图快照不可用；未提交")?;
		payload["image"] = json!(format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)));
	}
	let response = client()?.post(format!("{}/videos", job.base_url)).bearer_auth(key).json(&payload).send().await.map_err(|_| "提交连接中断，服务端可能已接单；请核对服务记录，未自动重试")?;
	let status = response.status();
	if !status.is_success() {
		// 5xx may be returned after accepting the task; preserve ambiguity.
		if [400, 401, 403, 404, 405, 413, 415, 422, 429].contains(&status.as_u16()) { job.status = "failed".into(); }
		return Err(http_error(status.as_u16()));
	}
	let value = json_response(response).await?;
	job.remote_id = Some(remote_id(&value)?);
	job.status = "queued".into();
	job.remote_status = value.get("status").and_then(Value::as_str).map(str::to_string);
	persist(dir, job, active)
}
fn apply_remote(job: &mut VideoJob, value: &Value) -> Result<(), String> {
	if let Some(id) = value.get("id").or_else(|| value.get("task_id")) { if Some(remote_id(&json!({"id":id}))?) != job.remote_id { return Err("查询返回的任务 ID 不匹配，已暂停".into()); } }
	let status = value.get("status").and_then(Value::as_str).ok_or("响应缺少状态，已暂停查询")?;
	job.remote_status = Some(status.chars().take(100).collect());
	job.progress = value.get("progress").and_then(Value::as_f64).filter(|p| p.is_finite() && *p >= 0.0 && *p <= 100.0);
	if let Some(usage) = value.get("usage") { job.usage = Some(usage.clone()); }
	match status {
		"queued" | "in_progress" => job.status = status.into(),
		"completed" => job.status = "downloading".into(),
		"failed" | "cancelled" | "canceled" | "expired" | "rejected" => { job.status = "failed".into(); return Err("远端任务已失败、取消或过期；未重新生成。".into()); }
		_ => return Err("服务返回未识别状态，已保留任务并暂停查询。".into()),
	}
	Ok(())
}
async fn follow(dir: &Path, job: &mut VideoJob, key: &str, active: &Active, cancel: &mut watch::Receiver<bool>) -> Result<(), String> {
	let client = client()?;
	let id = job.remote_id.clone().ok_or("缺少远端 ID")?;
	let deadline = Instant::now() + Duration::from_secs(15 * 60);
	let mut delay = 5;
	loop {
		if *cancel.borrow() { return Err("已停止等待，服务端可能仍在生成并计费。".into()); }
		if job.remote_status.as_deref() == Some("completed") {
			job.status = "downloading".into(); persist(dir, job, active)?;
			return tokio::select! { biased; _ = cancel.changed() => Err("下载已暂停，可重新下载；未重新生成。".into()), result = download(dir, job, key, &client) => result };
		}
		if Instant::now() >= deadline { return Err("本次查询等待已到上限，可继续查询；服务端可能仍在生成。".into()); }
		let result = tokio::select! { biased; _ = cancel.changed() => return Err("已停止等待，服务端可能仍在生成并计费。".into()), result = client.get(format!("{}/videos/{id}", job.base_url)).bearer_auth(key).send() => result };
		match result {
			Ok(response) if response.status().is_success() => {
				let value = tokio::select! { biased; _ = cancel.changed() => return Err("已暂停查询，服务端可能仍在生成。".into()), result = json_response(response) => result }?;
				if let Err(error) = apply_remote(job, &value) {
					let detail = value.pointer("/error/message").or_else(|| value.get("message")).and_then(Value::as_str).unwrap_or("");
					let detail: String = detail.replace(key, "[已隐藏]").chars().filter(|c| !c.is_control()).take(400).collect();
					return Err(if job.status == "failed" && !detail.is_empty() && !detail.contains("data:") { format!("{error} {detail}") } else { error });
				}
				job.message = None; persist(dir, job, active)?; delay = 5;
				if job.remote_status.as_deref() == Some("completed") { continue; }
			}
			Ok(response) if response.status().as_u16() == 429 || response.status().is_server_error() => {
				delay = retry_delay(response.headers().get("retry-after").and_then(|v| v.to_str().ok()), delay);
				if Duration::from_secs(delay) >= deadline.saturating_duration_since(Instant::now()) { return Err("服务要求稍后再查询，已暂停本地等待；可稍后继续查询此任务。".into()); }
				job.message = Some("服务暂不可用，正在退避查询；未重新提交。".into()); persist(dir, job, active)?;
			}
			Ok(response) => return Err(http_error(response.status().as_u16())),
			Err(_) => { delay = (delay * 2).min(60); job.message = Some("查询连接中断，稍后继续；未重新提交。".into()); persist(dir, job, active)?; }
		}
		tokio::select! { biased; _ = cancel.changed() => return Err("已停止等待，服务端可能仍在生成并计费。".into()), _ = tokio::time::sleep(Duration::from_secs(delay)) => {} }
	}
}
fn retry_delay(value: Option<&str>, previous: u64) -> u64 {
	value.and_then(|v| v.parse::<u64>().ok().or_else(|| httpdate::parse_http_date(v).ok().map(|date| date.duration_since(SystemTime::now()).unwrap_or_default().as_secs().saturating_add(1)))).unwrap_or_else(|| previous.saturating_mul(2).min(120)).max(5)
}
struct PartialFile(PathBuf);
impl Drop for PartialFile { fn drop(&mut self) { let _ = std::fs::remove_file(&self.0); } }
async fn download(dir: &Path, job: &mut VideoJob, key: &str, client: &reqwest::Client) -> Result<(), String> {
	let id = job.remote_id.as_deref().ok_or("缺少远端 ID")?;
	let mut response = client.get(format!("{}/videos/{id}/content", job.base_url)).bearer_auth(key).timeout(Duration::from_secs(180)).send().await.map_err(|_| "下载连接失败，可重新下载此任务")?;
	if !response.status().is_success() { return Err(http_error(response.status().as_u16())); }
	if response.content_length().is_some_and(|size| size > MAX_VIDEO) { return Err("视频超过 256 MB 下载上限".into()); }
	let path = dir.join("assets").join(format!("{}.mp4", job.id));
	std::fs::create_dir_all(path.parent().unwrap()).map_err(|_| "无法创建视频资产目录")?;
	let partial = PartialFile(path.with_extension("mp4.part"));
	let mut file = std::fs::File::create(&partial.0).map_err(|_| "无法创建视频文件")?;
	let mut count = 0;
	while let Some(bytes) = response.chunk().await.map_err(|_| "下载中断，可重新下载此任务")? {
		count += bytes.len() as u64;
		if count > MAX_VIDEO { return Err("视频超过 256 MB 下载上限".into()); }
		file.write_all(&bytes).map_err(|_| "无法写入视频，请检查磁盘空间")?;
	}
	file.sync_all().map_err(|_| "无法保存视频")?; drop(file);
	let info = media::inspect(&partial.0)?;
	std::fs::rename(&partial.0, &path).map_err(|_| "无法完成视频保存")?;
	job.actual_width = Some(info.width); job.actual_height = Some(info.height); job.actual_duration = Some(info.duration); job.actual_fps = info.fps;
	job.path = Some(path.to_string_lossy().into()); job.status = "completed".into(); job.message = None;
	job.completed_at = Some(SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64);
	Ok(())
}
fn asset_path(dir: &Path, id: &str) -> Result<PathBuf, String> {
	let job = read_job(dir, id)?;
	if job.status != "completed" { return Err("视频尚未保存完成".into()); }
	let path = dir.join("assets").join(format!("{id}.mp4"));
	if !path.is_file() { return Err("视频文件不存在，可检查作品目录".into()); } Ok(path)
}
#[tauri::command]
pub fn reveal_video_generation_asset(app: AppHandle, id: String) -> Result<(), String> {
	let path = asset_path(&super::generation::data_dir(&app)?, &id)?;
	#[cfg(windows)] { use std::os::windows::process::CommandExt; std::process::Command::new("explorer.exe").arg(format!("/select,{}", path.display())).creation_flags(0x08000000).spawn().map_err(|_| "无法打开视频所在目录")?; }
	#[cfg(not(windows))] { open::that(path.parent().unwrap()).map_err(|_| "无法打开视频所在目录")?; }
	Ok(())
}
#[tauri::command]
pub async fn export_video_generation_asset(app: AppHandle, id: String) -> Result<bool, String> {
	use tauri_plugin_dialog::DialogExt;
	let path = asset_path(&super::generation::data_dir(&app)?, &id)?;
	let (sender, receiver) = tokio::sync::oneshot::channel();
	app.dialog().file().add_filter("MP4 视频", &["mp4"]).set_file_name(format!("skiff-{id}.mp4")).save_file(move |target| { let _ = sender.send(target); });
	let Some(target) = receiver.await.map_err(|_| "保存窗口已关闭")? else { return Ok(false); };
	let target = target.into_path().map_err(|_| "请选择本地保存位置")?;
	if target != path { std::fs::copy(path, target).map_err(|_| "无法另存视频")?; } Ok(true)
}
