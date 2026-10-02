import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev port and a relative base for the bundled app.
export default defineConfig({
	plugins: [react()],
	clearScreen: false,
	server: {
		port: 1420,
		strictPort: true,
		// Rust writes/locks build artifacts during desktop development on Windows.
		watch: { ignored: ["**/src-tauri/**"] },
	},
	envPrefix: ["VITE_", "TAURI_ENV_"],
	build: {
		target: "es2021",
		outDir: "dist",
		emptyOutDir: true,
	},
});
