import { useCallback, useMemo, useState, type SetStateAction } from "react";
import type { SessionOwner } from "./usePiSession";

/** App-side derived state follows the same batch as the RPC snapshot. */
export function useSessionValue<T>(owner: SessionOwner, isCurrent: () => boolean, initialize: () => T) {
	const initial = useMemo(initialize, [owner]);
	const [stored, setStored] = useState({ owner, value: initial });
	const value = stored.owner === owner ? stored.value : initial;
	const setValue = useCallback((update: SetStateAction<T>) => {
		if (!isCurrent()) return;
		setStored((previous) => {
			if (!isCurrent()) return previous;
			const current = previous.owner === owner ? previous.value : initial;
			return { owner, value: typeof update === "function" ? (update as (value: T) => T)(current) : update };
		});
	}, [owner, isCurrent, initial]);
	return [value, setValue] as const;
}
