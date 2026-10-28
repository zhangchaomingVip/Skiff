# AGENTS.md

Skiff is an AI desktop shell built with React, TypeScript, Vite, and Tauri 2 (Rust), running agents through the pi CLI.

## Code Map

- `src/components/`: UI; `src/chat/`: session state, message parsing, and event reducer.
- `src/rpc/RpcClient.ts`: frontend RPC bridge; `src-tauri/src/`: native logic, pi lifecycle, and provider configuration.
- `src-tauri/src/families.rs`: relay/route config and pi projection; `src-tauri/src/pi_extensions/model_families.js`: the runtime adapter that dispatches each relay to the pi API matching its protocol.
- `src/tokens.css`: design tokens; reuse existing tokens and UI components.
- `tests/`: automated tests and mock bridge previews; `features/` and `docs/`: designs and research.

## Development and Checks

Run commands from the repository root. Use Node.js 24 (recommended); desktop development also requires Rust, platform Tauri prerequisites, and a configured pi CLI.

| Command | Purpose |
| --- | --- |
| `npm ci` | Install locked dependencies |
| `npm run dev` | Frontend development on port 1420 |
| `npm run tauri -- dev` | Desktop development |
| `npm run build` | TypeScript checks and frontend build |
| `npm test` | Node automated tests |
| `npm run test:cdp` | Full-chain desktop verification over CDP (real window, real Rust, real pi) |
| `npm run test:styles` / `npm run check:ui` | Style audit / test UI type checks |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Native code checks |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | Rust unit tests |

Run checks relevant to the change. For UI changes, verify interactions and both themes: run `npm run dev -- --port 1421` and open `/tests/preview.html?theme=light` or `?theme=dark`. The mock bridge avoids real model calls; a separate port isolates desktop storage. For real-pi regression checks, run `node tests/pi.integration.mjs <pi-cli.js>` with temporary configuration and a local mock service.

### Full-chain verification (`npm run test:cdp`)

`tests/app.cdp.mjs` covers the layer the other harnesses cannot reach: WebView2 UI → Tauri IPC → Rust → `pi --mode rpc`. It starts `npm run tauri -- dev` itself with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`, attaches with `chromium.connectOverCDP`, drives the real window, and asserts a streamed reply lands in the DOM while a local mock OpenAI server records the request.

- Use it for anything touching `RpcClient`, the Tauri commands, pi lifecycle/`prepare_runtime`, family projection, streaming event plumbing, or composer send flow — the mock-bridge previews only prove UI logic.
- Isolation: it writes a temporary `PI_CODING_AGENT_DIR` (with a `skiff-families.json` relay pointing at `127.0.0.1`) and deletes it afterwards, so real sessions and credentials are untouched. Keep it that way; never point it at the user's real agent directory.
- The WebView2 profile is **not** isolated — one user-data directory holds the real `localStorage`, so `skiff.workspace.v1` is the developer's actual project/chat list. The harness therefore snapshots every localStorage key before seeding (also written to `dist/cdp-localstorage-backup.json`), and restores it in `finally`, waiting ~8s before killing the process because Chromium flushes localStorage asynchronously. Never seed state without that restore step; losing the workspace index means losing project assignments, titles, pins and archived flags (pi transcripts survive in `~/.pi/agent/sessions`, but the catalogue does not).
- Requires Playwright, kept project-local and out of version control: `npm i --prefix .playwright-cli playwright-core` (no browser download — the harness only attaches over CDP). Ports 1420 and 9222 must be free.
- Timing: a warm cargo build finishes in ~70s; a cold build can take many minutes and the script waits up to 15 minutes for the CDP endpoint.
- Artifacts: screenshot in `dist/cdp-verify.png`, dev log in `dist/cdp-dev.log`. Read the log tail before assuming a UI bug.
- Writing new flows: an empty chat opens the launcher, not the chat view (`App.tsx` picks `launcher` unless the chat has messages or a draft), so click `开始聊天` on a `.launcher-row` before expecting `.composer-input`. Prefer clicking real controls over seeding extra state. `page.reload()` is fine but logs a harmless Tauri IPC/postMessage fallback.

## Change Guidelines

- Read relevant implementation and designs first. Keep changes focused; preserve existing work and avoid unrelated formatting.
- Use tabs, double quotes, and semicolons in TypeScript. Components use PascalCase, functions camelCase, and hooks the `use` prefix. Follow existing Rust conventions.
- Separate RPC transport, session state, and rendering. Add regression coverage for behavior changes, especially streaming, usage math, attachments, history restoration, and cleanup.
- Use commit prefixes such as `feat:`, `fix:`, and `docs:`. PRs should describe behavior changes, validation results, and unverified areas; include screenshots for UI changes.

## Configuration and Safety

- Install and configure pi separately. Select its launcher with `SKIFF_PI_PATH` or `PI_CLI_PATH`; respect `PI_CODING_AGENT_DIR`.
- Preserve existing provider configuration and credentials. Keep API keys out of source, logs, screenshots, and frontend `VITE_` variables.
- A relay's `protocol` is one of `openai` (default), `kimi`, `openai-responses`, `anthropic`, `google-genai`, `vertex`. It selects the pi API for projection, the request shape for connection tests, and the model-list endpoint; unknown or absent values fall back to `openai`. Anthropic's SDK appends `/v1`, so its stored base URL is trimmed before projection.
- Review native commands and `src-tauri/capabilities/` permissions when changing process or system access.
- Do not commit generated files such as `dist/` or `src-tauri/target/`.
