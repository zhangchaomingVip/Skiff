//! Human input goes to the managed page over CDP. Presses, releases, keys and
//! flushes wait for Chrome's acknowledgement; pointer moves only rely on the
//! socket's ordering, so a drag never queues behind page latency.
//!
//! The driver follows the panel's active tab: switching or closing a tab rebinds
//! the CDP session before the next event, so a click never lands in a hidden page.
use super::*;
use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpStream;
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};

pub(super) struct Driver {
	socket: WebSocketStream<MaybeTlsStream<TcpStream>>,
	id: u64,
	session: String,
	target_id: String,
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
	pub(super) async fn connect_browser(entry: &Entry) -> Result<Self> {
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
		Ok(Self {
			socket,
			id: 0,
			session: String::new(),
			target_id: String::new(),
		})
	}
	/// Bind a page session. Prefer the panel's active target; fall back to the recorded
	/// URL only for a browser that has no active target yet.
	pub(super) async fn connect(entry: &Entry) -> Result<Self> {
		let mut driver = Self::connect_browser(entry).await?;
		let targets = driver
			.request("Target.getTargets", json!({}), false)
			.await?;
		let active = entry.status().active_tab_id.unwrap_or_default();
		let current_url = entry.status().url.unwrap_or_default();
		let page = page_target(&targets, &active)
			.or_else(|| select_page(&targets, &current_url));
		match page {
			Some((target, _)) => driver.attach(&target).await?,
			None => {
				driver.target_id = active;
				driver.session.clear();
			}
		}
		driver.refresh(entry, &targets).await;
		Ok(driver)
	}
	async fn attach(&mut self, target_id: &str) -> Result<()> {
		let attached = self
			.request(
				"Target.attachToTarget",
				json!({"targetId":target_id,"flatten":true}),
				false,
			)
			.await?;
		self.session = attached["sessionId"]
			.as_str()
			.ok_or("无法绑定浏览器页面")?
			.into();
		self.target_id = target_id.into();
		// A CDP session can attach to a background tab. Chrome does not acknowledge input
		// reliably for those, so bring the panel's tab to the foreground before typing or
		// clicking into it. This also repairs a stale active_tab_id left by a page redirect.
		self.activate().await
	}
	async fn activate(&mut self) -> Result<()> {
		if self.target_id.is_empty() {
			return Ok(());
		}
		self.request(
			"Target.activateTarget",
			json!({"targetId":self.target_id}),
			false,
		)
		.await
		.map(|_| ())
	}
	/// Follow the panel's active target before dispatching. A switch to a browser
	/// internal page detaches the old session instead of leaking events into a hidden tab.
	async fn ensure_target(&mut self, entry: &Entry) -> Result<()> {
		let active = entry.status().active_tab_id.unwrap_or_default();
		if active.is_empty() || active == self.target_id {
			return Ok(());
		}
		let targets = self.request("Target.getTargets", json!({}), false).await?;
		if let Some((target, _)) = page_target(&targets, &active) {
			self.attach(&target).await?;
		} else {
			if !self.session.is_empty() {
				let _ = self
					.request(
						"Target.detachFromTarget",
						json!({"sessionId":self.session}),
						false,
					)
					.await;
			}
			self.session.clear();
			self.target_id = active;
		}
		Ok(())
	}
	/// Refresh the shared tab/history state from the target list and page history.
	async fn refresh(&mut self, entry: &Entry, targets: &Value) {
		let history = if self.session.is_empty() {
			None
		} else {
			self.request("Page.getNavigationHistory", json!({}), true)
				.await
				.ok()
		};
		apply_state(entry, Some(self.target_id.clone()), history.as_ref(), targets);
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
	pub(super) async fn dispatch(&mut self, entry: &Entry, value: &Value) -> Result<()> {
		let (method, params) = Self::describe(value)?;
		self.ensure_target(entry).await?;
		if self.session.is_empty() {
			// New-tab pages accept no page input; dropping the event beats faulting the
			// whole stream while the user is simply looking at a blank tab.
			return Ok(());
		}
		self.activate().await?;
		self.request(method, params, true).await.map(|_| ())
	}
	/// Pointer moves need order, not confirmation. The CDP socket preserves order,
	/// and waiting for every acknowledgement would let a drag queue behind page
	/// latency until the handle visibly stops following the cursor.
	pub(super) async fn dispatch_move(&mut self, entry: &Entry, value: &Value) -> Result<()> {
		let (method, params) = Self::describe(value)?;
		self.ensure_target(entry).await?;
		if self.session.is_empty() {
			return Ok(());
		}
		self.send(method, params, true).await.map(|_| ())
	}
	pub(super) async fn reload(&mut self, entry: &Entry) -> Result<()> {
		self.ensure_target(entry).await?;
		if self.session.is_empty() {
			return Ok(());
		}
		self.activate().await?;
		self.request("Page.reload", json!({"ignoreCache":false}), true)
			.await?;
		sync(entry, self).await
	}
	/// Panel address bar navigation. Restricted to credential-free http/https, matching
	/// the AI's `open` action, so a typed address can never reach local files.
	pub(super) async fn navigate(&mut self, entry: &Entry, url: &str) -> Result<()> {
		let parsed = reqwest::Url::parse(url).map_err(|_| "无效网址")?;
		if !["http", "https"].contains(&parsed.scheme())
			|| !parsed.username().is_empty()
			|| parsed.password().is_some()
		{
			return Err("只支持不含凭据的 http/https 网址".into());
		}
		self.ensure_target(entry).await?;
		if self.session.is_empty() {
			return Err("当前标签页无法打开网页".into());
		}
		let previous_url = entry.status().url.unwrap_or_default();
		self.activate().await?;
		let result = self.request("Page.navigate", json!({"url":url}), true).await?;
		if let Some(error) = result["errorText"].as_str().filter(|error| !error.is_empty()) {
			return Err(format!("网页跳转失败：{error}"));
		}
		sync(entry, self).await?;
		// Chrome can acknowledge navigation before history leaves about:blank. The
		// new-tab UI deliberately has no viewer, so publish the accepted destination
		// now; otherwise nothing starts capture to report the subsequent commit.
		let mut data = entry.data.lock().unwrap();
		if data.status.active_tab_id.as_deref() == Some(self.target_id.as_str())
			&& data.status.url.as_deref().is_none_or(|current| current.is_empty() || current == previous_url)
		{
			data.status.url = Some(url.to_owned());
			let title = parsed.host_str().unwrap_or(url).to_owned();
			data.status.title = Some(title.clone());
			for tab in &mut data.status.tabs {
				if tab.id == self.target_id { tab.url = url.to_owned(); tab.title = title.clone(); }
			}
		}
		drop(data);
		entry.changed.notify_waiters();
		Ok(())
	}
	/// Browser history navigation through the same page session the input uses.
	pub(super) async fn history(&mut self, entry: &Entry, direction: &str) -> Result<()> {
		let step: i64 = match direction {
			"back" => -1,
			"forward" => 1,
			_ => return Err("无效浏览历史方向".into()),
		};
		self.ensure_target(entry).await?;
		if self.session.is_empty() {
			return Err("当前标签页没有浏览历史".into());
		}
		self.activate().await?;
		let history = self
			.request("Page.getNavigationHistory", json!({}), true)
			.await?;
		let current = history["currentIndex"].as_u64().unwrap_or(0) as i64;
		let index = current + step;
		let entry_id = history["entries"]
			.as_array()
			.and_then(|entries| entries.get(index.max(0) as usize))
			.and_then(|entry| entry["id"].as_i64())
			.filter(|_| index >= 0)
			.ok_or("没有可用的浏览历史")?;
		self.request(
			"Page.navigateToHistoryEntry",
			json!({"entryId":entry_id}),
			true,
		)
		.await?;
		sync(entry, self).await
	}
}

/// Human input belongs to the managed tab. Chrome keeps auxiliary pages such as
/// `chrome://newtab` beside it, and attaching to one of those accepts every event while
/// the real page never sees a click, so fallback selection is limited to web pages.
fn web_page(url: &str) -> bool {
	["http://", "https://", "file://"]
		.iter()
		.any(|scheme| url.starts_with(scheme))
}

/// A target the panel can show and navigate. DevTools and extension surfaces are
/// not user pages and would make the tab strip look broken.
fn tab_page(url: &str) -> bool {
	!url.starts_with("devtools://") && !url.starts_with("chrome-extension://")
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

pub(super) fn page_target(targets: &Value, target_id: &str) -> Option<(String, String)> {
	if target_id.is_empty() {
		return None;
	}
	let page = targets["targetInfos"]
		.as_array()?
		.iter()
		.find(|target| {
			target["type"] == "page"
				&& target["targetId"].as_str() == Some(target_id)
				&& target["url"].as_str().is_some_and(tab_page)
		})?;
	Some((
		page["targetId"].as_str()?.to_owned(),
		page["url"].as_str()?.to_owned(),
	))
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

/// Every page target the panel can present as a tab, in Chrome's own order.
pub(super) fn list_tabs(targets: &Value) -> Vec<BrowserTab> {
	let Some(infos) = targets["targetInfos"].as_array() else {
		return Vec::new();
	};
	infos
		.iter()
		.filter(|target| target["type"] == "page")
		.filter(|target| target["url"].as_str().is_some_and(tab_page))
		.filter_map(|target| {
			let id = target["targetId"].as_str()?;
			let url: String = target["url"].as_str().unwrap_or("").chars().take(8192).collect();
			let title: String = target["title"]
				.as_str()
				.unwrap_or("")
				.chars()
				.take(512)
				.collect();
			Some(BrowserTab {
				id: id.into(),
				title,
				url,
				active: false,
			})
		})
		.collect()
}

/// Apply one CDP snapshot. `active` is the target the panel is bound to; when it is
/// absent the first page becomes active, so the strip always has a selected tab.
pub(super) fn apply_state(
	entry: &Entry,
	active: Option<String>,
	history: Option<&Value>,
	targets: &Value,
) {
	let mut tabs = list_tabs(targets);
	let mut active = active.unwrap_or_default();
	if tabs.is_empty() {
		let mut data = entry.data.lock().unwrap();
		data.status.tabs.clear();
		data.status.active_tab_id = None;
		data.status.can_go_back = false;
		data.status.can_go_forward = false;
		drop(data);
		entry.changed.notify_waiters();
		return;
	}
	if active.is_empty() || !tabs.iter().any(|tab| tab.id == active) {
		active = tabs[0].id.clone();
	}
	let selected = tabs.iter().find(|tab| tab.id == active).unwrap();
	let mut url = selected.url.clone();
	let mut title = selected.title.clone();
	let mut can_go_back = false;
	let mut can_go_forward = false;
	if let Some(history) = history {
		let current = history["currentIndex"].as_u64().unwrap_or(0) as usize;
		let entries = history["entries"].as_array();
		if let Some(entries) = entries {
			if let Some(item) = entries.get(current) {
				if let Some(value) = item["url"].as_str() {
					url = value.chars().take(8192).collect();
				}
				if let Some(value) = item["title"].as_str() {
					title = value.chars().take(512).collect();
				}
			}
			can_go_back = current > 0;
			can_go_forward = current + 1 < entries.len();
		}
	}
	// History can lag the target URL on a fresh tab; the active target's own record
	// fills the gap before the first navigation commits.
	if let Some(tab) = tabs.iter().find(|tab| tab.id == active) {
		if url.is_empty() {
			url = tab.url.clone();
		}
		if title.is_empty() {
			title = tab.title.clone();
		}
	}
	for tab in &mut tabs {
		tab.active = tab.id == active;
		if tab.active {
			if !url.is_empty() {
				tab.url = url.clone();
			}
			if !title.is_empty() {
				tab.title = title.clone();
			}
		}
	}
	{
		let mut data = entry.data.lock().unwrap();
		if !url.is_empty() {
			data.status.url = Some(url);
		}
		data.status.title = Some(title);
		data.status.can_go_back = can_go_back;
		data.status.can_go_forward = can_go_forward;
		data.status.tabs = tabs;
		data.status.active_tab_id = Some(active);
	}
	entry.changed.notify_waiters();
}

pub(super) async fn sync(entry: &Entry, driver: &mut Driver) -> Result<()> {
	driver.ensure_target(entry).await?;
	sync_attached(entry, driver).await
}

// An explicit tab action has just attached its destination. Following the entry here
// would reattach the *previous* active tab before the new selection can be published.
async fn sync_attached(entry: &Entry, driver: &mut Driver) -> Result<()> {
	if driver.target_id.is_empty() {
		return Ok(());
	}
	let history = if driver.session.is_empty() {
		None
	} else {
		driver
			.request("Page.getNavigationHistory", json!({}), true)
			.await
			.ok()
	};
	let targets = driver
		.request("Target.getTargets", json!({}), false)
		.await?;
	apply_state(entry, Some(driver.target_id.clone()), history.as_ref(), &targets);
	Ok(())
}

/// Initial tab list after launch. History is unavailable until a page session exists.
pub(super) async fn initialize(entry: &Entry) -> Result<()> {
	let mut driver = Driver::connect_browser(entry).await?;
	let targets = driver
		.request("Target.getTargets", json!({}), false)
		.await?;
	apply_state(entry, None, None, &targets);
	Ok(())
}

/// After an AI `open`, follow the target that actually hosts the requested address.
pub(super) async fn adopt(entry: &Entry, url: &str) -> Result<()> {
	let mut driver = Driver::connect_browser(entry).await?;
	let targets = driver
		.request("Target.getTargets", json!({}), false)
		.await?;
	let tabs = list_tabs(&targets);
	let chosen = tabs
		.iter()
		.find(|tab| tab.url == url)
		.or_else(|| {
			tabs.iter()
				.find(|tab| page_address(&tab.url) == page_address(url))
		})
		.map(|tab| tab.id.clone());
	let Some(chosen) = chosen else {
		apply_state(entry, entry.status().active_tab_id, None, &targets);
		return Ok(());
	};
	let _ = driver
		.request(
			"Target.activateTarget",
			json!({"targetId":chosen}),
			false,
		)
		.await;
	if let Err(error) = driver.attach(&chosen).await {
		eprintln!("[skiff] browser adopt: {error}");
	}
	let history = if driver.session.is_empty() {
		None
	} else {
		driver
			.request("Page.getNavigationHistory", json!({}), true)
			.await
			.ok()
	};
	apply_state(entry, Some(chosen), history.as_ref(), &targets);
	Ok(())
}

fn tab_id(value: &str) -> Result<&str> {
	if value.is_empty() || value.len() > 128 || value.chars().any(char::is_control) {
		Err("无效标签页标识".into())
	} else {
		Ok(value)
	}
}

/// Executes a tab action and reports whether the last page was closed. The caller
/// turns that into a full instance close so no orphan browser window survives.
pub(super) async fn tab_action(
	entry: &Entry,
	driver: &mut Driver,
	action: TabAction,
) -> Result<bool> {
	match action {
		TabAction::Select { tab_id: id } => {
			let id = tab_id(&id)?;
			driver
				.request("Target.activateTarget", json!({"targetId":id}), false)
				.await?;
			driver.attach(id).await?;
			sync_attached(entry, driver).await?;
			Ok(false)
		}
		TabAction::New => {
			let created = driver
				.request(
					"Target.createTarget",
					json!({"url":"about:blank","newWindow":false}),
					false,
				)
				.await?;
			let id = created["targetId"]
				.as_str()
				.ok_or("浏览器未返回新标签页")?
				.to_owned();
			driver
				.request("Target.activateTarget", json!({"targetId":id}), false)
				.await?;
			driver.attach(&id).await?;
			sync_attached(entry, driver).await?;
			Ok(false)
		}
		TabAction::Close { tab_id: closing } => {
			let closing = tab_id(&closing)?;
			let result = driver
				.request("Target.closeTarget", json!({"targetId":closing}), false)
				.await?;
			if result["success"] != true { return Err("浏览器未能关闭标签页".into()); }
			// closeTarget acknowledges the request before Chrome removes the target.
			// Publishing that interim list leaves a ghost tab which cannot be closed again.
			let targets = tokio::time::timeout(Duration::from_secs(3), async {
				loop {
					let targets = driver.request("Target.getTargets", json!({}), false).await?;
					if !list_tabs(&targets).iter().any(|tab| tab.id == closing) {
						return Ok::<Value, String>(targets);
					}
					tokio::time::sleep(Duration::from_millis(25)).await;
				}
			}).await.map_err(|_| "等待标签页关闭超时".to_string())??;
			let tabs = list_tabs(&targets);
			if tabs.is_empty() {
				let mut data = entry.data.lock().unwrap();
				data.status.tabs.clear();
				data.status.active_tab_id = None;
				data.status.can_go_back = false;
				data.status.can_go_forward = false;
				drop(data);
				entry.changed.notify_waiters();
				return Ok(true);
			}
			let current = entry.status().active_tab_id.unwrap_or_default();
			let next = if current == closing
				|| !tabs.iter().any(|tab| tab.id == current)
			{
				tabs[0].id.clone()
			} else {
				current
			};
			let _ = driver
				.request(
					"Target.activateTarget",
					json!({"targetId":next}),
					false,
				)
				.await;
			if let Err(error) = driver.attach(&next).await {
				eprintln!("[skiff] browser tab switch: {error}");
			}
			sync_attached(entry, driver).await?;
			Ok(false)
		}
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
		driver.dispatch(entry, value).await?;
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

	#[test]
	fn tabs_list_page_targets_and_prefer_the_active_id() {
		let targets = json!({"targetInfos":[
			{"type":"page","targetId":"first","url":"https://one.test/a","title":"One"},
			{"type":"page","targetId":"second","url":"https://two.test/b","title":"Two"},
			{"type":"page","targetId":"devtools","url":"devtools://devtools/bundled/inspector.html"},
			{"type":"service_worker","targetId":"worker","url":"https://two.test/sw.js"}
		]});
		let tabs = list_tabs(&targets);
		assert_eq!(tabs.len(), 2);
		assert_eq!(tabs[1].title, "Two");
		assert!(page_target(&targets, "second").is_some());
		assert!(page_target(&targets, "devtools").is_none());
	}
}
