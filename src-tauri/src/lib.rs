use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, State};

mod crypto;
mod families;
mod providers;
mod search;

/// One spawned `pi --mode rpc` session. `child` is kept only so we can kill it
/// on stop; `stdin` is shared with the reader threads so we can write lines.
struct Proc {
	child: Mutex<Child>,
	stdin: Arc<Mutex<ChildStdin>>,
}

#[derive(Default)]
struct AppState {
	sessions: Mutex<HashMap<String, Proc>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RpcStartOptions {
	instance_id: Option<String>,
	pi_path: Option<String>,
	cwd: Option<String>,
	env: Option<HashMap<String, String>>,
	/// Forwarded to pi as `--append-system-prompt`; this is the user's editable
	/// instructions plus Skiff's built-in narration hint.
	append_system_prompt: Option<String>,
}

/// Locate the `pi` launcher. Returns the program to run plus any prefix
/// arguments needed on this platform. On Windows the npm shim is a `.cmd`
/// file, which `CreateProcess` cannot execute directly, so we route it
/// through `cmd /C`.
fn resolve_pi(explicit: Option<&str>) -> (String, Vec<String>) {
	let requested = explicit
		.map(|s| s.to_string())
		.or_else(|| std::env::var("SKIFF_PI_PATH").ok())
		.or_else(|| std::env::var("PI_CLI_PATH").ok());

	let resolved = match requested {
		Some(candidate) => {
			let path = PathBuf::from(&candidate);
			if path.is_file() {
				Some(path)
			} else {
				find_on_path(&candidate).or_else(|| find_on_path("pi"))
			}
		}
		None => find_on_path("pi"),
	};

	let Some(path) = resolved else {
		return ("pi".to_string(), Vec::new());
	};

	#[cfg(windows)]
	{
		let ext = path
			.extension()
			.and_then(|e| e.to_str())
			.unwrap_or("")
			.to_ascii_lowercase();
		if ext == "cmd" || ext == "bat" {
			return (
				"cmd".to_string(),
				vec!["/C".to_string(), path.to_string_lossy().to_string()],
			);
		}
	}

	(path.to_string_lossy().to_string(), Vec::new())
}

/// Search PATH (honouring `PATHEXT` on Windows) plus the npm global bin dir
/// and pi's own bin dir for an executable named `name`.
fn find_on_path(name: &str) -> Option<PathBuf> {
	let path_var = std::env::var_os("PATH")?;

	#[cfg(windows)]
	let exts: Vec<String> = std::env::var("PATHEXT")
		.unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string())
		.split(';')
		.filter(|s| !s.is_empty())
		.map(|s| s.to_ascii_lowercase())
		.collect();
	#[cfg(not(windows))]
	let exts: Vec<String> = vec![String::new()];

	let mut dirs: Vec<PathBuf> = std::env::split_paths(&path_var).collect();
	if let Some(appdata) = std::env::var_os("APPDATA") {
		dirs.push(PathBuf::from(appdata).join("npm"));
	}
	if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
		dirs.push(PathBuf::from(home).join(".pi").join("agent").join("bin"));
	}

	for dir in dirs {
		for ext in &exts {
			let candidate = dir.join(format!("{name}{ext}"));
			if candidate.is_file() {
				return Some(candidate);
			}
		}
	}
	None
}

#[tauri::command]
fn rpc_start(app: AppHandle, state: State<AppState>, options: RpcStartOptions) -> Result<(), String> {
	let instance_id = options.instance_id.unwrap_or_else(|| "main".to_string());
	if let Some(cwd) = &options.cwd {
		if !PathBuf::from(cwd).is_dir() {
			return Err("项目目录不存在或不是文件夹".to_string());
		}
	}

	// Replace any existing session for this id. Dev reloads / StrictMode
	// remounts would otherwise orphan the previous `pi` process tree.
	if let Ok(mut sessions) = state.sessions.lock() {
		if let Some(previous) = sessions.remove(&instance_id) {
			if let Ok(mut child) = previous.child.lock() {
				#[cfg(windows)]
				{
					let pid = child.id().to_string();
					let _ = Command::new("taskkill")
						.args(["/F", "/T", "/PID", &pid])
						.output();
				}
				let _ = child.kill();
			}
		}
	}

	let (program, prefix_args) = resolve_pi(options.pi_path.as_deref());

	let mut cmd = Command::new(&program);
	#[cfg(windows)]
	{
		use std::os::windows::process::CommandExt;
		cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
	}
	for arg in &prefix_args {
		cmd.arg(arg);
	}
	cmd.arg("--mode").arg("rpc");
	if let Some(prompt) = options.append_system_prompt.as_deref() {
		if !prompt.trim().is_empty() {
			cmd.arg("--append-system-prompt").arg(prompt);
		}
	}
	if let Some(cwd) = &options.cwd {
		cmd.current_dir(cwd);
	}
	if let Some(env) = &options.env {
		for (k, v) in env {
			cmd.env(k, v);
		}
	}
	if let Some(dir) = get_pi_agent_dir() {
		families::prepare_runtime(&dir, &mut cmd)?;
	}
	cmd.stdin(Stdio::piped())
		.stdout(Stdio::piped())
		.stderr(Stdio::piped());

	let mut child = cmd
		.spawn()
		.map_err(|e| format!("failed to spawn `{program}`: {e}"))?;
	let stdin = Arc::new(Mutex::new(
		child.stdin.take().ok_or_else(|| "child has no stdin".to_string())?,
	));
	let stdout = child.stdout.take().ok_or_else(|| "child has no stdout".to_string())?;
	let stderr = child.stderr.take().ok_or_else(|| "child has no stderr".to_string())?;

	// stdout -> `rpc://<id>` events
	let app_out = app.clone();
	let id_out = instance_id.clone();
	std::thread::spawn(move || {
		let reader = std::io::BufReader::new(stdout);
		for line in reader.lines().flatten() {
			let _ = app_out.emit(&format!("rpc://{id_out}"), line);
		}
		let _ = app_out.emit(&format!("rpc://{id_out}"), serde_json::json!({
			"type": "bridge_exit",
			"message": "pi 进程已退出，请检查 pi 安装与配置后重新连接。"
		}).to_string());
	});

	// stderr -> `rpc-stderr://<id>` events (surfaced for debugging)
	let app_err = app.clone();
	let id_err = instance_id.clone();
	std::thread::spawn(move || {
		let reader = std::io::BufReader::new(stderr);
		for line in reader.lines().flatten() {
			let _ = app_err.emit(&format!("rpc-stderr://{id_err}"), line);
		}
	});

	state
		.sessions
		.lock()
		.map_err(|_| "session lock poisoned".to_string())?
		.insert(instance_id, Proc { child: Mutex::new(child), stdin });

	Ok(())
}

#[tauri::command]
fn rpc_send(state: State<AppState>, instance_id: String, message: String) -> Result<(), String> {
	let guard = state
		.sessions
		.lock()
		.map_err(|_| "session lock poisoned".to_string())?;
	let proc = guard.get(&instance_id).ok_or_else(|| "no such session".to_string())?;
	let mut stdin = proc.stdin.lock().map_err(|_| "stdin lock poisoned".to_string())?;
	stdin
		.write_all(message.as_bytes())
		.map_err(|e| e.to_string())?;
	stdin.write_all(b"\n").map_err(|e| e.to_string())?;
	stdin.flush().map_err(|e| e.to_string())?;
	Ok(())
}

#[tauri::command]
fn rpc_stop(state: State<AppState>, instance_id: String) -> Result<(), String> {
	let mut guard = state
		.sessions
		.lock()
		.map_err(|_| "session lock poisoned".to_string())?;
	if let Some(proc) = guard.remove(&instance_id) {
		let mut child = proc
			.child
			.lock()
			.map_err(|_| "child lock poisoned".to_string())?;
		#[cfg(windows)]
		{
			// Kill the whole tree: `pi` may be a `cmd /C` wrapper around node.
			let pid = child.id().to_string();
			let mut kill = Command::new("taskkill");
			use std::os::windows::process::CommandExt;
			kill.creation_flags(0x08000000);
			let _ = kill.args(["/F", "/T", "/PID", &pid]).output();
		}
		let _ = child.kill();
		let _ = child.wait();
	}
	Ok(())
}

#[derive(serde::Serialize)]
struct ProjectDirectory {
	name: String,
	path: String,
}

#[tauri::command]
fn validate_project_directory(path: String) -> Result<ProjectDirectory, String> {
	let directory = PathBuf::from(path.trim());
	if !directory.is_absolute() || !directory.is_dir() {
		return Err("请输入存在的文件夹的绝对路径".to_string());
	}
	let canonical = std::fs::canonicalize(directory).map_err(|e| e.to_string())?;
	let mut path = canonical.to_string_lossy().to_string();
	#[cfg(windows)]
	{
		if let Some(unc) = path.strip_prefix("\\\\?\\UNC\\") {
			path = format!("\\\\{unc}");
		} else if let Some(local) = path.strip_prefix("\\\\?\\") {
			path = local.to_string();
		}
	}
	Ok(ProjectDirectory {
		name: canonical.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path.clone()),
		path,
	})
}

#[tauri::command]
fn get_workspace_directory() -> Result<ProjectDirectory, String> {
	let mut directory = std::env::current_dir().map_err(|e| e.to_string())?;
	if directory.file_name().is_some_and(|n| n == "src-tauri") && directory.join("tauri.conf.json").is_file() {
		directory.pop();
	}
	validate_project_directory(directory.to_string_lossy().to_string())
}

// --- auth.json reader (mirrors pi-desktop) ---------------------------------

#[derive(serde::Serialize)]
struct ProviderStatus {
	provider: String,
	source: String,
	kind: String,
}

#[derive(serde::Serialize)]
struct AuthStatus {
	agent_dir: Option<String>,
	auth_file: Option<String>,
	auth_file_exists: bool,
	configured_providers: Vec<ProviderStatus>,
}

/// `~/.pi/agent` on every platform (HOME on *nix, USERPROFILE on Windows).
fn get_pi_agent_dir() -> Option<PathBuf> {
	#[cfg(windows)]
	let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"));
	#[cfg(not(windows))]
	let home = std::env::var_os("HOME");
	if let Some(path) = std::env::var_os("PI_CODING_AGENT_DIR") {
		let text = path.to_string_lossy();
		if text == "~" { return home.map(PathBuf::from); }
		if text.starts_with("~/") || text.starts_with("~\\") { return home.map(|home| PathBuf::from(home).join(&text[2..])); }
		return Some(PathBuf::from(path));
	}
	Some(PathBuf::from(home?).join(".pi").join("agent"))
}

#[tauri::command]
fn get_pi_auth_status() -> Result<AuthStatus, String> {
	let agent_dir = get_pi_agent_dir();
	let auth_path = agent_dir.as_ref().map(|d| d.join("auth.json"));
	let auth_file_exists = auth_path
		.as_ref()
		.map(|p| p.exists() && p.is_file())
		.unwrap_or(false);

	let mut configured_providers = Vec::new();
	if let Some(path) = &auth_path {
		if let Ok(content) = std::fs::read_to_string(path) {
			if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
				if let Some(map) = parsed.as_object() {
					for (provider, cred) in map {
						let kind = cred
							.get("type")
							.and_then(|v| v.as_str())
							.unwrap_or("unknown")
							.to_string();
						let source = if kind == "oauth" {
							"auth_file_oauth"
						} else {
							"auth_file_api_key"
						}
						.to_string();
						configured_providers.push(ProviderStatus {
							provider: provider.clone(),
							source,
							kind,
						});
					}
				}
			}
		}
	}
	configured_providers.sort_by(|a, b| a.provider.cmp(&b.provider));

	Ok(AuthStatus {
		agent_dir: agent_dir.map(|p| p.to_string_lossy().to_string()),
		auth_file: auth_path.map(|p| p.to_string_lossy().to_string()),
		auth_file_exists,
		configured_providers,
	})
}

#[derive(serde::Serialize)]
struct SystemPromptSection {
	name: String,
	text: String,
}

/// Read the newest system-prompt snapshot from a pi session file (`.jsonl`).
/// pi stores the assembled prompt as `message.sections`; this is read-only.
#[tauri::command]
fn read_system_prompt(session_path: String) -> Result<Vec<SystemPromptSection>, String> {
	let text = std::fs::read_to_string(&session_path).map_err(|e| format!("读取会话文件失败：{e}"))?;
	for line in text.lines().rev() {
		let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else { continue };
		let Some(message) = value.get("message") else { continue };
		if message.get("role").and_then(|role| role.as_str()) != Some("system") { continue; }
		if let Some(sections) = message.get("sections").and_then(|sections| sections.as_object()) {
			return Ok(sections
				.iter()
				.filter_map(|(name, value)| value.as_str().map(|prompt| SystemPromptSection { name: name.clone(), text: prompt.to_string() }))
				.collect());
		}
	}
	Err("该会话还没有系统提示词快照".to_string())
}

/// Opens a http(s) link in the system browser, for vendor consoles linked
/// from the provider editor. Webview navigation would leave the app, so the
/// shell delegates to the OS instead.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
	let trimmed = url.trim();
	if !trimmed.starts_with("https://") && !trimmed.starts_with("http://") {
		return Err("仅支持 http/https 链接".to_string());
	}
	open::that(trimmed).map_err(|e| format!("打开链接失败：{e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	tauri::Builder::default()
		.manage(AppState::default())
		.invoke_handler(tauri::generate_handler![
			rpc_start,
			rpc_send,
			rpc_stop,
			open_url,
			get_pi_auth_status,
			validate_project_directory,
			get_workspace_directory,
			read_system_prompt,
			families::list_model_families, families::list_model_runtime,
			families::save_relay, families::delete_relay, families::set_relay_enabled,
			families::save_route, families::delete_route, families::reorder_routes,
			families::set_default_route, families::set_family_auto_failover, families::set_family_auto_retry,
			families::test_provider_connection, families::cancel_provider_test, families::discover_relay_models,
			families::fetch_pricing_page, families::extract_pricing_table,
			families::fetch_public_catalog, families::set_usd_cny_rate,
			search::get_web_search_status, search::save_web_search_key, search::clear_web_search_key, search::install_web_search_extension
		])
		.on_window_event(|window, event| {
			if matches!(event, tauri::WindowEvent::Destroyed) {
				let state = window.state::<AppState>();
				let ids = state.sessions.lock().map(|s| s.keys().cloned().collect::<Vec<_>>()).unwrap_or_default();
				for id in ids { let _ = rpc_stop(window.state::<AppState>(), id); }
			}
		})
		.run(tauri::generate_context!())
		.expect("error while running Skiff");
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn rejects_relative_and_file_project_paths() {
		assert!(validate_project_directory("src".into()).is_err());
		assert!(validate_project_directory("".into()).is_err());
		let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml");
		assert!(validate_project_directory(manifest.to_string_lossy().into()).is_err());
	}

	#[test]
	fn reads_the_latest_system_prompt_snapshot() {
		let mut path = std::env::temp_dir();
		path.push(format!("skiff-system-prompt-{}.jsonl", std::process::id()));
		let lines = [
			serde_json::json!({"message": {"role": "user", "content": "hi"}}).to_string(),
			serde_json::json!({"message": {"role": "system", "sections": {"preamble": "first"}}}).to_string(),
			serde_json::json!({"message": {"role": "system", "sections": {"preamble": "second", "cwd": "D:/x"}}}).to_string(),
		];
		std::fs::write(&path, lines.join("\n")).unwrap();
		let sections = read_system_prompt(path.to_string_lossy().into()).unwrap();
		let map: std::collections::HashMap<_, _> = sections.into_iter().map(|s| (s.name, s.text)).collect();
		assert_eq!(map.get("preamble").map(String::as_str), Some("second"));
		assert_eq!(map.get("cwd").map(String::as_str), Some("D:/x"));
		assert!(read_system_prompt(path.with_extension("missing").to_string_lossy().into()).is_err());
		let _ = std::fs::remove_file(&path);
	}

	#[test]
	fn project_paths_are_canonical_and_have_a_display_name() {
		let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
		let project = validate_project_directory(root.to_string_lossy().into()).unwrap();
		assert!(PathBuf::from(&project.path).is_absolute());
		assert!(PathBuf::from(&project.path).is_dir());
		assert!(!project.name.is_empty());
		assert!(!project.path.starts_with("\\\\?\\"));
	}
}
