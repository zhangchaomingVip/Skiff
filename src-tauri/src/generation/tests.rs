use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
use axum::{extract::Request, response::IntoResponse, Router};

const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";

fn reference_png() -> Vec<u8> {
	let image = image::RgbaImage::from_pixel(4, 3, image::Rgba([10, 100, 200, 80]));
	let mut bytes = std::io::Cursor::new(vec![]); image.write_to(&mut bytes, image::ImageFormat::Png).unwrap(); bytes.into_inner()
}

#[test]
fn validates_reference_content_and_keeps_legacy_job_records_readable() {
	let bytes = reference_png();
	let (info, decoded) = validate_reference(ReferenceInput { name: "C:\\private\\reference.png".into(), data_url: format!("data:image/png;base64,{}", STANDARD.encode(&bytes)) }).unwrap();
	assert_eq!((info.width, info.height), (4, 3)); assert_eq!(info.name, "reference.png"); assert_eq!(decoded, bytes, "Preserve original input and transparency");
	for data_url in ["https://example.com/a.png".into(), "data:image/png;base64,".into(), "data:image/png;base64,bm90IGEgcG5n".into(), format!("data:image/jpeg;base64,{}", STANDARD.encode(&bytes))] {
		assert!(validate_reference(ReferenceInput { name: "test".into(), data_url }).is_err());
	}
	let mut encoded = serde_json::to_value(job()).unwrap(); encoded.as_object_mut().unwrap().remove("reference"); encoded.as_object_mut().unwrap().remove("removed");
	let old: ImageJob = serde_json::from_value(encoded).unwrap(); assert!(old.reference.is_none());
	assert!(!old.removed);
}

#[test]
fn removing_gallery_asset_is_durable_reversible_and_keeps_original_and_metadata() {
	let dir = TestDir::new(); let mut task = job();
	assert!(set_asset_removed(&dir.0, "../config", true).is_err());
	task.save(&dir.0).unwrap(); assert!(set_asset_removed(&dir.0, &task.id, true).is_err());
	std::fs::create_dir_all(dir.0.join("assets")).unwrap();
	let path = dir.0.join("assets").join(format!("{}.png", task.id));
	let bytes = reference_png(); std::fs::write(&path, &bytes).unwrap();
	task.status = "completed".into(); task.path = Some(path.to_string_lossy().into()); task.usage = Some(json!({"total_tokens":42})); task.save(&dir.0).unwrap();
	let hidden = set_asset_removed(&dir.0, &task.id, true).unwrap(); assert!(hidden.removed); assert_eq!(hidden.status, "completed");
	assert_eq!(hidden.prompt, task.prompt); assert_eq!(hidden.usage, task.usage);
	assert!(list_jobs(&dir.0, &HashMap::new()).unwrap()[0].removed);
	assert_eq!(std::fs::read(asset_path(&dir.0, &task.id).unwrap()).unwrap(), bytes);
	let restored = set_asset_removed(&dir.0, &task.id, false).unwrap(); assert!(!restored.removed);
	assert_eq!(std::fs::read(&path).unwrap(), bytes);
}

struct TestDir(PathBuf);
impl TestDir {
	fn new() -> Self { let dir = std::env::temp_dir().join(format!("skiff-generation-test-{}", uuid::Uuid::new_v4())); std::fs::create_dir_all(&dir).unwrap(); Self(dir) }
}
impl Drop for TestDir {
	fn drop(&mut self) {
		assert!(self.0.starts_with(std::env::temp_dir()));
		assert!(self.0.file_name().unwrap().to_string_lossy().starts_with("skiff-generation-test-"));
		let _ = std::fs::remove_dir_all(&self.0);
	}
}

fn input() -> ServiceInput {
	ServiceInput { id: None, name: "Test Images".into(), base_url: "https://api.openai.com/v1/".into(), api_key: Some("dummy-generation-secret-1234".into()), models: vec![ImageModel { id: "test-image".into(), sizes: vec!["1024x1024".into()] }], default_model: "test-image".into(), make_default: true }
}

fn job() -> ImageJob {
	ImageJob { id: uuid::Uuid::new_v4().to_string(), status: "generating".into(), prompt: "A paper boat".into(), service_id: "test".into(), service_name: "Test Images".into(), model_id: "test-image".into(), size: "1024x1024".into(), quality: "auto".into(), created_at: 42, message: None, path: None, usage: None, revised_prompt: None, actual_size: None, reference: None, removed: false, project_root: None, canvas_id: None }
}

#[test]
fn concurrency_defaults_migrates_and_enforces_only_supported_limits() {
	let dir = TestDir::new();
	assert_eq!(read_config(&dir.0).unwrap().concurrency_limit, 5);
	write_json(&dir.0.join("config.json"), &json!({"services":[],"defaultServiceId":""})).unwrap();
	assert_eq!(read_config(&dir.0).unwrap().view().concurrency_limit, 5);
	for limit in [3, 5, 10, 0] {
		assert_eq!(save_concurrency_limit(&dir.0, limit).unwrap().concurrency_limit, limit);
		assert_eq!(read_config(&dir.0).unwrap().concurrency_limit, limit);
		if limit > 0 {
			assert!(check_capacity(limit, limit - 1).is_ok());
			assert!(check_capacity(limit, limit).is_err());
			assert!(check_capacity(limit, limit + 2).is_err(), "Lowering the limit blocks submissions until capacity returns");
		} else { assert!(check_capacity(limit, 1000).is_ok()); }
	}
	for limit in [1, 4, 6, 20] { assert!(save_concurrency_limit(&dir.0, limit).is_err()); }
	assert_eq!(read_config(&dir.0).unwrap().concurrency_limit, 0);
}

#[cfg(windows)]
#[test]
fn concurrency_updates_preserve_services_and_service_edits_preserve_concurrency() {
	let dir = TestDir::new(); let view = save_service(&dir.0, input()).unwrap();
	let key = read_config(&dir.0).unwrap().services[0].api_key.clone();
	save_concurrency_limit(&dir.0, 10).unwrap();
	let config = read_config(&dir.0).unwrap();
	assert_eq!(config.services[0].api_key, key); assert_eq!(config.default_service_id, view.default_service_id);
	let mut edit = input(); edit.id = Some(view.default_service_id); edit.api_key = None;
	assert_eq!(save_service(&dir.0, edit).unwrap().concurrency_limit, 10);
}

#[cfg(windows)]
#[test]
fn credentials_are_encrypted_masked_and_preserved_on_edit() {
	let dir = TestDir::new();
	let view = save_service(&dir.0, input()).unwrap();
	let disk = std::fs::read_to_string(dir.0.join("config.json")).unwrap();
	assert!(!disk.contains("dummy-generation-secret"));
	assert!(disk.contains("dpapi1:"));
	assert_eq!(view.services[0].key_hint, "…1234");
	assert!(!serde_json::to_string(&view).unwrap().contains("apiKey"));
	let before = read_config(&dir.0).unwrap().services[0].api_key.clone();
	let mut edit = input(); edit.id = Some(view.default_service_id); edit.api_key = Some("".into()); edit.name = "Renamed".into();
	save_service(&dir.0, edit).unwrap();
	let saved = read_config(&dir.0).unwrap();
	assert_eq!(saved.services[0].api_key, before);
	assert_eq!(super::super::crypto::open(&before).unwrap(), "dummy-generation-secret-1234");
	assert_eq!(saved.services[0].base_url, "https://api.openai.com/v1");
}

#[test]
fn rejects_bad_endpoints_dimensions_and_model_config() {
	for url in ["file:///a", "https://user:secret@example.com/v1", "https://example.com/v1?key=secret", "https://example.com/v1#x"] { assert!(base_url(url).is_err()); }
	assert_eq!(dimensions("1536x864"), Some((1536, 864)));
	for size in ["0x0", "1024x1", "1025x1024", "9999999999x1", "4096x256", "1:1"] { assert!(dimensions(size).is_none()); }
	let dir = TestDir::new();
	let mut bad = input(); bad.models[0].sizes = vec!["1:1".into()]; assert!(save_service(&dir.0, bad).is_err());
	let mut bad = input(); bad.default_model = "missing".into(); assert!(save_service(&dir.0, bad).is_err());
	let mut bad = input(); bad.models.push(bad.models[0].clone()); assert!(save_service(&dir.0, bad).is_err());
	assert_eq!(dimensions("3840x2160"), Some((3840, 2160)));
	assert_eq!(dimensions("2880x2880"), Some((2880, 2880)));
	let mut bad = input(); bad.models[0].sizes = (0..33).map(|i| format!("{}x{}", 256 + i * 16, 256 + i * 16)).collect(); assert!(save_service(&dir.0, bad).err().unwrap().contains("1–32"));
}

#[test]
fn reload_marks_orphan_jobs_interrupted_and_rejects_path_traversal() {
	let dir = TestDir::new();
	let task = job(); task.save(&dir.0).unwrap();
	let (sender, _) = watch::channel(false);
	assert_eq!(list_jobs(&dir.0, &HashMap::from([(task.id.clone(), sender)])).unwrap()[0].status, "generating");
	let restored = list_jobs(&dir.0, &HashMap::new()).unwrap();
	assert_eq!(restored[0].status, "interrupted");
	assert!(restored[0].message.as_ref().unwrap().contains("计") || restored[0].message.as_ref().unwrap().contains("处理"));
	assert!(read_job(&dir.0, "../config").is_err());
	assert!(asset_path(&dir.0, &task.id).is_err());
}

async fn mock(mode: &'static str) -> (String, Arc<AtomicUsize>, tokio::task::JoinHandle<()>) {
	let count = Arc::new(AtomicUsize::new(0));
	let calls = count.clone();
	let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
	let base = format!("http://{}", listener.local_addr().unwrap());
	let asset_base = base.clone();
	let app = Router::new().fallback(move |request: Request| {
		let calls = calls.clone(); let base = asset_base.clone();
		async move {
			if request.uri().path() == "/asset.png" {
				assert!(request.headers().get("authorization").is_none(), "Never forward credentials to an image URL");
				if mode == "download-failure" { return (axum::http::StatusCode::GONE, "expired").into_response(); }
				return ([("content-type", "image/png")], STANDARD.decode(PNG).unwrap()).into_response();
			}
			calls.fetch_add(1, Ordering::SeqCst);
			if mode.starts_with("edit") {
				assert_eq!(request.uri().path(), "/v1/images/edits");
				assert_eq!(request.headers().get("authorization").unwrap(), "Bearer dummy-key");
				assert!(request.headers().get("content-type").unwrap().to_str().unwrap().starts_with("multipart/form-data; boundary="));
				let bytes = axum::body::to_bytes(request.into_body(), 65536).await.unwrap();
				let text = String::from_utf8_lossy(&bytes);
				for field in ["model", "prompt", "size", "quality", "n", "output_format", "image"] { assert!(text.contains(&format!("name=\"{field}\""))); }
				assert!(text.contains("filename=\"reference.png\"")); assert!(text.contains("Content-Type: image/png"));
				let original = reference_png(); assert!(bytes.windows(original.len()).any(|part| part == original));
				if mode == "edit-error" { return (axum::http::StatusCode::NOT_FOUND, axum::Json(json!({"error":{"message":"edits unsupported dummy-key"}}))).into_response(); }
				if mode == "edit-timeout" { tokio::time::sleep(Duration::from_millis(250)).await; }
				return axum::Json(json!({"data":[{"b64_json":PNG}],"usage":{"total_tokens":64}})).into_response();
			}
			assert_eq!(request.uri().path(), "/v1/images/generations");
			assert_eq!(request.headers().get("authorization").unwrap(), "Bearer dummy-key");
			let body: Value = serde_json::from_slice(&axum::body::to_bytes(request.into_body(), 65536).await.unwrap()).unwrap();
			assert_eq!(body["n"], 1); assert_eq!(body["output_format"], "png"); assert_eq!(body["model"], "test-image"); assert_eq!(body["size"], "1024x1024");
			assert!(body.get("response_format").is_none(), "GPT Image does not accept legacy response_format");
			if mode == "unauthorized" { return (axum::http::StatusCode::UNAUTHORIZED, axum::Json(json!({"error":{"message":"invalid dummy-key"}}))).into_response(); }
			if mode == "rate-limit" { return (axum::http::StatusCode::TOO_MANY_REQUESTS, axum::Json(json!({"error":{"message":"slow down"}}))).into_response(); }
			if mode == "timeout" { tokio::time::sleep(Duration::from_millis(250)).await; }
			if mode == "html" { return ([("content-type", "text/html")], "<html>website</html>").into_response(); }
			if mode == "empty" { return axum::Json(json!({"data":[]})).into_response(); }
			let image = match mode { "url" | "download-failure" => json!({"url": format!("{base}/asset.png")}), "invalid-image" => json!({"b64_json": STANDARD.encode(b"not a png")}), _ => json!({"b64_json":PNG,"revised_prompt":"A small paper boat"}) };
			axum::Json(json!({"data":[image],"usage":{"total_tokens":42}})).into_response()
		}
	});
	let handle = tokio::spawn(async move { axum::serve(listener, app).await.unwrap(); });
	(format!("{base}/v1"), count, handle)
}

#[tokio::test]
async fn persists_base64_and_url_results_with_metadata_and_without_auth_on_download() {
	for mode in ["base64", "url"] {
		let dir = TestDir::new(); let (base, count, server) = mock(mode).await;
		let service = Service { id: "test".into(), name: "Test".into(), base_url: base, api_key: "unused".into(), models: vec![], default_model: "test-image".into() };
		let mut task = job();
		generate(&dir.0, &service, "dummy-key", &mut task).await.unwrap(); task.save(&dir.0).unwrap();
		assert_eq!(count.load(Ordering::SeqCst), 1);
		assert_eq!(task.status, "completed"); assert_eq!(task.actual_size.as_deref(), Some("1x1"));
		assert_eq!(std::fs::read(asset_path(&dir.0, &task.id).unwrap()).unwrap(), STANDARD.decode(PNG).unwrap());
		let restored = list_jobs(&dir.0, &HashMap::new()).unwrap();
		assert_eq!(restored[0].status, "completed"); assert_eq!(restored[0].usage.as_ref().unwrap()["total_tokens"], 42);
		server.abort();
	}
}

#[tokio::test]
async fn reports_provider_and_download_errors_without_retrying_or_saving_bad_images() {
	for (mode, expected) in [("unauthorized", "401"), ("rate-limit", "429"), ("html", "JSON"), ("empty", "未返回图片"), ("invalid-image", "PNG"), ("download-failure", "下载失败")] {
		let dir = TestDir::new(); let (base, count, server) = mock(mode).await;
		let service = Service { id: "test".into(), name: "Test".into(), base_url: base, api_key: "unused".into(), models: vec![], default_model: "test-image".into() };
		let mut task = job(); let error = generate(&dir.0, &service, "dummy-key", &mut task).await.unwrap_err();
		assert!(error.contains(expected), "{mode}: {error}"); assert!(!error.contains("dummy-key"));
		assert_eq!(count.load(Ordering::SeqCst), 1, "Never automatically retry a billable POST");
		assert!(!dir.0.join("assets").join(format!("{}.png", task.id)).exists()); server.abort();
	}
}

#[tokio::test]
async fn timeout_never_repeats_a_billable_request() {
	let dir = TestDir::new(); let (base, count, server) = mock("timeout").await;
	let service = Service { id: "test".into(), name: "Test".into(), base_url: base, api_key: "unused".into(), models: vec![], default_model: "test-image".into() };
	let client = reqwest::Client::builder().timeout(Duration::from_millis(80)).retry(reqwest::retry::never()).build().unwrap();
	let mut task = job();
	let error = generate_with_client(&dir.0, &service, "dummy-key", &mut task, &client).await.unwrap_err();
	assert!(error.contains("超时")); assert!(error.contains("计费"));
	assert_eq!(count.load(Ordering::SeqCst), 1);
	server.abort();
}

#[tokio::test]
async fn edits_send_snapshot_as_multipart_and_never_fall_back_or_retry() {
	for mode in ["edit", "edit-error", "edit-timeout"] {
		let dir = TestDir::new(); let (base, count, server) = mock(mode).await;
		let service = Service { id: "test".into(), name: "Test".into(), base_url: base, api_key: "unused".into(), models: vec![], default_model: "test-image".into() };
		let (reference, bytes) = validate_reference(ReferenceInput { name: "source.png".into(), data_url: format!("data:image/png;base64,{}", STANDARD.encode(reference_png())) }).unwrap();
		let mut task = job(); task.reference = Some(reference); save_reference(&dir.0, &task, &bytes).unwrap(); task.save(&dir.0).unwrap();
		let client = reqwest::Client::builder().timeout(Duration::from_millis(if mode == "edit-timeout" { 80 } else { 2000 })).retry(reqwest::retry::never()).build().unwrap();
		let result = generate_with_client(&dir.0, &service, "dummy-key", &mut task, &client).await;
		if mode == "edit" {
			result.unwrap(); task.save(&dir.0).unwrap();
			assert_eq!(task.status, "completed"); assert_eq!(task.usage.as_ref().unwrap()["total_tokens"], 64);
			assert_eq!(read_job(&dir.0, &task.id).unwrap().reference.unwrap().name, "source.png");
		} else {
			let error = result.unwrap_err(); assert!(!error.contains("dummy-key"));
			if mode == "edit-error" { assert!(error.contains("图生图失败") && error.contains("未自动改为文生图")); }
		}
		assert_eq!(count.load(Ordering::SeqCst), 1);
		assert_eq!(std::fs::read(reference_path(&dir.0, &task).unwrap()).unwrap(), bytes); server.abort();
	}
}
