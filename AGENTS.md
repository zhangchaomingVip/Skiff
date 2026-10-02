# Repository Guidelines

## Project Structure & Module Organization
Skiff is an AI desktop shell using React, TypeScript, Vite, and Tauri 2 (Rust).
- `src/components/`: chat, model picker, terminal, and status UI.
- `src/chat/`: session hook, message types, parsing, and a framework-independent event reducer.
- `src/rpc/RpcClient.ts`: frontend RPC bridge.
- `src-tauri/src/`: pi subprocess lifecycle; `providers.rs` merges OpenAI-compatible configuration and discovers models.
- `src-tauri/icons/` and `capabilities/`: application assets and permissions.
- `features/`: feature specifications and design notes; `docs/research.md`: research context.
- `tests/`: Node protocol tests and a browser preview with a simulated pi bridge.
- `dist/` and `src-tauri/target/`: generated output; do not commit them.

## Build, Test, and Development Commands
Run from the repository root:
- `npm ci`: install dependencies from the committed lockfile.
- `npm run dev`: start the frontend on port 1420.
- `npm run tauri -- dev`: launch the desktop application with frontend hot reload; requires Rust and platform Tauri prerequisites.
- `npm run build`: run strict TypeScript checks and produce the frontend bundle.
- `npm test`: run protocol and transcript tests (Node 24 recommended).
- `npm run preview`: serve the frontend bundle.
- `npm run tauri -- build`: package the desktop application.
- `cargo check --manifest-path src-tauri/Cargo.toml`: check native code.

## Coding Style & Naming Conventions
Use tabs, double-quoted TypeScript strings, and semicolons. Name components in PascalCase (`ChatView.tsx`), functions in camelCase, and hooks with `use` (`usePiSession`). Rust uses snake_case functions and PascalCase types. Separate RPC transport, chat state, and rendering. TypeScript enforces strict and unused-code checks. No formatter or linter is configured; avoid unrelated formatting changes.

## Testing Guidelines
Use Node's test runner for `tests/*.test.ts` and `cargo test --manifest-path src-tauri/Cargo.toml --lib` for Rust. No coverage threshold is configured. Check streaming, reasoning, usage math, images, configuration preservation, history restoration, and cleanup. Serve `tests/preview.html` on a separate Vite port for simulated QA. Run `node tests/pi.integration.mjs <pi-cli.js>` for isolated, local-only real-pi verification. Record results in PRs.

## Commit & Pull Request Guidelines
History uses `feat:` and `docs:` prefixes, including Chinese summaries. Keep commits focused. PRs should explain changes, reference issues or feature designs, list validation results, and include screenshots for UI changes.

## Security & Configuration
Install/configure `pi` separately; use `SKIFF_PI_PATH` or `PI_CLI_PATH` to select its launcher. Keep API keys out of source, logs, and screenshots. Frontend `VITE_` variables are exposed in the bundle; never use them for secrets. Review native commands and Tauri capabilities when changing process access.
