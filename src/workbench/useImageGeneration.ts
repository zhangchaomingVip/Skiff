import { useCallback, useEffect, useRef, useState } from "react";
import { imageGenerationNative, imageJobPending, prepareImageReference, type ImageGenerationConfig, type ImageJob } from "./imageGeneration";

export function useImageGeneration() {
	const [config, setConfig] = useState<ImageGenerationConfig>();
	const [jobs, setJobs] = useState<ImageJob[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string>();
	const [submission, setSubmission] = useState<{ canvasId?: string; prompt: string }>();
	const [jobsLoaded, setJobsLoaded] = useState(false);
	const [mutatingId, setMutatingId] = useState<string>();
	const mutationPending = useRef(false);
	const jobRevision = useRef(0);
	const requestPending = useRef(false);
	const mounted = useRef(true);
	useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
	const refreshJobs = useCallback(async () => {
		const revision = jobRevision.current;
		const next = await imageGenerationNative.jobs();
		if (mounted.current && revision === jobRevision.current) { setJobs(next); setJobsLoaded(true); }
		return next;
	}, []);
	const refresh = useCallback(async () => {
		setLoading(true); setError(undefined);
		try {
			const [next] = await Promise.all([imageGenerationNative.config(), refreshJobs()]);
			if (mounted.current) setConfig(next);
		} catch (reason) { if (mounted.current) setError(String(reason)); }
		finally { if (mounted.current) setLoading(false); }
	}, [refreshJobs]);
	useEffect(() => { void refresh(); }, [refresh]);
	const runningCount = jobs.filter(imageJobPending).length;
	const running = runningCount > 0;
	const concurrencyLimit = config?.concurrencyLimit ?? 5;
	const atCapacity = concurrencyLimit > 0 && runningCount >= concurrencyLimit;
	useEffect(() => {
		if (!running) return;
		let stopped = false;
		let timer: ReturnType<typeof setTimeout>;
		const poll = async () => {
			try { const revision = jobRevision.current; const next = await imageGenerationNative.jobs(); if (!stopped && !requestPending.current && revision === jobRevision.current) { setJobs(next); setError(undefined); } }
			catch (reason) { if (!stopped) setError(`无法更新生成状态：${String(reason)}`); }
			if (!stopped) timer = setTimeout(() => void poll(), 1000);
		};
		timer = setTimeout(() => void poll(), 600);
		return () => { stopped = true; clearTimeout(timer); };
	}, [running]);
	// A successful generation retires the failures it replaces: once the same
	// prompt has a finished work, its older failed attempts leave the flow on
	// their own. History loaded on mount never triggers the cleanup.
	const completedSeen = useRef(new Set<string>());
	const jobsHydrated = useRef(false);
	useEffect(() => {
		const completed = jobs.filter((job) => job.status === "completed" && job.path);
		if (!jobsHydrated.current) { completedSeen.current = new Set(completed.map((job) => job.id)); jobsHydrated.current = true; return; }
		const fresh = completed.filter((job) => !completedSeen.current.has(job.id));
		if (!fresh.length) return;
		for (const job of fresh) completedSeen.current.add(job.id);
		const superseded = new Set(["failed", "cancelled", "interrupted"]);
		const stale = jobs.filter((item) => superseded.has(item.status) && !item.removed && fresh.some((done) => done.canvasId === item.canvasId && done.prompt === item.prompt && done.createdAt > item.createdAt));
		if (!stale.length) return;
		void (async () => {
			try {
				const updated = await Promise.all(stale.map((item) => imageGenerationNative.setRemoved(item.id, true).catch(() => undefined)));
				if (!mounted.current) return;
				const byId = new Map(updated.filter(Boolean).map((job) => [job!.id, job!]));
				if (byId.size) setJobs((current) => current.map((item) => byId.get(item.id) ?? item));
			} catch { /* Cleanup is best-effort; the flow already hides removed jobs. */ }
		})();
	}, [jobs]);
	const generate = async (input: Omit<Parameters<typeof imageGenerationNative.start>[0], "id" | "reference">, source?: { url: string; name: string }) => {
		if (requestPending.current || atCapacity || loading) return;
		// Polls taken before or during submission may omit the new task. Invalidate
		// both sets of snapshots when submission starts and when its reply settles.
		requestPending.current = true; jobRevision.current++; setSubmission({ canvasId: input.canvasId, prompt: input.prompt }); setError(undefined);
		try {
			const reference = source ? await prepareImageReference(source) : undefined;
			const job = await imageGenerationNative.start({ ...input, id: crypto.randomUUID(), ...(reference ? { reference } : {}) });
			if (mounted.current) setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
		} catch (reason) {
			if (mounted.current) setError(String(reason));
			// An IPC reply may be lost after the native task was accepted. Read its
			// durable status before allowing a new submission; never retry the POST.
			try { await refreshJobs(); } catch { if (mounted.current) setLoading(true); }
		} finally { jobRevision.current++; requestPending.current = false; if (mounted.current) setSubmission(undefined); }
	};
	const cancel = async (id: string) => {
		try { await imageGenerationNative.cancel(id); await refreshJobs(); }
		catch (reason) { setError(String(reason)); }
	};
	const assetAction = async (action: "export" | "reveal", id: string) => {
		setError(undefined);
		try { await imageGenerationNative[action](id); }
		catch (reason) { setError(String(reason)); }
	};
	const setRemoved = async (id: string, removed: boolean) => {
		if (mutationPending.current) return false;
		mutationPending.current = true; jobRevision.current++; setMutatingId(id); setError(undefined);
		try {
			const job = await imageGenerationNative.setRemoved(id, removed);
			if (mounted.current) setJobs((current) => current.map((item) => item.id === id ? job : item));
			return true;
		} catch (reason) { if (mounted.current) setError(String(reason)); return false; }
		finally { mutationPending.current = false; jobRevision.current++; if (mounted.current) setMutatingId(undefined); }
	};
	return { config, setConfig, jobs, jobsLoaded, loading, error, refresh, generate, running, runningCount, concurrencyLimit, atCapacity, submitting: !!submission, submission, cancel, assetAction, setRemoved, mutatingId };
}
