import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const mode = process.argv[2];
if (!['export', 'import'].includes(mode)) throw new Error("Usage: node scripts/profile-storage.mjs <export|import> [snapshot.json]");

const localData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
const backupDir = join(localData, "Skiff", "migration");
const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 13);
const snapshotPath = resolve(process.argv[3] ?? join(backupDir, `profile-${timestamp}.json`));
const origin = process.env.SKIFF_MIGRATION_ORIGIN ?? (mode === "export" ? "http://localhost:1420" : "http://tauri.localhost");
const cdpUrl = process.env.SKIFF_MIGRATION_CDP_URL ?? "http://127.0.0.1:9223";
const require = createRequire(import.meta.url);
const { chromium } = require(join(process.cwd(), ".playwright-cli/node_modules/playwright-core"));

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const waitFor = async (url, predicate, label) => {
	const deadline = Date.now() + 120_000;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(url);
			if (response.ok && predicate(await response.json())) return;
		} catch {}
		await sleep(500);
	}
	throw new Error(`Timed out waiting for ${label} at ${url}`);
};

await waitFor(`${cdpUrl}/json/version`, (value) => !!value.Browser, "WebView2 CDP");
const browser = await chromium.connectOverCDP(cdpUrl);
try {
	const context = browser.contexts()[0];
	if (!context) throw new Error("No WebView2 browser context is available");
	await waitFor(`${cdpUrl}/json/list`, (targets) => targets.some((target) => target.type === "page" && target.url.startsWith(origin)), `Skiff page (${origin})`);
	const page = context.pages().find((candidate) => candidate.url().startsWith(origin));
	if (!page) throw new Error(`Skiff page was not found for ${origin}`);

	if (mode === "export") {
		const snapshot = await page.evaluate(async () => {
			const bytesToBase64 = (bytes) => {
				let binary = "";
				for (let offset = 0; offset < bytes.length; offset += 24_576) binary += String.fromCharCode(...bytes.subarray(offset, offset + 24_576));
				return btoa(binary);
			};
			const pack = async (value) => {
				if (value instanceof Blob) return { $skiffType: "Blob", type: value.type, base64: bytesToBase64(new Uint8Array(await value.arrayBuffer())) };
				if (Array.isArray(value)) return Promise.all(value.map(pack));
				if (value && typeof value === "object") return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await pack(item)])));
				return value;
			};
			const storage = Object.fromEntries(Object.entries(localStorage));
			let database;
			const databases = await indexedDB.databases?.() ?? [];
			if (databases.some((item) => item.name === "skiff-drafts")) {
				database = await new Promise((resolve, reject) => {
					const request = indexedDB.open("skiff-drafts");
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => reject(request.error);
				});
			}
			let indexed = null;
			if (database) {
				const stores = {};
				for (const name of [...database.objectStoreNames]) {
					const tx = database.transaction(name, "readonly"), store = tx.objectStore(name);
					const records = await new Promise((resolve, reject) => {
						const request = store.getAll();
						request.onsuccess = () => resolve(request.result);
						request.onerror = () => reject(request.error);
					});
					stores[name] = {
						keyPath: store.keyPath,
						autoIncrement: store.autoIncrement,
						indexes: [...store.indexNames].map((indexName) => {
							const index = store.index(indexName);
							return { name: index.name, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry };
						}),
						records: await pack(records),
					};
				}
				indexed = { name: database.name, version: database.version, stores };
				database.close();
			}
			return { format: 1, exportedAt: new Date().toISOString(), localStorage: storage, indexedDB: indexed };
		});
		await mkdir(join(snapshotPath, ".."), { recursive: true });
		await writeFile(snapshotPath, JSON.stringify(snapshot), { flag: "wx" });
		const draftCounts = Object.fromEntries(Object.entries(snapshot.indexedDB?.stores ?? {}).map(([name, store]) => [name, store.records.length]));
		console.log(`Exported ${Object.keys(snapshot.localStorage).length} localStorage keys and IndexedDB records ${JSON.stringify(draftCounts)}.`);
		console.log(`Backup saved outside the repository: ${snapshotPath}`);
	} else {
		const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
		if (snapshot.format !== 1 || !snapshot.localStorage || typeof snapshot.localStorage !== "object") throw new Error("Unsupported or incomplete profile snapshot");
		const before = await page.evaluate(async () => {
			const storage = Object.fromEntries(Object.entries(localStorage));
			const databases = await indexedDB.databases?.() ?? [];
			let draftCounts = {};
			if (databases.some((item) => item.name === "skiff-drafts")) {
				const db = await new Promise((resolve, reject) => { const request = indexedDB.open("skiff-drafts"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
				for (const name of [...db.objectStoreNames]) {
					const store = db.transaction(name, "readonly").objectStore(name);
					draftCounts[name] = await new Promise((resolve, reject) => { const request = store.count(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
				}
				db.close();
			}
			return { format: 1, exportedAt: new Date().toISOString(), localStorage: storage, indexedDB: null, draftCounts };
		});
		const beforePath = join(backupDir, `before-import-${timestamp}.json`);
		await mkdir(backupDir, { recursive: true });
		await writeFile(beforePath, JSON.stringify(before), { flag: "wx" });
		if (Object.values(before.draftCounts).some((count) => count > 0)) {
			throw new Error(`Target IndexedDB is not empty; no data was changed. Target backup: ${beforePath}`);
		}

		const result = await page.evaluate(async ({ source, draftCounts }) => {
			const unpack = (value) => {
				if (Array.isArray(value)) return value.map(unpack);
				if (value && typeof value === "object" && value.$skiffType === "Blob") {
					const binary = atob(value.base64), bytes = new Uint8Array(binary.length);
					for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
					return new Blob([bytes], { type: value.type });
				}
				if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unpack(item)]));
				return value;
			};
			for (const [key, value] of Object.entries(source.localStorage)) localStorage.setItem(key, value);
			if (source.indexedDB) {
				const schema = source.indexedDB;
				const db = await new Promise((resolve, reject) => {
					const request = indexedDB.open(schema.name, schema.version);
					request.onupgradeneeded = () => {
						const database = request.result;
						for (const [name, definition] of Object.entries(schema.stores)) {
							if (!database.objectStoreNames.contains(name)) {
								const store = database.createObjectStore(name, { keyPath: definition.keyPath, autoIncrement: definition.autoIncrement });
								for (const index of definition.indexes) store.createIndex(index.name, index.keyPath, { unique: index.unique, multiEntry: index.multiEntry });
							}
						}
					};
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => reject(request.error);
				});
				for (const [name, definition] of Object.entries(schema.stores)) {
					await new Promise((resolve, reject) => {
						const tx = db.transaction(name, "readwrite"), store = tx.objectStore(name);
						store.clear();
						for (const record of unpack(definition.records)) store.put(record);
						tx.oncomplete = () => resolve();
						tx.onabort = () => reject(tx.error);
						tx.onerror = () => reject(tx.error);
					});
				}
				db.close();
			}
			return { localStorageKeys: Object.keys(source.localStorage).length, sourceDraftCounts: draftCounts };
		}, { source: snapshot, draftCounts: Object.fromEntries(Object.entries(snapshot.indexedDB?.stores ?? {}).map(([name, store]) => [name, store.records.length])) });
		console.log(`Imported ${result.localStorageKeys} localStorage keys and source IndexedDB records ${JSON.stringify(result.sourceDraftCounts)}.`);
		console.log(`Previous target storage backup: ${beforePath}`);
		await page.reload({ waitUntil: "domcontentloaded" });
	}
} finally {
	await browser.close();
}
