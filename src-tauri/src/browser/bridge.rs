//! Loopback-only typed command bridge and authenticated, filtered WebSocket relay.
use super::*;
use axum::{
	extract::{
		ws::{Message, WebSocket, WebSocketUpgrade},
		DefaultBodyLimit, Query, State,
	},
	http::{HeaderMap, StatusCode},
	response::{IntoResponse, Response},
	routing::{get, post},
	Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::{connect_async, tungstenite::Message as Upstream};

pub(super) fn serve(
	service: Arc<Service>,
	listener: tokio::net::TcpListener,
	mut stop: watch::Receiver<bool>,
) {
	let router = Router::new()
		.merge(super::agent::routes())
		.route("/v1/command", post(command))
		.route("/v1/cancel", post(cancel))
		.route("/v1/stream", get(stream))
		.layer(DefaultBodyLimit::max(64 * 1024))
		.with_state(service);
	tokio::spawn(async move {
		let _ = axum::serve(listener, router)
			.with_graceful_shutdown(async move {
				let _ = stop.changed().await;
			})
			.await;
	});
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CommandRequest {
	target: Target,
	request_id: String,
	control_version: u64,
	action: Action,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CancelRequest {
	target: Target,
	request_id: String,
}

// Extension requests are Node clients, not cross-origin browser requests. No CORS or browser Origin is accepted here.
fn authenticate(
	service: &Service,
	headers: &HeaderMap,
	target: &Target,
) -> std::result::Result<Arc<Entry>, StatusCode> {
	if headers.contains_key("origin") {
		return Err(StatusCode::FORBIDDEN);
	}
	let entry = service
		.entry(target)
		.map_err(|_| StatusCode::UNAUTHORIZED)?;
	let supplied = headers
		.get("authorization")
		.and_then(|header| header.to_str().ok())
		.and_then(|value| value.strip_prefix("Bearer "))
		.unwrap_or("");
	if !secret_eq(supplied, &entry.agent_token) || entry.terminal() {
		return Err(StatusCode::UNAUTHORIZED);
	}
	Ok(entry)
}
fn secret_eq(a: &str, b: &str) -> bool {
	if a.len() != b.len() {
		return false;
	}
	a.bytes()
		.zip(b.bytes())
		.fold(0u8, |diff, (a, b)| diff | (a ^ b))
		== 0
}
fn response(result: Result<Value>) -> Response {
	match result {
		Ok(data) => Json(json!({"success":true,"data":data})).into_response(),
		Err(error) => (
			StatusCode::CONFLICT,
			Json(json!({"success":false,"error":error})),
		)
			.into_response(),
	}
}
async fn command(
	State(service): State<Arc<Service>>,
	headers: HeaderMap,
	Json(request): Json<CommandRequest>,
) -> Response {
	if let Err(status) = authenticate(&service, &headers, &request.target) {
		return status.into_response();
	}
	// A dropped HTTP client must not drop the operation lock while the daemon is still executing.
	let task = tokio::spawn(async move {
		service
			.execute(
				request.target,
				request.request_id,
				request.control_version,
				request.action,
			)
			.await
	});
	response(
		task.await
			.unwrap_or_else(|_| Err("浏览器操作任务异常结束".into())),
	)
}
async fn cancel(
	State(service): State<Arc<Service>>,
	headers: HeaderMap,
	Json(request): Json<CancelRequest>,
) -> Response {
	if let Err(status) = authenticate(&service, &headers, &request.target) {
		return status.into_response();
	}
	let result = service.cancel(&request.target, &request.request_id);
	if result.is_ok() {
		tokio::spawn(async move {
			let _ = service.control(&request.target, ControlAction::Stop).await;
		});
	}
	response(result.map(|status| json!(status)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Viewer {
	chat_id: String,
	generation: String,
	token: String,
}
async fn stream(
	State(service): State<Arc<Service>>,
	headers: HeaderMap,
	Query(viewer): Query<Viewer>,
	upgrade: WebSocketUpgrade,
) -> Response {
	let origin = headers
		.get("origin")
		.and_then(|header| header.to_str().ok())
		.unwrap_or("");
	if !service.origins.iter().any(|allowed| allowed == origin) {
		return StatusCode::FORBIDDEN.into_response();
	}
	let Ok(entry) = service.entry(&Target {
		chat_id: viewer.chat_id,
		generation: viewer.generation,
	}) else {
		return StatusCode::UNAUTHORIZED.into_response();
	};
	if !secret_eq(&viewer.token, &entry.viewer_token) || entry.terminal() {
		return StatusCode::UNAUTHORIZED.into_response();
	}
	// A fixed cap per entry avoids multiple uncontrolled streams accumulating on hidden tabs.
	upgrade
		.max_message_size(64 * 1024)
		.max_frame_size(64 * 1024)
		.on_upgrade(move |socket| relay(socket, entry))
		.into_response()
}

async fn relay(socket: WebSocket, entry: Arc<Entry>) {
	let Ok(_viewer) = entry.viewers.clone().try_acquire_owned() else {
		return;
	};
	let Some(port) = entry.data.lock().unwrap().stream_port else {
		return;
	};
	let Ok(Ok((upstream, _))) = tokio::time::timeout(
		Duration::from_secs(5),
		connect_async(format!("ws://127.0.0.1:{port}/?pacing=ack&maxFps=10")),
	)
	.await
	else {
		return;
	};
	let (mut client_out, mut client_in) = socket.split();
	let (upstream_out, mut upstream_in) = upstream.split();
	let upstream_out = Arc::new(AsyncMutex::new(upstream_out));
	let (input_ack, mut input_acks) = tokio::sync::mpsc::channel::<Value>(32);
	let mut stop = entry.closed.subscribe();
	if *stop.borrow() {
		return;
	}
	let reader_entry = entry.clone();
	let reader_upstream = upstream_out.clone();
	let input = async move {
		let mut window = tokio::time::Instant::now();
		let mut count = 0u32;
		let mut driver = None;
		while let Some(Ok(message)) = client_in.next().await {
			let Message::Text(text) = message else {
				if matches!(message, Message::Close(_)) {
					break;
				}
				continue;
			};
			if window.elapsed() >= Duration::from_secs(1) {
				count = 0;
				window = tokio::time::Instant::now();
			}
			count += 1;
			if count > 240 {
				break;
			}
			let Ok(mut value) = serde_json::from_str::<Value>(&text) else {
				break;
			};
			let _gate = reader_entry.input.lock().await;
			if !allowed_message(&mut value, &reader_entry.status()) {
				continue;
			}
			let is_input = value["type"]
				.as_str()
				.is_some_and(|kind| kind.starts_with("input_"));
			if is_input {
				let result: Result<()> = async {
					if value["type"] == "input_flush" {
						return Ok(());
					}
					if driver.is_none() {
						driver = Some(super::input::Driver::connect(&reader_entry).await?);
					}
					super::input::remember(&reader_entry, &value);
					driver.as_mut().unwrap().dispatch(&value).await
				}
				.await;
				if let Err(error) = result {
					eprintln!("[skiff] browser input: {error}");
					reader_entry.invalidate(Control::Faulted);
					reader_entry.update(
						Control::Faulted,
						Some("无法确认浏览器输入已送达，请重新连接".into()),
					);
					break;
				}
				if let Some(id) = value["inputId"].as_str() {
					if input_ack
						.send(json!({"type":"input_ack","inputId":id}))
						.await
						.is_err()
					{
						break;
					}
				}
			} else if reader_upstream
				.lock()
				.await
				.send(Upstream::Text(value.to_string().into()))
				.await
				.is_err()
			{
				break;
			}
		}
	};
	let output = async {
		loop {
			tokio::select! {
				_ = stop.changed() => break,
				Some(ack) = input_acks.recv() => { if client_out.send(Message::Text(ack.to_string().into())).await.is_err() { break; } },
				_ = entry.changed.notified() => {
					let state = json!({"type":"control","status":entry.status()});
					if client_out.send(Message::Text(state.to_string().into())).await.is_err() { break; }
				},
				message = upstream_in.next() => {
					let Some(Ok(message)) = message else { break; };
					let Upstream::Text(text) = message else { if matches!(message, Upstream::Close(_)) { break; } continue; };
					if let Ok(value) = serde_json::from_str::<Value>(&text) {
						if value["type"] == "url" { if let Some(url) = value["url"].as_str() { entry.data.lock().unwrap().status.url = Some(url.chars().take(8192).collect()); } }
						if value["type"] == "status" && value["connected"] == false { entry.invalidate(Control::Disconnected); break; }
						// Console/network output can carry secrets and is not needed for a viewport.
						if !["frame", "status", "url", "tabs"].iter().any(|kind| value["type"] == *kind) { continue; }
					}
					if !tokio::time::timeout(Duration::from_secs(5), client_out.send(Message::Text(text.to_string().into()))).await.is_ok_and(|sent| sent.is_ok()) { break; }
				}
			}
		}
	};
	tokio::select! { _ = input => {}, _ = output => {} }
	{
		let _gate = entry.input.lock().await;
		if let Err(error) = super::input::release(&entry).await {
			entry.invalidate(Control::Faulted);
			entry.update(Control::Faulted, Some(error));
		}
	}
	let _ = tokio::time::timeout(Duration::from_secs(1), upstream_out.lock().await.close()).await;
}

fn allowed_message(value: &mut Value, status: &BrowserStatus) -> bool {
	let Some(kind) = value["type"].as_str().map(str::to_owned) else {
		return false;
	};
	if kind == "ack" {
		return value["seq"].as_u64().is_some();
	}
	if kind == "config" {
		// Viewer controls rate only; force bounded latest-frame delivery.
		*value = json!({"type":"config","pacing":"ack","maxFps":value["maxFps"].as_u64().unwrap_or(10).clamp(1, 15)});
		return true;
	}
	if status.control != Control::Human
		|| value["controlVersion"].as_u64() != Some(status.control_version)
	{
		return false;
	}
	let number = |key: &str, min: f64, max: f64| {
		value[key]
			.as_f64()
			.is_some_and(|n| n.is_finite() && n >= min && n <= max)
	};
	let valid = match kind.as_str() {
		"input_flush" => value["inputId"]
			.as_str()
			.is_some_and(|id| !id.is_empty() && id.len() <= 128),
		"input_mouse" => {
			["mousePressed", "mouseReleased", "mouseMoved", "mouseWheel"]
				.contains(&value["eventType"].as_str().unwrap_or(""))
				&& number("x", 0.0, 16384.0)
				&& number("y", 0.0, 16384.0)
		}
		"input_keyboard" => {
			["keyDown", "keyUp", "char"].contains(&value["eventType"].as_str().unwrap_or(""))
				&& ["key", "code", "text"].iter().all(|key| {
					value.get(*key).is_none_or(|v| {
						v.as_str()
							.is_some_and(|s| s.len() <= if *key == "text" { 49152 } else { 256 })
					})
				})
		}
		_ => false,
	};
	let optional_number =
		|key: &str, min: f64, max: f64| value.get(key).is_none() || number(key, min, max);
	let valid = valid
		&& optional_number("modifiers", 0.0, 15.0)
		&& optional_number("windowsVirtualKeyCode", 0.0, 255.0)
		&& optional_number("buttons", 0.0, 31.0)
		&& optional_number("clickCount", 0.0, 3.0)
		&& optional_number("deltaX", -10000.0, 10000.0)
		&& optional_number("deltaY", -10000.0, 10000.0)
		&& value
			.get("inputId")
			.is_none_or(|v| v.as_str().is_some_and(|id| id.len() <= 128))
		&& value.get("button").is_none_or(|v| {
			["none", "left", "middle", "right", "back", "forward"]
				.contains(&v.as_str().unwrap_or(""))
		});
	if valid {
		let keys: &[&str] = match kind.as_str() {
			"input_mouse" => &[
				"type",
				"eventType",
				"x",
				"y",
				"button",
				"buttons",
				"clickCount",
				"deltaX",
				"deltaY",
				"modifiers",
				"inputId",
			],
			"input_keyboard" => &[
				"type",
				"eventType",
				"key",
				"code",
				"text",
				"windowsVirtualKeyCode",
				"modifiers",
				"autoRepeat",
				"inputId",
			],
			_ => &["type", "inputId"],
		};
		value
			.as_object_mut()
			.unwrap()
			.retain(|key, _| keys.contains(&key.as_str()));
	}
	valid
}

#[cfg(test)]
mod tests {
	use super::*;
	#[test]
	fn input_requires_current_human_control_and_ack_stays_live() {
		let mut status = BrowserStatus {
			target: Target {
				chat_id: "a".into(),
				generation: "b".into(),
			},
			control: Control::Ai,
			control_version: 3,
			requires_snapshot: false,
			url: None,
			error: None,
		};
		let input = json!({"type":"input_mouse","eventType":"mousePressed","x":12,"y":20,"controlVersion":3});
		assert!(!allowed_message(&mut input.clone(), &status));
		assert!(allowed_message(&mut json!({"type":"ack","seq":1}), &status));
		status.control = Control::Human;
		assert!(allowed_message(&mut input.clone(), &status));
		status.control_version = 4;
		assert!(!allowed_message(&mut input.clone(), &status));
		assert!(!allowed_message(
			&mut json!({"type":"eval","expression":"1"}),
			&status
		));
		assert!(!allowed_message(
			&mut json!({"type":"input_mouse","eventType":"mousePressed","x":-1,"y":20,"controlVersion":4}),
			&status
		));
	}
}
