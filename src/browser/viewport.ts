export interface BrowserViewportRequest {
	width: number;
	height: number;
	scale: number;
}

/** Page zoom steps, mirroring what a browser's own zoom control offers. */
export const browserZoomLevels = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2];
export const defaultBrowserZoom = 1;
export const browserZoomPercent = (zoom: number) => Math.round(zoom * 100);

/** Next step away from the current level; stays put at either end. */
export function nextBrowserZoom(zoom: number, direction: 1 | -1) {
	const levels = browserZoomLevels;
	const current = levels.reduce((best, level, index) => (Math.abs(level - zoom) < Math.abs(levels[best] - zoom) ? index : best), 0);
	return levels[Math.min(levels.length - 1, Math.max(0, current + direction))];
}

export function isBrowserZoom(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && browserZoomLevels.includes(value);
}

/**
 * Chrome lays a page out in CSS pixels, so the panel's CSS box is the page viewport.
 * Feeding it the panel's device pixels made every page render at the screen scale factor
 * and shrink its text by the same amount. `density` is the pixel density the picture
 * should have relative to the CSS box, and zoom narrows the viewport so the page itself
 * grows instead of the picture being stretched.
 */
export function browserViewport(width: number, height: number, density: number, zoom = defaultBrowserZoom): BrowserViewportRequest | undefined {
	if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(density) || !Number.isFinite(zoom)) return undefined;
	const level = Math.min(browserZoomLevels[browserZoomLevels.length - 1], Math.max(browserZoomLevels[0], zoom));
	const w = Math.round(width / level);
	const h = Math.round(height / level);
	if (w < 200 || h < 200) return undefined;
	const device = Math.min(2, Math.max(1, density));
	const limit = Math.floor((3000 / Math.max(w, h)) * 100) / 100;
	const scale = Math.min(device, limit);
	if (scale < 1 || w * scale > 3000 || h * scale > 3000) return undefined;
	return { width: w, height: h, scale };
}
