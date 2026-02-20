import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { DiagnosticsView } from "./diagnostics-view";

interface AnchorEntry {
  name: string;
  position: string;
  rank: number | null;
  rankInPosition: number | null;
  value: number | null;
  leagueId: string;
  leagueName: string;
  idpOnly: boolean;
}

interface LeagueDiagnostics {
  leagueId: string;
  leagueName: string;
  format: {
    teams: number;
    superFlex: boolean;
    idpStructure: string | null;
    idpSlots: number;
    rosterPositions: Record<string, number>;
  };
  top10Overall: Array<{
    name: string;
    position: string;
    rank: number;
    value: number;
  }>;
  top5ByPosition: Record<
    string,
    Array<{ name: string; rank: number; value: number }>
  >;
  metrics: {
    maxValue: number;
    valueAtRank10: number | null;
    valueAtRank25: number | null;
    valueAtRank50: number | null;
    replacementTierCutoff: number;
    countOfIDPInTop50: number;
    countOfQBInTop25: number;
    totalPlayersValued: number;
  };
  anchors: AnchorEntry[];
}

export interface DiagnosticsData {
  generated: string;
  engineVersion: string | null;
  leagueCount: number;
  leagues: LeagueDiagnostics[];
  anchorComparison: Record<string, AnchorEntry[]>;
}

export default function DiagnosticsPage() {
  const filePath = resolve(
    process.cwd(),
    "test-data/league-diagnostics.json",
  );

  if (!existsSync(filePath)) {
    return (
      <div className="min-h-screen bg-slate-900 text-white p-8">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-2xl font-bold mb-4">
            League Diagnostics
          </h1>
          <div className="bg-yellow-900/50 border border-yellow-700 rounded-lg p-4">
            <p className="text-yellow-300">
              No diagnostics data found. Run the generator
              first:
            </p>
            <pre className="mt-2 text-sm text-yellow-200 font-mono">
              {
                "npx tsx scripts/generate-league-diagnostics.ts"
              }
            </pre>
          </div>
        </div>
      </div>
    );
  }

  const raw = readFileSync(filePath, "utf-8");
  const data: DiagnosticsData = JSON.parse(raw);

  return (
    <div className="min-h-screen bg-slate-900 text-white p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">
            League Diagnostics
          </h1>
          <p className="text-slate-400 mt-1">
            Engine {data.engineVersion ?? "?"} &middot;{" "}
            {data.leagueCount} leagues &middot; Generated{" "}
            {new Date(data.generated).toLocaleString()}
          </p>
        </div>
        <DiagnosticsView data={data} />
      </div>
    </div>
  );
}
