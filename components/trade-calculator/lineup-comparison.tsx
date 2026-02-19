"use client";

import type { LineupResult } from "@/lib/trade-engine";

interface LineupComparisonProps {
  before: LineupResult;
  after: LineupResult;
}

export function LineupComparison({ before, after }: LineupComparisonProps) {
  // Build slot -> player maps for before/after
  const beforeMap = new Map<string, Array<{ name: string; pts: number }>>();
  for (const s of before.starters) {
    const arr = beforeMap.get(s.slot) ?? [];
    arr.push({ name: s.player.playerName, pts: s.player.projectedPoints });
    beforeMap.set(s.slot, arr);
  }

  const afterMap = new Map<string, Array<{ name: string; pts: number }>>();
  for (const s of after.starters) {
    const arr = afterMap.get(s.slot) ?? [];
    arr.push({ name: s.player.playerName, pts: s.player.projectedPoints });
    afterMap.set(s.slot, arr);
  }

  // All unique slots
  const allSlots = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const slotOrder = [...allSlots].sort();

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-slate-500 uppercase">
            <th className="text-left px-2 py-1 w-16">Slot</th>
            <th className="text-left px-2 py-1">Before</th>
            <th className="text-right px-2 py-1 w-16">Pts</th>
            <th className="text-left px-2 py-1">After</th>
            <th className="text-right px-2 py-1 w-16">Pts</th>
            <th className="text-right px-2 py-1 w-16">Delta</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {slotOrder.map((slot) => {
            const bPlayers = beforeMap.get(slot) ?? [];
            const aPlayers = afterMap.get(slot) ?? [];
            const maxLen = Math.max(bPlayers.length, aPlayers.length);

            return Array.from({ length: maxLen }, (_, i) => {
              const bp = bPlayers[i];
              const ap = aPlayers[i];
              const delta = (ap?.pts ?? 0) - (bp?.pts ?? 0);
              const changed = bp?.name !== ap?.name;

              return (
                <tr
                  key={`${slot}-${i}`}
                  className={changed ? "bg-blue-900/10" : ""}
                >
                  <td className="px-2 py-1 text-slate-500 font-medium">
                    {i === 0 ? slot : ""}
                  </td>
                  <td className="px-2 py-1 text-slate-300 truncate max-w-[120px]">
                    {bp?.name ?? "-"}
                  </td>
                  <td className="px-2 py-1 text-right font-mono text-slate-400">
                    {bp ? bp.pts.toFixed(0) : "-"}
                  </td>
                  <td
                    className={`px-2 py-1 truncate max-w-[120px] ${
                      changed ? "text-white font-medium" : "text-slate-300"
                    }`}
                  >
                    {ap?.name ?? "-"}
                  </td>
                  <td className="px-2 py-1 text-right font-mono text-slate-400">
                    {ap ? ap.pts.toFixed(0) : "-"}
                  </td>
                  <td
                    className={`px-2 py-1 text-right font-mono text-xs ${
                      delta > 0
                        ? "text-green-400"
                        : delta < 0
                          ? "text-red-400"
                          : "text-slate-500"
                    }`}
                  >
                    {delta !== 0
                      ? `${delta > 0 ? "+" : ""}${delta.toFixed(0)}`
                      : ""}
                  </td>
                </tr>
              );
            });
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-slate-700">
            <td className="px-2 py-2 text-slate-400 font-medium">Total</td>
            <td />
            <td className="px-2 py-2 text-right font-mono text-slate-300">
              {before.totalStarterPoints.toFixed(0)}
            </td>
            <td />
            <td className="px-2 py-2 text-right font-mono text-slate-300">
              {after.totalStarterPoints.toFixed(0)}
            </td>
            <td
              className={`px-2 py-2 text-right font-mono font-bold ${
                after.totalStarterPoints > before.totalStarterPoints
                  ? "text-green-400"
                  : after.totalStarterPoints < before.totalStarterPoints
                    ? "text-red-400"
                    : "text-slate-400"
              }`}
            >
              {after.totalStarterPoints !== before.totalStarterPoints
                ? `${after.totalStarterPoints > before.totalStarterPoints ? "+" : ""}${(after.totalStarterPoints - before.totalStarterPoints).toFixed(0)}`
                : ""}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
