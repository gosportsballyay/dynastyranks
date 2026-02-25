"use client";

import { Fragment } from "react";
import { getAgeTier } from "@/lib/value-engine/age-curves";

export interface PlayerDetailProps {
  injuryStatus: string | null;
  draftRound: number | null;
  draftPick: number | null;
  rookieYear: number | null;
  yearsExperience: number | null;
  position: string;
  age: number | null;
  seasonLines: Array<{
    season: number;
    points: number;
    gamesPlayed: number;
  }>;
  projectedPoints: number;
  rank: number;
  rankInPosition: number;
  positionLabel: string;
  vorp: number;
  consensusValue: number | null;
  leagueValue: number;
  tier: number;
  lastSeasonPoints: number | null;
  flexEligibility?: string[];
  flexRanks?: Record<string, number>;
}

/** Dot separator for bio band items. */
function Dot() {
  return (
    <span className="text-slate-600 mx-1.5">&middot;</span>
  );
}

/** Injury badge with colored dot. */
function InjuryBadge({ status }: { status: string }) {
  const severe = ["out", "ir", "out for season"];
  const isSevere = severe.includes(status.toLowerCase());
  const dotColor = isSevere
    ? "bg-red-500"
    : "bg-yellow-500";
  const textColor = isSevere
    ? "text-red-400"
    : "text-yellow-400";

  return (
    <span className={`inline-flex items-center gap-1 ${textColor}`}>
      <span className={`w-2 h-2 rounded-full ${dotColor}`} />
      {status}
    </span>
  );
}

/** Format draft capital string. */
function formatDraftCapital(
  draftRound: number | null,
  draftPick: number | null,
  rookieYear: number | null,
): string {
  const year = rookieYear ? ` (${rookieYear})` : "";
  if (!draftRound) return `UDFA${year}`;
  const pick = draftPick ? `, #${draftPick}` : "";
  return `Rd ${draftRound}${pick}${year}`;
}

/** Format experience string (e.g. "3rd season"). */
function formatExperience(years: number | null): string | null {
  if (years == null) return null;
  if (years <= 0) return "Rookie";
  if (years === 1) return "1st season";
  if (years === 2) return "2nd season";
  if (years === 3) return "3rd season";
  return `${years}th season`;
}

const AGE_TIER_DISPLAY: Record<
  string,
  { label: string; color: string }
> = {
  developing: { label: "Developing \u2191", color: "text-emerald-400" },
  ascending: { label: "Ascending \u2191", color: "text-green-400" },
  prime: { label: "Prime \u25CF", color: "text-blue-400" },
  declining: { label: "Declining \u2193", color: "text-amber-400" },
  aging: { label: "Aging \u2193\u2193", color: "text-red-400" },
};

/**
 * Shared player detail dropdown used in both
 * rankings table and team roster view.
 */
export function PlayerDetailDropdown({
  injuryStatus,
  draftRound,
  draftPick,
  rookieYear,
  yearsExperience,
  position,
  age,
  seasonLines,
  projectedPoints,
  rank,
  rankInPosition,
  positionLabel,
  vorp,
  consensusValue,
  leagueValue,
  tier,
  lastSeasonPoints,
  flexEligibility = [],
  flexRanks = {},
}: PlayerDetailProps) {
  const ageTier = age != null
    ? getAgeTier(position, age)
    : null;
  const tierDisplay = ageTier
    ? AGE_TIER_DISPLAY[ageTier]
    : null;

  const sortedSeasons = [...seasonLines]
    .sort((a, b) => b.season - a.season)
    .slice(0, 3);

  const projYear = new Date().getFullYear();

  return (
    <div className="space-y-3">
      {/* Bio band */}
      <div className="flex flex-wrap items-center gap-y-1 text-sm text-slate-300">
        {injuryStatus && (
          <>
            <InjuryBadge status={injuryStatus} />
            <Dot />
          </>
        )}
        <span>
          {formatDraftCapital(draftRound, draftPick, rookieYear)}
        </span>
        {yearsExperience != null && (
          <>
            <Dot />
            <span>{formatExperience(yearsExperience)}</span>
          </>
        )}
        {tierDisplay && (
          <>
            <Dot />
            <span className={tierDisplay.color}>
              {tierDisplay.label}
            </span>
          </>
        )}
      </div>

      {/* Three-column layout */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-8 gap-y-4">
        {/* Season History */}
        <div>
          <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wider pb-1.5 mb-2 border-b border-slate-700">
            Season History
          </h4>
          <table className="text-sm">
            <thead>
              <tr className="text-slate-500 text-xs">
                <th className="text-left py-1 pr-4 font-medium">
                  Season
                </th>
                <th className="text-right py-1 pr-4 font-medium">
                  Pts
                </th>
                <th className="text-right py-1 pr-4 font-medium">
                  GP
                </th>
                <th className="text-right py-1 font-medium">
                  PPG
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedSeasons.map((s) => (
                <tr key={s.season} className="text-slate-300">
                  <td className="py-0.5 pr-4">{s.season}</td>
                  <td className="text-right font-mono pr-4">
                    {s.points.toFixed(1)}
                  </td>
                  <td className="text-right font-mono pr-4">
                    {s.gamesPlayed}
                  </td>
                  <td className="text-right font-mono">
                    {s.gamesPlayed > 0
                      ? (s.points / s.gamesPlayed).toFixed(1)
                      : "-"}
                  </td>
                </tr>
              ))}
              {sortedSeasons.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="py-1 text-slate-500 italic"
                  >
                    No history available
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Ranks */}
        <div>
          <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wider pb-1.5 mb-2 border-b border-slate-700">
            Ranks
          </h4>
          <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-sm">
            <dt className="text-slate-500">Overall</dt>
            <dd className="text-white font-mono text-right">
              #{rank}
            </dd>
            <dt className="text-slate-500">Position</dt>
            <dd className="text-white font-mono text-right">
              {positionLabel}
            </dd>
            <dt className="text-slate-500">VORP</dt>
            <dd className="text-white font-mono text-right">
              +{vorp.toFixed(1)}
            </dd>
            <dt className="text-slate-500">Tier</dt>
            <dd className="text-white font-mono text-right">
              {tier}
            </dd>
            {flexEligibility.map((slot) => {
              const r = flexRanks[slot];
              if (!r) return null;
              const label = slot === "SUPERFLEX" || slot === "SUPER_FLEX"
                ? "Superflex"
                : slot.charAt(0) + slot.slice(1).toLowerCase();
              return (
                <Fragment key={slot}>
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="text-white font-mono text-right">
                    #{r}
                  </dd>
                </Fragment>
              );
            })}
          </dl>
        </div>

        {/* Values */}
        <div>
          <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wider pb-1.5 mb-2 border-b border-slate-700">
            Values
          </h4>
          <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-sm">
            <dt className="text-slate-500">
              {projYear} Proj
            </dt>
            <dd className="text-white font-mono text-right">
              {projectedPoints.toFixed(1)}
            </dd>
            <dt className="text-slate-500">Consensus</dt>
            <dd className="text-white font-mono text-right">
              {consensusValue != null
                ? consensusValue.toLocaleString()
                : "-"}
            </dd>
            <dt className="text-slate-500">League</dt>
            <dd className="text-white font-mono text-right">
              {leagueValue.toLocaleString()}
            </dd>
          </dl>
        </div>
      </div>
    </div>
  );
}

