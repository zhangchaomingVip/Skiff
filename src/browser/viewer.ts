import { browserNative, type BrowserStatus, type BrowserTarget } from "./native";
import { isBrowserStatus, sameBrowser } from "./model";
import { LatestBrowserFrames } from "./frames";

export type BrowserStreamPhase = "connecting" | "waiting" | "live" | "disconnected";
export type BrowserViewer = ReturnType<typeof watchBrowser>;
export function watchBrowser(target: BrowserTarget, canvas: HTMLCanvasElement, callbacks: { phase: (phase: BrowserStreamPhase) => void; status: (status: BrowserStatus) => void; url: (url: string) => void; reload?: (ok: boolean, error?: string) => void; action?: (name: string, ok: boolean, error?: string) => void }, density: () => number = () => 2) {
	let disposed = false;
	let socket: WebSocket | undefined;
	let firstFrame: ReturnType<typeof setTimeout> | undefined;
	let live = false;
	let failed = false;
	let pixelRatio = 1;
	let pictureDensity = 1;
	let received = 0;
	const pending = new Map<string, { resolve: () => void; reject: () => void; timer: ReturnType<typeof setTimeout> }>();
	const clear = () => { canvas.width = 0; canvas.height = 0; canvas.dataset.frame = ""; };
	const ack = (seq: number) => { if (!disposed && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ack", seq })); };
	const lost = () => {
		if (disposed || failed) return;
		failed = true;
		for (const item of pending.values()) { clearTimeout(item.timer); item.reject(); } pending.clear();
		clearTimeout(firstFrame);
		frames.dispose();
		clear();
		callbacks.phase("disconnected");
		socket?.close();
	};
	const frames = new LatestBrowserFrames(async (data) => {
		const blob = typeof data === "string" ? new Blob([Uint8Array.from(atob(data), (char) => char.charCodeAt(0))], { type: "image/jpeg" }) : new Blob([data], { type: "image/jpeg" });
		return createImageBitmap(blob);
	}, (image, seq) => {
		if (disposed) return;
		// Clicks are mapped from bitmap pixels back to page CSS pixels with the picture's own
		// density against the page, not against the canvas box: the panel box can be wider than
		// the page (a resize the browser has not applied yet), and the page would then receive
		// coordinates outside its viewport. Skiff's own capture always renders at the density
		// the panel asked for; the managed fallback stream is laid out at page CSS size.
		pixelRatio = pictureDensity;
		// Re-assigning the size reallocates the whole backing store, which stalls the panel
		// on every frame; only resize when the picture actually changes shape.
		if (canvas.width !== image.width || canvas.height !== image.height) { canvas.width = image.width; canvas.height = image.height; }
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Canvas unavailable");
		context.drawImage(image, 0, 0);
		canvas.dataset.frame = String(seq);
		clearTimeout(firstFrame);
		if (!live) { live = true; callbacks.phase("live"); }
	}, ack, lost);
	clear();
	callbacks.phase("connecting");
	firstFrame = setTimeout(lost, 15000);
	void browserNative.connection(target).then((connection) => {
		if (disposed || failed) return;
		if (!isBrowserStatus(connection.status) || !sameBrowser(target, connection.status)) throw new Error("Browser owner changed");
		callbacks.status(connection.status);
		socket = new WebSocket(connection.streamUrl);
		socket.binaryType = "arraybuffer";
		socket.onopen = () => {
			if (disposed || failed) return;
			callbacks.phase("waiting");
			socket!.send(JSON.stringify({ type: "config", pacing: "ack", maxFps: 10 }));
		};
		socket.onmessage = ({ data }) => {
			if (disposed || failed) return;
			// Skiff's own capture sends raw JPEG; the managed fallback stream stays JSON.
			if (typeof data !== "string") {
				const bytes = data instanceof ArrayBuffer ? data : undefined;
				if (!bytes || bytes.byteLength < 2 || bytes.byteLength > 4 * 1024 * 1024) { lost(); return; }
				// Skiff's capture renders the page at the density the panel asked for.
				pictureDensity = Math.min(3, Math.max(1, density()));
				frames.push({ seq: ++received, data: bytes });
				return;
			}
			if (data.length > 8 * 1024 * 1024) { lost(); return; }
			try {
				const message = JSON.parse(data);
				if (message.type === "input_ack") { const item = pending.get(message.inputId); if (item) { pending.delete(message.inputId); clearTimeout(item.timer); item.resolve(); } }
				else if (message.type === "control" && isBrowserStatus(message.status) && sameBrowser(target, message.status)) callbacks.status(message.status);
				else if (message.type === "url" && typeof message.url === "string") callbacks.url(message.url.slice(0, 8192));
				else if (message.type === "reload") callbacks.reload?.(message.ok === true, typeof message.error === "string" ? message.error.slice(0, 500) : undefined);
				else if (message.type === "action" && typeof message.action === "string") callbacks.action?.(message.action, message.ok === true, typeof message.error === "string" ? message.error.slice(0, 500) : undefined);
				else if (message.type === "status" && message.connected === false) lost();
				else if (message.type === "frame") {
					if (!Number.isSafeInteger(message.seq) || message.seq < 0 || typeof message.data !== "string" || message.data.length > 6 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(message.data)) { lost(); return; }
					// The managed stream lays the page out at CSS size, one bitmap pixel per page pixel.
					pictureDensity = 1;
					frames.push({ seq: message.seq, data: message.data });
				}
			} catch { lost(); }
		};
		socket.onerror = lost;
		socket.onclose = () => { if (!disposed) lost(); };
	}).catch(lost);
	return {
		send(value: Record<string, unknown>, status: BrowserStatus) {
			if (disposed || failed || !live || status.control !== "human" || !sameBrowser(target, status) || socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > 65536) return false;
			socket.send(JSON.stringify({ ...value, controlVersion: status.controlVersion })); return true;
		},
		/** Navigation and reload stay available while the human owns the page or when the
		 * AI task is stopped; both are page-level actions that never mutate a form. */
		control(value: Record<string, unknown>, status: BrowserStatus) {
			if (disposed || failed || !live || !["human", "stopped"].includes(status.control) || !sameBrowser(target, status) || socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > 65536) return false;
			socket.send(JSON.stringify({ ...value, controlVersion: status.controlVersion })); return true;
		},
		navigate(url: string, status: BrowserStatus) { return this.control({ type: "navigate", url }, status); },
		history(direction: "back" | "forward", status: BrowserStatus) { return this.control({ type: "history", direction }, status); },
		/** Bitmap pixels per page CSS pixel, measured from the frames themselves. */
		scale() { return pixelRatio; },
		/** Page-level reload the human may request while in charge. */
		reload(status: BrowserStatus): boolean {
			if (disposed || failed || !live || !["human", "stopped"].includes(status.control) || !sameBrowser(target, status) || socket?.readyState !== WebSocket.OPEN) return false;
			socket.send(JSON.stringify({ type: "reload", controlVersion: status.controlVersion })); return true;
		},
		flush(status: BrowserStatus): Promise<void> {
			return new Promise((resolve, reject) => {
				const id = crypto.randomUUID();
				const fail = () => reject(new Error("无法确认人工输入已送达，请重新连接画面或停止浏览器"));
				const timer = setTimeout(() => { pending.delete(id); fail(); }, 5000);
				pending.set(id, { resolve, reject: fail, timer });
				if (!this.send({ type: "input_flush", inputId: id }, status)) { pending.delete(id); clearTimeout(timer); fail(); }
			});
		},
		dispose() {
		disposed = true;
		for (const item of pending.values()) { clearTimeout(item.timer); item.reject(); } pending.clear();
		clearTimeout(firstFrame);
		frames.dispose();
		if (socket) { socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null; socket.close(); }
		clear();
		},
	};
}
