"use client";

interface PlayerValue {
  id: string;
  value: number;
  rank: number;
  rankInPosition: number;
  tier: number;
  projectedPoints: number;
  vorp: number;
  player: {
    id: string;
    name: string;
    position: string;
    positionGroup: string;
    nflTeam: string | null;
    age: number | null;
  };
  owner: string | null;
  isOwnedByCurrentUser: boolean;
  isFreeAgent: boolean;
}

interface ExportCsvButtonProps {
  values: PlayerValue[];
  leagueName: string;
}

export function ExportCsvButton({ values, leagueName }: ExportCsvButtonProps) {
  const handleExport = () => {
    // Build CSV content
    const headers = [
      "Rank",
      "Name",
      "Position",
      "NFL Team",
      "Age",
      "Value",
      "Position Rank",
      "Tier",
      "Projected Points",
      "VORP",
      "Fantasy Team",
    ];

    const rows = values.map((v) => [
      v.rank,
      v.player.name,
      v.player.position,
      v.player.nflTeam || "",
      v.player.age || "",
      v.value.toFixed(1),
      `${v.player.position}${v.rankInPosition}`,
      v.tier,
      v.projectedPoints.toFixed(1),
      v.vorp.toFixed(1),
      v.owner || "FA",
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((row) =>
        row
          .map((cell) => {
            const str = String(cell);
            // Escape quotes and wrap in quotes if contains comma
            if (str.includes(",") || str.includes('"') || str.includes("\n")) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          })
          .join(",")
      ),
    ].join("\n");

    // Create download
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${leagueName.replace(/[^a-z0-9]/gi, "_")}_rankings.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <button
      onClick={handleExport}
      className="px-3 py-1.5 text-sm bg-slate-700 text-slate-300 rounded hover:bg-slate-600
        transition-colors flex items-center gap-1.5"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
        />
      </svg>
      Export
    </button>
  );
}
