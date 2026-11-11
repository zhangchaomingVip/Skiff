//! pi-scoped leases: lazy browser startup, fixed chat binding, independent cancellation.
use super::*;
use axum::{
	extract::State,
	http::{HeaderMap, StatusCode},
	response::{IntoResponse, Response},
	routing::{get, post},
	Json, Router,
};
use std::sync::{
	atomic::{AtomicBool, Ordering},
	Weak,
};

pub(super) struct Permit {
	chat_id: String,
	service: Weak<Service>,
	revoked: AtomicBool,
	binding: AsyncMutex<Option<Target>>,
	requests: Mutex<HashMap<String, Arc<Request>>>,
}
struct Request {
	started: AtomicBool,
	finished: AtomicBool,
	cancelled: AtomicBool,
	target: Mutex<Option<Target>>,
}
impl Request {
	fn new() -> Self {
		Self {
			started: AtomicBool::new(false),
			finished: AtomicBool::new(false),
			cancelled: AtomicBool::new(false),
			target: Mutex::new(None),
		}
	}
}

#[derive(Clone)]
pub struct AgentLease {
	permit: Arc<Permit>,
	token: String,
}
impl AgentLease {
	pub fn configure(&self, command: &mut std::process::Command) {
		if let Some(service) = self.permit.service.upgrade() {
			command.env("SKIFF_BROWSER_RUNTIME", json!({"url":format!("http://127.0.0.1:{}/v1/agent",service.port),"token":self.token}).to_string());
		}
	}
	pub fn revoke(&self) {
		self.permit.revoke();
		if let Some(service) = self.permit.service.upgrade() {
			service.agents.lock().unwrap().remove(&self.token);
		}
	}
}
impl Drop for AgentLease {
	fn drop(&mut self) {
		self.revoke();
	}
}

impl Permit {
	pub(super) fn chat_id(&self) -> &str {
		&self.chat_id
	}
	pub(super) fn revoke(&self) {
		if self.revoked.swap(true, Ordering::SeqCst) {
			return;
		}
		self.cancel_pending();
	}
	pub(super) fn cancel_pending(&self) {
		let requests = self.requests.lock().unwrap();
		for (id, request) in requests.iter() {
			if request.finished.load(Ordering::SeqCst) {
				continue;
			}
			request.cancelled.store(true, Ordering::SeqCst);
			if let Some(target) = request.target.lock().unwrap().clone() {
				if let Some(service) = self.service.upgrade() {
					stop_request(service, target, id.clone());
				}
			}
		}
	}
	async fn context(&self, service: &Service) -> Result<Option<BrowserStatus>> {
		if self.revoked.load(Ordering::SeqCst) {
			return Err("浏览器工具凭据已失效，请重新连接聊天".into());
		}
		let mut binding = self.binding.lock().await;
		if let Some(target) = binding.as_ref() {
			return Ok(Some(service.status(target).await?));
		}
		let existing = service.entries.lock().unwrap().get(&self.chat_id).cloned();
		if let Some(entry) = existing {
			let status = service.status(&entry.status().target).await?;
			if !matches!(status.control, Control::Closed | Control::Disconnected) {
				*binding = Some(status.target.clone());
				return Ok(Some(status));
			}
		}
		Ok(None)
	}
}

impl Service {
	pub fn grant_agent(self: &Arc<Self>, chat_id: String) -> Result<Option<AgentLease>> {
		if !self.settings.lock().unwrap().enabled {
			return Ok(None);
		}
		if chat_id.is_empty() || chat_id.len() > 256 {
			return Err("无效聊天标识".into());
		}
		let mut agents = self.agents.lock().unwrap();
		if self.retired.lock().unwrap().contains(&chat_id) {
			return Err("聊天已归档或删除".into());
		}
		let previous: Vec<_> = agents
			.iter()
			.filter(|(_, permit)| permit.chat_id == chat_id)
			.map(|(key, permit)| (key.clone(), permit.clone()))
			.collect();
		for (key, _) in &previous {
			agents.remove(key);
		}
		let permit = Arc::new(Permit {
			chat_id,
			service: Arc::downgrade(self),
			revoked: AtomicBool::new(false),
			binding: AsyncMutex::new(None),
			requests: Mutex::new(HashMap::new()),
		});
		let token = opaque();
		agents.insert(token.clone(), permit.clone());
		drop(agents);
		for (_, previous) in previous {
			previous.revoke();
		}
		if let Some(entry) = self.entries.lock().unwrap().get(&permit.chat_id) {
			let mut data = entry.data.lock().unwrap();
			if data.status.control == Control::Ai {
				data.status.requires_snapshot = true;
			}
		}
		Ok(Some(AgentLease { permit, token }))
	}
	pub(super) fn revoke_chat_agents(&self, chat_id: &str) {
		let permits = {
			let mut agents = self.agents.lock().unwrap();
			let keys: Vec<_> = agents
				.iter()
				.filter(|(_, permit)| permit.chat_id == chat_id)
				.map(|(key, _)| key.clone())
				.collect();
			keys.into_iter()
				.filter_map(|key| agents.remove(&key))
				.collect::<Vec<_>>()
		};
		for permit in permits {
			permit.revoke();
		}
	}
	pub(super) fn revoke_agents(&self) {
		let permits: Vec<_> = self
			.agents
			.lock()
			.unwrap()
			.drain()
			.map(|(_, permit)| permit)
			.collect();
		for permit in permits {
			permit.revoke();
		}
	}
}

fn stop_request(service: Arc<Service>, target: Target, id: String) {
	let stopping = service.cancel(&target, &id).is_ok()
		|| service.entry(&target).is_ok_and(|entry| {
			// Cancellation can arrive after target binding but before queue registration.
			let mut data = entry.data.lock().unwrap();
			if data.status.control != Control::Ai {
				return false;
			}
			data.status.control_version += 1;
			data.status.control = Control::Stopping;
			true
		});
	if stopping {
		tauri::async_runtime::spawn(async move {
			let _ = service.control(&target, ControlAction::Stop).await;
		});
	}
}

fn authenticate(
	service: &Service,
	headers: &HeaderMap,
) -> std::result::Result<Arc<Permit>, StatusCode> {
	if headers.contains_key("origin") {
		return Err(StatusCode::FORBIDDEN);
	}
	if !service.settings.lock().unwrap().enabled {
		return Err(StatusCode::FORBIDDEN);
	}
	let token = headers
		.get("authorization")
		.and_then(|value| value.to_str().ok())
		.and_then(|value| value.strip_prefix("Bearer "))
		.unwrap_or("");
	let permit = service
		.agents
		.lock()
		.unwrap()
		.get(token)
		.cloned()
		.ok_or(StatusCode::UNAUTHORIZED)?;
	if permit.revoked.load(Ordering::SeqCst) {
		return Err(StatusCode::UNAUTHORIZED);
	}
	Ok(permit)
}

pub(super) fn routes() -> Router<Arc<Service>> {
	Router::new()
		.route("/v1/agent/context", get(context))
		.route("/v1/agent/command", post(command))
		.route("/v1/agent/cancel", post(cancel))
}
async fn context(State(service): State<Arc<Service>>, headers: HeaderMap) -> Response {
	let permit = match authenticate(&service, &headers) {
		Ok(permit) => permit,
		Err(code) => return code.into_response(),
	};
	match permit.context(&service).await {
		Ok(status) => Json(json!({"success":true,"status":status})).into_response(),
		Err(_) => (
			StatusCode::CONFLICT,
			Json(
				json!({"success":false,"error":"浏览器实例已关闭或工具凭据已失效，请重新连接聊天"}),
			),
		)
			.into_response(),
	}
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AgentCommand {
	request_id: String,
	generation: Option<String>,
	control_version: Option<u64>,
	action: Action,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AgentCancel {
	request_id: String,
}

async fn command(
	State(service): State<Arc<Service>>,
	headers: HeaderMap,
	Json(command): Json<AgentCommand>,
) -> Response {
	let permit = match authenticate(&service, &headers) {
		Ok(permit) => permit,
		Err(code) => return code.into_response(),
	};
	let task = tokio::spawn(async move { execute(service, permit, command).await });
	match task.await {
		Ok(result) => Json(result).into_response(),
		Err(_) => (
			StatusCode::INTERNAL_SERVER_ERROR,
			Json(json!({"success":false,"outcome":"failed","error":"浏览器工具任务异常结束"})),
		)
			.into_response(),
	}
}
async fn execute(service: Arc<Service>, permit: Arc<Permit>, command: AgentCommand) -> Value {
	let started = std::time::Instant::now();
	let id = command.request_id.clone();
	let operation = command.action.name();
	let target_label = command.action.target_label();
	let rejected = |outcome, error| json!({"success":false,"error":error,"details":{"requestId":id,"operation":operation,"target":target_label,"durationMs":started.elapsed().as_millis() as u64,"outcome":outcome}});
	let request = {
		let mut requests = permit.requests.lock().unwrap();
		if id.is_empty() || id.len() > 128 || requests.len() >= 4096 {
			return rejected("invalidArguments", "操作标识无效或已达上限");
		}
		requests
			.entry(id.clone())
			.or_insert_with(|| Arc::new(Request::new()))
			.clone()
	};
	if request.started.swap(true, Ordering::SeqCst) {
		return rejected("duplicate", "操作标识已使用，未重复执行");
	}
	let result: Result<Value> = async {
		command.action.arguments()?;
		let mut binding = permit.binding.lock().await;
		if request.cancelled.load(Ordering::SeqCst) || permit.revoked.load(Ordering::SeqCst) {
			return Err("浏览器操作已取消".into());
		}
		let reopen = if let Some(target) = binding.as_ref() {
			if command.generation.as_deref() != Some(&target.generation) {
				return Err("浏览器实例已变化，未执行旧操作".into());
			}
			*request.target.lock().unwrap() = Some(target.clone());
			let status = service.status(target).await?;
			if status.control == Control::Closed {
				if !matches!(command.action, Action::Open { .. }) {
					return Err("浏览器已关闭，请使用 open 打开网页，开始新的浏览任务".into());
				}
				// A pre-close open must not recreate a browser after the user closed it.
				if command.control_version != Some(status.control_version) {
					return Err("浏览器已关闭，未执行关闭前的旧操作，请重新读取状态后打开网页".into());
				}
				true
			} else {
				false
			}
		} else {
			if !matches!(command.action, Action::Open { .. }) || command.generation.is_some() {
				return Err("请先打开网页，再读取或操作页面".into());
			}
			true
		};
		let target = if reopen {
			let status = service
				.start_checked(
					permit.chat_id.clone(),
					3_600_000,
					Some((&request.cancelled, &permit.revoked)),
				)
				.await?;
			*binding = Some(status.target.clone());
			status.target
		} else {
			binding.as_ref().unwrap().clone()
		};
		*request.target.lock().unwrap() = Some(target.clone());
		drop(binding);
		if request.cancelled.load(Ordering::SeqCst) || permit.revoked.load(Ordering::SeqCst) {
			stop_request(service.clone(), target.clone(), id.clone());
			// Startup itself may have completed after cancellation. Close its AI gate even if no page operation was queued.
			if service.entry(&target)?.status().control == Control::Ai {
				let _ = service.control(&target, ControlAction::Stop).await;
			}
			return Err("浏览器操作已取消".into());
		}
		let status = service.status(&target).await?;
		let version = if reopen {
			status.control_version
		} else {
			command.control_version.unwrap_or(status.control_version)
		};
		if command.generation.is_some() && command.control_version.is_none() {
			return Err("缺少浏览器控制权版本".into());
		}
		service
			.execute_checked(
				target,
				id.clone(),
				version,
				command.action,
				Some(&request.cancelled),
			)
			.await
	}
	.await;
	request.finished.store(true, Ordering::SeqCst);
	let target = request.target.lock().unwrap().clone();
	let status = target
		.as_ref()
		.and_then(|target| service.entry(target).ok())
		.map(|entry| entry.status());
	let outcome = if request.cancelled.load(Ordering::SeqCst) {
		"cancelled"
	} else if permit.revoked.load(Ordering::SeqCst) {
		"revoked"
	} else {
		match status.as_ref().map(|status| &status.control) {
			Some(Control::Human | Control::TakingOver) => "humanControl",
			Some(Control::Stopping | Control::Stopped) => "cancelled",
			Some(Control::Closed | Control::Closing) => "closed",
			Some(Control::Disconnected) => "disconnected",
			_ => {
				if result.is_ok() {
					"success"
				} else if result.as_ref().err().is_some_and(|error| {
					error.contains("超时")
						|| error.to_lowercase().contains("timeout")
						|| error.to_lowercase().contains("timed out")
				}) {
					"timeout"
				} else {
					"failed"
				}
			}
		}
	};
	let details = json!({"requestId":id,"operation":operation,"target":target_label,"durationMs":started.elapsed().as_millis() as u64,"outcome":outcome,"browser":status});
	match result {
		Ok(data) if outcome == "success" => json!({"success":true,"data":data,"details":details}),
		result => {
			json!({"success":false,"error":result.err().unwrap_or_else(||"浏览器控制权已变化，请核对页面".into()),"details":details})
		}
	}
}
async fn cancel(
	State(service): State<Arc<Service>>,
	headers: HeaderMap,
	Json(cancel): Json<AgentCancel>,
) -> Response {
	let permit = match authenticate(&service, &headers) {
		Ok(permit) => permit,
		Err(code) => return code.into_response(),
	};
	if cancel.request_id.is_empty() || cancel.request_id.len() > 128 {
		return StatusCode::BAD_REQUEST.into_response();
	}
	let request = {
		let mut requests = permit.requests.lock().unwrap();
		if requests.len() >= 4096 && !requests.contains_key(&cancel.request_id) {
			return StatusCode::TOO_MANY_REQUESTS.into_response();
		}
		requests
			.entry(cancel.request_id.clone())
			.or_insert_with(|| Arc::new(Request::new()))
			.clone()
	};
	request.cancelled.store(true, Ordering::SeqCst);
	if !request.finished.load(Ordering::SeqCst) {
		if let Some(target) = request.target.lock().unwrap().clone() {
			stop_request(service, target, cancel.request_id);
		}
	}
	Json(json!({"success":true,"outcome":"cancelling"})).into_response()
}

impl Action {
	fn name(&self) -> &'static str {
		match self {
			Self::Open { .. } => "open",
			Self::Snapshot => "snapshot",
			Self::Click { .. } => "click",
			Self::Fill { .. } => "fill",
			Self::Press { .. } => "press",
			Self::Scroll { .. } => "scroll",
			Self::Wait { .. } => "wait",
			Self::Screenshot => "screenshot",
			Self::Drag { .. } => "drag",
			Self::Mouse { .. } => "mouse",
			Self::Get { .. } => "get",
		}
	}
	fn target_label(&self) -> Option<String> {
		match self {
			Self::Open { url } => Some(url.clone()),
			Self::Click { selector } | Self::Fill { selector, .. } => Some(selector.clone()),
			Self::Press { key } => Some(key.clone()),
			Self::Scroll { direction, .. } => Some(direction.clone()),
			Self::Drag { source, target, .. } => Some(format!("{source} → {target}")),
			Self::Mouse { sub, .. } => Some(sub.clone()),
			Self::Get { kind, selector, .. } => {
				Some(selector.clone().unwrap_or_else(|| kind.clone()))
			}
			_ => None,
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use futures_util::FutureExt;

	async fn call(service: &Service, lease: &AgentLease, id: &str, action: Value) -> Value {
		let context = lease.permit.context(service).await.unwrap();
		reqwest::Client::new().post(format!("http://127.0.0.1:{}/v1/agent/command", service.port))
			.bearer_auth(&lease.token).json(&json!({"requestId":id,"generation":context.as_ref().map(|s| &s.target.generation),"controlVersion":context.map(|s| s.control_version),"action":action}))
			.send().await.unwrap().json().await.unwrap()
	}

	#[tokio::test]
	async fn lease_settings_and_pre_cancel_do_not_start_browser() {
		let root = std::env::temp_dir().join(format!("skiff-agent-lease-{}", opaque()));
		let service = Service::new(root.clone(), vec![]).await.unwrap();
		assert!(service.grant_agent("chat".into()).unwrap().is_none());
		let mut settings = service.settings.lock().unwrap().clone();
		settings.enabled = true;
		service.configure(settings).await.unwrap();
		let first = service.grant_agent("chat".into()).unwrap().unwrap();
		let lease = service.grant_agent("chat".into()).unwrap().unwrap();
		assert!(first.permit.revoked.load(Ordering::SeqCst));
		let url = format!("http://127.0.0.1:{}/v1/agent", service.port);
		let client = reqwest::Client::new();
		assert_eq!(
			client
				.get(format!("{url}/context"))
				.bearer_auth(&first.token)
				.send()
				.await
				.unwrap()
				.status(),
			401
		);
		assert_eq!(
			client
				.get(format!("{url}/context"))
				.bearer_auth(&lease.token)
				.header("Origin", "http://tauri.localhost")
				.send()
				.await
				.unwrap()
				.status(),
			403
		);
		client
			.post(format!("{url}/cancel"))
			.bearer_auth(&lease.token)
			.json(&json!({"requestId":"pre-cancelled"}))
			.send()
			.await
			.unwrap();
		let result = call(
			&service,
			&lease,
			"pre-cancelled",
			json!({"type":"open","url":"http://127.0.0.1:1"}),
		)
		.await;
		assert_eq!(result["details"]["outcome"], "cancelled");
		assert!(service.entries.lock().unwrap().is_empty());
		assert_eq!(
			call(
				&service,
				&lease,
				"pre-cancelled",
				json!({"type":"snapshot"})
			)
			.await["details"]["outcome"],
			"duplicate"
		);
		let mut settings = service.settings.lock().unwrap().clone();
		settings.enabled = false;
		service.configure(settings).await.unwrap();
		assert!(lease.permit.revoked.load(Ordering::SeqCst));
		assert!(
			!serde_json::from_slice::<Settings>(
				&std::fs::read(root.join("settings.json")).unwrap()
			)
			.unwrap()
			.enabled
		);
		service.shutdown().await.unwrap();
		drop(service);
		let _ = std::fs::remove_dir_all(root);
	}

	#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
	async fn closing_preserves_lease_but_cancels_pending_and_rejects_stale_open() {
		let root = std::env::temp_dir().join(format!("skiff-agent-close-{}", opaque()));
		let service = Service::new(root.clone(), vec![]).await.unwrap();
		let mut settings = service.settings.lock().unwrap().clone();
		settings.enabled = true;
		service.configure(settings).await.unwrap();
		let lease = service.grant_agent("chat".into()).unwrap().unwrap();
		// A fixture with no daemon exercises close without launching Chrome.
		let entry = service.new_entry("chat", "fixture".into(), 3_600_000).unwrap();
		entry.update(Control::Ai, None);
		service.entries.lock().unwrap().insert("chat".into(), entry.clone());
		let before = entry.status();
		*lease.permit.binding.lock().await = Some(before.target.clone());
		let queued = Arc::new(Request::new());
		lease.permit.requests.lock().unwrap().insert("queued".into(), queued.clone());
		let closed = service.close(&before.target).await.unwrap();
		assert_eq!(closed.control, Control::Closed);
		assert!(!lease.permit.revoked.load(Ordering::SeqCst));
		assert!(queued.cancelled.load(Ordering::SeqCst));
		let response = reqwest::Client::new()
			.get(format!("http://127.0.0.1:{}/v1/agent/context", service.port))
			.bearer_auth(&lease.token).send().await.unwrap();
		assert_eq!(response.status(), 200);
		assert_eq!(response.json::<Value>().await.unwrap()["status"]["control"], "closed");
		let stale = execute(service.clone(), lease.permit.clone(), AgentCommand {
			request_id: "stale-open".into(), generation: Some(before.target.generation.clone()),
			control_version: Some(before.control_version),
			action: Action::Open { url: "http://127.0.0.1:1".into() },
		}).await;
		assert_eq!(stale["success"], false, "{stale}");
		assert!(stale["error"].as_str().unwrap().contains("关闭前"));
		let snapshot = call(&service, &lease, "closed-snapshot", json!({"type":"snapshot"})).await;
		assert_eq!(snapshot["details"]["outcome"], "closed", "{snapshot}");
		assert_eq!(service.entries.lock().unwrap()["chat"].status().target.generation, before.target.generation);
		service.shutdown().await.unwrap();
		drop(lease);
		drop(service);
		let _ = std::fs::remove_dir_all(root);
	}

	#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
	#[ignore = "requires Windows and real agent-browser 0.41.2; isolated local fixture"]
	async fn real_agent_tools_cancel_takeover_and_reconnect() {
		use axum::{response::Html, routing::get};
		let root = std::env::temp_dir().join(format!("skiff-agent-tools-{}", opaque()));
		let site = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
		let url = format!("http://{}", site.local_addr().unwrap());
		let site = tokio::spawn(async move {
			axum::serve(site, Router::new().route("/", get(|| async { Html("<!doctype html><meta charset=utf-8><input id=name aria-label=姓名><button id=submit onclick=\"this.textContent='完成：'+document.querySelector('#name').value\">提交</button>") }))).await.unwrap();
		});
		let service = Service::new(root.clone(), vec![]).await.unwrap();
		let result = std::panic::AssertUnwindSafe(async {
			let mut settings = service.settings.lock().unwrap().clone();
			settings.enabled = true;
			service.configure(settings).await.unwrap();
			let lease = service.grant_agent("chat-a".into()).unwrap().unwrap();
			assert!(
				service.entries.lock().unwrap().is_empty(),
				"Grant must be lazy"
			);
			for (id, action) in [
				("open", json!({"type":"open","url":url})),
				(
					"fill",
					json!({"type":"fill","selector":"#name","text":"原生工具验证"}),
				),
				("click", json!({"type":"click","selector":"#submit"})),
			] {
				let result = call(&service, &lease, id, action).await;
				assert_eq!(result["success"], true, "{result}");
				assert_eq!(result["details"]["browser"]["chatId"], "chat-a");
			}
			let snapshot = call(&service, &lease, "snapshot", json!({"type":"snapshot"})).await;
			assert!(snapshot["data"]["snapshot"]
				.as_str()
				.unwrap()
				.contains("完成：原生工具验证"));
			let screenshot =
				call(&service, &lease, "screenshot", json!({"type":"screenshot"})).await;
			assert_eq!(screenshot["data"]["mimeType"], "image/png", "{screenshot}");
			assert!(screenshot["data"]["data"]
				.as_str()
				.unwrap()
				.starts_with("iVBOR"));
			let target = lease.permit.binding.lock().await.clone().unwrap();
			service
				.control(&target, ControlAction::TakeOver)
				.await
				.unwrap();
			assert_eq!(
				call(
					&service,
					&lease,
					"human",
					json!({"type":"click","selector":"#submit"})
				)
				.await["details"]["outcome"],
				"humanControl"
			);
			service
				.control(&target, ControlAction::Return)
				.await
				.unwrap();
			assert_eq!(
				call(&service, &lease, "after-return", json!({"type":"snapshot"})).await["success"],
				true
			);
			let wait = call(
				&service,
				&lease,
				"wait",
				json!({"type":"wait","milliseconds":1500}),
			);
			let cancel = async {
				loop {
					if service
						.entry(&target)
						.unwrap()
						.data
						.lock()
						.unwrap()
						.active
						.is_some()
					{
						break;
					}
					tokio::time::sleep(Duration::from_millis(10)).await;
				}
				let response = reqwest::Client::new()
					.post(format!("http://127.0.0.1:{}/v1/agent/cancel", service.port))
					.bearer_auth(&lease.token)
					.json(&json!({"requestId":"wait"}))
					.send()
					.await
					.unwrap();
				assert!(response.status().is_success());
				assert_eq!(
					service.entry(&target).unwrap().status().control,
					Control::Stopping
				);
			};
			let (wait, _) = tokio::time::timeout(Duration::from_secs(15), async {
				tokio::join!(wait, cancel)
			})
			.await
			.unwrap();
			assert_eq!(wait["details"]["outcome"], "cancelled");
			tokio::time::timeout(Duration::from_secs(10), async {
				while service.entry(&target).unwrap().status().control != Control::Stopped {
					tokio::time::sleep(Duration::from_millis(20)).await;
				}
			})
			.await
			.unwrap();
			let next = service.grant_agent("chat-a".into()).unwrap().unwrap();
			assert!(lease.permit.revoked.load(Ordering::SeqCst));
			service
				.control(&target, ControlAction::Return)
				.await
				.unwrap();
			assert_eq!(
				call(&service, &next, "next", json!({"type":"snapshot"})).await["success"],
				true
			);
			service.close(&target).await.unwrap();
			assert!(!next.permit.revoked.load(Ordering::SeqCst));
			let reopened = call(&service, &next, "reopen", json!({"type":"open","url":url})).await;
			assert_eq!(reopened["success"], true, "{reopened}");
			assert_ne!(reopened["details"]["browser"]["generation"], target.generation);
		})
		.catch_unwind()
		.await;
		let cleanup = service.shutdown().await;
		site.abort();
		drop(service);
		let _ = std::fs::remove_dir_all(root);
		assert!(cleanup.is_ok(), "{cleanup:?}");
		if let Err(panic) = result {
			std::panic::resume_unwind(panic);
		}
	}
}
