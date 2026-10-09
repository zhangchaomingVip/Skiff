import { Button, Input, IconButton, Select, TextArea } from "./ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { FAMILY_KEYWORDS } from "../chat/modelDiscovery";
import { PRICING_IMPORT_PROMPT, catalogEntryToPriced, catalogForFamily, estimateVisionTokens, importPricedModels, parsePricedTable, type PricedModel, type TableRowError } from "../chat/pricingPage";
import type { Currency } from "../chat/types";
import { extractPricingTable, fetchPricingPage, type CatalogEntry } from "../rpc/pricingPage";
import { knownRelayPricing } from "../chat/knownRelays";
import { Icon } from "./Icon";

/** A configured (relay × model) the user can spend tokens on for screenshot recognition. */
export interface ExtractorPick {
	key: string;
	relayName: string;
	baseUrl: string;
	apiKey: string;
	modelId: string;
	inputCost: number;
	outputCost: number;
	currency: Currency;
	vision: boolean;
}

interface PickedImage {
	key: string;
	name: string;
	dataUrl: string;
	width: number;
	height: number;
}

const OUTPUT_ESTIMATE_TOKENS = 300;
const MAX_IMAGES = 4;

const formatCost = (value: number) => String(Number(value.toFixed(6)));
const formatContext = (value: number | null) => {
	if (!value) return "";
	if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
	if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
	return String(value);
};
const formatMoney = (value: number, currency: Currency) => {
	const symbol = currency === "CNY" ? "¥" : "$";
	if (value <= 0) return `${symbol}0`;
	const digits = value >= 0.01 ? 2 : value >= 0.0001 ? 4 : 6;
	return symbol + value.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "");
};
const formatStamp = (unix: number) => {
	const date = new Date(unix * 1000);
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/**
 * Model & pricing import with three paths into one preview: a public pricing
 * URL, screenshot recognition through the user's own relay (token spend, gated
 * by an explicit per-call confirmation), or pasting an AI/Excel table.
 */
export function PriceImport({ familyId, addedIds, extractors, catalog, catalogStale, catalogFetchedAt, usdCnyRate, onSaveRate, relayBaseUrl, disabled, onImport }: {
	familyId: string;
	addedIds: string[];
	extractors: ExtractorPick[];
	catalog: CatalogEntry[];
	catalogStale: boolean;
	catalogFetchedAt: number;
	usdCnyRate: number;
	onSaveRate: (rate: number) => Promise<boolean>;
	/** Current route's relay; known relays get their pricing fetched automatically. */
	relayBaseUrl: string;
	disabled: boolean;
	onImport: (models: PricedModel[]) => void;
}) {
	const [open, setOpen] = useState(false);
	const [url, setUrl] = useState("");
	const [loading, setLoading] = useState(false);
	const [models, setModels] = useState<PricedModel[]>([]);
	const [selected, setSelected] = useState<string[]>([]);
	const [query, setQuery] = useState("");
	const [error, setError] = useState<string>();
	const [rowErrors, setRowErrors] = useState<TableRowError[]>([]);
	const [pasted, setPasted] = useState("");
	const [copied, setCopied] = useState(false);
	const [images, setImages] = useState<PickedImage[]>([]);
	const [pickKey, setPickKey] = useState("");
	const [confirming, setConfirming] = useState(false);
	const [extracting, setExtracting] = useState(false);
	const [usage, setUsage] = useState<{ input: number; output: number } | null>(null);
	const fileRef = useRef<HTMLInputElement>(null);
	const requestRef = useRef(0);
	const [rateDraft, setRateDraft] = useState(String(usdCnyRate));
	const [savingRate, setSavingRate] = useState(false);
	const [rateSaved, setRateSaved] = useState(false);
	const [knownStatus, setKnownStatus] = useState<"idle" | "loading" | "done" | "error">("idle");

	const known = useMemo(() => knownRelayPricing(relayBaseUrl), [relayBaseUrl]);
	const pick = extractors.find((item) => item.key === pickKey) ?? extractors[0];
	const familyCatalog = useMemo(() => catalogForFamily(catalog, familyId), [catalog, familyId]);
	const rateValue = Number(rateDraft);
	const rateValid = Number.isFinite(rateValue) && rateValue >= 0.01 && rateValue <= 100;
	const rateDirty = rateValid && rateValue !== usdCnyRate;

	useEffect(() => { setRateDraft(String(usdCnyRate)); }, [usdCnyRate]);
	useEffect(() => {
		if (!rateSaved) return;
		const timer = window.setTimeout(() => setRateSaved(false), 2000);
		return () => window.clearTimeout(timer);
	}, [rateSaved]);

	const saveRate = async () => {
		if (!rateDirty || disabled || savingRate) return;
		setSavingRate(true);
		try {
			if (await onSaveRate(rateValue)) setRateSaved(true);
			else setError("汇率保存失败，请重试");
		} finally { setSavingRate(false); }
	};

	const loadCatalogPrices = () => {
		if (disabled || !familyCatalog.length) return;
		setError(undefined);
		showResult(familyCatalog.map((entry) => catalogEntryToPriced(entry, usdCnyRate)), []);
	};

	useEffect(() => {
		if (!error) return;
		const timer = window.setTimeout(() => setError(undefined), 6000);
		return () => window.clearTimeout(timer);
	}, [error]);
	useEffect(() => {
		if (!copied) return;
		const timer = window.setTimeout(() => setCopied(false), 2000);
		return () => window.clearTimeout(timer);
	}, [copied]);

	const added = useMemo(() => new Set(addedIds.map((id) => id.toLowerCase())), [addedIds]);
	const keywords = FAMILY_KEYWORDS[familyId] ?? [familyId];
	const ranked = (list: PricedModel[]) => {
		const boost = (id: string) => keywords.some((word) => id.toLowerCase().includes(word));
		return list.length > 20
			? [...list].sort((a, b) => Number(boost(b.modelId)) - Number(boost(a.modelId)) || a.modelId.localeCompare(b.modelId))
			: [...list].sort((a, b) => a.modelId.localeCompare(b.modelId));
	};
	const filtered = useMemo(() => models.filter((model) => model.modelId.toLowerCase().includes(query.trim().toLowerCase())), [models, query]);
	const estimate = useMemo(() => {
		if (!images.length || !pick) return undefined;
		const input = images.reduce((sum, image) => sum + estimateVisionTokens(image.width, image.height), 0);
		return { input, output: OUTPUT_ESTIMATE_TOKENS, cost: (input / 1e6) * pick.inputCost + (OUTPUT_ESTIMATE_TOKENS / 1e6) * pick.outputCost };
	}, [images, pick]);

	const showResult = (list: PricedModel[], errors: TableRowError[]) => {
		const sorted = ranked(list);
		setModels(sorted);
		setSelected(sorted.map((model) => model.modelId));
		setRowErrors(errors);
		setQuery("");
		setUsage(null);
		if (!sorted.length && !errors.length) setError("未能解析出模型，请检查内容后重试");
	};

	// Known relay: fetch its public pricing the moment the panel opens, so the
	// prices are already waiting when the user looks.
	const runKnown = async () => {
		if (!known || loading) return;
		const request = ++requestRef.current;
		setLoading(true); setError(undefined); setKnownStatus("loading");
		try {
			const models = await importPricedModels(known.url, fetchPricingPage);
			if (request !== requestRef.current) return;
			showResult(models, []);
			setKnownStatus("done");
		} catch (error) {
			if (request === requestRef.current) {
				setModels([]); setSelected([]); setRowErrors([]);
				setError(String(error).replace(/^Error: /, ""));
				setKnownStatus("error");
			}
		} finally {
			if (request === requestRef.current) setLoading(false);
		}
	};

	useEffect(() => {
		if (open && known && knownStatus === "idle") void runKnown();
	}, [open, known]);

	const run = async () => {
		if (disabled || loading || !url.trim()) return;
		const request = ++requestRef.current;
		setLoading(true); setError(undefined);
		try {
			const models = await importPricedModels(url.trim(), fetchPricingPage);
			if (request !== requestRef.current) return;
			showResult(models, []);
		} catch (error) {
			if (request === requestRef.current) { setModels([]); setSelected([]); setRowErrors([]); setError(String(error).replace(/^Error: /, "")); }
		} finally {
			if (request === requestRef.current) setLoading(false);
		}
	};

	const parsePasted = () => {
		if (disabled || !pasted.trim()) return;
		setError(undefined);
		const parsed = parsePricedTable(pasted);
		showResult(parsed.models, parsed.errors);
	};

	const copyPrompt = () => {
		void navigator.clipboard.writeText(PRICING_IMPORT_PROMPT).then(() => setCopied(true), () => setError("复制失败，请展开后手动全选复制"));
	};

	const addFiles = (files: Iterable<File>) => {
		setError(undefined);
		for (const file of files) {
			if (!file.type.startsWith("image/")) continue;
			if (images.length >= MAX_IMAGES) { setError(`一次最多 ${MAX_IMAGES} 张图片`); break; }
			const reader = new FileReader();
			reader.onload = () => {
				const dataUrl = String(reader.result);
				const probe = new Image();
				probe.onload = () => setImages((items) => items.length >= MAX_IMAGES ? items : [...items, { key: `${file.name}-${items.length}`, name: file.name, dataUrl, width: probe.naturalWidth, height: probe.naturalHeight }]);
				probe.src = dataUrl;
			};
			reader.readAsDataURL(file);
		}
	};
	const removeImage = (key: string) => {
		setImages((items) => items.filter((item) => item.key !== key));
		setConfirming(false);
	};

	const doExtract = async () => {
		if (!pick || !images.length || extracting) return;
		setConfirming(false);
		setExtracting(true); setError(undefined);
		try {
			const result = await extractPricingTable({
				baseUrl: pick.baseUrl, apiKey: pick.apiKey, modelId: pick.modelId,
				instruction: PRICING_IMPORT_PROMPT, images: images.map((image) => image.dataUrl),
			});
			const parsed = parsePricedTable(result.text);
			showResult(parsed.models, parsed.errors);
			if (result.promptTokens !== null) setUsage({ input: result.promptTokens, output: result.completionTokens ?? 0 });
		} catch (error) {
			setError(String(error).replace(/^Error: /, "").replaceAll(pick.apiKey, "[已隐藏]"));
		} finally {
			setExtracting(false);
		}
	};

	const toggle = (modelId: string) => {
		setSelected((items) => items.includes(modelId) ? items.filter((item) => item !== modelId) : [...items, modelId]);
	};
	const importSelected = () => {
		const picked = models.filter((model) => selected.includes(model.modelId) && !added.has(model.modelId.toLowerCase()));
		if (!picked.length) return;
		onImport(picked);
		setOpen(false);
	};

	const importable = selected.filter((id) => !added.has(id.toLowerCase()));

	return <>
		<Button type="button" variant="ghost" size="compact" onClick={() => setOpen((value) => !value)} aria-expanded={open} disabled={disabled}>导入模型与价格</Button>
		{open && <div className="price-import" onPaste={(event) => {
			if (event.clipboardData.files.length) {
				event.preventDefault();
				addFiles(event.clipboardData.files);
			}
		}}>
			{known && <div className="price-import-section price-import-known">
				<span className="price-import-label">{known.name}公开价目<span className="price-import-free-flag">已自动识别</span></span>
				<div className="price-import-row">
					<small className="price-import-hint">
						{knownStatus === "loading" ? "正在自动获取实时售价…" :
							knownStatus === "done" ? `已自动获取 ${models.length} 个模型的实时售价，下方勾选导入（已跳过本线路已有的）` :
								`自动获取失败：${error ?? "未知错误"}`}
					</small>
					{knownStatus === "error" && <Button type="button" variant="ghost" size="compact" onClick={() => void runKnown()} disabled={disabled || loading}>重试</Button>}
				</div>
			</div>}
			<div className="price-import-row">
				<Input type="url" inputMode="url" placeholder="https://tokenrhythm.studio/models" aria-label="定价页地址" value={url} onChange={(event) => setUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void run(); } }} disabled={disabled || loading} />
				<Button type="button" variant="ghost" size="compact" onClick={() => void run()} disabled={disabled || loading || !url.trim()} aria-busy={loading}>{loading && <span className="model-discovery-spinner" aria-hidden="true" />}{loading ? "获取中…" : "获取价格"}</Button>
			</div>
			<div className="price-import-section">
				<span className="price-import-label">公开牌价（models.dev）<span className="price-import-free-flag">免费</span></span>
				<div className="price-import-row">
					<small className="price-import-hint">1 USD =</small>
					<Input type="number" className="price-import-rate" min={0.01} max={100} step={0.1} aria-label="美元兑人民币汇率" value={rateDraft} onChange={(event) => setRateDraft(event.target.value)} disabled={disabled || savingRate} />
					<small className="price-import-hint">CNY，官方牌价按此折算</small>
					<Button type="button" variant="ghost" size="compact" onClick={() => void saveRate()} disabled={disabled || savingRate || !rateDirty}>{rateSaved ? "已保存" : "保存"}</Button>
				</div>
				<div className="price-import-row">
					<small className="price-import-hint">{catalog.length ? `收录 ${familyCatalog.length} 个本家族官方模型 · 目录更新于 ${formatStamp(catalogFetchedAt)}${catalogStale ? "（网络失败，读取本地缓存）" : ""} · 牌价≠中转价，导入后请按中转实际核对` : "目录加载中…首次需联网抓取，之后走 24 小时本地缓存"}</small>
					<Button type="button" variant="ghost" size="compact" onClick={loadCatalogPrices} disabled={disabled || !familyCatalog.length}>带出本家族牌价</Button>
				</div>
			</div>
			<div className="price-import-section">
				<span className="price-import-label">截图识别<span className="price-import-cost-flag">消耗 API 额度</span></span>
				<div className="price-import-images">
					{images.map((image) => <span className="price-import-thumb" key={image.key}>
						<img src={image.dataUrl} alt={image.name} />
						<IconButton type="button"  onClick={() => removeImage(image.key)} aria-label={`移除 ${image.name}`}><Icon name="close" size={12} /></IconButton>
					</span>)}
					{images.length < MAX_IMAGES && <Button type="button" variant="ghost" size="compact" onClick={() => fileRef.current?.click()}>选择截图</Button>}
					<input ref={fileRef} type="file" accept="image/*" multiple className="price-import-file" aria-hidden="true" tabIndex={-1} onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }} />
				</div>
				{extractors.length ? <>
					<div className="price-import-row">
						<Select aria-label="识别所用模型" value={pick?.key ?? ""} onChange={(event) => { setPickKey(event.target.value); setConfirming(false); }} disabled={disabled || extracting}>
							{extractors.map((item) => <option key={item.key} value={item.key}>{item.modelId} · {item.relayName}（入 {formatCost(item.inputCost)} / 出 {formatCost(item.outputCost)} · {item.currency}）</option>)}
						</Select>
						<Button type="button" variant="ghost" size="compact" onClick={() => setConfirming(true)} disabled={disabled || extracting || !images.length || confirming}>{extracting ? "识别中…" : "识别"}</Button>
					</div>
					{confirming && estimate && pick && <div className="price-import-confirm" role="alertdialog" aria-label="识别消耗确认">
						<span>将用 <strong>{pick.modelId}</strong>（{pick.relayName}）识别 {images.length} 张截图，预计消耗约 {estimate.input.toLocaleString()} 输入 + {estimate.output} 输出 tokens（约 {formatMoney(estimate.cost, pick.currency)}）。<small>估算值，以中转实际计费为准。</small></span>
						<span className="price-import-confirm-actions">
							<Button type="button" variant="ghost" size="compact" onClick={() => setConfirming(false)} disabled={extracting}>取消</Button>
							<Button type="button" variant="primary" size="compact" onClick={() => void doExtract()} disabled={extracting}>确认并识别</Button>
						</span>
					</div>}
				</> : <small className="price-import-hint">暂无可用的已配置模型。先到「模型选择」页配置一个支持视觉的模型，或改用下方粘贴方式（免费）。</small>}
				{usage && <small className="price-import-usage">本次实际消耗 {usage.input.toLocaleString()} 输入 + {usage.output.toLocaleString()} 输出 tokens。</small>}
			</div>
			<div className="price-import-section">
				<span className="price-import-label">粘贴识别结果<span className="price-import-free-flag">免费</span></span>
				<TextArea className="price-import-paste" rows={4} placeholder={"模型ID\t输入单价\t输出单价\t币种\t上下文窗口\t最大输出"} aria-label="识别结果" value={pasted} onChange={(event) => setPasted(event.target.value)} disabled={disabled} />
				<div className="price-import-row">
					<details className="price-import-prompt">
						<summary>没有现成表格？复制提示词，把截图发给任意 AI</summary>
						<pre>{PRICING_IMPORT_PROMPT}</pre>
						<Button type="button" variant="ghost" size="compact" onClick={copyPrompt}>{copied ? "已复制" : "复制提示词"}</Button>
					</details>
					<Button type="button" variant="ghost" size="compact" onClick={parsePasted} disabled={disabled || !pasted.trim()}>解析并预览</Button>
				</div>
			</div>
			{error && <div className="model-discovery-error" role="alert"><span>{error}</span><IconButton type="button"  aria-label="关闭导入错误" onClick={() => setError(undefined)}><Icon name="close" size={14} /></IconButton></div>}
			{rowErrors.length > 0 && <ul className="price-import-errors">{rowErrors.map((row) => <li key={row.line}>第 {row.line} 行：{row.reason}{row.text ? `（${row.text}）` : ""}</li>)}</ul>}
			{models.length > 0 && <div className="price-import-list">
				{models.length > 10 && <Input className="price-import-search" type="search" placeholder="搜索模型 ID…" aria-label="搜索模型 ID" value={query} onChange={(event) => setQuery(event.target.value)} disabled={disabled} />}
				{filtered.map((model) => {
					const isAdded = added.has(model.modelId.toLowerCase());
					return <label className={`price-import-option${isAdded ? " disabled" : ""}`} key={model.modelId}>
						<input type="checkbox" checked={selected.includes(model.modelId)} disabled={disabled || isAdded} onChange={() => toggle(model.modelId)} />
						<span className="price-import-id">{model.modelId}{model.note && <span className="provider-tag muted-tag">{model.note}</span>}{isAdded && <span className="provider-tag">已添加</span>}</span>
						<small>入 {formatCost(model.inputCost)} / 出 {formatCost(model.outputCost)} · {model.currency}{model.contextWindow ? ` · 上下文 ${formatContext(model.contextWindow)}` : ""}</small>
					</label>;
				})}
				{!filtered.length && <p className="model-discovery-empty" role="status">没有匹配的模型</p>}
			</div>}
			{models.length > 0 && <div className="price-import-actions"><Button type="button" variant="primary" size="compact" onClick={importSelected} disabled={disabled || !importable.length}>导入 {importable.length} 个模型</Button></div>}
		</div>}
	</>;
}
