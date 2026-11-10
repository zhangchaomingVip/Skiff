import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { FileWorkbenchTab } from "../workbench/projectWorkbench";

export const WorkbenchHeaderActionsContext = createContext<{ target: HTMLDivElement | null; tool: FileWorkbenchTab } | undefined>(undefined);

/** Panels retain their own action state while only the active tab fills the header. */
export function WorkbenchHeaderActions({ tool, children }: { tool: FileWorkbenchTab; children: ReactNode }) {
	const header = useContext(WorkbenchHeaderActionsContext);
	return header?.target && header.tool === tool ? createPortal(children, header.target) : null;
}
