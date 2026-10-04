/**
 * Relays whose public pricing API we know about. Adding a major relay is a
 * one-line entry: match the relay's host, point at its pricing endpoint, and
 * the import panel fetches it automatically — no URL pasting. Shipped with
 * the app, so it works out of the box for everyone.
 */
export interface KnownRelay {
	name: string;
	hosts: string[];
	/** Pricing endpoint path on the same origin as the relay's base URL. */
	pricingPath: string;
}

export const KNOWN_RELAYS: KnownRelay[] = [
	{ name: "基元律动", hosts: ["tokenrhythm.studio"], pricingPath: "/api/models" },
];

/** Resolves a relay's base URL to its known pricing endpoint, if registered. */
export function knownRelayPricing(baseUrl: string): { name: string; url: string } | undefined {
	let url: URL;
	try {
		url = new URL(baseUrl);
	} catch {
		return undefined;
	}
	const host = url.hostname.replace(/^www\./, "");
	const hit = KNOWN_RELAYS.find((relay) => relay.hosts.includes(host));
	return hit ? { name: hit.name, url: `${url.protocol}//${host}${hit.pricingPath}` } : undefined;
}
