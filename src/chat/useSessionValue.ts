import { useCallback, useMemo, useRef, useState, type SetStateAction } from "react";
import type { SessionOwner } from "./usePiSession";

/** Per-runtime refs survive navigation without crossing conversation boundaries. */
export function useSessionRef<T>(owner: SessionOwner, initialize: () => T | undefined) {
	const values = useRef(new Map<SessionOwner, { current: T | undefined }>());
	if (!values.current.has(owner)) {
		for (const key of values.current.keys()) if (key.id === owner.id) values.current.delete(key);
		values.current.set(owner, { current: initialize() });
	}
	return values.current.get(owner)!;
}

/** App-side derived state follows the same batch as the RPC snapshot. */
export function useSessionValue<T>(owner: SessionOwner, isCurrent: () => boolean, initialize: () => T) {
	const initial = useMemo(initialize, [owner]);
	const [stored, setStored] = useState(() => new Map<SessionOwner, T>());
	const value = stored.has(owner) ? stored.get(owner)! : initial;
	const setValue = useCallback((update: SetStateAction<T>) => {
		if (!isCurrent()) return;
		setStored((previous) => {
			if (!isCurrent()) return previous;
			const current = previous.has(owner) ? previous.get(owner)! : initial;
			const next = new Map(previous);
			for (const key of next.keys()) if (key.id === owner.id && key !== owner) next.delete(key);
			next.set(owner, typeof update === "function" ? (update as (value: T) => T)(current) : update);
			return next;
		});
	}, [owner, isCurrent, initial]);
	return [value, setValue] as const;
}
