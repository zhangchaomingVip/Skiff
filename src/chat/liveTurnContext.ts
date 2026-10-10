import { createContext } from "react";
import type { VoyageMetrics } from "./useVoyageMetrics";

/** Shared clock for the rail and lightweight transcript summaries. */
export const LiveTurnContext = createContext<VoyageMetrics["liveTurn"]>(undefined);
