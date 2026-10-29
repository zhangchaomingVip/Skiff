import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("app entrypoint has no stray content after the HTML document", () => {
	const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
	// Browsers render text after </html> below #root, adding an outer scrollbar.
	// Report only the result so accidentally pasted credentials stay out of logs.
	assert.ok(/<\/html>\s*$/i.test(html), "Unexpected content after </html> can overflow the app viewport");
});
