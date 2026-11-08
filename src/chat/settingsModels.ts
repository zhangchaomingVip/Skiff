import { maskBaseUrl, type RelaySpec } from "./useModelFamilies";
import { matchPreset } from "./providerPresets";

export function filterSettingsProviders(relays: RelaySpec[], query: string) {
	const q = query.trim().toLowerCase();
	return relays.filter((relay) => [relay.name, maskBaseUrl(relay.baseUrl)].some((value) => value.toLowerCase().includes(q)));
}

export function settingsProviderEndpointLabel(baseUrl: string) {
	let endpoint: string;
	let path: string;
	let safePath = "";
	let hostname = "";
	let port = "";
	try {
		const url = new URL(baseUrl);
		hostname = url.hostname;
		port = url.port ? `:${url.port}` : "";
		path = url.pathname.replace(/\/+$/, "");
		safePath = path.endsWith("/compatible-mode/v1") ? "/compatible-mode/v1" : path === "/v1" ? path : path ? "/…" : "";
		endpoint = url.host + safePath;
	} catch {
		endpoint = maskBaseUrl(baseUrl);
		path = "";
	}
	if (endpoint.length <= 30) return endpoint;
	if (hostname.endsWith(".aliyuncs.com")) {
		const compactHost = hostname.length <= 30 ? hostname : `${hostname.slice(0, -".aliyuncs.com".length).slice(0, 10)}…aliyuncs.com`;
		return `${compactHost}${port}`;
	}
	const suffix = path.endsWith("/compatible-mode/v1") ? "/compatible-mode/v1" : endpoint.slice(-20);
	return `${endpoint.slice(0, 10)}…${suffix}`;
}

export function settingsProviderEndpointTitle(baseUrl: string) {
	try {
		const url = new URL(baseUrl);
		if (url.hostname.endsWith(".aliyuncs.com") && url.pathname.replace(/\/+$/, "") === "/compatible-mode/v1") {
			return `${url.origin}${url.pathname}`;
		}
	} catch {}
	return maskBaseUrl(baseUrl);
}

export const providerSourceLabel = (baseUrl: string) => {
	const kind = matchPreset(baseUrl)?.kind;
	return kind === "vendor" ? "官方直连" : kind === "relay" ? "中转" : kind === "local" ? "本机" : "自定义";
};
