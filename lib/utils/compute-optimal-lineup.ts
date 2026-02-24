/**
 * Optimal lineup wrapper for the summary page.
 * Delegates to the trade engine's solveOptimalLineup.
 */

import { solveOptimalLineup } from "@/lib/trade-engine/optimal-lineup";
import type { PlayerAsset, LeagueConfig } from "@/lib/trade-engine/types";

/** Compute optimal starter IDs from roster values + league config. */
export function computeOptimalStarters(
  players: Array<{
    id: string;
    position: string;
    positionGroup: string;
    value: number;
    slot: string;
  }>,
  rosterPositions: Record<string, number>,
  flexRules: Array<{ slot: string; eligible: string[] }>,
  positionMappings?: Record<string, string[]> | null,
): Set<string> {
  const eligible = players.filter((p) => p.slot !== "IR");

  const assets: PlayerAsset[] = eligible.map((p) => ({
    playerId: p.id,
    playerName: "",
    position: p.position,
    positionGroup: p.positionGroup as "offense" | "defense",
    age: null,
    nflTeam: null,
    value: p.value,
    projectedPoints: p.value,
    consensusValue: null,
    consensusComponent: null,
    leagueSignalComponent: null,
    rank: 0,
    rankInPosition: 0,
    tier: 0,
    scarcityMultiplier: 0,
    ageCurveMultiplier: 0,
    dynastyPremium: 0,
  }));

  const config: LeagueConfig = {
    totalTeams: 0,
    rosterPositions,
    flexRules,
    positionMappings: positionMappings ?? undefined,
    benchSlots: 0,
    taxiSlots: 0,
    irSlots: 0,
  };

  const result = solveOptimalLineup(assets, config);
  return new Set(result.starters.map((s) => s.player.playerId));
}
