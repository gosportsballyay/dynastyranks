"use client";

import { useState } from "react";

interface ScoringRules {
  [key: string]: number;
}

interface FlexRule {
  slot: string;
  eligible: string[];
}

interface AdapterSettings {
  scoringRules: ScoringRules;
  positionScoringOverrides?: Record<string, ScoringRules>;
  rosterPositions: Record<string, number>;
  flexRules: FlexRule[];
  positionMappings?: Record<string, string[]>;
  idpStructure: string;
  benchSlots: number;
  taxiSlots: number;
  irSlots: number;
  metadata?: Record<string, unknown>;
}

interface RawPayload {
  endpoint: string;
  requestParams: Record<string, unknown>;
  payload: unknown;
  status: string;
  errorMessage?: string;
  fetchedAt: string;
}

interface DebugResponse {
  platform: string;
  leagueId: string;
  settings: AdapterSettings | null;
  rawPayloads: RawPayload[];
  error?: string;
}

export default function LeagueDataDebugPage() {
  const [platform, setPlatform] = useState<"fleaflicker" | "sleeper">("fleaflicker");
  const [leagueId, setLeagueId] = useState("333258");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DebugResponse | null>(null);
  const [expandedPayloads, setExpandedPayloads] = useState<Set<number>>(new Set());

  async function handleFetch() {
    setLoading(true);
    setData(null);

    try {
      const response = await fetch(
        `/api/debug/league-data?platform=${platform}&leagueId=${leagueId}`
      );
      const json = await response.json();
      setData(json);
    } catch (error) {
      setData({
        platform,
        leagueId,
        settings: null,
        rawPayloads: [],
        error: error instanceof Error ? error.message : "Failed to fetch",
      });
    } finally {
      setLoading(false);
    }
  }

  function togglePayload(index: number) {
    setExpandedPayloads((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  function groupScoringRules(rules: ScoringRules) {
    const groups: Record<string, Record<string, number>> = {
      Passing: {},
      Rushing: {},
      Receiving: {},
      IDP: {},
      Other: {},
    };

    for (const [key, value] of Object.entries(rules)) {
      if (key.startsWith("pass_") || key === "int") {
        groups.Passing[key] = value;
      } else if (key.startsWith("rush_")) {
        groups.Rushing[key] = value;
      } else if (key.startsWith("rec") || key === "te_rec_bonus") {
        groups.Receiving[key] = value;
      } else if (
        ["tackle_solo", "tackle_assist", "tfl", "sack", "qb_hit", "def_int", "ff", "fum_rec", "pd", "safety", "def_td", "blk_kick"].includes(key)
      ) {
        groups.IDP[key] = value;
      } else {
        groups.Other[key] = value;
      }
    }

    return groups;
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">League Data Extraction - POC</h1>
        <p className="text-slate-400 mb-8">
          Verify that scoring rules and roster requirements are extracted correctly
        </p>

        {/* Form */}
        <div className="bg-slate-800 rounded-lg p-4 mb-8 flex gap-4 items-end">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Platform</label>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value as "fleaflicker" | "sleeper")}
              className="bg-slate-700 rounded px-3 py-2 text-white"
            >
              <option value="fleaflicker">Fleaflicker</option>
              <option value="sleeper">Sleeper</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-sm text-slate-400 mb-1">League ID</label>
            <input
              type="text"
              value={leagueId}
              onChange={(e) => setLeagueId(e.target.value)}
              placeholder="Enter league ID"
              className="w-full bg-slate-700 rounded px-3 py-2 text-white"
            />
          </div>
          <button
            onClick={handleFetch}
            disabled={loading || !leagueId}
            className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 px-6 py-2 rounded font-medium"
          >
            {loading ? "Fetching..." : "Fetch"}
          </button>
        </div>

        {/* Error */}
        {data?.error && (
          <div className="bg-red-900/50 border border-red-700 rounded-lg p-4 mb-8">
            <h2 className="font-semibold text-red-400 mb-2">Error</h2>
            <p className="text-red-300">{data.error}</p>
          </div>
        )}

        {/* Results */}
        {data?.settings && (
          <div className="space-y-6">
            {/* Scoring Rules */}
            <div className="bg-slate-800 rounded-lg p-4">
              <h2 className="text-lg font-semibold mb-4 text-blue-400">Scoring Rules</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(groupScoringRules(data.settings.scoringRules)).map(
                  ([group, rules]) =>
                    Object.keys(rules).length > 0 && (
                      <div key={group} className="bg-slate-900/50 rounded p-3">
                        <h3 className="font-medium text-slate-300 mb-2">{group}</h3>
                        <div className="space-y-1">
                          {Object.entries(rules).map(([stat, value]) => (
                            <div key={stat} className="flex justify-between text-sm">
                              <span className="text-slate-400">{stat}</span>
                              <span className="font-mono">{value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                )}
              </div>
            </div>

            {/* Position-Specific Scoring */}
            {data.settings.positionScoringOverrides && (
              <div className="bg-slate-800 rounded-lg p-4">
                <h2 className="text-lg font-semibold mb-4 text-purple-400">
                  Position-Specific Scoring Overrides
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {Object.entries(data.settings.positionScoringOverrides).map(
                    ([position, rules]) => (
                      <div key={position} className="bg-slate-900/50 rounded p-3">
                        <h3 className="font-medium text-purple-300 mb-2">{position}</h3>
                        <div className="space-y-1">
                          {Object.entries(rules).map(([stat, value]) => (
                            <div key={stat} className="flex justify-between text-sm">
                              <span className="text-slate-400">{stat}</span>
                              <span className="font-mono">{value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  )}
                </div>
              </div>
            )}

            {/* Roster Requirements */}
            <div className="bg-slate-800 rounded-lg p-4">
              <h2 className="text-lg font-semibold mb-4 text-green-400">
                Roster Requirements
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Starting Positions */}
                <div>
                  <h3 className="font-medium text-slate-300 mb-2">Starting Positions</h3>
                  <div className="bg-slate-900/50 rounded p-3 space-y-1">
                    {Object.entries(data.settings.rosterPositions).map(([pos, count]) => (
                      <div key={pos} className="flex justify-between text-sm">
                        <span className="text-slate-400">{pos}</span>
                        <span className="font-mono">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Other Slots */}
                <div>
                  <h3 className="font-medium text-slate-300 mb-2">Other Slots</h3>
                  <div className="bg-slate-900/50 rounded p-3 space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Bench</span>
                      <span className="font-mono">{data.settings.benchSlots}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">IR</span>
                      <span className="font-mono">{data.settings.irSlots}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Taxi</span>
                      <span className="font-mono">{data.settings.taxiSlots}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Flex Rules */}
            {data.settings.flexRules.length > 0 && (
              <div className="bg-slate-800 rounded-lg p-4">
                <h2 className="text-lg font-semibold mb-4 text-yellow-400">Flex Rules</h2>
                <div className="space-y-2">
                  {data.settings.flexRules.map((rule, i) => (
                    <div key={i} className="bg-slate-900/50 rounded p-3 flex items-center gap-2">
                      <span className="font-medium text-yellow-300">{rule.slot}</span>
                      <span className="text-slate-500">→</span>
                      <span className="text-slate-300">{rule.eligible.join(", ")}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Position Mappings */}
            {data.settings.positionMappings && (
              <div className="bg-slate-800 rounded-lg p-4">
                <h2 className="text-lg font-semibold mb-4 text-orange-400">
                  Position Mappings (Consolidated → Granular)
                </h2>
                <div className="space-y-2">
                  {Object.entries(data.settings.positionMappings).map(([consolidated, granular]) => (
                    <div key={consolidated} className="bg-slate-900/50 rounded p-3 flex items-center gap-2">
                      <span className="font-medium text-orange-300">{consolidated}</span>
                      <span className="text-slate-500">→</span>
                      <span className="text-slate-300">{granular.join(", ")}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* IDP Structure */}
            <div className="bg-slate-800 rounded-lg p-4">
              <h2 className="text-lg font-semibold mb-2 text-cyan-400">IDP Structure</h2>
              <p className="text-xl font-mono">{data.settings.idpStructure}</p>
            </div>

            {/* Metadata */}
            {data.settings.metadata && Object.keys(data.settings.metadata).length > 0 && (
              <div className="bg-slate-800 rounded-lg p-4">
                <h2 className="text-lg font-semibold mb-4 text-slate-400">Metadata</h2>
                <pre className="bg-slate-900/50 rounded p-3 text-sm overflow-auto">
                  {JSON.stringify(data.settings.metadata, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Raw Payloads */}
        {data?.rawPayloads && data.rawPayloads.length > 0 && (
          <div className="mt-8">
            <h2 className="text-lg font-semibold mb-4 text-slate-400">Raw API Responses</h2>
            <div className="space-y-2">
              {data.rawPayloads.map((payload, index) => (
                <div key={index} className="bg-slate-800 rounded-lg overflow-hidden">
                  <button
                    onClick={() => togglePayload(index)}
                    className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-700"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        payload.status === "success" ? "bg-green-900 text-green-300" : "bg-red-900 text-red-300"
                      }`}>
                        {payload.status}
                      </span>
                      <span className="font-mono text-sm">{payload.endpoint}</span>
                    </div>
                    <span className="text-slate-500">{expandedPayloads.has(index) ? "▼" : "▶"}</span>
                  </button>
                  {expandedPayloads.has(index) && (
                    <div className="px-4 pb-4">
                      <pre className="bg-slate-900 rounded p-3 text-xs overflow-auto max-h-96">
                        {JSON.stringify(payload.payload, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
