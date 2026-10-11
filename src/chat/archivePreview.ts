import { parseMessages } from "./parse";
import { attachHistoricalSnapshots } from "./routeSnapshot";
import type { ChatMessage, RouteSnapshot } from "./types";

export type ArchiveRequest = <T = unknown>(command: Record<string, unknown> & { type: string }) => Promise<T>;

/** Load archived history through read-only pi RPC commands. */
export async function readArchivedMessages(request: ArchiveRequest, sessionPath: string, snapshots?: Array<RouteSnapshot | null>): Promise<ChatMessage[]> {
	await request({ type: "switch_session", sessionPath });
	const transcript = await request<{ messages?: unknown }>({ type: "get_messages" });
	return attachHistoricalSnapshots(parseMessages(transcript.messages), snapshots);
}
