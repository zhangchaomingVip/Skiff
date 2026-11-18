//! Human input goes to the managed page over CDP. Presses, releases, keys and
//! flushes wait for Chrome's acknowledgement; pointer moves only rely on the
//! socket's ordering, so a drag never queues behind page latency.
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
	async fn send(&mut self, method: &str, params: Value, attached: bool) -> Result<u64> {
		self.id += 1;
		let id = self.id;
		let mut message = json!({"id":id,"method":method,"params":params});
		if attached {
			message["sessionId"] = json!(self.session);
		}
		self.socket
			.send(Message::Text(message.to_string().into()))
			.await
			.map_err(|_| "浏览器输入连接已断开")?;
		Ok(id)
	}
	async fn request(&mut self, method: &str, params: Value, attached: bool) -> Result<Value> {
		let id = self.send(method, params, attached).await?;
		tokio::time::timeout(Duration::from_secs(3), async {
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
		let (page, page_url) =
			select_page(&targets, &current_url).ok_or("没有可操作的浏览器页面")?;
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
		// The recorded URL can lag a scripted redirect, so the page target just attached
		// is the truthful address; refresh it for later selections and the panel.
		if page_url != current_url {
			let url: String = page_url.chars().take(8192).collect();
			entry.data.lock().unwrap().status.url = Some(url);
			entry.changed.notify_waiters();
		}
		Ok(driver)
	}
	pub(super) fn describe(value: &Value) -> Result<(&'static str, Value)> {
		let kind = value["eventType"].as_str().ok_or("无效输入事件")?;
		let method = if value["type"] == "input_mouse" {
			"Input.dispatchMouseEvent"
		} else if kind == "char" {
			"Input.insertText"
		} else {
			"Input.dispatchKeyEvent"
		};
		if method == "Input.insertText" {
			return Ok((method, json!({"text":value["text"]})));
		}
		let mut params = value.clone();
		let object = params.as_object_mut().ok_or("无效输入")?;
		object.remove("type");
		object.remove("eventType");
		object.remove("controlVersion");
		object.remove("inputId");
		object.retain(|_, item| !item.is_null());
		object.insert("type".into(), json!(kind));
		Ok((method, params))
	}
	pub(super) async fn dispatch(&mut self, value: &Value) -> Result<()> {
		let (method, params) = Self::describe(value)?;
		self.request(method, params, true).await.map(|_| ())
	}
	/// Pointer moves need order, not confirmation. The CDP socket preserves order,
	/// and waiting for every acknowledgement would let a drag queue behind page
	/// latency until the handle visibly stops following the cursor.
	pub(super) async fn dispatch_move(&mut self, value: &Value) -> Result<()> {
		let (method, params) = Self::describe(value)?;
		self.send(method, params, true).await.map(|_| ())
	}
	pub(super) async fn reload(&mut self) -> Result<()> {
		self.request("Page.reload", json!({"ignoreCache":false}), true)
			.await
			.map(|_| ())
	}
}

/// Human input belongs to the managed tab. Chrome keeps auxiliary pages such as
/// `chrome://newtab` beside it, and attaching to one of those accepts every event while
/// the real page never sees a click, so selection is limited to web pages.
fn web_page(url: &str) -> bool {
	["http://", "https://", "file://"]
		.iter()
		.any(|scheme| url.starts_with(scheme))
}

/// A recorded URL that only differs by query, fragment or a trailing slash is the same
/// page: sites commonly route through `?clientId=…&state=…` before showing a form.
fn page_address(url: &str) -> &str {
	let address = url.split(['?', '#']).next().unwrap_or("");
	if address.len() > 8 {
		address.trim_end_matches('/')
	} else {
		address
	}
}

pub(super) fn select_page(targets: &Value, current_url: &str) -> Option<(String, String)> {
	let pages: Vec<&Value> = targets["targetInfos"]
		.as_array()?
		.iter()
		.filter(|target| target["type"] == "page")
		.filter(|target| target["url"].as_str().is_some_and(web_page))
		.collect();
	let current = page_address(current_url);
	let page = pages
		.iter()
		.find(|target| target["url"].as_str() == Some(current_url))
		.or_else(|| {
			pages.iter().find(|target| {
				target["url"]
					.as_str()
					.is_some_and(|url| page_address(url) == current)
			})
		})
		.or_else(|| pages.first())?;
	Some((
		page["targetId"].as_str()?.to_owned(),
		page["url"].as_str()?.to_owned(),
	))
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

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn human_input_never_attaches_to_a_browser_internal_page() {
		let targets = json!({"targetInfos":[
			{"type":"page","targetId":"newtab","url":"chrome://newtab/"},
			{"type":"page","targetId":"login","url":"http://10.0.0.1:8080/login?clientId=a&state=b"},
			{"type":"page","targetId":"blank","url":"about:blank"},
			{"type":"service_worker","targetId":"worker","url":"http://10.0.0.1:8080/sw.js"}
		]});
		// The recorded address after a scripted redirect is stale; the login page must win
		// over the auxiliary new tab that Chrome lists first.
		assert_eq!(
			select_page(&targets, "http://10.0.0.1:8080/resources"),
			Some((
				"login".into(),
				"http://10.0.0.1:8080/login?clientId=a&state=b".into()
			))
		);
		assert_eq!(
			select_page(&targets, "http://10.0.0.1:8080/login/"),
			Some((
				"login".into(),
				"http://10.0.0.1:8080/login?clientId=a&state=b".into()
			))
		);
	}

	#[test]
	fn internal_pages_alone_offer_no_human_input_target() {
		let targets = json!({"targetInfos":[
			{"type":"page","targetId":"newtab","url":"chrome://newtab/"},
			{"type":"page","targetId":"blank","url":"about:blank"}
		]});
		assert_eq!(select_page(&targets, ""), None);
		assert_eq!(select_page(&json!({}), "about:blank"), None);
	}
}
