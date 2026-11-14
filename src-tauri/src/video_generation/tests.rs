use super::*;
use axum::{extract::Request, response::IntoResponse, Router};
use std::sync::atomic::{AtomicUsize, Ordering};

struct TestDir(PathBuf);
impl TestDir {
	fn new() -> Self { let p = std::env::temp_dir().join(format!("skiff-video-test-{}", uuid::Uuid::new_v4())); std::fs::create_dir_all(&p).unwrap(); Self(p) }
}
impl Drop for TestDir {
	fn drop(&mut self) { assert!(self.0.starts_with(std::env::temp_dir()) && self.0.file_name().unwrap().to_string_lossy().starts_with("skiff-video-test-")); let _ = std::fs::remove_dir_all(&self.0); }
}
fn config(dir: &Path, base: &str) {
	write_json(&dir.join("video-config.json"), &Config { default_service_id: "test".into(), services: vec![Service { id: "test".into(), name: "Test Videos".into(), base_url: base.into(), api_key: "dummy-video-key".into(), models: vec![VideoModel { id: "muse-video".into(), durations: vec![5], ratios: vec!["9:16".into()], reference_enabled: true }], default_model: "muse-video".into() }] }).unwrap();
}
fn input() -> GenerateInput { GenerateInput { id: uuid::Uuid::new_v4().to_string(), service_id: "test".into(), model_id: "muse-video".into(), prompt: "A blue paper boat".into(), duration: 5, ratio: "9:16".into(), reference: None, project_root: None, canvas_id: None } }
fn video() -> Vec<u8> { STANDARD.decode(include_str!("../../../tests/fixtures/video.mp4.b64").trim()).unwrap() }
fn jpeg() -> Vec<u8> {
	let mut bytes = vec![];
	image::codecs::jpeg::JpegEncoder::new(&mut bytes).encode(&[0, 128, 255], 1, 1, image::ExtendedColorType::Rgb8).unwrap(); bytes
}
#[test]
fn validates_capabilities_references_paths_and_preserves_idempotence() {
	let dir = TestDir::new(); config(&dir.0, "https://example.com/v1");
	for url in ["file:///tmp", "https://u:key@example.com/v1", "https://example.com?key=x", "https://example.com/v1/videos"] { assert!(base_url(url).is_err()); }
	assert_eq!(base_url("https://example.com/").unwrap(), "https://example.com/v1");
	assert_eq!(base_url("https://example.com/v1/").unwrap(), "https://example.com/v1");
	let mut bad = input(); bad.duration = 15; assert!(prepare(&dir.0, bad).is_err());
	let mut bad = input(); bad.ratio = "16:9".into(); assert!(prepare(&dir.0, bad).is_err());
	assert!(read_job(&dir.0, "../video-config").is_err());
	assert!(reference_bytes("https://example.com/photo.jpg").is_err());
	assert!(reference_bytes("data:image/jpeg;base64,bm90IGEganBlZw==").is_err());
	let mut disabled = read_config(&dir.0).unwrap(); disabled.services[0].models[0].reference_enabled = false;
	write_json(&dir.0.join("video-config.json"), &disabled).unwrap();
	let mut bad = input(); bad.reference = Some(format!("data:image/jpeg;base64,{}", STANDARD.encode(jpeg()))); assert!(prepare(&dir.0, bad).is_err());
	disabled.services[0].models[0].reference_enabled = true; write_json(&dir.0.join("video-config.json"), &disabled).unwrap();
	let mut request = input(); request.reference = Some(format!("data:image/jpeg;base64,{}", STANDARD.encode(jpeg())));
	let id = request.id.clone();
	let (job, _, created) = prepare(&dir.0, request).unwrap(); assert!(created); assert!(job.has_reference);
	assert_eq!(std::fs::read(dir.0.join("video-inputs").join(format!("{id}.jpg"))).unwrap(), jpeg());
	let mut duplicate = input(); duplicate.id = id;
	let (saved, key, created) = prepare(&dir.0, duplicate).unwrap(); assert!(!created); assert!(key.is_empty()); assert_eq!(saved.prompt, job.prompt);
	assert!(prepare(&dir.0, input()).is_err(), "Native layer blocks a second task");
}
#[cfg(windows)]
#[test]
fn encrypts_key_and_keeps_existing_key_on_edit() {
	let dir = TestDir::new();
	let request = || ServiceInput { id: None, name: "Muse".into(), base_url: "https://api.example.com".into(), api_key: Some("dummy-video-key-5678".into()), models: vec![VideoModel { id: "muse-video".into(), durations: vec![5], ratios: vec!["9:16".into()], reference_enabled: true }], default_model: "muse-video".into(), make_default: true };
	let view = save_service(&dir.0, request()).unwrap();
	let disk = std::fs::read_to_string(dir.0.join("video-config.json")).unwrap(); assert!(disk.contains("dpapi1:")); assert!(!disk.contains("dummy-video-key"));
	assert!(!serde_json::to_string(&view).unwrap().contains("apiKey")); assert_eq!(view.services[0].key_hint, "…5678");
	let mut edit = request(); edit.id = Some(view.default_service_id); edit.api_key = None;
	save_service(&dir.0, edit).unwrap(); assert_eq!(super::super::crypto::open(&read_config(&dir.0).unwrap().services[0].api_key).unwrap(), "dummy-video-key-5678");
}
#[test]
fn binds_recovery_credentials_to_original_endpoint_and_retains_unknown_status() {
	let dir = TestDir::new(); config(&dir.0, "https://old.example/v1");
	let (mut job, _, _) = prepare(&dir.0, input()).unwrap();
	assert_eq!(credentials(&dir.0, &job).unwrap(), "dummy-video-key");
	config(&dir.0, "https://new.example/v1"); assert!(credentials(&dir.0, &job).is_err());
	job.remote_id = Some("muse_test".into());
	assert!(apply_remote(&mut job, &json!({"id":"different", "status":"completed"})).is_err());
	assert!(apply_remote(&mut job, &json!({"status":"new_provider_state", "progress":999})).is_err());
	assert_eq!(job.remote_status.as_deref(), Some("new_provider_state")); assert!(job.progress.is_none());
	job.status = "paused".into(); assert!(job.blocks_submission());
	job.status = "submission_unknown".into(); assert!(job.blocks_submission());
	job.status = "abandoned".into(); assert!(!job.blocks_submission());
	job.status = "download_failed".into(); assert!(!job.blocks_submission());
}
#[test]
fn respects_retry_after_instead_of_querying_before_server_delay() {
	assert_eq!(retry_delay(Some("3600"), 5), 3600);
	assert_eq!(retry_delay(Some("2"), 5), 5);
	assert_eq!(retry_delay(None, 5), 10);
	assert_eq!(retry_delay(Some("invalid"), 120), 120);
	let future = httpdate::fmt_http_date(SystemTime::now() + Duration::from_secs(3600));
	assert!((3599..=3601).contains(&retry_delay(Some(&future), 5)));
}
#[test]
fn reads_actual_mp4_specs_and_rejects_invalid_files() {
	let dir = TestDir::new(); let path = dir.0.join("sample.mp4");
	std::fs::write(&path, video()).unwrap();
	let info = media::inspect(&path).unwrap(); assert_eq!((info.width, info.height), (72, 128)); assert_eq!(info.duration, 5.0); assert_eq!(info.fps, Some(24.0));
	let mut truncated = video(); truncated.truncate(truncated.len() - 20); std::fs::write(&path, truncated).unwrap(); assert!(media::inspect(&path).is_err());
	std::fs::write(&path, b"<html>bad gateway</html>").unwrap(); assert!(media::inspect(&path).is_err());
}
async fn mock(mode: &'static str) -> (String, Arc<AtomicUsize>, tokio::task::JoinHandle<()>) {
	let posts = Arc::new(AtomicUsize::new(0)); let count = posts.clone();
	let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap(); let base = format!("http://{}/v1", listener.local_addr().unwrap());
	let app = Router::new().fallback(move |request: Request| {
		let count = count.clone();
		async move {
			assert_eq!(request.headers().get("authorization").unwrap(), "Bearer dummy-video-key");
			if request.method() == "POST" {
				count.fetch_add(1, Ordering::SeqCst);
				let body: Value = serde_json::from_slice(&axum::body::to_bytes(request.into_body(), 4 * 1024 * 1024).await.unwrap()).unwrap();
				assert_eq!(body["duration"], 5); assert_eq!(body["aspect_ratio"], "9:16"); assert_eq!(body["model"], "muse-video");
				for field in ["size", "seconds", "mode", "fps", "motion", "quality"] { assert!(body.get(field).is_none()); }
				if mode == "reference" { assert_eq!(reference_bytes(body["image"].as_str().unwrap()).unwrap(), jpeg()); }
				if mode == "unauthorized" { return (axum::http::StatusCode::UNAUTHORIZED, "dummy-video-key must never appear in errors").into_response(); }
				if mode == "ambiguous" { return (axum::http::StatusCode::BAD_GATEWAY, "accepted but response lost").into_response(); }
				return (axum::http::StatusCode::ACCEPTED, axum::Json(json!({"id":"muse_test","status":"queued"}))).into_response();
			}
			if request.uri().path().ends_with("/content") {
				if mode == "download-failure" { return (axum::http::StatusCode::GONE, "expired").into_response(); }
				if mode == "oversize" { return ([("content-length", "300000000")], "").into_response(); }
				if mode == "invalid-video" { return ([("content-type", "text/html")], "<html>bad gateway</html>").into_response(); }
				return ([("content-type", "video/mp4")], video()).into_response();
			}
			if mode == "rate-limit" { return (axum::http::StatusCode::TOO_MANY_REQUESTS, [("retry-after", "3600")], "slow down").into_response(); }
			let status = if mode == "pending" { "in_progress" } else if mode == "remote-failure" { "failed" } else { "completed" };
			axum::Json(json!({"id":"muse_test", "status":status, "progress":100, "error":{"message":"upstream failed dummy-video-key"}, "usage":{"billing_seconds":5,"cost":0}})).into_response()
		}
	});
	let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap(); }); (base, posts, task)
}
#[tokio::test]
async fn creates_once_and_recovers_via_get_with_actual_specs_and_reference() {
	for mode in ["success", "reference"] {
		let dir = TestDir::new(); let (base, posts, server) = mock(mode).await; config(&dir.0, &base);
		let mut request = input(); if mode == "reference" { request.reference = Some(format!("data:image/jpeg;base64,{}", STANDARD.encode(jpeg()))); }
		let (mut job, key, _) = prepare(&dir.0, request).unwrap(); let active = Active::default();
		create_remote(&dir.0, &mut job, &key, &active).await.unwrap();
		assert_eq!(read_job(&dir.0, &job.id).unwrap().remote_id.as_deref(), Some("muse_test"));
		// Simulate a new process recovering the durable task, without POST.
		let mut restored = read_job(&dir.0, &job.id).unwrap(); let (_sender, mut receiver) = watch::channel(false);
		follow(&dir.0, &mut restored, &credentials(&dir.0, &job).unwrap(), &active, &mut receiver).await.unwrap();
		assert_eq!(restored.status, "completed"); assert_eq!(restored.actual_width, Some(72)); assert_eq!(restored.actual_fps, Some(24.0));
		assert_eq!(std::fs::read(restored.path.unwrap()).unwrap(), video()); assert_eq!(posts.load(Ordering::SeqCst), 1);
		assert_eq!(restored.usage.unwrap()["billing_seconds"], 5); server.abort();
	}
}
#[tokio::test]
async fn errors_never_retry_post_or_leak_secrets_and_download_retry_is_get_only() {
	for mode in ["unauthorized", "ambiguous", "download-failure", "remote-failure", "oversize", "invalid-video", "disk-failure", "rate-limit"] {
		let dir = TestDir::new(); let (base, posts, server) = mock(mode).await; config(&dir.0, &base);
		let (mut job, key, _) = prepare(&dir.0, input()).unwrap(); let active = Active::default();
		let result = create_remote(&dir.0, &mut job, &key, &active).await;
		if ["unauthorized", "ambiguous"].contains(&mode) {
			let error = result.unwrap_err(); assert!(!error.contains("dummy-video-key")); assert!(job.remote_id.is_none());
			assert_eq!(job.status, if mode == "unauthorized" { "failed" } else { "submitting" });
		} else {
			result.unwrap(); let (_sender, mut receiver) = watch::channel(false);
			if mode == "disk-failure" { std::fs::write(dir.0.join("assets"), b"occupied").unwrap(); }
			let error = follow(&dir.0, &mut job, &key, &active, &mut receiver).await.unwrap_err();
			assert!(!error.contains("dummy-video-key"));
			if mode == "download-failure" { assert_eq!(job.remote_status.as_deref(), Some("completed")); assert!(download(&dir.0, &mut job, &key, &client().unwrap()).await.is_err()); }
			assert!(!dir.0.join("assets").join(format!("{}.mp4.part", job.id)).exists());
		}
		assert_eq!(posts.load(Ordering::SeqCst), 1); server.abort();
	}
}
#[tokio::test]
async fn pause_stops_local_polling_without_ending_remote_task() {
	let dir = TestDir::new(); let (base, posts, server) = mock("pending").await; config(&dir.0, &base);
	let (mut job, key, _) = prepare(&dir.0, input()).unwrap(); let active = Active::default();
	create_remote(&dir.0, &mut job, &key, &active).await.unwrap();
	let (sender, mut receiver) = watch::channel(false); sender.send(true).unwrap();
	let error = follow(&dir.0, &mut job, &key, &active, &mut receiver).await.unwrap_err(); assert!(error.contains("计费")); assert!(job.blocks_submission()); assert_eq!(posts.load(Ordering::SeqCst), 1); server.abort();
}
