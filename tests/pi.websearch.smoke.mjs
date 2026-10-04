// Smoke-tests the bundled pi extension: `node tests/pi.websearch.smoke.mjs <pi.cmd> ["question"]`
// Prints whether `/web` got registered and, with a question, whether the model
// actually calls the web_search tool.
import { spawn } from "node:child_process";

const pi = process.argv[2] ?? "pi";
const question = process.argv[3];

const child = spawn("cmd.exe", ["/C", pi, "--mode", "rpc"], {
	cwd: "d:/workspace/Skiff",
	stdio: ["pipe", "pipe", "pipe"],
	windowsHide: true,
});

let buffer = "";
child.stdout.on("data", (chunk) => {
	buffer += chunk.toString();
	let index = buffer.indexOf("\n");
	while (index >= 0) {
		const line = buffer.slice(0, index).trim();
		buffer = buffer.slice(index + 1);
		if (line) process.stdout.write(`OUT  ${line.slice(0, 400)}\n`);
		index = buffer.indexOf("\n");
	}
});
child.stderr.on("data", (chunk) => {
	const text = chunk.toString().trim();
	if (text) process.stdout.write(`ERR  ${text.slice(0, 300)}\n`);
});

const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
const step = (ms, fn) => setTimeout(fn, ms);

step(3000, () => { process.stdout.write("\n== get_commands ==\n"); send({ type: "get_commands", id: "req_1" }); });
step(5000, () => { process.stdout.write("\n== /web on ==\n"); send({ type: "prompt", message: "/web on", id: "req_2" }); });
if (question) step(8000, () => { process.stdout.write(`\n== prompt: ${question} ==\n`); send({ type: "prompt", message: question, id: "req_3" }); });
step(question ? 60000 : 9000, () => { child.kill(); process.exit(0); });
