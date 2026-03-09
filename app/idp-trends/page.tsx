import Link from "next/link";
import type { IdpTrendsData } from "@/lib/types/idp-trends";
import trendsData from "@/data/idp-trends.json";

const data = trendsData as IdpTrendsData;

export const metadata = {
  title: "IDP League Trends on Sleeper | MyDynastyValues",
  description:
    "How do IDP leagues actually configure their rosters and scoring? " +
    "Data from thousands of Sleeper leagues.",
};

export default function IdpTrendsPage() {
  const hasData = data.meta.idpLeaguesFound > 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800">
      <nav className="border-b border-slate-700 bg-slate-900/50 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <Link href="/" className="flex items-center">
              <span className="text-xl font-bold text-white font-[family-name:var(--font-display)]">
                MyDynastyValues
              </span>
              <span className="ml-2 px-2 py-0.5 text-xs font-medium rounded-full bg-blue-600/20 text-blue-400 ring-1 ring-blue-500/30">
                Beta
              </span>
            </Link>
            <Link
              href="/"
              className="text-sm text-slate-400 hover:text-white transition-colors"
            >
              Back
            </Link>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
        {/* Hero */}
        <h1 className="text-3xl font-bold text-white mb-3">
          IDP League Trends on Sleeper
        </h1>
        <p className="text-slate-400 mb-2 max-w-2xl leading-relaxed">
          How do IDP leagues actually configure their rosters and
          scoring? We crawled the Sleeper ecosystem starting from our
          synced leagues, following league members to discover their
          other leagues via BFS traversal.
        </p>
        {hasData && (
          <p className="text-sm text-slate-500 mb-10">
            {data.meta.totalLeaguesCrawled.toLocaleString()} leagues
            found &middot;{" "}
            {data.meta.idpLeaguesFound.toLocaleString()} have
            IDP &middot; Last updated {data.meta.lastUpdated}
          </p>
        )}
        {!hasData && (
          <p className="text-sm text-amber-400/80 mb-10">
            No data yet. Run the crawler to populate this page.
          </p>
        )}

        {hasData && (
          <div className="space-y-12">
            {/* Key Stats */}
            <section>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <StatCard
                  label="IDP Leagues Found"
                  value={data.meta.idpLeaguesFound.toLocaleString()}
                  sub={`of ${data.meta.totalLeaguesCrawled.toLocaleString()} (${data.meta.idpPct}%)`}
                />
                <StatCard
                  label="Median IDP Starters"
                  value={String(data.highlights.medianIdpStarters)}
                  sub="slots per league"
                />
                <StatCard
                  label="Most Common Setup"
                  value={`${data.highlights.mostCommonIdpCount} IDP`}
                  sub="mode value"
                />
                <StatCard
                  label="Have IDP_FLEX"
                  value={`${data.highlights.pctWithIdpFlex}%`}
                  sub="of IDP leagues"
                />
                <StatCard
                  label="Dynasty Leagues"
                  value={`${data.meta.dynastyPct}%`}
                  sub="of IDP leagues"
                />
                <StatCard
                  label="SuperFlex + IDP"
                  value={`${data.highlights.pctSuperFlex}%`}
                  sub="of IDP leagues"
                />
              </div>
            </section>

            {/* IDP Starter Distribution */}
            {data.starterDistribution.length > 0 && (
              <section>
                <h2 className="text-xl font-semibold text-white mb-1">
                  IDP Starter Slots
                </h2>
                <p className="text-sm text-slate-400 mb-4">
                  Distribution of IDP starter slot counts across
                  leagues
                </p>
                <StarterDistribution
                  distribution={data.starterDistribution}
                  modeValue={data.highlights.mostCommonIdpCount}
                />
                <OutlierNote lines={[
                  "One 4-team league runs 72 IDP starter slots. Seventy-two.",
                  "One family of leagues averages 52 IDP slots across 5 linked leagues. Respect the commitment.",
                  "A 4-team league starts 184 offensive + 30 IDP players per roster. The entire NFL is spoken for.",
                ]} />
              </section>
            )}

            {/* Scoring Settings */}
            {data.scoringDistributions.length > 0 && (
              <section>
                <h2 className="text-xl font-semibold text-white mb-1">
                  IDP Scoring Settings
                </h2>
                <p className="text-sm text-slate-400 mb-4">
                  How leagues score defensive stats — range and
                  most common values
                </p>
                <ScoringTable
                  distributions={data.scoringDistributions}
                />
                <OutlierNote lines={[
                  "One 12-team league scores sacks at 358,368 points each.",
                  "A 32-team league scores interceptions at -83 points. Defensive players are punished for doing their job.",
                  "The 4-team league with 184 offensive starters also has 7 scoring stats maxed at 99,999 — solo tackles, total tackles, sacks, interceptions, forced fumbles, pass deflections, and QB hits.",
                ]} />
              </section>
            )}

            {/* Top Roster Configs */}
            {data.topRosterConfigs.length > 0 && (
              <section>
                <h2 className="text-xl font-semibold text-white mb-1">
                  Most Popular IDP Roster Configs
                </h2>
                <p className="text-sm text-slate-400 mb-4">
                  Top configurations by frequency
                </p>
                <div className="space-y-1.5">
                  {data.topRosterConfigs.map((c, i) => {
                    const maxPct = data.topRosterConfigs[0].pct;
                    return (
                      <BarRow
                        key={i}
                        label={c.config}
                        pct={c.pct}
                        count={c.count}
                        maxPct={maxPct}
                        color="emerald"
                        mono
                      />
                    );
                  })}
                </div>
                <OutlierNote lines={[
                  "One 16-team league has 307 bench slots per team. That's 4,912 rostered players across the league — roughly the entire NFL and half of the CFL.",
                ]} />
              </section>
            )}

            {/* Cross-tabs */}
            <section>
              <h2 className="text-xl font-semibold text-white mb-4">
                Cross-tabulations
              </h2>

              {/* By League Size */}
              {data.crossTabs.byLeagueSize.length > 0 && (
                <div className="mb-8">
                  <h3 className="text-sm font-medium text-slate-300 mb-3">
                    By League Size
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                    {data.crossTabs.byLeagueSize.map((s) => (
                      <LeagueSizeCard
                        key={s.teamCount}
                        teamCount={s.teamCount}
                        avg={s.avgIdpStarters}
                        median={s.medianIdpStarters}
                        count={s.leagueCount}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Dynasty vs Redraft */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                <ComparisonCard
                  title="Dynasty IDP"
                  stats={[
                    {
                      label: "Leagues",
                      value:
                        data.crossTabs.dynastyVsRedraft.dynasty
                          .count,
                    },
                    {
                      label: "Avg IDP starters",
                      value:
                        data.crossTabs.dynastyVsRedraft.dynasty
                          .avgIdpStarters,
                    },
                    {
                      label: "Have IDP_FLEX",
                      value: `${data.crossTabs.dynastyVsRedraft.dynasty.pctWithIdpFlex}%`,
                    },
                  ]}
                />
                <ComparisonCard
                  title="Redraft IDP"
                  stats={[
                    {
                      label: "Leagues",
                      value:
                        data.crossTabs.dynastyVsRedraft.redraft
                          .count,
                    },
                    {
                      label: "Avg IDP starters",
                      value:
                        data.crossTabs.dynastyVsRedraft.redraft
                          .avgIdpStarters,
                    },
                    {
                      label: "Have IDP_FLEX",
                      value: `${data.crossTabs.dynastyVsRedraft.redraft.pctWithIdpFlex}%`,
                    },
                  ]}
                />
              </div>

              {/* SuperFlex + TEP splits */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <ComparisonCard
                  title="SuperFlex Correlation"
                  stats={[
                    {
                      label: "SF leagues",
                      value: `${data.crossTabs.superFlexCorrelation.superFlex.count} (avg ${data.crossTabs.superFlexCorrelation.superFlex.avgIdpStarters} IDP)`,
                    },
                    {
                      label: "Non-SF leagues",
                      value: `${data.crossTabs.superFlexCorrelation.nonSuperFlex.count} (avg ${data.crossTabs.superFlexCorrelation.nonSuperFlex.avgIdpStarters} IDP)`,
                    },
                  ]}
                />
                <ComparisonCard
                  title="TEP Correlation"
                  stats={[
                    {
                      label: "TEP leagues",
                      value: `${data.crossTabs.tepCorrelation.tep.count} (avg ${data.crossTabs.tepCorrelation.tep.avgIdpStarters} IDP)`,
                    },
                    {
                      label: "Non-TEP leagues",
                      value: `${data.crossTabs.tepCorrelation.nonTep.count} (avg ${data.crossTabs.tepCorrelation.nonTep.avgIdpStarters} IDP)`,
                    },
                  ]}
                />
              </div>
            </section>

            {/* Footer note */}
            <p className="text-xs text-slate-500 pt-4 border-t border-slate-700">
              Data collected via BFS crawl of the Sleeper public API.
              Only league configuration data is collected — no
              personal information, rosters, or player data.
              Last updated {data.meta.lastUpdated}.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

// --------------- Helper components ---------------

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-xs text-slate-500 mt-0.5">{sub}</p>
    </div>
  );
}

function BarRow({
  label,
  pct,
  count,
  maxPct,
  highlight,
  color = "blue",
  mono,
}: {
  label: string;
  pct: number;
  count: number;
  maxPct: number;
  highlight?: boolean;
  color?: "blue" | "emerald";
  mono?: boolean;
}) {
  const widthPct = maxPct > 0 ? (pct / maxPct) * 100 : 0;
  const barColor =
    color === "emerald" ? "bg-emerald-500/70" : "bg-blue-500";
  const highlightRing = highlight
    ? "ring-1 ring-blue-400/40"
    : "";

  return (
    <div className="flex items-center gap-3">
      <span
        className={`w-40 text-right text-sm shrink-0 ${
          mono ? "font-mono text-xs" : ""
        } ${highlight ? "text-blue-300 font-medium" : "text-slate-400"}`}
      >
        {label}
      </span>
      <div className="flex-1 h-6 bg-slate-800/60 rounded overflow-hidden">
        <div
          className={`h-full rounded ${barColor} ${highlightRing} transition-all`}
          style={{ width: `${widthPct}%` }}
        />
      </div>
      <span
        className={`w-24 text-xs shrink-0 ${
          highlight ? "text-blue-300" : "text-slate-500"
        }`}
      >
        {count} ({pct}%)
      </span>
    </div>
  );
}

function ScoringTable({
  distributions,
}: {
  distributions: IdpTrendsData["scoringDistributions"];
}) {
  const fmt = (v: number) => {
    if (Number.isInteger(v)) return String(v);
    return v.toFixed(2).replace(/0$/, "");
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-700">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-700 bg-slate-800/80">
            <th className="text-left px-3 py-2 text-slate-400 font-medium">
              Stat
            </th>
            <th className="text-center px-2 py-2 text-slate-400 font-medium">
              Most Common
            </th>
            <th className="text-center px-2 py-2 text-slate-400 font-medium">
              Median
            </th>
            <th className="text-center px-2 py-2 text-slate-400 font-medium hidden sm:table-cell">
              Low End
            </th>
            <th className="text-center px-2 py-2 text-slate-400 font-medium hidden sm:table-cell">
              High End
            </th>
          </tr>
        </thead>
        <tbody>
          {distributions.map((d) => (
            <tr
              key={d.stat}
              className="border-b border-slate-700/50 last:border-0"
            >
              <td className="px-3 py-2.5 text-slate-300">
                {d.label}
              </td>
              <td className="text-center px-2 py-2.5">
                <span className="text-white font-medium">
                  {fmt(d.mostCommon)}
                </span>
                <span className="text-slate-500 text-xs ml-1">
                  ({d.mostCommonPct}%)
                </span>
              </td>
              <td className="text-center px-2 py-2.5 text-slate-300">
                {fmt(d.median)}
              </td>
              <td className="text-center px-2 py-2.5 text-slate-500 hidden sm:table-cell">
                {fmt(d.p25)}
              </td>
              <td className="text-center px-2 py-2.5 text-slate-500 hidden sm:table-cell">
                {fmt(d.p75)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OutlierNote({ lines }: { lines: string[] }) {
  return (
    <div className="mt-4 rounded-lg bg-amber-500/5 border border-amber-500/20 px-4 py-3">
      <p className="text-xs font-medium text-amber-400/80 mb-1.5">
        Wild outliers from the dataset
      </p>
      <ul className="space-y-1">
        {lines.map((line, i) => (
          <li key={i} className="text-xs text-slate-400 leading-relaxed">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StarterDistribution({
  distribution,
  modeValue,
}: {
  distribution: IdpTrendsData["starterDistribution"];
  modeValue: number;
}) {
  // Bucket: show 1-12 individually, group 13+ together
  const buckets: Array<{
    label: string;
    count: number;
    pct: number;
    isMode: boolean;
  }> = [];
  let overflowCount = 0;
  let overflowPct = 0;

  for (const d of distribution) {
    if (d.idpSlots <= 12) {
      buckets.push({
        label: String(d.idpSlots),
        count: d.count,
        pct: d.pct,
        isMode: d.idpSlots === modeValue,
      });
    } else {
      overflowCount += d.count;
      overflowPct += d.pct;
    }
  }
  if (overflowCount > 0) {
    buckets.push({
      label: "13+",
      count: overflowCount,
      pct: Math.round(overflowPct * 10) / 10,
      isMode: false,
    });
  }

  const maxPct = Math.max(...buckets.map((b) => b.pct));

  return (
    <div className="space-y-1">
      {buckets.map((b) => {
        const widthPct = maxPct > 0 ? (b.pct / maxPct) * 100 : 0;
        return (
          <div key={b.label} className="flex items-center gap-2">
            <span
              className={`w-8 text-right text-sm shrink-0 ${
                b.isMode
                  ? "text-blue-300 font-medium"
                  : "text-slate-400"
              }`}
            >
              {b.label}
            </span>
            <div className="flex-1 h-5 bg-slate-800/60 rounded overflow-hidden">
              <div
                className={`h-full rounded ${
                  b.isMode
                    ? "bg-blue-400 ring-1 ring-blue-400/40"
                    : "bg-blue-500/70"
                }`}
                style={{ width: `${widthPct}%` }}
              />
            </div>
            <span
              className={`w-20 text-xs shrink-0 ${
                b.isMode ? "text-blue-300" : "text-slate-500"
              }`}
            >
              {b.count} ({b.pct}%)
            </span>
          </div>
        );
      })}
    </div>
  );
}

function LeagueSizeCard({
  teamCount,
  avg,
  median,
  count,
}: {
  teamCount: number;
  avg: number;
  median: number;
  count: number;
}) {
  return (
    <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700 text-center">
      <p className="text-lg font-bold text-white">
        {teamCount}-team
      </p>
      <p className="text-xs text-slate-400 mt-1">
        avg {avg} IDP &middot; med {median}
      </p>
      <p className="text-xs text-slate-500">{count} leagues</p>
    </div>
  );
}

function ComparisonCard({
  title,
  stats,
}: {
  title: string;
  stats: Array<{ label: string; value: string | number }>;
}) {
  return (
    <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
      <h4 className="text-sm font-medium text-white mb-2">
        {title}
      </h4>
      <dl className="space-y-1.5">
        {stats.map((s) => (
          <div key={s.label} className="flex justify-between text-xs">
            <dt className="text-slate-400">{s.label}</dt>
            <dd className="text-slate-200 font-medium">
              {s.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
