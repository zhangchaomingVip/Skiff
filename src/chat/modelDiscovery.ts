export const FAMILY_KEYWORDS: Record<string, string[]> = {
	deepseek: ["deepseek"],
	kimi: ["kimi", "moonshot"],
	glm: ["glm", "chatglm"],
};

export function sortDiscoveredModels(ids: string[], familyId: string): string[] {
	const models = [...new Set(ids)];
	const keywords = models.length > 20 ? FAMILY_KEYWORDS[familyId] ?? [familyId] : [];
	const matches = (id: string) => keywords.some((word) => id.toLowerCase().includes(word));
	return models.sort((a, b) => Number(matches(b)) - Number(matches(a)) || a.localeCompare(b, "en", { sensitivity: "base" }) || a.localeCompare(b, "en"));
}
