/** Four seconds of 100ms samples: the sparkline shows the current burst only. */
export const SPARK_SAMPLES = 40;

/** Geometry of the speed sparkline; kept pure so the trail maths is testable. */
export interface SparkGeometry {
	line: string;
	area: string;
	last?: { x: number; y: number };
}

/**
 * Map the newest speed samples onto a width×height box. A missing or broken
 * sample reads as zero, the tallest sample owns the top, and a single sample
 * sits on the right edge where the live reading is.
 */
export function sparkGeometry(trail: readonly number[], width = 100, height = 26): SparkGeometry {
	const values = trail.map((value) => Number.isFinite(value) && value > 0 ? value : 0);
	const peak = Math.max(0, ...values);
	// Nothing has moved yet: draw nothing and let the dashed baseline stand in,
	// instead of painting a bright zero band across the card.
	if (peak <= 0) return { line: "", area: "", last: undefined };
	const usable = Math.max(0, height - 4);
	const points = values.map((value, index) => {
		const x = values.length <= 1 ? width : index / (values.length - 1) * width;
		const y = height - 2 - Math.min(1, value / peak) * usable;
		return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
	});
	return {
		line: points.map((point) => `${point.x},${point.y}`).join(" "),
		area: points.length ? `M0,${height} L${points.map((point) => `${point.x},${point.y}`).join(" L")} L${width},${height} Z` : "",
		last: points[points.length - 1],
	};
}
