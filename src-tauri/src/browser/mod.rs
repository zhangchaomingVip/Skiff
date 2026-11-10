//! Managed browser service. This layer is independent of pi and of the browser panel.
mod agent;
mod bridge;
mod input;
mod lifecycle;
mod runtime;
pub use agent::AgentLease;

#[cfg(test)]
mod tests;

use runtime::{OwnedDaemon, ProcessRecord, Runtime};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
	collections::{HashMap, HashSet},
	path::PathBuf,
	sync::{Arc, Mutex},
	time::Duration,
};
use tauri::Manager;
use tokio::sync::{watch, Mutex as AsyncMutex, Notify};

type Result<T> = std::result::Result<T, String>;
const COMMAND_TIMEOUT: Duration = Duration::from_secs(20);
const DRAIN_TIMEOUT: Duration = Duration::from_secs(35);
// HiDPI screenshots at the panel viewport are roughly 2.4x larger than a 1x capture.
const SCREENSHOT_LIMIT: u64 = 6 * 1024 * 1024;
fn opaque() -> String {
	uuid::Uuid::new_v4().simple().to_string()
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
	pub cli_path: Option<String>,
	#[serde(default)]
	pub enabled: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dependencies {
	pub enabled: bool,
	pub ready: bool,
	pub supported: bool,
	pub cli_path: Option<String>,
	pub configured_cli_path: Option<String>,
	pub version: Option<String>,
	pub browser_installed: bool,
	pub message: String,
	pub install_commands: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Control {
	Starting,
	Ai,
	TakingOver,
	Human,
	Stopping,
	Stopped,
	Returning,
	Closing,
	Closed,
	Disconnected,
	Faulted,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Target {
	pub chat_id: String,
	pub generation: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserStatus {
	#[serde(flatten)]
	pub target: Target,
	pub control: Control,
	pub control_version: u64,
	pub requires_snapshot: bool,
	pub url: Option<String>,
	pub error: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
	pub status: BrowserStatus,
	pub bridge_url: String,
	pub agent_token: String,
	pub stream_url: String,
}
struct EntryData {
	status: BrowserStatus,
	stream_port: Option<u16>,
	cdp_url: Option<String>,
	daemon: Option<OwnedDaemon>,
	active: Option<(String, bool)>,
	requests: HashSet<String>,
	pending: HashSet<String>,
	held_input: Vec<Value>,
}
struct Entry {
	runtime: Runtime,
	agent_token: String,
	viewer_token: String,
	data: Mutex<EntryData>,
	operation: AsyncMutex<()>,
	input: AsyncMutex<()>,
	changed: Notify,
	closed: watch::Sender<bool>,
	viewers: Arc<tokio::sync::Semaphore>,
}
impl Entry {
	fn status(&self) -> BrowserStatus {
		self.data.lock().unwrap().status.clone()
	}
	fn update(&self, control: Control, error: Option<String>) {
		{
			let mut data = self.data.lock().unwrap();
			data.status.control = control;
			data.status.error = error;
		}
		self.changed.notify_waiters();
	}
	fn invalidate(&self, control: Control) {
		{
			let mut data = self.data.lock().unwrap();
			data.status.control = control;
			data.status.control_version += 1;
		}
		self.changed.notify_waiters();
	}
	fn terminal(&self) -> bool {
		matches!(
			self.status().control,
			Control::Closed | Control::Disconnected
		)
	}
}

pub struct Service {
	root: PathBuf,
	namespace: String,
	port: u16,
	entries: Mutex<HashMap<String, Arc<Entry>>>,
	settings: Mutex<Settings>,
	shutting_down: Mutex<bool>,
	server_stop: watch::Sender<bool>,
	origins: Vec<String>,
	registration: AsyncMutex<()>,
	root_lease: Mutex<Option<std::fs::File>>,
	agents: Mutex<HashMap<String, Arc<agent::Permit>>>,
	retired: Mutex<HashSet<String>>,
}
impl Service {
	pub async fn new(root: PathBuf, origins: Vec<String>) -> Result<Arc<Self>> {
		std::fs::create_dir_all(root.join("runs")).map_err(|_| "无法创建浏览器运行目录")?;
		std::fs::create_dir_all(root.join("profiles"))
			.map_err(|_| "无法创建浏览器 profile 目录")?;
		let lease = std::fs::OpenOptions::new()
			.create(true)
			.truncate(false)
			.read(true)
			.write(true)
			.open(root.join("service.lock"))
			.map_err(|_| "无法锁定浏览器数据目录")?;
		lease
			.try_lock()
			.map_err(|_| "此浏览器数据目录正由另一个 Skiff 实例使用")?;
		let settings = match std::fs::read(root.join("settings.json")) {
			Ok(bytes) => {
				serde_json::from_slice(&bytes).map_err(|_| "浏览器设置文件无效，请修复后重试")?
			}
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => Settings::default(),
			Err(_) => return Err("无法读取浏览器设置".into()),
		};
		// Recover only records created inside our dedicated runs directory. Never scan processes by name.
		for directory in std::fs::read_dir(root.join("runs"))
			.map_err(|_| "无法读取浏览器运行目录")?
			.flatten()
		{
			if !directory
				.file_type()
				.is_ok_and(|kind| kind.is_dir() && !kind.is_symlink())
			{
				continue;
			}
			let record = directory.path().join("owned.json");
			if let Ok(bytes) = std::fs::read(&record) {
				if let Ok(record) = serde_json::from_slice::<ProcessRecord>(&bytes) {
					if let Ok(process) =
						OwnedDaemon::capture(record.pid, &record.binary, Some(record.created))
					{
						process.terminate()?;
					}
				}
			}
		}
		let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
			.await
			.map_err(|_| "无法启动本机浏览器桥接")?;
		let port = listener
			.local_addr()
			.map_err(|_| "无法读取浏览器端口")?
			.port();
		let (server_stop, receiver) = watch::channel(false);
		let service = Arc::new(Self {
			root,
			namespace: format!("skiff-{}", opaque()),
			port,
			entries: Mutex::new(HashMap::new()),
			settings: Mutex::new(settings),
			shutting_down: Mutex::new(false),
			server_stop,
			origins,
			registration: AsyncMutex::new(()),
			root_lease: Mutex::new(Some(lease)),
			agents: Mutex::new(HashMap::new()),
			retired: Mutex::new(HashSet::new()),
		});
		bridge::serve(service.clone(), listener, receiver);
		Ok(service)
	}
	pub async fn dependencies(&self) -> Dependencies {
		let settings = self.settings.lock().unwrap().clone();
		let mut result = Dependencies {
			enabled: settings.enabled,
			ready: false,
			supported: cfg!(windows),
			cli_path: None,
			configured_cli_path: settings.cli_path.clone(),
			version: None,
			browser_installed: false,
			message: String::new(),
			install_commands: vec![
				"npm install -g agent-browser@0.41.2".into(),
				"agent-browser install".into(),
			],
		};
		if !result.supported {
			result.message = "浏览器托管服务首版仅支持 Windows".into();
			return result;
		}
		let configured = settings.cli_path;
		let binary = match runtime::resolve_binary(configured.as_deref()) {
			Ok(path) => path,
			Err(error) => {
				result.message = error;
				return result;
			}
		};
		result.cli_path = Some(binary.to_string_lossy().into_owned());
		let mut command = runtime::clean_command(&binary, &self.root);
		command.arg("--version");
		match runtime::run(command, Duration::from_secs(5)).await {
			Ok(bytes) => {
				result.version = Some(
					String::from_utf8_lossy(&bytes)
						.trim()
						.trim_start_matches("agent-browser ")
						.to_string(),
				);
			}
			Err(error) => {
				result.message = error;
				return result;
			}
		}
		if result.version.as_deref() != Some(runtime::VERSION) {
			result.message = "需要 agent-browser 0.41.2，其他版本需重新验证后启用".into();
			return result;
		}
		// Observe the managed Chrome cache only. `doctor` performs a launch/network test; querying dependencies must not do that.
		result.browser_installed = chrome_cache().is_some();
		result.ready = result.browser_installed;
		result.message = if result.ready {
			"浏览器已就绪"
		} else {
			"未检测到 Chrome for Testing，请执行 agent-browser install 后重新检测"
		}
		.into();
		result
	}
	pub async fn configure(&self, settings: Settings) -> Result<Dependencies> {
		let _registration = self.registration.lock().await;
		if settings.cli_path != self.settings.lock().unwrap().cli_path
			&& self
				.entries
				.lock()
				.unwrap()
				.values()
				.any(|entry| !entry.terminal())
		{
			return Err("请先关闭所有托管浏览器再修改 CLI 路径".into());
		}
		if let Some(path) = &settings.cli_path {
			runtime::resolve_binary(Some(path))?;
		}
		crate::providers::atomic_write(&self.root.join("settings.json"), &json!(settings))?;
		*self.settings.lock().unwrap() = settings;
		if !self.settings.lock().unwrap().enabled {
			self.revoke_agents();
		}
		Ok(self.dependencies().await)
	}
	pub async fn start(&self, chat_id: String) -> Result<BrowserStatus> {
		self.start_with_idle(chat_id, 3_600_000).await
	}
	async fn start_with_idle(&self, chat_id: String, idle_ms: u64) -> Result<BrowserStatus> {
		self.start_checked(chat_id, idle_ms, None).await
	}
	async fn start_checked(
		&self,
		chat_id: String,
		idle_ms: u64,
		validity: Option<(
			&std::sync::atomic::AtomicBool,
			&std::sync::atomic::AtomicBool,
		)>,
	) -> Result<BrowserStatus> {
		if chat_id.is_empty() || chat_id.len() > 256 {
			return Err("无效聊天标识".into());
		}
		let registration = self.registration.lock().await;
		if self.retired.lock().unwrap().contains(&chat_id) {
			return Err("聊天已归档或删除，不能启动浏览器".into());
		}
		if validity.is_some_and(|(cancelled, revoked)| {
			cancelled.load(std::sync::atomic::Ordering::SeqCst)
				|| revoked.load(std::sync::atomic::Ordering::SeqCst)
				|| !self.settings.lock().unwrap().enabled
		}) {
			return Err("浏览器操作已取消或能力已禁用".into());
		}
		let dependencies = self.dependencies().await;
		if !dependencies.ready {
			return Err(dependencies.message);
		}
		let existing = self.entries.lock().unwrap().get(&chat_id).cloned();
		let existing = if let Some(entry) = existing {
			self.status(&entry.status().target).await?;
			if entry.terminal() {
				let _operation = entry.operation.lock().await;
				self.close_locked(&entry).await?;
				None
			} else {
				Some(entry)
			}
		} else {
			None
		};
		let entry = {
			let closing = self.shutting_down.lock().unwrap();
			if *closing {
				return Err("浏览器服务正在退出".into());
			}
			let mut entries = self.entries.lock().unwrap();
			if let Some(entry) = existing {
				entry
			} else {
				let entry = self.new_entry(&chat_id, dependencies.cli_path.unwrap(), idle_ms)?;
				entries.insert(chat_id, entry.clone());
				entry
			}
		};
		drop(registration);
		let _operation = entry.operation.lock().await;
		if entry.status().control != Control::Starting {
			return Ok(entry.status());
		}
		let result = async {
			let opened = entry.runtime.open().await;
			// Capture before interpreting the open result: even a failed launch may leave a daemon.
			let socket_dir = home_dir()
				.ok_or("无法确定浏览器运行目录")?
				.join(".agent-browser/namespaces")
				.join(&entry.runtime.namespace)
				.join("run");
			let pid: u32 =
				std::fs::read_to_string(socket_dir.join(format!("{}.pid", entry.runtime.session)))
					.map_err(|_| "无法读取浏览器进程标识")?
					.trim()
					.parse()
					.map_err(|_| "无效浏览器进程标识")?;
			let daemon = OwnedDaemon::capture(pid, &entry.runtime.binary, None)?;
			let record = serde_json::to_vec(&daemon.record).unwrap();
			entry.data.lock().unwrap().daemon = Some(daemon);
			std::fs::write(entry.runtime.directory.join("owned.json"), record)
				.map_err(|_| "无法记录浏览器进程归属")?;
			opened?;
			let stream = entry
				.runtime
				.call(
					vec!["stream".into(), "status".into()],
					Duration::from_secs(5),
				)
				.await?;
			let port = stream["port"]
				.as_u64()
				.filter(|port| *port > 0 && *port <= 65535)
				.ok_or("浏览器未提供画面端口")? as u16;
			let cdp = entry
				.runtime
				.call(vec!["get".into(), "cdp-url".into()], Duration::from_secs(5))
				.await?;
			let cdp_url = cdp["cdpUrl"].as_str().ok_or("浏览器未提供运行地址")?;
			{
				let mut data = entry.data.lock().unwrap();
				data.stream_port = Some(port);
				data.cdp_url = Some(cdp_url.into());
				data.status.url = Some("about:blank".into());
			}
			Ok::<_, String>(())
		}
		.await;
		if let Err(error) = result {
			let cleanup = self.close_locked(&entry).await;
			entry.update(
				Control::Faulted,
				Some(if cleanup.is_err() {
					"浏览器启动失败，后台资源清理失败，请重试关闭".into()
				} else {
					error.clone()
				}),
			);
			return Err(error);
		}
		// A close/takeover may invalidate Starting while launch is in flight. Never reopen the gate.
		if entry.status().control == Control::Starting {
			entry.update(Control::Ai, None);
		}
		Ok(entry.status())
	}
	fn new_entry(&self, chat_id: &str, binary: String, idle_ms: u64) -> Result<Arc<Entry>> {
		let generation = opaque();
		let directory = self.root.join("runs").join(&generation);
		std::fs::create_dir_all(&directory).map_err(|_| "无法创建浏览器实例目录")?;
		std::fs::write(directory.join("config.json"), "{}")
			.map_err(|_| "无法写入托管浏览器配置")?;
		let profile = self
			.root
			.join("profiles")
			.join(format!("{:x}", Sha256::digest(chat_id.as_bytes())));
		let (closed, _) = watch::channel(false);
		Ok(Arc::new(Entry {
			runtime: Runtime {
				binary: binary.into(),
				directory,
				namespace: self.namespace.clone(),
				session: format!("chat-{generation}"),
				profile,
				idle_ms,
			},
			agent_token: opaque(),
			viewer_token: opaque(),
			data: Mutex::new(EntryData {
				status: BrowserStatus {
					target: Target {
						chat_id: chat_id.into(),
						generation,
					},
					control: Control::Starting,
					control_version: 1,
					requires_snapshot: false,
					url: None,
					error: None,
				},
				stream_port: None,
				cdp_url: None,
				daemon: None,
				active: None,
				requests: HashSet::new(),
				pending: HashSet::new(),
				held_input: Vec::new(),
			}),
			operation: AsyncMutex::new(()),
			input: AsyncMutex::new(()),
			changed: Notify::new(),
			closed,
			viewers: Arc::new(tokio::sync::Semaphore::new(2)),
		}))
	}
	fn entry(&self, target: &Target) -> Result<Arc<Entry>> {
		let entry = self
			.entries
			.lock()
			.unwrap()
			.get(&target.chat_id)
			.cloned()
			.ok_or("聊天没有运行中的浏览器")?;
		if entry.status().target.generation != target.generation {
			return Err("浏览器实例已变更，请刷新状态".into());
		}
		Ok(entry)
	}
	pub async fn status(&self, target: &Target) -> Result<BrowserStatus> {
		let entry = self.entry(target)?;
		let dead = {
			let data = entry.data.lock().unwrap();
			data.daemon.as_ref().is_some_and(|daemon| !daemon.alive())
		};
		let (cdp_url, version, control) = {
			let data = entry.data.lock().unwrap();
			(
				data.cdp_url.clone(),
				data.status.control_version,
				data.status.control.clone(),
			)
		};
		let disconnected = if !dead
			&& !matches!(
				control,
				Control::Closed
					| Control::Closing
					| Control::Starting
					| Control::Disconnected
					| Control::Faulted
			) {
			match cdp_url {
				Some(url) => !runtime::connected(&url).await,
				None => true,
			}
		} else {
			dead
		};
		if disconnected
			&& entry.status().control_version == version
			&& !matches!(
				entry.status().control,
				Control::Closed | Control::Closing | Control::Starting
			) {
			entry.invalidate(Control::Disconnected);
			entry.closed.send_replace(true);
		}
		Ok(entry.status())
	}
	pub fn connection(&self, target: &Target) -> Result<Connection> {
		let entry = self.entry(target)?;
		if entry.terminal() || entry.status().control == Control::Faulted {
			return Err("浏览器未连接，请重新打开".into());
		}
		if entry.data.lock().unwrap().stream_port.is_none() {
			return Err("浏览器尚未启动完成".into());
		}
		Ok(Connection {
			status: entry.status(),
			bridge_url: format!("http://127.0.0.1:{}/v1", self.port),
			agent_token: entry.agent_token.clone(),
			stream_url: format!(
				"ws://127.0.0.1:{}/v1/stream?chatId={}&generation={}&token={}",
				self.port,
				url_escape(&target.chat_id),
				target.generation,
				entry.viewer_token
			),
		})
	}
	/// Panel-driven viewport. Serialized with page actions so a resize never lands mid-capture.
	pub async fn viewport(&self, target: &Target, width: u32, height: u32, scale: f32) -> Result<()> {
		let args = viewport_arguments(width, height, scale)?;
		let entry = self.entry(target)?;
		if entry.terminal() {
			return Err("浏览器已关闭，无法调整画面".into());
		}
		let _operation = entry.operation.lock().await;
		ensure_alive(&entry)?;
		entry
			.runtime
			.call(args, Duration::from_secs(10))
			.await
			.map(|_| ())
			.map_err(String::from)
	}
	pub async fn execute(
		&self,
		target: Target,
		request_id: String,
		version: u64,
		action: Action,
	) -> Result<Value> {
		self.execute_checked(target, request_id, version, action, None)
			.await
	}
	async fn execute_checked(
		&self,
		target: Target,
		request_id: String,
		version: u64,
		action: Action,
		cancelled: Option<&std::sync::atomic::AtomicBool>,
	) -> Result<Value> {
		use std::sync::atomic::Ordering;
		let mut args = action.arguments()?;
		if request_id.is_empty() || request_id.len() > 128 {
			return Err("无效操作标识".into());
		}
		let entry = self.entry(&target)?;
		{
			let mut data = entry.data.lock().unwrap();
			check_ai(&data.status, version)?;
			if data.status.requires_snapshot && !matches!(action, Action::Snapshot) {
				return Err("交还后请先读取新的 snapshot，再继续操作页面".into());
			}
			if cancelled.is_some_and(|flag| flag.load(Ordering::SeqCst)) {
				return Err("浏览器操作已取消，未执行".into());
			}
			if data.pending.len() >= 32 {
				return Err("浏览器等待队列已满".into());
			}
			if data.requests.len() >= 4096 {
				return Err("本实例操作数量达到上限，请重新打开浏览器".into());
			}
			if !data.requests.insert(request_id.clone()) {
				return Err("操作标识已使用，禁止自动重复执行".into());
			}
			data.pending.insert(request_id.clone());
		}
		let _operation = entry.operation.lock().await;
		{
			let mut data = entry.data.lock().unwrap();
			data.pending.remove(&request_id);
			check_ai(&data.status, version)?;
			if cancelled.is_some_and(|flag| flag.load(Ordering::SeqCst)) {
				return Err("浏览器操作已取消，未执行".into());
			}
		}
		ensure_alive(&entry)?;
		let cdp_url = entry
			.data
			.lock()
			.unwrap()
			.cdp_url
			.clone()
			.ok_or("浏览器运行地址不可用")?;
		if !runtime::connected(&cdp_url).await {
			entry.invalidate(Control::Disconnected);
			entry.closed.send_replace(true);
			return Err("浏览器连接已断开，请关闭后重开".into());
		}
		{
			let mut data = entry.data.lock().unwrap();
			check_ai(&data.status, version)?;
			if cancelled.is_some_and(|flag| flag.load(Ordering::SeqCst)) {
				return Err("浏览器操作已取消，未执行".into());
			}
			data.active = Some((request_id, false));
		}
		let screenshot = matches!(action, Action::Screenshot);
		if screenshot {
			args.push(
				entry
					.runtime
					.directory
					.join("capture.jpg")
					.to_string_lossy()
					.into_owned(),
			);
		}
		// JPEG keeps screenshots small enough to survive relay body limits on every re-send.
		let result = if screenshot {
			entry
				.runtime
				.call_with_global(args, &["--screenshot-format", "jpeg", "--screenshot-quality", "85"], COMMAND_TIMEOUT)
				.await
		} else {
			entry.runtime.call(args, COMMAND_TIMEOUT).await
		};
		let cancelled = {
			let mut data = entry.data.lock().unwrap();
			data.active.take().is_some_and(|(_, cancelled)| cancelled)
		};
		if let Err(runtime::Failure::Uncertain(error)) = &result {
			// Unknown transport/process outcomes must close the mutation gate until explicit close/reopen.
			entry.invalidate(Control::Faulted);
			entry.update(Control::Faulted, Some(error.clone()));
			// Invalidation advances controlVersion; preserve the actual failure instead of
			// mistaking that internal version change for cancellation below.
			return Err(error.clone());
		}
		if cancelled || entry.status().control_version != version {
			return Err("浏览器操作已中止；已发出的动作可能发生，请核对页面".into());
		}
		if let Ok(data) = &result {
			if let Some(url) = data["url"].as_str() {
				entry.data.lock().unwrap().status.url = Some(url.into());
			}
		}
		let result = result.map_err(String::from)?;
		if matches!(action, Action::Snapshot) {
			entry.data.lock().unwrap().status.requires_snapshot = false;
			entry.changed.notify_waiters();
		}
		if matches!(action, Action::Screenshot) {
			use base64::Engine;
			let path = entry.runtime.directory.join("capture.jpg");
			use std::io::Read;
			let mut bytes = Vec::new();
			std::fs::File::open(&path)
				.map_err(|_| "无法读取浏览器截图")?
				.take(SCREENSHOT_LIMIT + 1)
				.read_to_end(&mut bytes)
				.map_err(|_| "无法读取浏览器截图")?;
			let _ = std::fs::remove_file(&path);
			if bytes.len() > SCREENSHOT_LIMIT as usize || !bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
				return Err("截图格式无效或超过 6 MiB 限制".into());
			}
			return Ok(
				json!({"mimeType":"image/jpeg","data":base64::engine::general_purpose::STANDARD.encode(bytes)}),
			);
		}
		if let Action::Get { .. } = &action {
			// get results embed lifecycle/origin noise; keep only the value fields the model needs.
			let mut clean = serde_json::Map::new();
			for key in ["x", "y", "width", "height", "value", "text", "title", "url", "count", "html"] {
				if let Some(value) = result.get(key) {
					clean.insert(key.into(), value.clone());
				}
			}
			return Ok(Value::Object(clean));
		}
		Ok(result)
	}
	pub fn cancel(&self, target: &Target, request_id: &str) -> Result<BrowserStatus> {
		let entry = self.entry(target)?;
		let mut data = entry.data.lock().unwrap();
		if data.status.control != Control::Ai
			|| (!data.pending.contains(request_id)
				&& !data.active.as_ref().is_some_and(|(id, _)| id == request_id))
		{
			return Err("操作已结束或控制权已变化".into());
		}
		if let Some((id, cancelled)) = &mut data.active {
			if id == request_id {
				*cancelled = true;
			}
		}
		// Cancelling one request invalidates queued work too. No later mutation runs until explicit resume.
		data.status.control_version += 1;
		if !matches!(data.status.control, Control::Closing | Control::Closed) {
			data.status.control = Control::Stopping;
		}
		drop(data);
		entry.changed.notify_waiters();
		Ok(entry.status())
	}
	pub async fn control(
		&self,
		target: &Target,
		operation: ControlAction,
	) -> Result<BrowserStatus> {
		let begun = Box::pin(self.begin_control(target, operation.clone())).await?;
		Box::pin(self.complete_control(target, operation, begun.control_version)).await
	}
	pub async fn begin_control(
		&self,
		target: &Target,
		operation: ControlAction,
	) -> Result<BrowserStatus> {
		let entry = self.entry(target)?;
		let desired = match operation {
			ControlAction::TakeOver => Control::TakingOver,
			ControlAction::Stop => Control::Stopping,
			ControlAction::Return => Control::Returning,
		};
		{
			let _input = entry.input.lock().await;
			let current = entry.status().control;
			let valid = match operation {
				ControlAction::TakeOver => matches!(
					current,
					Control::Starting | Control::Ai | Control::Stopped | Control::TakingOver
				),
				ControlAction::Stop => {
					matches!(
						current,
						Control::Starting
							| Control::Ai | Control::Human
							| Control::Stopping | Control::TakingOver
					)
				}
				ControlAction::Return => matches!(current, Control::Human | Control::Stopped),
			};
			if !valid {
				return Err("浏览器当前状态不允许此操作".into());
			}
			entry.invalidate(desired.clone());
			if let Err(error) = input::release(&entry).await {
				entry.update(Control::Faulted, Some(error.clone()));
				return Err(error);
			}
		}
		Ok(entry.status())
	}
	pub async fn complete_control(
		&self,
		target: &Target,
		operation: ControlAction,
		version: u64,
	) -> Result<BrowserStatus> {
		let entry = self.entry(target)?;
		let desired = match operation {
			ControlAction::TakeOver => Control::TakingOver,
			ControlAction::Stop => Control::Stopping,
			ControlAction::Return => Control::Returning,
		};
		let _operation = entry.operation.lock().await;
		ensure_alive(&entry)?;
		if entry.status().control_version != version || entry.status().control != desired {
			return Err("控制权请求已被更新的操作替代".into());
		}
		let drain = entry
			.runtime
			.call(vec!["snapshot".into(), "-i".into()], DRAIN_TIMEOUT)
			.await;
		if let Err(error) = drain {
			entry.update(
				Control::Faulted,
				Some("无法确认浏览器在途操作已结束，请关闭后重开".into()),
			);
			return Err(error.into());
		}
		{
			let mut data = entry.data.lock().unwrap();
			if data.status.control_version != version {
				return Err("控制权请求已失效".into());
			}
			data.status.control = match operation {
				ControlAction::TakeOver => Control::Human,
				ControlAction::Stop => Control::Stopped,
				ControlAction::Return => Control::Ai,
			};
			data.status.error = None;
			if matches!(operation, ControlAction::Return) {
				data.status.requires_snapshot = true;
			}
		}
		entry.changed.notify_waiters();
		Ok(entry.status())
	}
	pub async fn close(&self, target: &Target) -> Result<BrowserStatus> {
		let _registration = self.registration.lock().await;
		self.close_instance(target).await
	}
	async fn close_instance(&self, target: &Target) -> Result<BrowserStatus> {
		let entry = self.entry(target)?;
		let permits: Vec<_> = self
			.agents
			.lock()
			.unwrap()
			.values()
			.filter(|permit| permit.chat_id() == target.chat_id)
			.cloned()
			.collect();
		for permit in permits {
			permit.revoke();
		}
		{
			let _input = entry.input.lock().await;
			if entry.status().control == Control::Closed {
				return Ok(entry.status());
			}
			entry.invalidate(Control::Closing);
			let _ = input::release(&entry).await;
			entry.closed.send_replace(true);
		}
		let _operation = entry.operation.lock().await;
		if let Err(error) = self.close_locked(&entry).await {
			entry.update(Control::Faulted, Some(error.clone()));
			return Err(error);
		}
		entry.update(Control::Closed, None);
		Ok(entry.status())
	}
	async fn close_locked(&self, entry: &Entry) -> Result<()> {
		// No CLI call if the owned daemon has exited: CLI would silently start a new daemon.
		let alive = entry
			.data
			.lock()
			.unwrap()
			.daemon
			.as_ref()
			.is_some_and(|daemon| daemon.alive());
		if alive {
			let closed = entry
				.runtime
				.call(vec!["close".into()], Duration::from_secs(6))
				.await;
			if closed.is_err() {
				let data = entry.data.lock().unwrap();
				if let Some(daemon) = &data.daemon {
					daemon.terminate()?;
				}
			}
		}
		let mut data = entry.data.lock().unwrap();
		if let Some(daemon) = &data.daemon {
			if daemon.alive() {
				daemon.terminate()?;
			}
		}
		data.daemon = None;
		data.stream_port = None;
		data.cdp_url = None;
		drop(data);
		// Profiles intentionally survive close; only this generation's generated runtime files are removed.
		let expected = self
			.root
			.join("runs")
			.join(&entry.status().target.generation);
		if entry.runtime.directory != expected {
			return Err("浏览器运行目录归属不匹配".into());
		}
		if let Ok(metadata) = std::fs::symlink_metadata(&expected) {
			if metadata.file_type().is_symlink() {
				return Err("浏览器运行目录已被替换，未清理".into());
			}
			std::fs::remove_dir_all(&expected).map_err(|_| "浏览器已关闭，但运行文件清理失败")?;
		}
		Ok(())
	}
	pub async fn shutdown(&self) -> Result<()> {
		*self.shutting_down.lock().unwrap() = true;
		self.revoke_agents();
		let targets: Vec<_> = self
			.entries
			.lock()
			.unwrap()
			.values()
			.map(|entry| entry.status().target)
			.collect();
		let results =
			futures_util::future::join_all(targets.iter().map(|target| self.close(target))).await;
		self.server_stop.send_replace(true);
		if results.iter().any(|result| result.is_err()) {
			return Err("部分浏览器资源清理失败".into());
		}
		self.root_lease.lock().unwrap().take();
		Ok(())
	}
}

/// The viewport is expressed in CSS pixels; the live stream keeps CSS resolution, so callers pass device pixels here.
fn viewport_arguments(width: u32, height: u32, scale: f32) -> Result<Vec<String>> {
	if !(200..=3000).contains(&width) || !(200..=3000).contains(&height) {
		return Err("无效的浏览器画面尺寸".into());
	}
	if !scale.is_finite() || !(1.0..=3.0).contains(&scale) {
		return Err("无效的浏览器画面缩放".into());
	}
	Ok(vec![
		"set".into(),
		"viewport".into(),
		width.to_string(),
		height.to_string(),
		format!("{scale}"),
	])
}
fn check_ai(status: &BrowserStatus, version: u64) -> Result<()> {
	if status.control != Control::Ai || status.control_version != version {
		return Err("浏览器控制权已变化，操作未执行".into());
	}
	Ok(())
}
fn ensure_alive(entry: &Entry) -> Result<()> {
	if !entry
		.data
		.lock()
		.unwrap()
		.daemon
		.as_ref()
		.is_some_and(|daemon| daemon.alive())
	{
		entry.invalidate(Control::Disconnected);
		entry.closed.send_replace(true);
		return Err("浏览器已退出，请重新打开".into());
	}
	Ok(())
}
fn home_dir() -> Option<PathBuf> {
	std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}
fn chrome_cache() -> Option<PathBuf> {
	let cache = home_dir()?.join(".agent-browser/browsers");
	std::fs::read_dir(cache)
		.ok()?
		.flatten()
		.map(|item| item.path().join("chrome.exe"))
		.find(|path| path.is_file())
}
fn url_escape(text: &str) -> String {
	text.bytes()
		.map(|b| {
			if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
				(b as char).to_string()
			} else {
				format!("%{b:02X}")
			}
		})
		.collect()
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ControlAction {
	TakeOver,
	Return,
	Stop,
}

#[derive(Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum Action {
	Open { url: String },
	Snapshot,
	Click { selector: String },
	Fill { selector: String, text: String },
	Press { key: String },
	Scroll { direction: String, pixels: u32 },
	Wait { milliseconds: u32 },
	Screenshot,
	Drag {
		source: String,
		target: String,
		#[serde(default)]
		human: bool,
	},
	Mouse {
		sub: String,
		#[serde(default)]
		x: Option<u32>,
		#[serde(default)]
		y: Option<u32>,
		#[serde(default)]
		button: Option<String>,
		#[serde(default)]
		steps: Option<u32>,
		#[serde(default)]
		duration: Option<u32>,
		#[serde(default)]
		human: bool,
		#[serde(default)]
		seed: Option<u32>,
	},
	Get {
		kind: String,
		#[serde(default)]
		selector: Option<String>,
		#[serde(default)]
		name: Option<String>,
	},
}
impl Action {
	fn arguments(&self) -> Result<Vec<String>> {
		let text = |value: &str| -> Result<String> {
			if value.len() > 16384 || value.contains('\0') {
				Err("浏览器参数过长或包含无效字符".into())
			} else {
				Ok(value.into())
			}
		};
		let select = |value: &str| -> Result<String> {
			if value.is_empty() || value.starts_with('-') {
				Err("无效页面元素选择器".into())
			} else {
				text(value)
			}
		};
		Ok(match self {
			Self::Open { url } => {
				let parsed = reqwest::Url::parse(url).map_err(|_| "无效网址")?;
				if !["http", "https"].contains(&parsed.scheme())
					|| !parsed.username().is_empty()
					|| parsed.password().is_some()
				{
					return Err("只支持不含凭据的 http/https 网址".into());
				}
				vec!["open".into(), text(url)?]
			}
			Self::Snapshot => vec!["snapshot".into()],
			Self::Screenshot => vec!["screenshot".into()],
			Self::Click { selector: value } => vec!["click".into(), select(value)?],
			Self::Fill {
				selector: value,
				text: value_text,
			} => vec!["fill".into(), select(value)?, text(value_text)?],
			Self::Press { key } => {
				if key.starts_with('-') {
					return Err("无效按键".into());
				}
				vec!["press".into(), text(key)?]
			}
			Self::Scroll { direction, pixels } => {
				if !["up", "down", "left", "right"].contains(&direction.as_str()) || *pixels > 10000
				{
					return Err("无效滚动参数".into());
				}
				vec!["scroll".into(), direction.clone(), pixels.to_string()]
			}
			Self::Wait { milliseconds } => {
				if *milliseconds > 10000 {
					return Err("单次等待不能超过 10 秒".into());
				}
				vec!["wait".into(), milliseconds.to_string()]
			}
			Self::Drag {
				source,
				target,
				human,
			} => {
				let mut args = vec!["drag".into(), select(source)?, select(target)?];
				if *human {
					args.push("--human".into());
				}
				args
			}
			Self::Mouse {
				sub,
				x,
				y,
				button,
				steps,
				duration,
				human,
				seed,
			} => match sub.as_str() {
				"move" => {
					let x = x.ok_or("鼠标移动需要 x 坐标")?;
					let y = y.ok_or("鼠标移动需要 y 坐标")?;
					if x > 30000 || y > 30000 {
						return Err("鼠标坐标超出范围".into());
					}
					let mut args =
						vec!["mouse".into(), "move".into(), x.to_string(), y.to_string()];
					if let Some(value) = steps {
						if !(1..=240).contains(value) {
							return Err("移动事件数无效".into());
						}
						args.push("--steps".into());
						args.push(value.to_string());
					}
					if let Some(value) = duration {
						if *value > 5000 {
							return Err("移动时长无效".into());
						}
						args.push("--duration".into());
						args.push(value.to_string());
					}
					if *human {
						args.push("--human".into());
					}
					if let Some(value) = seed {
						args.push("--seed".into());
						args.push(value.to_string());
					}
					args
				}
				"down" | "up" => {
					let mut args = vec!["mouse".into(), sub.clone()];
					if let Some(value) = button {
						if !["left", "right", "middle"].contains(&value.as_str()) {
							return Err("无效鼠标按键".into());
						}
						args.push(value.clone());
					}
					args
				}
				_ => return Err("无效鼠标操作".into()),
			},
			Self::Get {
				kind,
				selector,
				name,
			} => {
				let mut args = vec!["get".into(), kind.clone()];
				match kind.as_str() {
					"url" | "title" => {}
					"attr" => {
						let value = selector.as_deref().ok_or("读取属性需要选择器")?;
						let attr = name.as_deref().ok_or("读取属性需要属性名")?;
						args.push(select(value)?);
						args.push(text(attr)?);
					}
					"box" | "text" | "value" | "count" | "html" => {
						let value = selector.as_deref().ok_or("该读取类型需要选择器")?;
						args.push(select(value)?);
					}
					_ => return Err("无效读取类型".into()),
				}
				args
			}
		})
	}
}

#[derive(Default)]
pub struct BrowserState {
	service: AsyncMutex<Option<Arc<Service>>>,
}
impl BrowserState {
	fn data_root(app: &tauri::AppHandle) -> Result<PathBuf> {
		match std::env::var_os("SKIFF_BROWSER_DATA_DIR") {
			Some(path) => {
				let path = PathBuf::from(path);
				if !path.is_absolute() {
					return Err("浏览器数据目录必须是绝对路径".into());
				}
				Ok(path)
			}
			None => Ok(app
				.path()
				.app_data_dir()
				.map_err(|_| "无法获取浏览器数据目录")?
				.join("browser")),
		}
	}
	pub async fn prepare_agent(
		&self,
		app: &tauri::AppHandle,
		chat_id: String,
	) -> Result<Option<AgentLease>> {
		let enabled = if let Some(service) = self.service.lock().await.as_ref() {
			service.settings.lock().unwrap().enabled
		} else {
			match std::fs::read(Self::data_root(app)?.join("settings.json")) {
				Ok(bytes) => {
					serde_json::from_slice::<Settings>(&bytes)
						.map_err(|_| "浏览器设置文件无效")?
						.enabled
				}
				Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
				Err(_) => return Err("无法读取浏览器设置".into()),
			}
		};
		if !enabled {
			return Ok(None);
		}
		self.get(app).await?.grant_agent(chat_id)
	}
	async fn get(&self, app: &tauri::AppHandle) -> Result<Arc<Service>> {
		let mut slot = self.service.lock().await;
		if let Some(service) = slot.as_ref() {
			return Ok(service.clone());
		}
		let root = Self::data_root(app)?;
		let mut origins = vec!["http://tauri.localhost".into(), "tauri://localhost".into()];
		if cfg!(debug_assertions) {
			origins.extend([
				"http://localhost:1420".into(),
				"http://127.0.0.1:1420".into(),
			]);
		}
		let service = Service::new(root, origins).await?;
		*slot = Some(service.clone());
		Ok(service)
	}
	pub async fn shutdown(&self) {
		if let Some(service) = self.service.lock().await.as_ref() {
			let _ = service.shutdown().await;
		}
	}
}

#[tauri::command]
pub async fn browser_dependencies(
	app: tauri::AppHandle,
	state: tauri::State<'_, BrowserState>,
) -> Result<Dependencies> {
	Ok(state.get(&app).await?.dependencies().await)
}
#[tauri::command]
pub async fn browser_configure(
	app: tauri::AppHandle,
	state: tauri::State<'_, BrowserState>,
	settings: CliSettings,
) -> Result<Dependencies> {
	let service = state.get(&app).await?;
	let mut config = service.settings.lock().unwrap().clone();
	config.cli_path = settings.cli_path;
	service.configure(config).await
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CliSettings {
	cli_path: Option<String>,
}
#[tauri::command]
pub async fn browser_set_enabled(
	app: tauri::AppHandle,
	state: tauri::State<'_, BrowserState>,
	enabled: bool,
) -> Result<Dependencies> {
	let service = state.get(&app).await?;
	let mut config = service.settings.lock().unwrap().clone();
	config.enabled = enabled;
	service.configure(config).await
}
#[tauri::command]
pub async fn browser_start(
	app: tauri::AppHandle,
	state: tauri::State<'_, BrowserState>,
	chat_id: String,
) -> Result<BrowserStatus> {
	state.get(&app).await?.start(chat_id).await
}
#[tauri::command]
pub async fn browser_status(
	app: tauri::AppHandle,
	state: tauri::State<'_, BrowserState>,
	target: Target,
) -> Result<BrowserStatus> {
	state.get(&app).await?.status(&target).await
}
#[tauri::command]
pub async fn browser_find(
	app: tauri::AppHandle,
	state: tauri::State<'_, BrowserState>,
	chat_id: String,
) -> Result<Option<BrowserStatus>> {
	let service = state.get(&app).await?;
	let target = service
		.entries
		.lock()
		.unwrap()
		.get(&chat_id)
		.map(|entry| entry.status().target);
	match target {
		Some(target) => Ok(Some(service.status(&target).await?)),
		None => Ok(None),
	}
}
#[tauri::command]
pub async fn browser_connection(
	app: tauri::AppHandle,
	state: tauri::State<'_, BrowserState>,
	target: Target,
) -> Result<Connection> {
	state.get(&app).await?.connection(&target)
}
#[tauri::command]
pub async fn browser_viewport(
	app: tauri::AppHandle,
	state: tauri::State<'_, BrowserState>,
	target: Target,
	width: u32,
	height: u32,
	scale: f32,
) -> Result<()> {
	state
		.get(&app)
		.await?
		.viewport(&target, width, height, scale)
		.await
}
#[tauri::command]
pub async fn browser_control(
	app: tauri::AppHandle,
	state: tauri::State<'_, BrowserState>,
	target: Target,
	operation: ControlAction,
) -> Result<BrowserStatus> {
	state.get(&app).await?.control(&target, operation).await
}
#[tauri::command]
pub async fn browser_begin_control(
	app: tauri::AppHandle,
	state: tauri::State<'_, BrowserState>,
	target: Target,
	operation: ControlAction,
) -> Result<BrowserStatus> {
	state
		.get(&app)
		.await?
		.begin_control(&target, operation)
		.await
}
#[tauri::command]
pub async fn browser_complete_control(
	app: tauri::AppHandle,
	state: tauri::State<'_, BrowserState>,
	target: Target,
	operation: ControlAction,
	control_version: u64,
) -> Result<BrowserStatus> {
	state
		.get(&app)
		.await?
		.complete_control(&target, operation, control_version)
		.await
}
#[tauri::command]
pub async fn browser_close(
	app: tauri::AppHandle,
	state: tauri::State<'_, BrowserState>,
	target: Target,
) -> Result<BrowserStatus> {
	state.get(&app).await?.close(&target).await
}

#[tauri::command]
pub async fn browser_retire_chat(
	app: tauri::AppHandle,
	state: tauri::State<'_, BrowserState>,
	chat_id: String,
	delete_profile: bool,
) -> Result<()> {
	state
		.get(&app)
		.await?
		.retire_chat(&chat_id, delete_profile)
		.await
}
#[tauri::command]
pub async fn browser_restore_chat(
	app: tauri::AppHandle,
	state: tauri::State<'_, BrowserState>,
	chat_id: String,
) -> Result<()> {
	state.get(&app).await?.restore_chat(&chat_id).await
}
