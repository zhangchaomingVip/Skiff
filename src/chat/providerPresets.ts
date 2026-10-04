/**
 * Built-in provider catalog for the "add provider" sheet, modelled on
 * Magpie's preset directory (github.com/steipete/magpie). Picking a preset
 * only asks for the API key — the endpoint, console links and the default
 * family come along. Custom relays stay fully hand-typed.
 */
export type PresetKind = "vendor" | "relay" | "local";

export interface ProviderPreset {
	id: string;
	name: string;
	kind: PresetKind;
	/** OpenAI-compatible base URL prefilled in the editor. */
	baseUrl: string;
	/** Vendor console, opened from the editor header. */
	website: string;
	/** "Get a key" link next to the key field. */
	keysUrl: string;
	/** The family this vendor's models belong to, when known upfront. */
	familyId?: string;
	/** Local servers accept an empty key. */
	keyOptional?: boolean;
}

export const PRESET_KINDS: { kind: PresetKind; title: string; hint: string }[] = [
	{ kind: "vendor", title: "供应商", hint: "模型厂商的官方 API" },
	{ kind: "relay", title: "中转", hint: "一个密钥，多家模型" },
	{ kind: "local", title: "本机", hint: "运行在这台电脑上" },
];

export const PROVIDER_PRESETS: ProviderPreset[] = [
	// --- vendors: the model makers Skiff has families for -------------------
	{ id: "deepseek", name: "DeepSeek", kind: "vendor", baseUrl: "https://api.deepseek.com/v1", website: "https://platform.deepseek.com", keysUrl: "https://platform.deepseek.com/api_keys", familyId: "deepseek" },
	{ id: "kimi", name: "Kimi（月之暗面）", kind: "vendor", baseUrl: "https://api.moonshot.cn/v1", website: "https://platform.moonshot.cn", keysUrl: "https://platform.moonshot.cn/console/api-keys", familyId: "kimi" },
	{ id: "kimi-global", name: "Kimi（国际）", kind: "vendor", baseUrl: "https://api.moonshot.ai/v1", website: "https://platform.moonshot.ai", keysUrl: "https://platform.moonshot.ai/console/api-keys", familyId: "kimi" },
	{ id: "glm", name: "智谱 GLM", kind: "vendor", baseUrl: "https://open.bigmodel.cn/api/paas/v4", website: "https://open.bigmodel.cn", keysUrl: "https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys", familyId: "glm" },
	{ id: "zai", name: "Z.ai", kind: "vendor", baseUrl: "https://api.z.ai/api/paas/v4", website: "https://z.ai", keysUrl: "https://z.ai/manage-apikey/apikey-list", familyId: "glm" },

	// --- relays: one key for many vendors -----------------------------------
	{ id: "openrouter", name: "OpenRouter", kind: "relay", baseUrl: "https://openrouter.ai/api/v1", website: "https://openrouter.ai", keysUrl: "https://openrouter.ai/keys" },
	{ id: "siliconflow", name: "硅基流动", kind: "relay", baseUrl: "https://api.siliconflow.cn/v1", website: "https://cloud.siliconflow.cn", keysUrl: "https://cloud.siliconflow.cn/account/ak" },
	{ id: "modelscope", name: "魔搭 ModelScope", kind: "relay", baseUrl: "https://api-inference.modelscope.cn/v1", website: "https://modelscope.cn", keysUrl: "https://modelscope.cn/my/myaccesstoken" },
	{ id: "together", name: "Together AI", kind: "relay", baseUrl: "https://api.together.xyz/v1", website: "https://www.together.ai", keysUrl: "https://api.together.ai/settings/api-keys" },
	{ id: "fireworks", name: "Fireworks", kind: "relay", baseUrl: "https://api.fireworks.ai/inference/v1", website: "https://fireworks.ai", keysUrl: "https://app.fireworks.ai/settings/users/api-keys" },
	{ id: "aihubmix", name: "AiHubMix", kind: "relay", baseUrl: "https://aihubmix.com/v1", website: "https://aihubmix.com", keysUrl: "https://console.aihubmix.com/token" },
	{ id: "302ai", name: "302.AI", kind: "relay", baseUrl: "https://api.302.ai/v1", website: "https://302.ai", keysUrl: "https://302.ai/api-keys/list" },

	// --- local: servers on this machine --------------------------------------
	{ id: "ollama", name: "Ollama", kind: "local", baseUrl: "http://localhost:11434/v1", website: "https://ollama.com", keysUrl: "https://ollama.com", keyOptional: true },
	{ id: "lmstudio", name: "LM Studio", kind: "local", baseUrl: "http://localhost:1234/v1", website: "https://lmstudio.ai", keysUrl: "https://lmstudio.ai", keyOptional: true },
];

export function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return "";
	}
}

/** Hosts that point at the same loopback server, whatever they are written as. */
function canonicalHost(url: URL): string {
	const hostname = url.hostname.toLowerCase();
	const host = hostname === "127.0.0.1" ? "localhost" : hostname;
	return url.port ? `${host}:${url.port}` : host;
}

/** Strips trailing slashes so prefix compares hold whatever the user typed. */
function normalize(url: string): string | undefined {
	try {
		const parsed = new URL(url.trim());
		return `${canonicalHost(parsed)}${parsed.pathname.replace(/\/+$/, "")}`;
	} catch {
		return undefined;
	}
}

/**
 * Finds the preset a configured relay came from, matching by endpoint so it
 * keeps working after renames. Custom relays match nothing.
 */
export function matchPreset(baseUrl: string): ProviderPreset | undefined {
	const actual = normalize(baseUrl);
	if (!actual) return undefined;
	return PROVIDER_PRESETS.find((preset) => {
		const expected = normalize(preset.baseUrl);
		// Mutual prefix: a relay typed without /v1 still matches, and a plan
		// endpoint under the vendor's host does too.
		return !!expected && (actual.startsWith(expected) || expected.startsWith(actual));
	});
}

/** Presets whose name, id or endpoint host contains the query (empty = all). */
export function filterPresets(query: string): ProviderPreset[] {
	const q = query.trim().toLowerCase();
	if (!q) return PROVIDER_PRESETS;
	return PROVIDER_PRESETS.filter((preset) => preset.name.toLowerCase().includes(q) || preset.id.includes(q) || hostOf(preset.baseUrl).toLowerCase().includes(q));
}
