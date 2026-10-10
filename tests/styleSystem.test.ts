import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { offerPrice, offerPriceCompact, offerAccount } from "../src/chat/offerDisplay.ts";

test("visual tokens, selector scope and contrast pass the standalone style audit", () => {
	// The TS resolver intentionally rewrites source .js imports; run the CSS
	// parser outside that resolver so it does not rewrite PostCSS's own modules.
	const output = execFileSync(process.execPath, ["scripts/check-styles.mjs"], { encoding: "utf8" });
	assert.match(output, /style errors: 0/);
	assert.match(output, /contrast failures: 0/);
});
test("billing presentation distinguishes unknown prices from free and labels accounts", () => {
	assert.match(offerPrice({ currency: "USD", inputCost: 0, outputCost: 2 }), /USD · 输入 \$0 · 输出 \$2 \/ 每百万 token/);
	assert.match(offerPrice({ currency: "CNY" }), /待配置/);
	assert.match(offerPrice({ currency: "CNY", inputCost: NaN, outputCost: Infinity }), /输入 待配置 · 输出 待配置/);
	assert.equal(offerAccount("  "), "扣费账户：未标注");
});
test("compact prices keep symbols and unknown states for dense rows", () => {
	assert.equal(offerPriceCompact({ currency: "CNY", inputCost: 1.5, outputCost: 4.5 }), "输入 ¥1.5 · 输出 ¥4.5");
	assert.equal(offerPriceCompact({ currency: "USD", inputCost: 2, outputCost: 8 }), "输入 $2 · 输出 $8");
	assert.equal(offerPriceCompact({ currency: "CNY" }), "输入 待配置 · 输出 待配置");
});
