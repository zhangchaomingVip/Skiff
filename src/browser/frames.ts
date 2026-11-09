export interface BrowserFrame { seq: number; data: string }
export interface DecodedFrame { width: number; height: number; close: () => void }

/** Bounded decoding: one in progress and one replacement, never a playback queue. */
export class LatestBrowserFrames<T extends DecodedFrame> {
	private pending?: BrowserFrame;
	private decoding = false;
	private disposed = false;
	private timer?: ReturnType<typeof setTimeout>;
	private nextDraw = 0;
	private readonly decode: (data: string) => Promise<T>;
	private readonly draw: (frame: T, seq: number) => void;
	private readonly ack: (seq: number) => void;
	private readonly fail: () => void;
	constructor(decode: (data: string) => Promise<T>, draw: (frame: T, seq: number) => void, ack: (seq: number) => void, fail: () => void) {
		this.decode = decode; this.draw = draw; this.ack = ack; this.fail = fail;
	}
	push(frame: BrowserFrame) {
		if (this.disposed) return;
		if (this.pending) this.ack(this.pending.seq);
		this.pending = frame;
		this.schedule();
	}
	private schedule() {
		if (this.disposed || this.decoding || this.timer !== undefined || !this.pending) return;
		this.timer = setTimeout(() => { this.timer = undefined; void this.render(); }, Math.max(0, this.nextDraw - performance.now()));
	}
	private async render() {
		const pending = this.pending;
		if (this.disposed || !pending) return;
		this.pending = undefined;
		this.decoding = true;
		let frame: T | undefined;
		try {
			frame = await this.decode(pending.data);
			if (!this.disposed && !this.pending) {
				if (frame.width < 1 || frame.height < 1 || frame.width > 16384 || frame.height > 16384 || frame.width * frame.height > 32000000) throw new Error("Invalid frame size");
				this.draw(frame, pending.seq);
				this.nextDraw = performance.now() + 100;
			}
		} catch { if (!this.disposed) this.fail(); }
		finally {
			frame?.close();
			this.decoding = false;
			if (!this.disposed) { this.ack(pending.seq); this.schedule(); }
		}
	}
	dispose() {
		this.disposed = true;
		this.pending = undefined;
		if (this.timer !== undefined) clearTimeout(this.timer);
		this.timer = undefined;
	}
}
