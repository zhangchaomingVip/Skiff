import type { ReactNode } from "react";
import { BrandMark } from "./BrandMark";

export function TitleBarNav({ children }: { children?: ReactNode }) {
	return <nav className="titlebar-nav" aria-label="应用栏">
		<span className="titlebar-mark" role="img" aria-label="Skiff"><BrandMark /></span>
		{children}
	</nav>;
}
