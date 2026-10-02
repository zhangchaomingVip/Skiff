use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};

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
	pi_path: Option<String>,
	cwd: Option<String>,
	env: Option<HashMap<String, String>>,
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
	let instance_id = "main".to_string();

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
	for arg in &prefix_args {
		cmd.arg(arg);
	}
	cmd.arg("--mode").arg("rpc");
	if let Some(cwd) = &options.cwd {
		cmd.current_dir(cwd);
	}
	if let Some(env) = &options.env {
		for (k, v) in env {
			cmd.env(k, v);
		}
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
			let _ = Command::new("taskkill")
				.args(["/F", "/T", "/PID", &pid])
				.output();
		}
		let _ = child.kill();
	}
	Ok(())
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
	let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
	Some(PathBuf::from(home).join(".pi").join("agent"))
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	tauri::Builder::default()
		.manage(AppState::default())
		.invoke_handler(tauri::generate_handler![
			rpc_start,
			rpc_send,
			rpc_stop,
			get_pi_auth_status
		])
		.run(tauri::generate_context!())
		.expect("error while running Skiff");
}
