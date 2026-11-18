//! The panel picture is captured by Skiff itself over CDP. The managed stream caps frames
//! at the page's CSS width, so a HiDPI panel upscales every frame and text turns soft;
//! Chrome captures the same page at device resolution instead, at the panel's frame rate.
use super::*;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpStream;
use tokio::time::Instant;
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};

const QUALITY: u64 = 82;
/// Chrome captures on damage and holds the next picture until the previous one is
/// acknowledged. Acknowledging without any ceiling let it paint at compositor speed
/// (measured ~96 fps at 2x, 11 MB/s), which starved input on the same machine.
/// The ack therefore keeps a floor between captures, while the panel still gets the
/// newest picture instead of a backlog.
const ACK_INTERVAL: Duration = Duration::from_millis(30);
/// Pointer feedback only feels live at roughly 30 frames per second; the JPEG is delivered
/// as binary so a frame costs less to move and decode than the old base64 JSON envelope.
const INTERVAL: Duration = Duration::from_millis(33);
/// Encoded size above which a picture is paced slower to keep encoding and transport lean.
const HEAVY_FRAME: usize = 90 * 1024;
const HEAVY_INTERVAL: Duration = Duration::from_millis(66);
const FRAME_LIMIT: usize = 4 * 1024 * 1024;

/// One captured picture, already decoded from CDP's base64 so the viewer reads JPEG bytes.
pub struct Picture {
	pub bytes: Vec<u8>,
}

struct Cdp {
	socket: WebSocketStream<MaybeTlsStream<TcpStream>>,
	id: u64,
	pub session: String,
}

impl Cdp {
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
			.map_err(|_| "浏览器画面连接已断开")?;
		Ok(id)
	}
	async fn request(&mut self, method: &str, params: Value, attached: bool) -> Result<Value> {
		let id = self.send(method, params, attached).await?;
		tokio::time::timeout(Duration::from_secs(5), async {
			while let Some(Ok(message)) = self.socket.next().await {
				let Message::Text(text) = message else {
					continue;
				};
				let Ok(value) = serde_json::from_str::<Value>(&text) else {
					continue;
				};
				if value["id"] == id {
					return if value.get("error").is_some() {
						Err("浏览器未确认画面请求".to_string())
					} else {
						Ok(value["result"].clone())
					};
				}
			}
			Err("浏览器画面连接已断开".to_string())
		})
		.await
		.map_err(|_| "浏览器画面确认超时".to_string())?
	}
	/// Acks must not wait for a reply: the reply loop would swallow the frames Chrome
	/// sends right behind them.
	async fn notify(&mut self, method: &str, params: Value) -> Result<()> {
		self.send(method, params, true).await.map(|_| ())
	}
}

pub(super) async fn run(entry: Arc<Entry>, out: tokio::sync::mpsc::Sender<Picture>) -> Result<()> {
	let url = entry
		.data
		.lock()
		.unwrap()
		.cdp_url
		.clone()
		.ok_or("浏览器画面地址不可用")?;
	let (socket, _) = tokio::time::timeout(Duration::from_secs(3), connect_async(url))
		.await
		.map_err(|_| "浏览器画面连接超时")?
		.map_err(|_| "无法连接浏览器画面")?;
	let mut cdp = Cdp {
		socket,
		id: 0,
		session: String::new(),
	};
	let targets = cdp.request("Target.getTargets", json!({}), false).await?;
	let current = entry.status().url.unwrap_or_default();
	let (page, _) = super::input::select_page(&targets, &current).ok_or("没有可显示的浏览器页面")?;
	let attached = cdp
		.request(
			"Target.attachToTarget",
			json!({"targetId":page,"flatten":true}),
			false,
		)
		.await?;
	cdp.session = attached["sessionId"]
		.as_str()
		.ok_or("无法绑定浏览器页面")?
		.into();
	cdp.request("Page.enable", json!({}), true).await?;
	cdp.request(
		"Page.startScreencast",
		json!({"format":"jpeg","quality":QUALITY,"maxWidth":0,"maxHeight":0,"everyNthFrame":1}),
		true,
	)
	.await?;
	let mut closed = entry.closed.subscribe();
	let mut delivered = Instant::now()
		.checked_sub(INTERVAL)
		.unwrap_or_else(Instant::now);
	let mut acked = Instant::now()
		.checked_sub(ACK_INTERVAL)
		.unwrap_or_else(Instant::now);
	loop {
		let message = tokio::select! {
			_ = closed.changed() => break,
			message = cdp.socket.next() => message,
		};
		let Some(Ok(message)) = message else {
			break;
		};
		let Message::Text(text) = message else {
			if matches!(message, Message::Close(_)) {
				break;
			}
			continue;
		};
		let Ok(value) = serde_json::from_str::<Value>(&text) else {
			continue;
		};
		if value["method"] != "Page.screencastFrame" {
			continue;
		}
		let frame = value["params"]["sessionId"].clone();
		let data = value["params"]["data"].as_str().unwrap_or_default();
		if data.is_empty() || data.len() > FRAME_LIMIT {
			cdp.notify("Page.screencastFrameAck", json!({"sessionId":frame}))
				.await?;
			continue;
		}
		// Acknowledge at once unless Chrome is producing faster than the panel can absorb;
		// the hold keeps capture near 30 fps instead of compositor speed.
		if let Some(rest) = ACK_INTERVAL.checked_sub(acked.elapsed()) {
			tokio::time::sleep(rest).await;
		}
		acked = Instant::now();
		cdp.notify("Page.screencastFrameAck", json!({"sessionId":frame}))
			.await?;
		// Big pictures (zoomed-out or wide panels) cost more to encode and decode, so they
		// get a slower cadence; the skipped ones were already acknowledged above.
		let interval = if data.len() > HEAVY_FRAME * 4 / 3 {
			HEAVY_INTERVAL
		} else {
			INTERVAL
		};
		if delivered.elapsed() < interval {
			continue;
		}
		let Ok(bytes) = STANDARD.decode(data) else {
			continue;
		};
		if bytes.is_empty() || bytes.len() > FRAME_LIMIT {
			continue;
		}
		delivered = Instant::now();
		if out.send(Picture { bytes }).await.is_err() {
			break;
		}
	}
	let _ = cdp.request("Page.stopScreencast", json!({}), true).await;
	Ok(())
}
