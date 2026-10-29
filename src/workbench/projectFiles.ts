import type { DirectoryPage } from "./projectWorkbench";

export const PROJECT_FILES_UPDATED = "skiff:project-files-updated";
export const retainedFilePages = new Map<string, DirectoryPage>();

export function invalidateProjectFiles(projectId: string) {
	for (const key of retainedFilePages.keys()) if (key.startsWith(`${projectId}:`)) retainedFilePages.delete(key);
	window.dispatchEvent(new CustomEvent(PROJECT_FILES_UPDATED, { detail: projectId }));
}
