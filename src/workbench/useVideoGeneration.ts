import { useCallback, useEffect, useRef, useState } from "react";
import { prepareVideoReference, videoGenerationNative, videoJobActive, videoJobBlocks, type VideoConfig, type VideoJob } from "./videoGeneration";

export function useVideoGeneration() {
	const [config, setConfig] = useState<VideoConfig>();
	const [jobs, setJobs] = useState<VideoJob[]>([]);
	const [loading, setLoading] = useState(true);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string>();
	const mounted = useRef(true);
	const pending = useRef(false);
	useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
	const refreshJobs = useCallback(async () => { const next = await videoGenerationNative.jobs(); if (mounted.current) setJobs(next); return next; }, []);
	const refresh = useCallback(async () => {
		setLoading(true); setError(undefined);
		try { const [next, list] = await Promise.all([videoGenerationNative.config(), videoGenerationNative.jobs()]); if (mounted.current) { setConfig(next); setJobs(list); } }
		catch (reason) { if (mounted.current) setError(String(reason)); }
		finally { if (mounted.current) setLoading(false); }
	}, []);
	useEffect(() => { void refresh(); }, [refresh]);
	const active = jobs.some(videoJobActive);
	const running = jobs.some(videoJobBlocks);
	useEffect(() => {
		if (!active) return;
		let stopped = false;
		let timer: ReturnType<typeof setTimeout>;
		const poll = async () => {
			try { const next = await videoGenerationNative.jobs(); if (!stopped) setJobs(next); }
			catch (reason) { if (!stopped) setError(`无法读取视频状态：${String(reason)}`); }
			if (!stopped) timer = setTimeout(() => void poll(), 1000);
		};
		timer = setTimeout(() => void poll(), 500);
		return () => { stopped = true; clearTimeout(timer); };
	}, [active]);
	const generate = async (input: Omit<Parameters<typeof videoGenerationNative.start>[0], "id" | "reference">, referenceUrl?: string) => {
		if (pending.current || running || loading) return;
		pending.current = true; setSubmitting(true); setError(undefined);
		try {
			const reference = referenceUrl ? await prepareVideoReference(referenceUrl) : undefined;
			const job = await videoGenerationNative.start({ ...input, id: crypto.randomUUID(), reference });
			if (mounted.current) setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
		} catch (reason) {
			if (mounted.current) setError(String(reason));
			try { await refreshJobs(); } catch { if (mounted.current) setLoading(true); }
		} finally { pending.current = false; if (mounted.current) setSubmitting(false); }
	};
	const [controlling, setControlling] = useState(false);
	const actionPending = useRef(false);
	const control = async (id: string, action: "pause" | "resume" | "abandon") => {
		if (actionPending.current) return;
		actionPending.current = true; setControlling(true); setError(undefined);
		try { await videoGenerationNative.control(id, action); await refreshJobs(); }
		catch (reason) { if (mounted.current) setError(String(reason)); }
		finally { actionPending.current = false; if (mounted.current) setControlling(false); }
	};
	const assetAction = async (action: "export" | "reveal", id: string) => {
		setError(undefined);
		try { await videoGenerationNative[action](id); } catch (reason) { if (mounted.current) setError(String(reason)); }
	};
	return { config, setConfig, jobs, loading, submitting, error, refresh, generate, running, active, control, controlling, assetAction };
}
