# AGENTS.md

Skiff is an AI desktop shell built with React, TypeScript, Vite, and Tauri 2 (Rust), running agents through the pi CLI.

## Code Map

- `src/components/`: UI; `src/chat/`: session state, message parsing, and event reducer.
- `src/rpc/RpcClient.ts`: frontend RPC bridge; `src-tauri/src/`: native logic, pi lifecycle, and provider configuration.
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
| `npm run test:styles` / `npm run check:ui` | Style audit / test UI type checks |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Native code checks |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | Rust unit tests |

Run checks relevant to the change. For UI changes, verify interactions and both themes: run `npm run dev -- --port 1421` and open `/tests/preview.html?theme=light` or `?theme=dark`. The mock bridge avoids real model calls; a separate port isolates desktop storage. For real-pi regression checks, run `node tests/pi.integration.mjs <pi-cli.js>` with temporary configuration and a local mock service.

## Change Guidelines

- Read relevant implementation and designs first. Keep changes focused; preserve existing work and avoid unrelated formatting.
- Use tabs, double quotes, and semicolons in TypeScript. Components use PascalCase, functions camelCase, and hooks the `use` prefix. Follow existing Rust conventions.
- Separate RPC transport, session state, and rendering. Add regression coverage for behavior changes, especially streaming, usage math, attachments, history restoration, and cleanup.
- Use commit prefixes such as `feat:`, `fix:`, and `docs:`. PRs should describe behavior changes, validation results, and unverified areas; include screenshots for UI changes.

## Configuration and Safety

- Install and configure pi separately. Select its launcher with `SKIFF_PI_PATH` or `PI_CLI_PATH`; respect `PI_CODING_AGENT_DIR`.
- Preserve existing provider configuration and credentials. Keep API keys out of source, logs, screenshots, and frontend `VITE_` variables.
- Review native commands and `src-tauri/capabilities/` permissions when changing process or system access.
- Do not commit generated files such as `dist/` or `src-tauri/target/`.
