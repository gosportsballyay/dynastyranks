"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type {
  PlayerAsset,
  DraftPickAsset,
  TradeAsset,
  LeagueConfig,
  FairnessResult,
  RosterImpactResult,
  TradeDivergenceResult,
} from "@/lib/trade-engine";
import {
  computeFairness,
  computeMarketDivergence,
} from "@/lib/trade-engine/trade-analysis";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { TradeSide } from "./trade-side";
import { FairnessPanel } from "./fairness-panel";
import { MarketPanel } from "./market-panel";
import { RosterImpactPanel } from "./roster-impact-panel";
import { analyzeRosterImpactAction } from "@/app/league/[id]/trade-calculator/actions";

interface TeamData {
  id: string;
  name: string;
  roster: PlayerAsset[];
  picks: DraftPickAsset[];
}

interface TradeCalculatorProps {
  teams: TeamData[];
  genericPicks: DraftPickAsset[];
  leagueConfig: LeagueConfig;
  userTeamId: string | null;
  leagueId: string;
  replacementValue: number;
  provider?: string;
}

export function TradeCalculator({
  teams,
  genericPicks,
  leagueConfig,
  userTeamId,
  leagueId,
  replacementValue,
  provider,
}: TradeCalculatorProps) {
  const [team1Id, setTeam1Id] = useState("");
  const [team2Id, setTeam2Id] = useState("");
  const [team1Players, setTeam1Players] = useState<PlayerAsset[]>([]);
  const [team2Players, setTeam2Players] = useState<PlayerAsset[]>([]);
  const [team1Picks, setTeam1Picks] = useState<DraftPickAsset[]>([]);
  const [team2Picks, setTeam2Picks] = useState<DraftPickAsset[]>([]);
  const [rosterImpact, setRosterImpact] =
    useState<RosterImpactResult | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactError, setImpactError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const team1 = teams.find((t) => t.id === team1Id);
  const team2 = teams.find((t) => t.id === team2Id);

  // Build TradeAsset arrays
  const side1Assets: TradeAsset[] = [
    ...team1Players.map(
      (p) => ({ type: "player", asset: p }) as TradeAsset,
    ),
    ...team1Picks.map(
      (p) => ({ type: "pick", asset: p }) as TradeAsset,
    ),
  ];
  const side2Assets: TradeAsset[] = [
    ...team2Players.map(
      (p) => ({ type: "player", asset: p }) as TradeAsset,
    ),
    ...team2Picks.map(
      (p) => ({ type: "pick", asset: p }) as TradeAsset,
    ),
  ];

  const hasAssets = side1Assets.length > 0 || side2Assets.length > 0;

  // Compute client-side analysis
  let fairness: FairnessResult | null = null;
  let divergence: TradeDivergenceResult | null = null;

  if (hasAssets) {
    fairness = computeFairness(side1Assets, side2Assets, replacementValue);
    divergence = computeMarketDivergence(side1Assets, side2Assets);
  }

  // Determine which TradeSide gets the value adjustment line item.
  // adjustedSide indicates the MORE-asset side (where deduction applies),
  // so the FEWER-asset side (opposite) gets the positive adjustment row.
  const adjustmentValue = fairness?.totalAdjustmentValue ?? 0;
  const adjustedSide = fairness?.adjustedSide ?? null;
  const side1Adjustment =
    adjustmentValue > 0 && adjustedSide === 2 ? adjustmentValue : 0;
  const side2Adjustment =
    adjustmentValue > 0 && adjustedSide === 1 ? adjustmentValue : 0;

  // Check if user's team is involved
  const userTeamInvolved =
    userTeamId !== null &&
    (team1Id === userTeamId || team2Id === userTeamId);

  // Debounced roster impact server action
  const fetchRosterImpact = useCallback(() => {
    if (!userTeamId || !userTeamInvolved || !hasAssets) {
      setRosterImpact(null);
      return;
    }

    // Determine which side is the user's team
    const isUserTeam1 = team1Id === userTeamId;
    const userAssetsOut = isUserTeam1 ? side1Assets : side2Assets;
    const userAssetsIn = isUserTeam1 ? side2Assets : side1Assets;

    if (userAssetsOut.length === 0 && userAssetsIn.length === 0) {
      setRosterImpact(null);
      return;
    }

    setImpactLoading(true);
    setImpactError(null);
    analyzeRosterImpactAction(
      leagueId,
      userTeamId,
      userAssetsOut,
      userAssetsIn,
    ).then((result) => {
      setRosterImpact(result);
      setImpactLoading(false);
    }).catch((err) => {
      console.error("Roster impact analysis failed:", err);
      setImpactError("Failed to analyze roster impact.");
      setImpactLoading(false);
    });
  }, [
    userTeamId,
    userTeamInvolved,
    hasAssets,
    team1Id,
    leagueId,
    // Serialize asset IDs to detect changes
    team1Players.map((p) => p.playerId).join(","),
    team2Players.map((p) => p.playerId).join(","),
    team1Picks.map((p) => `${p.pickId}:${p.value}`).join(","),
    team2Picks.map((p) => `${p.pickId}:${p.value}`).join(","),
  ]);

  // Trigger debounced roster impact analysis
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchRosterImpact, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchRosterImpact]);

  function clearTrade() {
    setTeam1Players([]);
    setTeam2Players([]);
    setTeam1Picks([]);
    setTeam2Picks([]);
    setRosterImpact(null);
  }

  function selectTeam1(id: string, keepSelections = false) {
    setTeam1Id(id);
    if (!keepSelections) {
      setTeam1Players([]);
      setTeam1Picks([]);
      setRosterImpact(null);
    }
  }

  function selectTeam2(id: string, keepSelections = false) {
    setTeam2Id(id);
    if (!keepSelections) {
      setTeam2Players([]);
      setTeam2Picks([]);
      setRosterImpact(null);
    }
  }

  /** Update a pick's value (used by E/M/L toggle). */
  function updatePick1Value(pickId: string, value: number) {
    setTeam1Picks((prev) =>
      prev.map((p) => (p.pickId === pickId ? { ...p, value } : p)),
    );
  }

  function updatePick2Value(pickId: string, value: number) {
    setTeam2Picks((prev) =>
      prev.map((p) => (p.pickId === pickId ? { ...p, value } : p)),
    );
  }

  return (
    <div className="space-y-6">
      {provider === "espn" && (
        <div className="rounded-lg bg-amber-900/20 border border-amber-700/30 px-4 py-3 text-sm text-amber-300">
          ESPN does not provide draft pick trade data. Pick ownership
          assumes each team holds their own picks — traded picks may
          not be reflected.
        </div>
      )}
      {/* Trade workspace */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TradeSide
          teamId={team1Id}
          teamName={team1?.name ?? ""}
          allTeamsData={teams}
          genericPicks={genericPicks}
          selectedPlayers={team1Players}
          selectedPicks={team1Picks}
          onSelectTeam={selectTeam1}
          onAddPlayer={(p) => {
            if (!team1Players.find((x) => x.playerId === p.playerId)) {
              setTeam1Players([...team1Players, p]);
            }
          }}
          onRemovePlayer={(id) =>
            setTeam1Players(team1Players.filter((p) => p.playerId !== id))
          }
          onAddPick={(p) => {
            if (!team1Picks.find((x) => x.pickId === p.pickId)) {
              setTeam1Picks([...team1Picks, p]);
            }
          }}
          onRemovePick={(id) =>
            setTeam1Picks(team1Picks.filter((p) => p.pickId !== id))
          }
          onUpdatePickValue={updatePick1Value}
          otherTeamId={team2Id}
          totalValue={
            team1Players.reduce((s, p) => s + p.value, 0) +
            team1Picks.reduce((s, p) => s + p.value, 0)
          }
          valueAdjustment={side1Adjustment}
        />

        <TradeSide
          teamId={team2Id}
          teamName={team2?.name ?? ""}
          allTeamsData={teams}
          genericPicks={genericPicks}
          selectedPlayers={team2Players}
          selectedPicks={team2Picks}
          onSelectTeam={selectTeam2}
          onAddPlayer={(p) => {
            if (!team2Players.find((x) => x.playerId === p.playerId)) {
              setTeam2Players([...team2Players, p]);
            }
          }}
          onRemovePlayer={(id) =>
            setTeam2Players(team2Players.filter((p) => p.playerId !== id))
          }
          onAddPick={(p) => {
            if (!team2Picks.find((x) => x.pickId === p.pickId)) {
              setTeam2Picks([...team2Picks, p]);
            }
          }}
          onRemovePick={(id) =>
            setTeam2Picks(team2Picks.filter((p) => p.pickId !== id))
          }
          onUpdatePickValue={updatePick2Value}
          otherTeamId={team1Id}
          totalValue={
            team2Players.reduce((s, p) => s + p.value, 0) +
            team2Picks.reduce((s, p) => s + p.value, 0)
          }
          valueAdjustment={side2Adjustment}
        />
      </div>

      {/* Clear button */}
      {hasAssets && (
        <div className="flex justify-center">
          <button
            onClick={clearTrade}
            className="text-sm text-slate-400 hover:text-white transition-colors px-4 py-1.5"
          >
            Clear Trade
          </button>
        </div>
      )}

      {/* Analysis panels */}
      {hasAssets && fairness && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 px-1">
            <span className="text-sm font-medium text-slate-400">
              Trade Analysis
            </span>
            <HelpTooltip text="Compares total dynasty value of each side. Accounts for positional scarcity, age curves, and your league's scoring." />
          </div>
          <FairnessPanel
            fairness={fairness}
            team1Name={team1?.name ?? "Side A"}
            team2Name={team2?.name ?? "Side B"}
          />

          {divergence && (
            <MarketPanel
              divergence={divergence}
              team1Name={team1?.name ?? "Side A"}
              team2Name={team2?.name ?? "Side B"}
            />
          )}

          {userTeamInvolved && impactError && (
            <div className="rounded-lg border border-red-800/50 bg-red-900/20 p-4 text-sm text-red-300">
              {impactError}
            </div>
          )}

          {userTeamInvolved &&
            !impactError &&
            (rosterImpact || impactLoading) && (
              <RosterImpactPanel
                impact={
                  rosterImpact ?? {
                    lineupDelta: 0,
                    lineupBefore: {
                      starters: [],
                      bench: [],
                      totalStarterPoints: 0,
                    },
                    lineupAfter: {
                      starters: [],
                      bench: [],
                      totalStarterPoints: 0,
                    },
                    oneYearDelta: 0,
                    threeYearDelta: 0,
                    efficiency: {
                      spotDelta: 0,
                      consolidation: false,
                      thinPositions: [],
                    },
                  }
                }
                loading={impactLoading}
              />
            )}
        </div>
      )}
    </div>
  );
}
