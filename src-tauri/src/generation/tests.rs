use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
use axum::{extract::Request, response::IntoResponse, Router};

const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";

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
	ImageJob { id: uuid::Uuid::new_v4().to_string(), status: "generating".into(), prompt: "A paper boat".into(), service_id: "test".into(), service_name: "Test Images".into(), model_id: "test-image".into(), size: "1024x1024".into(), quality: "auto".into(), created_at: 42, message: None, path: None, usage: None, revised_prompt: None, actual_size: None }
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
