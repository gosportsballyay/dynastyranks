interface LeagueSettingsSidebarProps {
  league: {
    name: string;
    provider: string;
    season: number;
    totalTeams: number;
  };
  settings: {
    scoringRules: Record<string, number>;
    rosterPositions: Record<string, number>;
    flexRules: Array<{ slot: string; eligible: string[] }>;
    idpStructure: string;
    benchSlots: number;
    taxiSlots: number;
    irSlots: number;
  };
}

export function LeagueSettingsSidebar({
  league,
  settings,
}: LeagueSettingsSidebarProps) {
  // Detect key scoring features
  const isPPR = (settings.scoringRules.rec || 0) >= 1;
  const isHalfPPR =
    (settings.scoringRules.rec || 0) >= 0.5 &&
    (settings.scoringRules.rec || 0) < 1;
  const hasTEPremium =
    (settings.scoringRules.te_rec_bonus || 0) > 0 ||
    (settings.scoringRules.bonus_rec_te || 0) > 0;
  const hasSuperFlex = Object.keys(settings.rosterPositions).some(
    (p) => p === "SUPERFLEX" || p === "SUPER_FLEX"
  );
  const hasIDP = settings.idpStructure !== "none";

  return (
    <div className="bg-slate-800/50 rounded-xl ring-1 ring-slate-700 p-6 sticky top-24">
      <h2 className="text-lg font-semibold text-white mb-4">League Settings</h2>

      {/* League Info */}
      <div className="mb-6">
        <div className="text-sm text-slate-400 mb-1">
          {league.provider.charAt(0).toUpperCase() + league.provider.slice(1)} •{" "}
          {league.season}
        </div>
        <div className="text-white font-medium">{league.name}</div>
        <div className="text-sm text-slate-400">{league.totalTeams} teams</div>
      </div>

      {/* Key Features */}
      <div className="flex flex-wrap gap-2 mb-6">
        {isPPR && <Badge>PPR</Badge>}
        {isHalfPPR && <Badge>Half PPR</Badge>}
        {hasTEPremium && <Badge color="orange">TE Premium</Badge>}
        {hasSuperFlex && <Badge color="purple">Superflex</Badge>}
        {hasIDP && <Badge color="cyan">IDP</Badge>}
      </div>

      {/* Roster Positions */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-slate-400 mb-2">
          Roster Positions
        </h3>
        <div className="space-y-1 text-sm">
          {Object.entries(settings.rosterPositions)
            .filter(([pos]) => !["BN", "TAXI", "IR"].includes(pos))
            .map(([pos, count]) => (
              <div key={pos} className="flex justify-between">
                <span className="text-slate-300">{pos}</span>
                <span className="text-white font-mono">{count}</span>
              </div>
            ))}
        </div>
        {(settings.benchSlots > 0 ||
          settings.taxiSlots > 0 ||
          settings.irSlots > 0) && (
          <div className="mt-2 pt-2 border-t border-slate-700 space-y-1 text-sm">
            {settings.benchSlots > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-400">Bench</span>
                <span className="text-slate-300 font-mono">
                  {settings.benchSlots}
                </span>
              </div>
            )}
            {settings.taxiSlots > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-400">Taxi</span>
                <span className="text-slate-300 font-mono">
                  {settings.taxiSlots}
                </span>
              </div>
            )}
            {settings.irSlots > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-400">IR</span>
                <span className="text-slate-300 font-mono">
                  {settings.irSlots}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Key Scoring Rules */}
      <div>
        <h3 className="text-sm font-medium text-slate-400 mb-2">
          Scoring Highlights
        </h3>
        <div className="space-y-1 text-sm">
          {settings.scoringRules.pass_td && (
            <ScoringRow label="Pass TD" value={settings.scoringRules.pass_td} />
          )}
          {settings.scoringRules.pass_yd && (
            <ScoringRow
              label="Pass Yd"
              value={settings.scoringRules.pass_yd}
              perUnit={25}
            />
          )}
          {settings.scoringRules.rush_td && (
            <ScoringRow label="Rush TD" value={settings.scoringRules.rush_td} />
          )}
          {settings.scoringRules.rec && (
            <ScoringRow label="Reception" value={settings.scoringRules.rec} />
          )}
          {settings.scoringRules.rec_td && (
            <ScoringRow label="Rec TD" value={settings.scoringRules.rec_td} />
          )}
          {hasIDP && (
            <>
              {settings.scoringRules.tackle_solo && (
                <ScoringRow
                  label="Solo Tackle"
                  value={settings.scoringRules.tackle_solo}
                />
              )}
              {settings.scoringRules.sack && (
                <ScoringRow label="Sack" value={settings.scoringRules.sack} />
              )}
              {settings.scoringRules.def_int && (
                <ScoringRow
                  label="Interception"
                  value={settings.scoringRules.def_int}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Badge({
  children,
  color = "blue",
}: {
  children: React.ReactNode;
  color?: "blue" | "orange" | "purple" | "cyan";
}) {
  const colors = {
    blue: "bg-blue-500/20 text-blue-400",
    orange: "bg-orange-500/20 text-orange-400",
    purple: "bg-purple-500/20 text-purple-400",
    cyan: "bg-cyan-500/20 text-cyan-400",
  };

  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-medium ${colors[color]}`}
    >
      {children}
    </span>
  );
}

function ScoringRow({
  label,
  value,
  perUnit,
}: {
  label: string;
  value: number;
  perUnit?: number;
}) {
  const displayValue = perUnit ? value * perUnit : value;
  const suffix = perUnit ? ` per ${perUnit}` : "";

  return (
    <div className="flex justify-between">
      <span className="text-slate-300">{label}</span>
      <span className="text-white font-mono">
        {displayValue}
        {suffix && <span className="text-slate-500 text-xs">{suffix}</span>}
      </span>
    </div>
  );
}
