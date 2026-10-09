import { useEffect, useState, type ReactNode } from "react";
import { Dialog } from "./ui";

export function SidebarPresentation({ children, onClose }: { children: ReactNode; onClose: () => void }) {
	const [narrow, setNarrow] = useState(() => window.innerWidth <= 760);
	useEffect(() => {
		const query = window.matchMedia("(max-width: 760px)");
		const change = () => setNarrow(query.matches);
		query.addEventListener("change", change);
		return () => query.removeEventListener("change", change);
	}, []);
	return narrow ? <Dialog variant="drawer" onClose={onClose} returnFocusSelector=".chat-header button[aria-label='展开侧栏']" aria-label="项目与聊天导航">{children}</Dialog> : <>{children}</>;
}
