export interface BrowserViewportRequest { width: number; height: number; scale: number }

/**
 * Chrome streams exactly the CSS viewport, so the panel's device pixels become the viewport.
 * Keep scale at 1: a device scale factor only enlarges screenshots and would shrink the page twice.
 */
export function browserViewport(width: number, height: number, ratio: number): BrowserViewportRequest | undefined {
	if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(ratio)) return undefined;
	const zoom = Math.min(3, Math.max(1, ratio));
	const w = Math.round(width * zoom);
	const h = Math.round(height * zoom);
	if (w < 200 || h < 200 || w > 3000 || h > 3000) return undefined;
	return { width: w, height: h, scale: 1 };
}
