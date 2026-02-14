/**
 * Adapter exports
 */

export { BaseAdapter } from "./base";
export { SleeperAdapter, createSleeperAdapter } from "./sleeper";
export { FleaflickerAdapter, createFleaflickerAdapter } from "./fleaflicker";
export { ESPNAdapter, createESPNAdapter } from "./espn";
export type { ESPNAdapterConfig } from "./espn";
export { YahooAdapter, createYahooAdapter } from "./yahoo";
export type { YahooAdapterConfig } from "./yahoo";

import type { Provider, LeagueProviderAdapter, AdapterConfig } from "@/types";
import { SleeperAdapter } from "./sleeper";
import { FleaflickerAdapter } from "./fleaflicker";
import { ESPNAdapter, type ESPNAdapterConfig } from "./espn";
import { YahooAdapter, type YahooAdapterConfig } from "./yahoo";

/**
 * Create an adapter for the given provider
 */
export function createAdapter(
  provider: Provider,
  config: AdapterConfig
): LeagueProviderAdapter {
  switch (provider) {
    case "sleeper":
      return new SleeperAdapter(config);
    case "fleaflicker":
      return new FleaflickerAdapter(config);
    case "espn":
      return new ESPNAdapter(config as ESPNAdapterConfig);
    case "yahoo":
      return new YahooAdapter(config as YahooAdapterConfig);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
