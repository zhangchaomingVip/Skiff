import type { BrandName } from "../components/BrandIcon";
import type { ChatMessage, ModelInfo } from "./types";

/** Brand mark for a provider/model, matched on any identifying string. */
export function modelBrand(...parts: (string | undefined)[]): BrandName | undefined {
	const text = parts.filter(Boolean).join(" ").toLowerCase();
	if (text.includes("deepseek")) return "deepseek";
	return undefined;
}

export interface ModelDisplay {
	/** Shown as the assistant turn label, e.g. `DeepSeek V4.1 Flash`. */
	label: string;
	brand?: BrandName;
}

/** Resolve the model that produced a message, falling back to the active model. */
export function modelDisplay(message: ChatMessage, models: ModelInfo[], current?: ModelInfo): ModelDisplay {
	const info = message.model ? models.find((model) => model.id === message.model) : undefined;
	const label = info?.name ?? info?.id ?? message.model ?? current?.name ?? current?.id ?? "Skiff";
	const brand = modelBrand(message.provider, message.model, info?.provider, info?.name, current?.provider, current?.name);
	return { label, brand };
}
