import { Image } from "@tauri-apps/api/image";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Taskbar/dock icon follows the voyage state: the sailing speedboat while pi is
 * answering, the docked one when the turn ends. Windows has no animated taskbar
 * icons, so the two marks are swapped as whole images.
 *
 * Notes on the plumbing:
 * - The marks ship as frontend assets (`public/`) because `resolveResource` has
 *   no permission entry in this Tauri version.
 * - The PNG is decoded in the webview into raw RGBA and handed over with
 *   `Image.new`, which avoids requiring the `image-png` Cargo feature.
 * - Decoded images are cached; swapping icons must not leak image resources.
 */
const SOURCES = { sailing: "/app-icon-sailing.png", docked: "/app-icon.png" };
const SIZE = 128;
const cache = new Map<boolean, Promise<Image>>();

const decode = async (url: string) => {
	const bitmap = await createImageBitmap(await (await fetch(url)).blob());
	const canvas = document.createElement("canvas");
	canvas.width = SIZE;
	canvas.height = SIZE;
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Canvas 2D context unavailable");
	context.drawImage(bitmap, 0, 0, SIZE, SIZE);
	bitmap.close();
	const { data } = context.getImageData(0, 0, SIZE, SIZE);
	return Image.new(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), SIZE, SIZE);
};

const load = (sailing: boolean) => {
	const cached = cache.get(sailing);
	if (cached) return cached;
	const pending = decode(sailing ? SOURCES.sailing : SOURCES.docked)
		.catch((error: unknown) => { cache.delete(sailing); throw error; });
	cache.set(sailing, pending);
	return pending;
};

/** Swaps the window (and therefore taskbar) icon for the given voyage state. */
export function showVoyageIcon(sailing: boolean) {
	return load(sailing).then((icon) => getCurrentWindow().setIcon(icon));
}
