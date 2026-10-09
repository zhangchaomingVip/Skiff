import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Composer } from "../src/components/Composer";
import { Button } from "../src/components/ui";
import type { ImageAttachment, ModelInfo } from "../src/chat/types";
import type { TextAttachment } from "../src/chat/textAttachments";
import type { WebSearchControls } from "../src/chat/webSearch";

const model: ModelInfo = { provider: "mock", id: "test-model", input: ["text", "image"] };
const images: ImageAttachment[] = [];
const files: TextAttachment[] = [];
const commands = async () => [{ name: "review", description: "审查" }, { name: "plan", description: "计划" }];
const noop = () => {};
const search: WebSearchControls = { available: false, configured: false, extensionInstalled: false, enabled: false, busy: false, toggle: async () => {}, clearKey: async () => {}, install: async () => {}, refresh: noop };

export function ComposerHarness() {
	const root = useRef<HTMLDivElement>(null);
	const [text, setText] = useState("");
	const [result, setResult] = useState("");
	const calls = useRef<string[]>([]);
	const send = async (message: string) => { calls.current.push(message); return true; };
	const run = async () => {
		const input = root.current?.querySelector("textarea");
		if (!input) return;
		const key = (key: string, extras: KeyboardEventInit = {}) => input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extras }));
		const assert = (valid: boolean, message: string) => { if (!valid) throw Error(message); };
		try {
			calls.current = [];
			flushSync(() => setText("组合输入"));
			key("Enter", { isComposing: true, keyCode: 229 });
			assert(calls.current.length === 0 && input.value === "组合输入", "IME Enter 不应发送");
			assert(key("Enter", { shiftKey: true }), "Shift+Enter 不应 preventDefault");
			flushSync(() => setText("/r"));
			await new Promise(requestAnimationFrame);
			key("Enter");
			await new Promise(requestAnimationFrame);
			assert(calls.current.length === 0 && input.value === "/review ", "菜单 Enter 应只填充命令");
			flushSync(() => setText("一次发送"));
			key("Enter"); key("Enter");
			await new Promise(requestAnimationFrame);
			assert(calls.current.length === 1 && calls.current[0] === "一次发送", "重复 Enter 不应重复发送");
			assert(input.value === "", "接受后应清空草稿");
			setResult("PASS · IME、Shift+Enter、建议菜单优先级、重复发送、草稿清空");
		} catch (error) { setResult(`FAIL · ${String(error)}`); }
	};
	return <section ref={root}><h2>Composer DOM 行为测试</h2><p>挂载正式 Composer，通过 DOM KeyboardEvent 验证组合输入与菜单优先级；不连接 pi。</p><Button onClick={() => void run()}>执行 Composer 行为测试</Button><output aria-label="Composer 测试结果">{result}</output><Composer text={text} onTextChange={setText} disabled={false} streaming={false} onSend={send} onAbort={noop} models={[model]} model={model} onSelectModel={noop} connected modelDisabled={false} thinkingLevels={[]} onThinkingLevel={noop} focusSignal={0} restoredImages={images} restoredFiles={files} editing={false} onCancelEdit={noop} getCommands={commands} search={search} onConfigureSearch={noop} /></section>;
}
