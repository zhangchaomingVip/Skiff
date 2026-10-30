/**
 * Skiff speedboat mark for in-app chrome: transparent, tight-cropped, with the hull
 * on the text colour and the cockpit plus waterline on the accent. A 1px breathing
 * gap separates the cockpit from the hull, and the wake line runs a little past the
 * stern, so the mark still reads as a boat on water when it is only 22px wide.
 *
 * OS and taskbar icons (`src-tauri/icons/app-icon*.svg`) carry the deep-sea plate:
 * shell surfaces need an opaque, self-bounded badge, in-app chrome does not.
 */
export function BrandMark({ size = 26 }: { size?: number }) {
	return <svg className="brand-mark" width={size} height={size} viewBox="132 356 736 388" aria-hidden="true" focusable="false">
		<path d="M190 470 H613 C693 470 773 440 834 392 C824 488 762 570 652 612 H286 C226 612 190 566 190 470 Z" fill="var(--text)" />
		<path d="M373 440 L406 376 L566 376 L586 440 Z" fill="var(--accent)" />
		<path d="M152 702 C 244 678 336 720 456 696 C 576 672 706 670 850 684" fill="none" stroke="var(--accent)" stroke-width="30" stroke-linecap="round" />
	</svg>;
}
