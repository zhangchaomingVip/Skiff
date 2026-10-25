import test from "node:test";
import assert from "node:assert/strict";
import { commandRowTitle, shellLabel } from "../src/chat/commandSummary.ts";

const title = (command: string, name = "bash") => commandRowTitle(name, JSON.stringify({ command })).title;

test("high-frequency commands map to deterministic action titles", () => {
	assert.equal(title("ls -la"), "查看目录内容");
	assert.equal(title("dir"), "查看目录内容");
	assert.equal(title("find . -name '*.ts'"), "查找文件");
	assert.equal(title("fd preview"), "查找文件");
	assert.equal(title("rg pattern src/"), "搜索文件内容");
	assert.equal(title("grep -rn TODO ."), "搜索文件内容");
	assert.equal(title("cat package.json"), "读取文件");
	assert.equal(title("tail -n 20 app.log"), "读取文件");
	assert.equal(title("git status"), "查看仓库状态");
	assert.equal(title("git diff"), "查看代码变更");
	assert.equal(title("npm test"), "运行测试");
	assert.equal(title("npm run test:unit"), "运行测试");
	assert.equal(title("pnpm vitest run"), "运行测试");
	assert.equal(title("npx jest"), "运行测试");
	assert.equal(title("cargo test"), "运行测试");
	assert.equal(title("go test ./..."), "运行测试");
	assert.equal(title("python -m pytest -q"), "运行测试");
	assert.equal(title("node --test"), "运行测试");
	assert.equal(title("mvn test"), "运行测试");
});

test("high-risk commands keep the key operation in the title", () => {
	assert.equal(title("rm -rf build"), "删除文件或目录 · rm");
	assert.equal(title("del temp.txt"), "删除文件或目录 · del");
	assert.equal(title("Remove-Item build"), "删除文件或目录 · Remove-Item");
	assert.equal(title("git reset --hard HEAD~1"), "执行 Bash · git reset");
	assert.equal(title("git commit -m 'msg'"), "执行 Bash · git commit");
});

test("cd handling: skip a single leading cd, otherwise fall back", () => {
	assert.equal(title("cd packages/app && ls -la"), "查看目录内容");
	assert.equal(title("cd"), "切换工作目录");
	assert.equal(title("cd .."), "切换工作目录");
	assert.equal(title("cd a && cd b && ls"), "执行 Bash 命令");
	assert.equal(title("ls && pwd"), "执行 Bash 命令");
	assert.equal(title("cat a | head -5"), "执行 Bash 命令");
	assert.equal(title("echo done > out.txt"), "执行 Bash 命令");
	assert.equal(title("for f in *; do echo done; done"), "执行 Bash 命令");
});

test("unmapped programs show the main program; unclear shapes fall back", () => {
	assert.equal(title("npm run build"), "执行 Bash · npm");
	assert.equal(title("./gradlew assemble"), "执行 Bash · gradlew");
	assert.equal(title("node scripts/deploy.mjs"), "执行 Bash · node");
	assert.equal(title("FOO=1 npm test"), "运行测试");
	assert.equal(title("sudo rm -rf build"), "删除文件或目录 · rm");
	assert.equal(title("Get-ChildItem -Recurse", "powershell"), "执行 PowerShell · Get-ChildItem");
	assert.equal(title("", "bash"), "执行 Bash 命令");
	assert.equal(commandRowTitle("bash", "not json").title, "执行 Bash 命令");
	assert.equal(title("npm run build", "exec"), "执行 Bash · npm");
});

test("unclear shapes fall back instead of guessing", () => {
	assert.equal(title('git commit -m "a && b"'), "执行 Bash 命令");
	assert.equal(title("echo $(pwd)"), "执行 Bash 命令");
	assert.equal(title("echo `pwd`"), "执行 Bash 命令");
	assert.equal(title("echo $HOME"), "执行 Bash 命令");
	assert.equal(title("Remove-Item $path", "powershell"), "执行 PowerShell 命令");
	assert.equal(title("npm run build &"), "执行 Bash 命令");
	assert.equal(title("cat a | grep b | wc -l"), "执行 Bash 命令");
	assert.equal(title("echo one\necho two"), "执行 Bash 命令");
	assert.equal(title('"C:\\Program Files\\Git\\bin\\git.exe" status'), "查看仓库状态");
});

test("shell labels come from the tool name or the host platform", () => {
	assert.equal(shellLabel("bash"), "Bash");
	assert.equal(shellLabel("powershell"), "PowerShell");
	assert.equal(shellLabel("pwsh"), "PowerShell");
	assert.equal(shellLabel("cmd"), "CMD");
	assert.ok(["Bash", "PowerShell"].includes(shellLabel("exec")));
});

test("streaming partial JSON falls back instead of guessing", () => {
	const partial = commandRowTitle("bash", '{"command": "npm te');
	assert.equal(partial.source, "fallback");
});
