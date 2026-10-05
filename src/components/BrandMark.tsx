/**
 * Skiff wordmark tile: white rounded square with the navy speedboat, matching
 * `src-tauri/icons/app-icon.svg` so the sidebar and the app icon stay in sync.
 * Decorative: the sidebar spells the product name next to it.
 */
export function BrandMark({ size = 26 }: { size?: number }) {
	return <svg className="brand-mark" width={size} height={size} viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
		<rect width="1024" height="1024" rx="160" fill="#ffffff" />
		<path d="M190 470 H613 C693 470 773 440 834 392 C826 492 770 592 658 640 H288 C228 640 190 582 190 470 Z" fill="#0b1626" />
		<path d="M358 470 L406 376 L566 376 L596 470 Z" fill="#5b9fff" />
	</svg>;
}
