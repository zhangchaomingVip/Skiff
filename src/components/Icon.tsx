const paths = {
	copy: "M9 9h12v12H9ZM15 9V3H3v12h6",
	refresh: "M20 7V3m0 4h-4M20 7a9 9 0 1 0 1 9",
	trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
	info: "M12 11v6m0-10h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
	tokens: "M12 3 3 8v8l9 5 9-5V8L12 3ZM3 8l9 5 9-5m-9 5v8",
	down: "M12 5v14m-6-6 6 6 6-6",
	plus: "M12 5v14M5 12h14",
	edit: "m16 3 5 5-12 12-6 1 1-6L16 3ZM14 5l5 5",
	folder: "M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z",
	chevron: "m9 5 7 7-7 7",
	panel: "M9 3v18M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z",
	arrow: "M12 19V5m-6 6 6-6 6 6",
	stop: "M6 6h12v12H6Z",
	close: "m6 6 12 12M6 18 18 6",
	code: "m8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18",
	check: "m5 12 4 4L19 6",
	file: "M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2ZM14 2v5.5h6",
	terminal: "m4 17 6-6-6-6M12 19h8",
	wrench: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z",
	search: "m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
	spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z",
	image: "M3 3h18v18H3Zm0 14 6-6 5 5 3-3 4 4M16 7h.01",
	clock: "M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
	settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM9 3l-.5 2-2 1L4 5 2 9l2 2v2l-2 2 2 4 2.5-1 2 1L9 21h6l.5-2 2-1 2.5 1 2-4-2-2v-2l2-2-2-4-2.5 1-2-1L15 3H9Z",
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
	return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
