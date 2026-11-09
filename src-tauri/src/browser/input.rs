//! Human input uses acknowledged CDP commands; a stream ping only acknowledges receipt.
use super::*;
use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpStream;
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};

pub(super) struct Driver {
	socket: WebSocketStream<MaybeTlsStream<TcpStream>>,
	id: u64,
	session: String,
}
impl Driver {
	async fn request(&mut self, method: &str, params: Value, attached: bool) -> Result<Value> {
		self.id += 1;
		let id = self.id;
		let mut message = json!({"id":id,"method":method,"params":params});
		if attached {
			message["sessionId"] = json!(self.session);
		}
		tokio::time::timeout(Duration::from_secs(3), async {
			self.socket
				.send(Message::Text(message.to_string().into()))
				.await
				.map_err(|_| "浏览器输入连接已断开")?;
			while let Some(Ok(message)) = self.socket.next().await {
				if let Message::Text(text) = message {
					if let Ok(value) = serde_json::from_str::<Value>(&text) {
						if value["id"] == id {
							return if value.get("error").is_some() {
								Err("浏览器未确认输入，请重新连接".into())
							} else {
								Ok(value["result"].clone())
							};
						}
					}
				}
			}
			Err("浏览器输入连接已断开".into())
		})
		.await
		.map_err(|_| "浏览器输入确认超时".to_string())?
	}
	pub(super) async fn connect(entry: &Entry) -> Result<Self> {
		let url = entry
			.data
			.lock()
			.unwrap()
			.cdp_url
			.clone()
			.ok_or("浏览器输入地址不可用")?;
		let (socket, _) = tokio::time::timeout(Duration::from_secs(3), connect_async(url))
			.await
			.map_err(|_| "浏览器输入连接超时")?
			.map_err(|_| "无法连接浏览器输入")?;
		let mut driver = Self {
			socket,
			id: 0,
			session: String::new(),
		};
		let targets = driver
			.request("Target.getTargets", json!({}), false)
			.await?;
		let current_url = entry.status().url.unwrap_or_default();
		let pages: Vec<_> = targets["targetInfos"]
			.as_array()
			.into_iter()
			.flatten()
			.filter(|target| {
				target["type"] == "page"
					&& !target["url"]
						.as_str()
						.unwrap_or("")
						.starts_with("devtools:")
			})
			.collect();
		let page = pages
			.iter()
			.find(|target| target["url"] == current_url)
			.or_else(|| pages.iter().find(|target| target["url"] != "about:blank"))
			.or_else(|| pages.first())
			.and_then(|target| target["targetId"].as_str())
			.ok_or("没有可操作的浏览器页面")?;
		let attached = driver
			.request(
				"Target.attachToTarget",
				json!({"targetId":page,"flatten":true}),
				false,
			)
			.await?;
		driver.session = attached["sessionId"]
			.as_str()
			.ok_or("无法绑定浏览器页面")?
			.into();
		Ok(driver)
	}
	pub(super) async fn dispatch(&mut self, value: &Value) -> Result<()> {
		let mut params = value.clone();
		let object = params.as_object_mut().ok_or("无效输入")?;
		let mouse = value["type"] == "input_mouse";
		let kind = object.remove("eventType").ok_or("无效输入事件")?;
		object.remove("type");
		object.remove("controlVersion");
		object.remove("inputId");
		object.retain(|_, value| !value.is_null());
		object.insert("type".into(), kind);
		let method = if mouse {
			"Input.dispatchMouseEvent"
		} else if value["eventType"] == "char" {
			params = json!({"text":value["text"]});
			"Input.insertText"
		} else {
			"Input.dispatchKeyEvent"
		};
		self.request(method, params, true).await?;
		Ok(())
	}
}

pub(super) fn remember(entry: &Entry, value: &Value) {
	let mut data = entry.data.lock().unwrap();
	if value["type"] == "input_keyboard" {
		let key = value["code"]
			.as_str()
			.or(value["key"].as_str())
			.unwrap_or("");
		data.held_input.retain(|held| {
			!(held["type"] == "input_keyboard"
				&& held["code"].as_str().or(held["key"].as_str()).unwrap_or("") == key)
		});
		if value["eventType"] == "keyDown" {
			data.held_input.push(json!({"type":"input_keyboard","eventType":"keyUp","key":value["key"],"code":value["code"],"windowsVirtualKeyCode":value["windowsVirtualKeyCode"],"modifiers":0}));
		}
	} else if value["type"] == "input_mouse"
		&& ["mousePressed", "mouseReleased"].contains(&value["eventType"].as_str().unwrap_or(""))
	{
		data.held_input
			.retain(|held| !(held["type"] == "input_mouse" && held["button"] == value["button"]));
		if value["eventType"] == "mousePressed" {
			data.held_input.push(json!({"type":"input_mouse","eventType":"mouseReleased","button":value["button"],"x":value["x"],"y":value["y"],"buttons":0,"clickCount":1}));
		}
	}
}
pub(super) async fn release(entry: &Entry) -> Result<()> {
	let held = entry.data.lock().unwrap().held_input.clone();
	if held.is_empty() {
		return Ok(());
	}
	let mut driver = Driver::connect(entry).await?;
	for value in &held {
		driver.dispatch(value).await?;
	}
	entry.data.lock().unwrap().held_input.clear();
	Ok(())
}
