const paths = {
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
	search: "m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
	spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z",
	image: "M3 3h18v18H3Zm0 14 6-6 5 5 3-3 4 4M16 7h.01",
	clock: "M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
	settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM9 3l-.5 2-2 1L4 5 2 9l2 2v2l-2 2 2 4 2.5-1 2 1L9 21h6l.5-2 2-1 2.5 1 2-4-2-2v-2l2-2-2-4-2.5 1-2-1L15 3H9Z",
};

export function Icon({ name, size = 18 }: { name: keyof typeof paths; size?: number }) {
	return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
