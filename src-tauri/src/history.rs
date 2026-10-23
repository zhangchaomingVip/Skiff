//! Restricted, read-only search projection. Never switches a running pi session.
use std::{collections::{HashMap, HashSet}, fs, hash::{Hash, Hasher}, io::Read, path::{Path, PathBuf}, sync::Mutex};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryTarget { chat_id: String, session_file: String, cwd: String }
#[derive(Default)]
pub struct HistoryWorkspace(Mutex<HashMap<String, HistoryTarget>>);
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryMessage { entry_id: String, role: String, text: String, timestamp: Option<Value> }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryProjection { version: String, messages: Vec<HistoryMessage>, unchanged: bool }

#[tauri::command]
pub fn set_history_workspace(state: tauri::State<'_, HistoryWorkspace>, targets: Vec<HistoryTarget>) -> Result<(), String> {
	if targets.len() > 10000 { return Err("会话索引过大".into()); }
	*state.0.lock().map_err(|_| "历史索引不可用")? = targets.into_iter().map(|target| (target.chat_id.clone(), target)).collect();
	Ok(())
}

#[tauri::command]
pub async fn read_session_history(state: tauri::State<'_, HistoryWorkspace>, chat_id: String, session_file: String, known_version: Option<String>) -> Result<HistoryProjection, String> {
	let target = state.0.lock().map_err(|_| "历史索引不可用")?.get(&chat_id).filter(|target| target.session_file == session_file).cloned().ok_or("会话不在当前工作区索引中")?;
	let root = crate::get_pi_agent_dir().ok_or("无法定位 pi 数据目录")?.join("sessions");
	tauri::async_runtime::spawn_blocking(move || read_history(&root, &target, known_version.as_deref())).await.map_err(|_| "历史读取任务失败")?
}

/// Permanently removes one pi session file. There is no trash or undo, so the
/// target must stay inside the pi sessions directory and keep the `.jsonl`
/// shape pi writes; anything else (relative escapes, symlinks, folders) is
/// rejected before touching the disk.
#[tauri::command]
pub fn delete_session_file(session_file: String) -> Result<(), String> {
	let root = crate::get_pi_agent_dir().ok_or("无法定位 pi 数据目录")?.join("sessions");
	purge_session_file(&root, &session_file)
}

fn purge_session_file(root: &Path, session_file: &str) -> Result<(), String> {
	let root = root.canonicalize().map_err(|_| "pi 会话目录不存在")?;
	let candidate = PathBuf::from(session_file);
	let candidate = if candidate.is_absolute() { candidate } else { root.join(candidate) };
	// Deleting is idempotent: a transcript that pi already pruned is still a
	// successful permanent delete, otherwise one stale index entry would block
	// removing a whole project.
	let Ok(file) = candidate.canonicalize() else { return Ok(()) };
	// Canonicalizing first resolves symlinks, so the containment check below
	// also rejects links that point outside the sessions directory.
	if !file.starts_with(&root) || file.extension().and_then(|v| v.to_str()) != Some("jsonl") { return Err("会话文件超出允许目录或格式不受支持".into()); }
	if !file.is_file() { return Err("会话路径不是文件".into()); }
	fs::remove_file(&file).map_err(|error| format!("删除会话文件失败：{error}"))
}

fn stamp(meta: &fs::Metadata) -> String { format!("{}:{:?}:{:?}", meta.len(), meta.modified().ok(), meta.created().ok()) }
fn digest(bytes: &[u8]) -> String { let mut hash = std::collections::hash_map::DefaultHasher::new(); bytes.hash(&mut hash); format!("{:016x}", hash.finish()) }

fn read_history(root: &Path, target: &HistoryTarget, known: Option<&str>) -> Result<HistoryProjection, String> {
	let root = root.canonicalize().map_err(|_| "pi 历史目录不存在")?;
	let candidate = PathBuf::from(&target.session_file);
	let candidate = if candidate.is_absolute() { candidate } else { root.join(candidate) };
	let file = candidate.canonicalize().map_err(|_| "历史文件不存在")?;
	if !file.starts_with(&root) || file.extension().and_then(|v| v.to_str()) != Some("jsonl") { return Err("历史文件超出允许目录或格式不受支持".into()); }
	for _ in 0..2 {
		let mut handle = fs::File::open(&file).map_err(|_| "无法读取历史文件")?;
		let before = handle.metadata().map_err(|_| "无法检查历史文件")?;
		if !before.is_file() || before.len() > 64 * 1024 * 1024 { return Err("历史不是普通文件或超过 64 MiB 读取上限".into()); }
		let mut bytes = Vec::with_capacity(before.len() as usize);
		handle.by_ref().take(64 * 1024 * 1024 + 1).read_to_end(&mut bytes).map_err(|_| "历史读取失败")?;
		let after = handle.metadata().map_err(|_| "历史读取期间文件失效")?;
		let current = fs::metadata(&file).map_err(|_| "历史读取期间文件失效")?;
		if stamp(&before) != stamp(&after) || stamp(&after) != stamp(&current) || bytes.len() as u64 != after.len() || candidate.canonicalize().ok().as_ref() != Some(&file) { continue; }
		let version = format!("{}:{}", stamp(&after), digest(&bytes));
		if known == Some(version.as_str()) {
			let end = bytes.iter().position(|byte| *byte == b'\n').ok_or("历史缺少完整会话头")?;
			let header = serde_json::from_slice::<Value>(&bytes[..end]).map_err(|_| "历史会话头无效")?;
			validate_header(&header, Path::new(&target.cwd))?;
			return Ok(HistoryProjection { unchanged: true, messages: vec![], version });
		}
		let messages = parse_history(&bytes, Path::new(&target.cwd))?;
		return Ok(HistoryProjection { unchanged: false, messages, version });
	}
	Err("历史文件正在变化，请重试检索".into())
}

fn validate_header(header: &Value, cwd: &Path) -> Result<u64, String> {
	let version = match header.get("version") { None => 1, Some(value) => value.as_u64().ok_or("历史版本格式无效")? };
	if header["type"] != "session" || header["id"].as_str().filter(|v| !v.is_empty()).is_none() || !(1..=3).contains(&version) { return Err("历史会话头或版本不受支持".into()); }
	let project = cwd.canonicalize().map_err(|_| "项目目录不存在")?;
	let header_cwd = header["cwd"].as_str().map(PathBuf::from).and_then(|path| path.canonicalize().ok()).ok_or("历史会话缺少有效项目目录")?;
	if project != header_cwd { return Err("历史会话的项目目录不匹配".into()); }
	Ok(version)
}

fn parse_history(bytes: &[u8], cwd: &Path) -> Result<Vec<HistoryMessage>, String> {
	// Ignore only the final, incomplete append. Malformed complete lines are errors.
	let complete = bytes.iter().rposition(|v| *v == b'\n').map(|index| &bytes[..=index]).ok_or("历史缺少完整会话头")?;
	let text = std::str::from_utf8(complete).map_err(|_| "历史不是有效 UTF-8")?;
	let mut rows = Vec::new();
	for line in text.lines().filter(|line| !line.trim().is_empty()) { rows.push(serde_json::from_str::<Value>(line).map_err(|_| "历史包含损坏的完整 JSON 行")?); }
	let header = rows.first().ok_or("历史为空")?;
	let version = validate_header(header, cwd)?;
	let mut index = HashMap::new();
	for (position, entry) in rows.iter().enumerate().skip(1) {
		if entry["type"] == "session" || entry["type"].as_str().is_none() { return Err("历史条目格式无效".into()); }
		if version > 1 {
			let id = entry["id"].as_str().filter(|v| !v.is_empty()).ok_or("历史条目缺少 ID")?;
			if index.insert(id, position).is_some() { return Err("历史条目 ID 重复".into()); }
			match entry.get("parentId") {
				Some(Value::Null) => {},
				Some(Value::String(parent)) if index.get(parent.as_str()).is_some_and(|parent_position| *parent_position < position) => {},
				_ => return Err("历史分支断链".into()),
			}
		}
	}
	let mut branch = Vec::new();
	if version == 1 { branch.extend(1..rows.len()); }
	else if rows.len() > 1 {
		let mut cursor = Some(rows.len() - 1);
		let mut seen = HashSet::new();
		while let Some(position) = cursor {
			if !seen.insert(position) { return Err("历史分支循环".into()); }
			branch.push(position);
			cursor = rows[position]["parentId"].as_str().map(|id| index[id]);
		}
		branch.reverse();
	}
	let mut messages = Vec::new();
	for position in branch {
		let entry = &rows[position];
		if entry["type"] != "message" { continue; }
		let message = &entry["message"];
		let role = message["role"].as_str().ok_or("历史消息缺少角色")?;
		if role != "user" && role != "assistant" { continue; }
		let text = match &message["content"] {
			Value::String(value) => value.clone(),
			Value::Array(blocks) => blocks.iter().filter(|block| block["type"] == "text").filter_map(|block| block["text"].as_str()).collect::<Vec<_>>().join("\n\n"),
			_ => return Err("历史消息正文格式无效".into()),
		};
		if text.is_empty() { continue; }
		messages.push(HistoryMessage { entry_id: if version == 1 { format!("v1:{position}") } else { entry["id"].as_str().unwrap().to_owned() }, role: role.to_owned(), text, timestamp: message.get("timestamp").filter(|value| value.is_string() || value.is_number()).cloned() });
	}
	Ok(messages)
}

#[cfg(test)]
mod tests {
	use super::*;
	use serde_json::json;
	fn fixture() -> (PathBuf, PathBuf, HistoryTarget) {
		let dir = std::env::temp_dir().join(format!("skiff-history-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
		let sessions = dir.join("sessions"); fs::create_dir_all(&sessions).unwrap();
		let target = HistoryTarget { chat_id: "chat".into(), session_file: sessions.join("test.jsonl").to_string_lossy().into(), cwd: dir.to_string_lossy().into() };
		(dir, sessions, target)
	}
	fn lines(values: Vec<Value>) -> Vec<u8> { values.into_iter().map(|value| format!("{value}\n")).collect::<String>().into_bytes() }
	#[test]
	fn versions_branches_compaction_and_corruption() {
		let (dir, _, _) = fixture();
		for version in [1, 2, 3] {
			let data = lines(vec![json!({"type":"session","id":"s","version":version,"cwd":dir}), json!({"type":"message","id":"a","parentId":null,"message":{"role":"user","content":"before compaction"}}), json!({"type":"message","id":"b","parentId":"a","message":{"role":"assistant","content":[{"type":"thinking","thinking":"excluded"},{"type":"text","text":"old branch"}]}}), json!({"type":"compaction","id":"c","parentId":"a"}), json!({"type":"message","id":"d","parentId":"c","message":{"role":"assistant","content":"current branch"}})]);
			let result = parse_history(&data, &dir).unwrap();
			assert_eq!(result.len(), if version == 1 { 3 } else { 2 });
			assert_eq!(result[0].text, "before compaction");
			assert_eq!(result.last().unwrap().text, "current branch");
			let mut append = data.clone(); append.extend_from_slice(b"{partial"); assert_eq!(parse_history(&append, &dir).unwrap().len(), result.len());
			append.extend_from_slice(b"\n"); assert!(parse_history(&append, &dir).is_err());
			let broken = String::from_utf8(data).unwrap().replace("\"parentId\":\"a\"", "\"parentId\":\"missing\"");
			if version > 1 { assert!(parse_history(broken.as_bytes(), &dir).is_err()); }
		}
		fs::remove_dir_all(dir).unwrap();
	}
	#[test]
	fn restricted_paths_versions_and_project_identity() {
		let (dir, sessions, mut target) = fixture();
		let data = lines(vec![json!({"type":"session","id":"s","version":3,"cwd":dir}), json!({"type":"message","id":"a","parentId":null,"message":{"role":"user","content":"hello"}})]);
		fs::write(&target.session_file, &data).unwrap();
		let first = read_history(&sessions, &target, None).unwrap();
		assert!(read_history(&sessions, &target, Some(&first.version)).unwrap().unchanged);
		fs::write(&target.session_file, [data.as_slice(), b"{incomplete"].concat()).unwrap();
		assert_ne!(read_history(&sessions, &target, None).unwrap().version, first.version);
		assert!(parse_history(&data, &sessions).is_err());
		assert!(parse_history(String::from_utf8(data.clone()).unwrap().replace("\"version\":3", "\"version\":\"3\"").as_bytes(), &dir).is_err());
		let duplicate = lines(vec![json!({"type":"session","id":"s","version":3,"cwd":dir}), json!({"type":"message","id":"a","parentId":null,"message":{"role":"user","content":"first"}}), json!({"type":"message","id":"a","parentId":null,"message":{"role":"user","content":"duplicate"}})]);
		assert!(parse_history(&duplicate, &dir).is_err());
		assert!(parse_history(String::from_utf8(data.clone()).unwrap().replace("\"version\":3", "\"version\":4").as_bytes(), &dir).is_err());
		let outside = dir.join("outside.jsonl"); fs::write(&outside, &data).unwrap(); target.session_file = outside.to_string_lossy().into();
		assert!(read_history(&sessions, &target, None).is_err());
		target.session_file = sessions.join("missing.jsonl").to_string_lossy().into(); assert!(read_history(&sessions, &target, None).is_err());
		target.session_file = sessions.to_string_lossy().into(); assert!(read_history(&sessions, &target, None).is_err());
		fs::remove_dir_all(dir).unwrap();
	}
	#[test]
	fn permanent_delete_is_confined_to_the_sessions_directory() {
		let (dir, sessions, _) = fixture();
		let inside = sessions.join("purge.jsonl"); fs::write(&inside, b"{}\n").unwrap();
		purge_session_file(&sessions, &inside.to_string_lossy()).unwrap();
		assert!(!inside.exists(), "an indexed session file must be removed");
		let outside = dir.join("outside.jsonl"); fs::write(&outside, b"{}\n").unwrap();
		assert!(purge_session_file(&sessions, &outside.to_string_lossy()).is_err());
		assert!(outside.exists(), "files outside the sessions directory must survive");
		let wrong_format = sessions.join("notes.txt"); fs::write(&wrong_format, b"x").unwrap();
		assert!(purge_session_file(&sessions, &wrong_format.to_string_lossy()).is_err());
		assert!(wrong_format.exists());
		assert!(purge_session_file(&sessions, &sessions.join("missing.jsonl").to_string_lossy()).is_ok(), "an already removed transcript must not block the delete");
		assert!(purge_session_file(&sessions, &sessions.to_string_lossy()).is_err());
		assert!(purge_session_file(&sessions, &format!("../{}", outside.file_name().unwrap().to_string_lossy())).is_err());
		assert!(outside.exists(), "relative escapes must not reach files outside the sessions directory");
		fs::remove_dir_all(dir).unwrap();
	}
	#[test]
	fn hundred_session_read_benchmark() {
		let (dir, sessions, target) = fixture();
		let mut targets = Vec::new();
		let mut bytes = 0;
		for session in 0..100 {
			let mut rows = vec![json!({"type":"session","id":format!("s{session}"),"version":3,"cwd":dir})];
			for message in 0..100 {
				rows.push(json!({"type":"message","id":format!("m{message}"),"parentId":if message == 0 { Value::Null } else { json!(format!("m{}",message - 1)) },"message":{"role":if message % 2 == 0 { "user" } else { "assistant" },"content":[{"type":"text","text":format!("session {session} message {message} 普通正文与最终结论")}]}}));
			}
			let data = lines(rows); bytes += data.len();
			let file = sessions.join(format!("s{session}.jsonl")); fs::write(&file, data).unwrap();
			targets.push(HistoryTarget { session_file: file.to_string_lossy().into(), ..target.clone() });
		}
		let start = std::time::Instant::now();
		let versions = targets.iter().map(|target| { let projection = read_history(&sessions, target, None).unwrap(); assert_eq!(projection.messages.len(), 100); projection.version }).collect::<Vec<_>>();
		let cold_ms = start.elapsed().as_secs_f64() * 1000.0;
		let mut samples = Vec::new();
		for _ in 0..20 {
			let start = std::time::Instant::now();
			for (target, version) in targets.iter().zip(&versions) { let projection = read_history(&sessions, target, Some(version)).unwrap(); assert!(projection.unchanged); assert!(projection.messages.is_empty()); }
			samples.push(start.elapsed().as_secs_f64() * 1000.0);
		}
		println!("history_benchmark={}", json!({"sessions":100,"messages":10000,"bytes":bytes,"coldMs":cold_ms,"samples":samples}));
		fs::remove_dir_all(dir).unwrap();
	}
}
