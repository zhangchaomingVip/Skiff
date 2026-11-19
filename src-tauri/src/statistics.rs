//! Read-only usage projection. IPC never returns transcript content, prompts or credentials.
use serde::{Deserialize, Serialize};
use std::{collections::{HashMap, HashSet}, fs::{self, File}, io::{BufRead, BufReader, Read}, path::{Path, PathBuf}};

const MAX_LINE: u64 = 64 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target { chat_id: String, session_file: String, cwd: String }

#[derive(Deserialize)]
struct Header {
	#[serde(rename = "type")] kind: String,
	id: String,
	cwd: PathBuf,
	version: Option<u64>,
	#[serde(rename = "parentSession")] parent_session: Option<String>,
	timestamp: Option<String>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Timestamp { Millis(u64), Iso(String) }

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Usage { input: Option<u64>, output: Option<u64>, cache_read: Option<u64>, cache_write: Option<u64> }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Message {
	role: String,
	provider: Option<String>,
	model: Option<String>,
	stop_reason: Option<String>,
	usage: Option<Usage>,
	timestamp: Option<Timestamp>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
	#[serde(rename = "type")] kind: String,
	id: Option<String>,
	parent_id: Option<String>,
	timestamp: Option<String>,
	message: Option<Message>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Request {
	id: Option<String>,
	entry_timestamp: Option<String>,
	assistant_index: Option<usize>,
	provider: Option<String>,
	model: Option<String>,
	stop_reason: Option<String>,
	usage: Option<Usage>,
	timestamp: Option<serde_json::Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Session {
	chat_id: String,
	forked: bool,
	started_at: Option<String>,
	requests: Vec<Request>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaJob {
	id: String,
	#[serde(skip_serializing)] status: String,
	#[serde(skip_serializing)] remote_status: Option<String>,
	service_id: String,
	service_name: String,
	model_id: String,
	project_root: Option<String>,
	created_at: u64,
	completed_at: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Statistics { sessions: Vec<Session>, skipped_sessions: usize, images: Vec<MediaJob>, videos: Vec<MediaJob>, skipped_media: usize }

#[tauri::command]
pub async fn read_session_statistics(app: tauri::AppHandle, targets: Vec<Target>) -> Result<Statistics, String> {
	if targets.len() > 10000 { return Err("会话索引过大".into()); }
	let root = crate::get_pi_agent_dir().map(|root| root.join("sessions"));
	let generation = crate::generation::data_dir(&app).ok();
	tauri::async_runtime::spawn_blocking(move || read_statistics(root.as_deref(), generation.as_deref(), targets))
		.await.map_err(|_| "无法读取会话统计".into())
}

fn read_statistics(root: Option<&Path>, generation: Option<&Path>, targets: Vec<Target>) -> Statistics {
	let root = root.and_then(|root| root.canonicalize().ok());
	let mut seen = HashSet::new();
	let mut skipped_sessions = 0;
	let mut sessions = Vec::new();
	for target in targets {
		let result = (|| {
			let root = root.as_ref()?;
			let file = root.join(&target.session_file).canonicalize().ok()?;
			if !file.starts_with(root) || file.extension()?.to_str()? != "jsonl" { return None; }
			if seen.contains(&file) { return Some(None); }
			let session = read_session(&file, target).ok()?;
			seen.insert(file);
			Some(Some(session))
		})();
		match result { Some(Some(session)) => sessions.push(session), Some(None) => {}, None => skipped_sessions += 1 }
	}
	let ((images, bad_images), (videos, bad_videos)) = generation.map_or(((vec![], 1), (vec![], 1)), |dir| (
		read_media(&dir.join(crate::generation::IMAGE_JOBS_DIR), false),
		read_media(&dir.join(crate::video_generation::VIDEO_JOBS_DIR), true),
	));
	Statistics { sessions, skipped_sessions, images, videos, skipped_media: bad_images + bad_videos }
}

fn complete_line(reader: &mut impl BufRead, line: &mut Vec<u8>) -> Result<bool, ()> {
	line.clear();
	let size = reader.take(MAX_LINE + 1).read_until(b'\n', line).map_err(|_| ())?;
	if size as u64 > MAX_LINE { return Err(()); }
	// Only pi's complete writes are visible; an append in progress can be read on refresh.
	Ok(line.last() == Some(&b'\n'))
}

fn read_session(file: &Path, target: Target) -> Result<Session, ()> {
	let meta = fs::metadata(file).map_err(|_| ())?;
	if !meta.is_file() { return Err(()); }
	let handle = File::open(file).map_err(|_| ())?;
	let mut reader = BufReader::new(handle.take(meta.len()));
	let mut line = Vec::new();
	if !complete_line(&mut reader, &mut line)? { return Err(()); }
	let header: Header = serde_json::from_slice(&line).map_err(|_| ())?;
	let version = header.version.unwrap_or(1);
	let cwd = Path::new(&target.cwd);
	let cwd_matches = cwd.is_absolute() && header.cwd.is_absolute() && (cwd == header.cwd
		|| cwd.canonicalize().ok().zip(header.cwd.canonicalize().ok()).is_some_and(|(expected, actual)| expected == actual));
	if header.kind != "session" || header.id.is_empty() || !cwd_matches || !(1..=3).contains(&version) { return Err(()); }
	let mut requests = Vec::new();
	let mut nodes = HashMap::new();
	let mut leaf = None;
	while complete_line(&mut reader, &mut line)? {
		if line.iter().all(u8::is_ascii_whitespace) { continue; }
		let entry: Entry = serde_json::from_slice(&line).map_err(|_| ())?;
		let mut request_index = None;
		if let Some(message) = entry.message.filter(|message| entry.kind == "message" && message.role == "assistant") {
			let timestamp = match message.timestamp {
				Some(Timestamp::Millis(value)) => Some(value.into()),
				Some(Timestamp::Iso(value)) => Some(value.into()),
				None => entry.timestamp.as_ref().map(|value| value.as_str().into()),
			};
			request_index = Some(requests.len());
			requests.push(Request { id: entry.id.clone(), entry_timestamp: entry.timestamp, assistant_index: (version == 1).then_some(requests.len()),
				provider: message.provider, model: message.model, stop_reason: message.stop_reason, usage: message.usage, timestamp });
		}
		if version > 1 {
			let id = entry.id.ok_or(())?;
			if entry.parent_id.as_ref().is_some_and(|id| !nodes.contains_key(id)) { return Err(()); }
			if nodes.insert(id.clone(), (entry.parent_id, request_index)).is_some() { return Err(()); }
			leaf = Some(id);
		}
	}
	// Charge all physical requests, even those on abandoned branches. Ordinal-based
	// route/price snapshots are valid only for replies on the current branch.
	let mut indices = Vec::new();
	let mut cursor = leaf.as_ref();
	while let Some(id) = cursor {
		let (parent, index) = &nodes[id];
		if let Some(index) = index { indices.push(*index); }
		cursor = parent.as_ref();
	}
	for (ordinal, index) in indices.into_iter().rev().enumerate() { requests[index].assistant_index = Some(ordinal); }
	Ok(Session { chat_id: target.chat_id, forked: header.parent_session.is_some(), started_at: header.timestamp, requests })
}

fn read_media(dir: &Path, video: bool) -> (Vec<MediaJob>, usize) {
	let entries = match fs::read_dir(dir) {
		Ok(entries) => entries,
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => return (vec![], 0),
		Err(_) => return (vec![], 1),
	};
	let mut jobs = Vec::new();
	let mut skipped = 0;
	for entry in entries {
		let Ok(entry) = entry else { skipped += 1; continue; };
		if entry.path().extension().and_then(|ext| ext.to_str()) != Some("json") { continue; }
		let job = entry.file_type().ok().filter(|kind| kind.is_file()).and_then(|_| File::open(entry.path()).ok())
			.and_then(|file| serde_json::from_reader::<_, MediaJob>(BufReader::new(file.take(1024 * 1024))).ok());
		match job {
			Some(job) if job.status == "completed" || (video && job.remote_status.as_deref() == Some("completed")) => jobs.push(job),
			Some(_) => {},
			None => skipped += 1,
		}
	}
	(jobs, skipped)
}

#[cfg(test)]
mod tests {
	use super::*;
	use serde_json::json;

	#[test]
	fn reads_all_pi_branches_but_only_indexes_the_active_branch_and_projects_no_content() {
		let base = std::env::temp_dir().join(format!("skiff-statistics-{}", uuid::Uuid::new_v4()));
		let root = base.join("sessions");
		let project = base.join("project");
		let generation = base.join("generation");
		fs::create_dir_all(&root).unwrap();
		for dir in [crate::generation::IMAGE_JOBS_DIR, crate::video_generation::VIDEO_JOBS_DIR] { fs::create_dir_all(generation.join(dir)).unwrap(); }
		let header = json!({"type":"session", "version":3, "id":"session-id", "cwd":project, "timestamp":"2026-01-01T00:00:00.000Z"});
		let assistant = |id: &str, parent: &str, timestamp| json!({"type":"message", "id":id,"parentId":parent,"timestamp":"2026-01-01T00:00:01.000Z","message": {
			"role":"assistant","provider":"relay-key","model":"model-a","timestamp":timestamp,"usage":{"input":10,"cacheRead":20,"cacheWrite":3,"output":7},"content":"not projected"
		}});
		let rows = [header, json!({"type":"message","id":"user-a","parentId":null,"message":{"role":"user","content":"private prompt"}}),
			assistant("old", "user-a", 10), assistant("new", "user-a", 11), assistant("active", "new", 12),
			json!({"type":"compaction","id":"summary","parentId":"active","summary":"private summary"})];
		let content = rows.iter().map(|row| format!("{row}\n")).collect::<String>() + "{\"type\":\"message\"";
		fs::write(root.join("valid.jsonl"), &content).unwrap();
		fs::write(base.join("outside.jsonl"), &content).unwrap();
		fs::write(root.join("broken.jsonl"), format!("{}\n{{broken}}\n", rows[0])).unwrap();
		let fixture = |dir, id: &str, status: &str, remote| {
			let path = generation.join(dir).join(format!("{id}.json"));
			fs::write(path, json!({"id":id,"status":status,"remoteStatus":remote,"serviceId":"service","serviceName":"Test Service",
				"modelId":"media-model","projectRoot":project,"createdAt":123,"completedAt":456,"removed":true,"prompt":"private media prompt","usage":{"cost":100}}).to_string()).unwrap();
		};
		fixture(crate::generation::IMAGE_JOBS_DIR, "image-ok", "completed", None::<&str>);
		fixture(crate::generation::IMAGE_JOBS_DIR, "image-failed", "failed", None);
		fixture(crate::video_generation::VIDEO_JOBS_DIR, "video-ok", "download_failed", Some("completed"));
		fixture(crate::video_generation::VIDEO_JOBS_DIR, "video-pending", "queued", None);
		fs::write(generation.join(crate::generation::IMAGE_JOBS_DIR).join("corrupt.json"), "bad").unwrap();
		let target = |chat: &str, file: &str, cwd: &Path| Target { chat_id: chat.into(), session_file: file.into(), cwd: cwd.to_string_lossy().into() };
		let output = read_statistics(Some(&root), Some(&generation), vec![
			target("mismatch", "valid.jsonl", &base), target("chat", root.join("valid.jsonl").to_str().unwrap(), &project), target("dup", "valid.jsonl", &project),
			target("outside", "../outside.jsonl", &project), target("bad", "broken.jsonl", &project), target("stale", "missing.jsonl", &project),
		]);
		assert_eq!(output.skipped_sessions, 4);
		assert_eq!(output.skipped_media, 1);
		assert_eq!(output.sessions.len(), 1);
		assert_eq!(output.sessions[0].chat_id, "chat");
		let rows = &output.sessions[0].requests;
		assert_eq!(rows.iter().map(|row| row.assistant_index).collect::<Vec<_>>(), vec![None, Some(0), Some(1)]);
		assert_eq!(rows[0].usage.as_ref().unwrap().cache_write, Some(3));
		assert_eq!(rows[2].timestamp, Some(12.into()));
		assert_eq!(output.images.iter().map(|job| job.id.as_str()).collect::<Vec<_>>(), vec!["image-ok"]);
		assert_eq!(output.videos.iter().map(|job| job.id.as_str()).collect::<Vec<_>>(), vec!["video-ok"]);
		let transport = serde_json::to_string(&output).unwrap();
		assert!(!transport.contains("private") && !transport.contains("not projected") && !transport.contains("cost"));
		fs::remove_dir_all(&base).unwrap();
	}
}
