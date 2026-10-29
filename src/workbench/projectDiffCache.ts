import { gitDiff } from "./projectWorkbench";
import { DiffPreviewCache } from "./diffPreviewCache";

export const projectDiffCache = new DiffPreviewCache(gitDiff);
