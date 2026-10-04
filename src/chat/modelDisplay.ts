import type { BrandName } from "../components/BrandIcon";
import type { ChatMessage, ModelInfo } from "./types";

/** Families whose marks ship with the app. */
const FAMILY_BRANDS: { id: BrandName; label: string }[] = [
	{ id: "deepseek", label: "DeepSeek" },
	{ id: "kimi", label: "Kimi" },
	{ id: "glm", label: "GLM" },
];

/** Resolves a pi provider key (skiff-<family>-<channel>) back to its family. */
export function familyFromProvider(provider?: string): { id: BrandName; label: string } | undefined {
	if (!provider?.startsWith("skiff-")) return undefined;
	return FAMILY_BRANDS.find((family) => provider.startsWith(`skiff-${family.id}-`));
}

/** Brand mark for a provider/model, matched on any identifying string. */
export function modelBrand(...parts: (string | undefined)[]): BrandName | undefined {
	const text = parts.filter(Boolean).join(" ").toLowerCase();
	if (text.includes("deepseek")) return "deepseek";
	if (text.includes("kimi") || text.includes("moonshot")) return "kimi";
	if (text.includes("glm") || text.includes("zhipu")) return "glm";
	return undefined;
}

export interface ModelDisplay {
	/** Shown as the assistant turn label, e.g. `DeepSeek V4.1 Flash`. */
	label: string;
	brand?: BrandName;
}

/** Resolve the model that produced a message, falling back to the active model. */
export function modelDisplay(message: ChatMessage, models: ModelInfo[], current?: ModelInfo): ModelDisplay {
	const info = message.model ? models.find((model) => model.id === message.model && (!message.provider || model.provider === message.provider)) : undefined;
	const label = info?.name ?? info?.id ?? message.model ?? current?.name ?? current?.id ?? "Skiff";
	const brand = modelBrand(message.provider, message.model, info?.provider, info?.name, current?.provider, current?.name);
	return { label, brand };
}
