import { createContext, useContext } from "react";
import type { ModelInfo } from "./types";

export interface FamilyLookup {
	id: string;
	name: string;
}

export interface ModelFamilyContextValue {
	models?: ModelInfo[];
	/** Includes disabled channels and legacy aliases for historical pricing. */
	pricingModels?: ModelInfo[];
	current?: ModelInfo;
	configurationHint?: string;
	select?: (model: ModelInfo) => void;
	/** Maps a model (pi provider key) to its family, when it belongs to one. */
	familyOf: (model: ModelInfo) => FamilyLookup | undefined;
	/** Opens the provider settings dialog. */
	manage: () => void;
}

/**
 * Family metadata and the settings entry point are provided once at the app
 * root, so the composer and menus stay free of extra plumbing.
 */
export const ModelFamilyContext = createContext<ModelFamilyContextValue>({
	familyOf: () => undefined,
	manage: () => {},
});

export const useModelFamily = () => useContext(ModelFamilyContext);
