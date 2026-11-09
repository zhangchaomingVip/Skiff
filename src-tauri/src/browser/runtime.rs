//! Bounded native CLI execution. No shell interpolation or inherited browser configuration.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
	path::{Path, PathBuf},
	process::Stdio,
	time::Duration,
};
use tokio::{
	io::{AsyncReadExt, AsyncWriteExt},
	process::Command,
};

pub const VERSION: &str = "0.41.2";
const OUTPUT_LIMIT: usize = 4 * 1024 * 1024;

pub async fn connected(cdp_url: &str) -> bool {
	let Ok(url) = reqwest::Url::parse(cdp_url) else {
		return false;
	};
	if url.scheme() != "ws" || url.host_str() != Some("127.0.0.1") {
		return false;
	}
	let Some(port) = url.port() else {
		return false;
	};
	let Ok(client) = reqwest::Client::builder()
		.no_proxy()
		.timeout(Duration::from_secs(2))
		.redirect(reqwest::redirect::Policy::none())
		.build()
	else {
		return false;
	};
	let Ok(response) = client
		.get(format!("http://127.0.0.1:{port}/json/version"))
		.send()
		.await
	else {
		return false;
	};
	let Ok(json) = response.json::<Value>().await else {
		return false;
	};
	json["webSocketDebuggerUrl"] == cdp_url
}

pub fn resolve_binary(requested: Option<&str>) -> Result<PathBuf, String> {
	let candidate = requested
		.map(PathBuf::from)
		.or_else(|| std::env::var_os("SKIFF_AGENT_BROWSER_PATH").map(PathBuf::from));
	let path = if let Some(candidate) = candidate {
		if !candidate.is_absolute() {
			return Err("浏览器 CLI 路径必须是绝对路径".into());
		}
		candidate
	} else {
		crate::find_on_path("agent-browser")
			.ok_or("未找到 agent-browser，请安装 0.41.2 并重新检测")?
	};
	// npm's Windows shim lives beside node_modules, and postinstall points it at this native binary.
	let path = if matches!(
		path.extension().and_then(|v| v.to_str()),
		Some("cmd" | "bat" | "ps1")
	) {
		path.parent()
			.ok_or("无效 CLI 路径")?
			.join("node_modules/agent-browser/bin/agent-browser-win32-x64.exe")
	} else if path.file_name().and_then(|v| v.to_str()) == Some("agent-browser.js") {
		path.parent()
			.ok_or("无效 CLI 路径")?
			.join("agent-browser-win32-x64.exe")
	} else {
		path
	};
	if !path.is_file() {
		return Err("未找到 agent-browser 原生可执行文件，请检查安装路径".into());
	}
	#[cfg(windows)]
	if path
		.extension()
		.and_then(|v| v.to_str())
		.is_none_or(|ext| !ext.eq_ignore_ascii_case("exe"))
	{
		return Err("请选择 agent-browser 原生 exe 或 npm 启动器".into());
	}
	std::fs::canonicalize(path).map_err(|_| "无法访问浏览器 CLI".into())
}

pub fn clean_command(binary: &Path, cwd: &Path) -> Command {
	let mut command = Command::new(binary);
	command
		.current_dir(cwd)
		.stdin(Stdio::null())
		.stdout(Stdio::piped())
		.stderr(Stdio::piped())
		.kill_on_drop(true);
	for (key, _) in std::env::vars_os() {
		let name = key.to_string_lossy().to_ascii_uppercase();
		if name.starts_with("AGENT_BROWSER_")
			|| [
				"HTTP_PROXY",
				"HTTPS_PROXY",
				"ALL_PROXY",
				"NO_PROXY",
				"BROWSER_USE_API_KEY",
				"BROWSERBASE_API_KEY",
				"BROWSERLESS_API_KEY",
				"KERNEL_API_KEY",
				"AI_GATEWAY_API_KEY",
			]
			.contains(&name.as_str())
		{
			command.env_remove(key);
		}
	}
	command
		.env("AGENT_BROWSER_NO_VERSION_CHECK", "1")
		.env("AGENT_BROWSER_DEFAULT_TIMEOUT", "10000");
	#[cfg(windows)]
	command.creation_flags(0x08000000);
	command
}

async fn bounded_read(mut input: impl tokio::io::AsyncRead + Unpin) -> Result<Vec<u8>, String> {
	let mut output = Vec::new();
	let mut buffer = [0u8; 8192];
	loop {
		let size = input
			.read(&mut buffer)
			.await
			.map_err(|_| "读取浏览器输出失败")?;
		if size == 0 {
			return Ok(output);
		}
		if output.len() + size > OUTPUT_LIMIT {
			return Err("浏览器输出超过 4 MiB 限制".into());
		}
		output.extend_from_slice(&buffer[..size]);
	}
}

pub async fn run(mut command: Command, timeout: Duration) -> Result<Vec<u8>, String> {
	run_with_input(&mut command, timeout, None).await
}

async fn run_with_input(
	command: &mut Command,
	timeout: Duration,
	input: Option<Vec<u8>>,
) -> Result<Vec<u8>, String> {
	if input.is_some() {
		command.stdin(Stdio::piped());
	}
	let mut child = command
		.spawn()
		.map_err(|_| "无法启动浏览器 CLI，请检查可执行文件和权限")?;
	let stdout = child.stdout.take().ok_or("缺少浏览器输出")?;
	let stderr = child.stderr.take().ok_or("缺少浏览器错误输出")?;
	let result = tokio::time::timeout(timeout, async {
		if let Some(input) = input {
			let mut stdin = child.stdin.take().ok_or("缺少浏览器命令输入")?;
			stdin
				.write_all(&input)
				.await
				.map_err(|_| "无法传入浏览器命令")?;
			drop(stdin);
		}
		let (out, _) = tokio::try_join!(bounded_read(stdout), bounded_read(stderr))?;
		let status = child.wait().await.map_err(|_| "等待浏览器 CLI 失败")?;
		if !status.success() {
			// JSON error is inspected by the caller. Never expose raw stderr, which can contain launch configuration.
			if serde_json::from_slice::<Value>(&out).is_err() {
				return Err("浏览器 CLI 执行失败，请检查版本和浏览器安装".into());
			}
		}
		Ok(out)
	})
	.await;
	match result {
		Ok(Ok(output)) => Ok(output),
		failure => {
			let _ = child.kill().await;
			let _ = child.wait().await;
			match failure {
				Ok(Err(error)) => Err(error),
				_ => Err("浏览器命令超时，底层操作状态待核对".into()),
			}
		}
	}
}

#[derive(Clone)]
pub struct Runtime {
	pub binary: PathBuf,
	pub directory: PathBuf,
	pub namespace: String,
	pub session: String,
	pub profile: PathBuf,
	pub idle_ms: u64,
}

#[derive(Clone, Debug)]
pub enum Failure {
	Command(String),
	Uncertain(String),
}
impl From<Failure> for String {
	fn from(error: Failure) -> Self {
		match error {
			Failure::Command(message) | Failure::Uncertain(message) => message,
		}
	}
}

impl Runtime {
	pub fn command(&self, args: &[String]) -> Command {
		let mut command = clean_command(&self.binary, &self.directory);
		command.args([
			"--config",
			"config.json",
			"--namespace",
			&self.namespace,
			"--session",
			&self.session,
			"--json",
		]);
		command.args(args);
		command
	}
	pub async fn call(&self, args: Vec<String>, timeout: Duration) -> Result<Value, Failure> {
		// Batch stdin parses positional arrays without running the global flag parser on page-supplied text.
		let mut command = self.command(&["batch".into(), "--bail".into(), "--omit-command".into()]);
		let bytes = run_with_input(
			&mut command,
			timeout,
			Some(serde_json::to_vec(&vec![args]).unwrap()),
		)
		.await
		.map_err(Failure::Uncertain)?;
		let rows: Value = serde_json::from_slice(&bytes)
			.map_err(|_| Failure::Uncertain("浏览器返回了无效 JSON".into()))?;
		let json = rows
			.as_array()
			.and_then(|rows| rows.first())
			.ok_or_else(|| Failure::Uncertain("浏览器返回了无效批次结果".into()))?;
		if !json["success"].is_boolean() {
			return Err(Failure::Uncertain("浏览器未返回操作终态".into()));
		}
		if json["success"] == false {
			let error = json["error"].as_str().unwrap_or("浏览器操作失败");
			return Err(Failure::Command(error.chars().take(1000).collect()));
		}
		Ok(json["result"].clone())
	}
	pub async fn open(&self) -> Result<Value, String> {
		let args = vec![
			"--profile".into(),
			self.profile.to_string_lossy().into_owned(),
			"--idle-timeout".into(),
			self.idle_ms.to_string(),
			"open".into(),
			"about:blank".into(),
		];
		let bytes = run(self.command(&args), Duration::from_secs(40)).await?;
		let json: Value = serde_json::from_slice(&bytes).map_err(|_| "浏览器返回了无效 JSON")?;
		if json["success"] != true {
			return Err(json["error"]
				.as_str()
				.unwrap_or("浏览器启动失败")
				.chars()
				.take(1000)
				.collect());
		}
		Ok(json["data"].clone())
	}
}

// Retain an actual Windows process handle: a recycled PID can never target another browser.
#[derive(Clone, Serialize, Deserialize)]
pub struct ProcessRecord {
	pub pid: u32,
	pub created: u64,
	pub binary: PathBuf,
}

#[cfg(windows)]
pub struct OwnedDaemon {
	handle: isize,
	pub record: ProcessRecord,
}
#[cfg(windows)]
impl OwnedDaemon {
	pub fn capture(pid: u32, binary: &Path, expected_created: Option<u64>) -> Result<Self, String> {
		use windows_sys::Win32::{
			Foundation::{CloseHandle, FILETIME},
			System::Threading::*,
		};
		unsafe {
			let handle = OpenProcess(
				PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
				0,
				pid,
			);
			if handle.is_null() {
				return Err("浏览器后台进程已退出或不可访问".into());
			}
			let mut path = [0u16; 32768];
			let mut size = path.len() as u32;
			let mut created: FILETIME = std::mem::zeroed();
			let mut exited = created;
			let mut kernel = created;
			let mut user = created;
			let valid = QueryFullProcessImageNameW(handle, 0, path.as_mut_ptr(), &mut size) != 0
				&& GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut user) != 0;
			let ticks = ((created.dwHighDateTime as u64) << 32) | created.dwLowDateTime as u64;
			let actual = PathBuf::from(String::from_utf16_lossy(&path[..size as usize]));
			let actual = std::fs::canonicalize(actual).ok();
			if !valid
				|| actual.as_deref() != Some(binary)
				|| expected_created.is_some_and(|v| v != ticks)
			{
				CloseHandle(handle);
				return Err("浏览器进程身份不匹配，未结束该进程".into());
			}
			Ok(Self {
				handle: handle as isize,
				record: ProcessRecord {
					pid,
					created: ticks,
					binary: binary.into(),
				},
			})
		}
	}
	pub fn alive(&self) -> bool {
		unsafe {
			windows_sys::Win32::System::Threading::WaitForSingleObject(self.handle as _, 0) == 258
		}
	}
	pub fn terminate(&self) -> Result<(), String> {
		use windows_sys::Win32::System::Threading::*;
		if !self.alive() {
			return Ok(());
		}
		unsafe {
			if TerminateProcess(self.handle as _, 1) == 0 {
				// A normal close can race this fallback: Windows rejects TerminateProcess
				// while an already-exiting process has not signalled its handle yet.
				if WaitForSingleObject(self.handle as _, 5000) == 0 {
					return Ok(());
				}
				return Err("无法回收浏览器后台进程".into());
			}
			if WaitForSingleObject(self.handle as _, 5000) == 258 {
				return Err("浏览器后台进程未退出".into());
			}
		}
		Ok(())
	}
}
#[cfg(windows)]
impl Drop for OwnedDaemon {
	fn drop(&mut self) {
		unsafe {
			windows_sys::Win32::Foundation::CloseHandle(self.handle as _);
		}
	}
}
#[cfg(not(windows))]
pub struct OwnedDaemon {
	pub record: ProcessRecord,
}
#[cfg(not(windows))]
impl OwnedDaemon {
	pub fn capture(_: u32, _: &Path, _: Option<u64>) -> Result<Self, String> {
		Err("浏览器托管服务首版仅支持 Windows".into())
	}
	pub fn alive(&self) -> bool {
		false
	}
	pub fn terminate(&self) -> Result<(), String> {
		Err("当前平台尚未验证进程回收".into())
	}
}
