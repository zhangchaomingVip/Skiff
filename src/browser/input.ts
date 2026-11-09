import type { BrowserStatus } from "./native";
import type { BrowserViewer } from "./viewer";

export function browserPoint(rect: { left: number; top: number; width: number; height: number }, image: { width: number; height: number }, x: number, y: number) {
	if (!rect.width || !rect.height || !image.width || !image.height) return undefined;
	const scale = Math.min(rect.width / image.width, rect.height / image.height);
	const left = rect.left + (rect.width - image.width * scale) / 2;
	const top = rect.top + (rect.height - image.height * scale) / 2;
	const point = { x: (x - left) / scale, y: (y - top) / scale };
	return point.x >= 0 && point.x < image.width && point.y >= 0 && point.y < image.height ? point : undefined;
}

/** Ephemeral input only. Nothing here is sent to chat history or storage. */
export function attachBrowserInput(element: HTMLTextAreaElement, canvas: HTMLCanvasElement, viewer: BrowserViewer, status: BrowserStatus) {
	let active = true;
	let composing = false;
	let lastComposition = "";
	const keys = new Map<string, Record<string, unknown>>();
	const buttons = new Map<string, { x: number; y: number }>();
	let lastMove = 0;
	let lastWheel = 0;
	const send = (value: Record<string, unknown>) => active && viewer.send(value, status);
	const modifiers = (event: MouseEvent | KeyboardEvent) => (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);
	const point = (event: MouseEvent) => browserPoint(canvas.getBoundingClientRect(), canvas, event.clientX, event.clientY);
	const release = () => {
		for (const key of keys.values()) send({ ...key, eventType: "keyUp", modifiers: 0 }); keys.clear();
		for (const [button, point] of buttons) send({ type: "input_mouse", eventType: "mouseReleased", ...point, button, buttons: 0, clickCount: 1 }); buttons.clear();
		element.value = ""; composing = false;
	};
	const mouse = (event: PointerEvent) => {
		if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
		const location = point(event);
		if (!location) { if (event.type === "pointerup") release(); return; }
		event.preventDefault(); event.stopPropagation();
		const button = ["left", "middle", "right"][event.button];
		if (event.type === "pointerdown") {
			element.focus();
			if (!button) return;
			element.setPointerCapture(event.pointerId);
			buttons.set(button, location);
		} else if (event.type === "pointermove") {
			if (performance.now() - lastMove < 35) return; lastMove = performance.now();
		} else { if (button) buttons.delete(button); }
		send({ type: "input_mouse", eventType: event.type === "pointerdown" ? "mousePressed" : event.type === "pointerup" ? "mouseReleased" : "mouseMoved", ...location, button: button ?? "none", buttons: event.buttons, clickCount: event.type === "pointermove" ? 0 : Math.min(event.detail || 1, 3), modifiers: modifiers(event) });
	};
	const wheel = (event: WheelEvent) => {
		const location = point(event); if (!location) return;
		event.preventDefault(); event.stopPropagation();
		if (performance.now() - lastWheel < 35) return; lastWheel = performance.now();
		const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.height : 1;
		send({ type: "input_mouse", eventType: "mouseWheel", ...location, deltaX: Math.max(-4000, Math.min(4000, event.deltaX * factor)), deltaY: Math.max(-4000, Math.min(4000, event.deltaY * factor)), modifiers: modifiers(event) });
	};
	const text = (value: string) => {
		if (!active || !value) return;
		// One bounded command keeps paste and IME commits atomic with respect to handoff.
		send({ type: "input_keyboard", eventType: "char", text: value.slice(0, 16384) });
	};
	const keydown = (event: KeyboardEvent) => {
		event.stopPropagation();
		if (event.isComposing || composing || event.keyCode === 229) return;
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") return;
		if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) return;
		event.preventDefault();
		const key = { type: "input_keyboard", eventType: "keyDown", key: event.key, code: event.code, windowsVirtualKeyCode: event.keyCode, modifiers: modifiers(event), autoRepeat: event.repeat };
		keys.set(event.code, key); send(key);
	};
	const keyup = (event: KeyboardEvent) => {
		event.stopPropagation();
		const key = keys.get(event.code); if (!key) return;
		event.preventDefault(); keys.delete(event.code); send({ ...key, eventType: "keyUp", modifiers: modifiers(event) });
	};
	const compositionstart = () => { composing = true; lastComposition = ""; };
	const compositionend = (event: CompositionEvent) => { composing = false; text(event.data); lastComposition = event.data; element.value = ""; };
	const input = (event: Event) => {
		const value = event as InputEvent;
		if (composing || value.isComposing) return;
		const duplicate = value.inputType === "insertFromComposition" || (value.inputType === "insertCompositionText" && value.data === lastComposition);
		if (!duplicate) text(value.data ?? element.value);
		lastComposition = ""; element.value = "";
	};
	const paste = (event: ClipboardEvent) => { event.preventDefault(); event.stopPropagation(); text(event.clipboardData?.getData("text/plain") ?? ""); element.value = ""; };
	const contextmenu = (event: Event) => event.preventDefault();
	element.addEventListener("pointerdown", mouse); element.addEventListener("pointerup", mouse); element.addEventListener("pointermove", mouse);
	element.addEventListener("pointercancel", release); element.addEventListener("lostpointercapture", release);
	element.addEventListener("wheel", wheel, { passive: false });
	element.addEventListener("keydown", keydown); element.addEventListener("keyup", keyup);
	element.addEventListener("compositionstart", compositionstart); element.addEventListener("compositionend", compositionend);
	element.addEventListener("input", input); element.addEventListener("paste", paste); element.addEventListener("blur", release); element.addEventListener("contextmenu", contextmenu);
	window.addEventListener("blur", release);
	return {
		async flush() { release(); await viewer.flush(status); },
		dispose() {
			release(); active = false;
			element.removeEventListener("pointerdown", mouse); element.removeEventListener("pointerup", mouse); element.removeEventListener("pointermove", mouse);
			element.removeEventListener("pointercancel", release); element.removeEventListener("lostpointercapture", release); element.removeEventListener("wheel", wheel);
			element.removeEventListener("keydown", keydown); element.removeEventListener("keyup", keyup);
			element.removeEventListener("compositionstart", compositionstart); element.removeEventListener("compositionend", compositionend); element.removeEventListener("input", input); element.removeEventListener("paste", paste); element.removeEventListener("blur", release); element.removeEventListener("contextmenu", contextmenu); window.removeEventListener("blur", release);
		},
	};
}
