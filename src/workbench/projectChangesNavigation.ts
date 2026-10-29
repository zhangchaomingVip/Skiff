import { createContext } from "react";

/** Result cards open Commit for repositories and the file tree for local projects. */
export const ProjectChangesNavigationContext = createContext<{ root: string; label: string; onOpen: () => void; onOpenFile: (path: string) => void } | undefined>(undefined);
