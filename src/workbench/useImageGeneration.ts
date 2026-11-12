import { useCallback, useEffect, useRef, useState } from "react";
import { imageGenerationNative, imageJobPending, prepareImageReference, type ImageGenerationConfig, type ImageJob } from "./imageGeneration";

export function useImageGeneration() {
	const [config, setConfig] = useState<ImageGenerationConfig>();
	const [jobs, setJobs] = useState<ImageJob[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string>();
	const [submitting, setSubmitting] = useState(false);
	const [mutatingId, setMutatingId] = useState<string>();
	const mutationPending = useRef(false);
	const jobRevision = useRef(0);
	const requestPending = useRef(false);
	const mounted = useRef(true);
	useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
	const refreshJobs = useCallback(async () => {
		const revision = jobRevision.current;
		const next = await imageGenerationNative.jobs();
		if (mounted.current && revision === jobRevision.current) setJobs(next);
		return next;
	}, []);
	const refresh = useCallback(async () => {
		setLoading(true); setError(undefined);
		const revision = jobRevision.current;
		try {
			const [next, list] = await Promise.all([imageGenerationNative.config(), imageGenerationNative.jobs()]);
			if (mounted.current) { setConfig(next); if (revision === jobRevision.current) setJobs(list); }
		} catch (reason) { if (mounted.current) setError(String(reason)); }
		finally { if (mounted.current) setLoading(false); }
	}, []);
	useEffect(() => { void refresh(); }, [refresh]);
	const running = jobs.some(imageJobPending);
	useEffect(() => {
		if (!running) return;
		let stopped = false;
		let timer: ReturnType<typeof setTimeout>;
		const poll = async () => {
			try { const revision = jobRevision.current; const next = await imageGenerationNative.jobs(); if (!stopped && revision === jobRevision.current) { setJobs(next); setError(undefined); } }
			catch (reason) { if (!stopped) setError(`无法更新生成状态：${String(reason)}`); }
			if (!stopped) timer = setTimeout(() => void poll(), 1000);
		};
		timer = setTimeout(() => void poll(), 600);
		return () => { stopped = true; clearTimeout(timer); };
	}, [running]);
	const generate = async (input: Omit<Parameters<typeof imageGenerationNative.start>[0], "id" | "reference">, source?: { url: string; name: string }) => {
		if (requestPending.current || running || loading) return;
		requestPending.current = true; setSubmitting(true); setError(undefined);
		try {
			const reference = source ? await prepareImageReference(source) : undefined;
			const job = await imageGenerationNative.start({ ...input, id: crypto.randomUUID(), ...(reference ? { reference } : {}) });
			if (mounted.current) setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
		} catch (reason) {
			if (mounted.current) setError(String(reason));
			// An IPC reply may be lost after the native task was accepted. Read its
			// durable status before allowing a new submission; never retry the POST.
			try { await refreshJobs(); } catch { if (mounted.current) setLoading(true); }
		} finally { requestPending.current = false; if (mounted.current) setSubmitting(false); }
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
	return { config, setConfig, jobs, loading, error, refresh, generate, running, submitting, cancel, assetAction, setRemoved, mutatingId };
}
