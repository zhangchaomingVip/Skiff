import { registerHooks } from "node:module";

// Resolve source-relative extensionless imports while Node strips TS types.
registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
			return nextResolve(`${specifier}.ts`, context);
		}
		return nextResolve(specifier, context);
	},
});
