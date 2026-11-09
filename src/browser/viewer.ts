import { browserNative, type BrowserStatus, type BrowserTarget } from "./native";
import { isBrowserStatus, sameBrowser } from "./model";
import { LatestBrowserFrames } from "./frames";

export type BrowserStreamPhase = "connecting" | "waiting" | "live" | "disconnected";
export type BrowserViewer = ReturnType<typeof watchBrowser>;
export function watchBrowser(target: BrowserTarget, canvas: HTMLCanvasElement, callbacks: { phase: (phase: BrowserStreamPhase) => void; status: (status: BrowserStatus) => void; url: (url: string) => void }) {
	let disposed = false;
	let socket: WebSocket | undefined;
	let firstFrame: ReturnType<typeof setTimeout> | undefined;
	let live = false;
	let failed = false;
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
		const raw = atob(data);
		const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));
		return createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
	}, (image, seq) => {
		if (disposed) return;
		canvas.width = image.width; canvas.height = image.height;
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
		socket.onopen = () => {
			if (disposed || failed) return;
			callbacks.phase("waiting");
			socket!.send(JSON.stringify({ type: "config", pacing: "ack", maxFps: 10 }));
		};
		socket.onmessage = ({ data }) => {
			if (disposed || failed) return;
			if (typeof data !== "string" || data.length > 8 * 1024 * 1024) { lost(); return; }
			try {
				const message = JSON.parse(data);
				if (message.type === "input_ack") { const item = pending.get(message.inputId); if (item) { pending.delete(message.inputId); clearTimeout(item.timer); item.resolve(); } }
				else if (message.type === "control" && isBrowserStatus(message.status) && sameBrowser(target, message.status)) callbacks.status(message.status);
				else if (message.type === "url" && typeof message.url === "string") callbacks.url(message.url.slice(0, 8192));
				else if (message.type === "status" && message.connected === false) lost();
				else if (message.type === "frame") {
					if (!Number.isSafeInteger(message.seq) || message.seq < 0 || typeof message.data !== "string" || message.data.length > 6 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(message.data)) { lost(); return; }
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
