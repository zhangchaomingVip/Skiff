import type { DiscoveredModel } from "../rpc/modelDiscovery";

export const FAMILY_KEYWORDS: Record<string, string[]> = {
	deepseek: ["deepseek"],
	kimi: ["kimi", "moonshot"],
	glm: ["glm", "chatglm"],
	auto: ["auto"],
};

export function sortDiscoveredModels(models: DiscoveredModel[], familyId: string): string[] {
	const ids = [...new Set(models.map((model) => model.id.trim()).filter(Boolean))];
	const keywords = ids.length > 20 ? FAMILY_KEYWORDS[familyId] ?? [familyId] : [];
	const matches = (id: string) => keywords.some((word) => id.toLowerCase().includes(word));
	return ids.sort((a, b) => Number(matches(b)) - Number(matches(a)) || a.localeCompare(b, "en", { sensitivity: "base" }) || a.localeCompare(b, "en"));
}
