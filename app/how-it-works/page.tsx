import Link from "next/link";

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800">
      <nav className="border-b border-slate-700 bg-slate-900/50 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <Link href="/" className="flex items-center">
              <span className="text-xl font-bold text-white">
                DynastyRanks
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

      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold text-white mb-4">
          How It Works
        </h1>
        <p className="text-slate-400 mb-10">
          A quick guide to how DynastyRanks calculates player
          values, ranks your roster, and evaluates trades.
        </p>

        <div className="space-y-10">
          {/* Value Pipeline */}
          <section id="value-pipeline">
            <h2 className="text-xl font-semibold text-white mb-3">
              How Values Are Calculated
            </h2>
            <p className="text-slate-300 leading-relaxed mb-4">
              Every player value is computed specifically for your
              league. The pipeline runs through six stages:
            </p>
            <div className="flex flex-wrap items-center gap-2 text-sm mb-4">
              <PipelineStep label="Projections" />
              <Arrow />
              <PipelineStep label="Fantasy Pts" />
              <Arrow />
              <PipelineStep label="VORP" />
              <Arrow />
              <PipelineStep label="Consensus Blend" />
              <Arrow />
              <PipelineStep label="Age Adjustment" />
              <Arrow />
              <PipelineStep label="Final Value" />
            </div>
            <p className="text-slate-300 leading-relaxed">
              Player projections are scored using your
              league&apos;s exact scoring rules. Those points are
              compared to the replacement level at each position to
              produce VORP. VORP is blended with market consensus,
              then dynasty age adjustments and positional scarcity
              are applied to produce the final value.
            </p>
          </section>

          {/* VORP */}
          <section id="vorp">
            <h2 className="text-xl font-semibold text-white mb-3">
              VORP (Value Over Replacement Player)
            </h2>
            <p className="text-slate-300 leading-relaxed mb-3">
              VORP measures how much better a player is than the
              best freely available replacement at their position in
              your specific league. A QB projected for 300 points in
              a league where the replacement QB scores 250 has a
              VORP of 50.
            </p>
            <p className="text-slate-300 leading-relaxed">
              Replacement level is calculated dynamically based on
              your league&apos;s roster size, number of teams, and
              flex slots. This means the same player can have
              different VORP in different leagues &mdash; a TE in a
              2-TE league is more scarce than in a 1-TE league.
            </p>
          </section>

          {/* Consensus Blending */}
          <section id="consensus">
            <h2 className="text-xl font-semibold text-white mb-3">
              Consensus Blending
            </h2>
            <p className="text-slate-300 leading-relaxed mb-3">
              Market consensus aggregates dynasty rankings from
              KeepTradeCut (40%), FantasyCalc (35%), and
              DynastyProcess (25%). This represents how the broader
              dynasty community values each player. DynastyRanks
              blends this consensus with your league&apos;s computed
              signal based on your Valuation Emphasis setting:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <ModeCard
                mode="Auto"
                description="Adjusts automatically. Standard leagues lean toward consensus (~70%). Complex IDP or superflex leagues lean toward league signal (~65%)."
              />
              <ModeCard
                mode="Market"
                description="65% consensus weight. Best when evaluating trades against what the market will pay."
              />
              <ModeCard
                mode="Balanced"
                description="50/50 split between consensus and league signal."
              />
              <ModeCard
                mode="League"
                description="65% league signal weight. Best for leagues with unusual scoring or deep rosters."
              />
            </div>
          </section>

          {/* Age Curves */}
          <section id="age-curves">
            <h2 className="text-xl font-semibold text-white mb-3">
              Dynasty Age Curves
            </h2>
            <p className="text-slate-300 leading-relaxed mb-3">
              Player values are adjusted for age based on
              position-specific career arcs from NFL production
              data:
            </p>
            <ul className="space-y-2 text-slate-300 text-sm">
              <li>
                <span className="text-white font-medium">
                  RB:
                </span>{" "}
                Peak 24&ndash;27, steep decline after 28
              </li>
              <li>
                <span className="text-white font-medium">
                  WR:
                </span>{" "}
                Peak 24&ndash;28, gradual decline into early 30s
              </li>
              <li>
                <span className="text-white font-medium">
                  TE:
                </span>{" "}
                Peak 26&ndash;29, slow developers with late
                breakouts
              </li>
              <li>
                <span className="text-white font-medium">
                  QB:
                </span>{" "}
                Peak 28&ndash;33, longest productive window
              </li>
            </ul>
            <p className="text-slate-300 leading-relaxed mt-3">
              Young players at ascending positions receive a dynasty
              premium reflecting their remaining career upside. A
              22-year-old RB is worth more than a 27-year-old with
              identical production because of the extra productive
              years ahead.
            </p>
          </section>

          {/* IDP */}
          <section id="idp">
            <h2 className="text-xl font-semibold text-white mb-3">
              IDP Values
            </h2>
            <p className="text-slate-300 leading-relaxed">
              No major dynasty ranking site publishes IDP values.
              DynastyRanks computes IDP values entirely from your
              league&apos;s scoring signals &mdash; tackles, sacks,
              interceptions, pass breakups, and other stats weighted
              exactly as your league scores them. IDP values are
              intentionally conservative to account for the higher
              replacement-level volatility at defensive positions.
            </p>
          </section>

          {/* Trade Analysis */}
          <section id="trade-analysis">
            <h2 className="text-xl font-semibold text-white mb-3">
              Trade Analysis
            </h2>
            <p className="text-slate-300 leading-relaxed mb-3">
              The trade calculator evaluates deals through three
              lenses:
            </p>
            <div className="space-y-3 text-sm">
              <div className="rounded-lg bg-slate-800/50 p-4 ring-1 ring-slate-700">
                <h3 className="text-white font-medium mb-1">
                  Structural Fairness
                </h3>
                <p className="text-slate-400">
                  Compares total dynasty value of each side.
                  Adjusts for roster cost (adding players consumes
                  bench spots) and the stud premium (fewer elite
                  assets are worth more than many average ones).
                </p>
              </div>
              <div className="rounded-lg bg-slate-800/50 p-4 ring-1 ring-slate-700">
                <h3 className="text-white font-medium mb-1">
                  Market Comparison
                </h3>
                <p className="text-slate-400">
                  Shows whether your league values the trade
                  differently than market consensus. A large gap
                  can reveal league-specific arbitrage
                  opportunities where you see value others
                  don&apos;t.
                </p>
              </div>
              <div className="rounded-lg bg-slate-800/50 p-4 ring-1 ring-slate-700">
                <h3 className="text-white font-medium mb-1">
                  Roster Impact
                </h3>
                <p className="text-slate-400">
                  Simulates your optimal lineup before and after
                  the trade. Shows weekly point changes, plus
                  1-year and 3-year dynasty value trajectory
                  including age curves.
                </p>
              </div>
            </div>
          </section>

          <p className="text-sm text-slate-500 pt-4 border-t border-slate-700">
            Last updated: February 24, 2026
          </p>
        </div>
      </main>
    </div>
  );
}

function PipelineStep({ label }: { label: string }) {
  return (
    <span className="px-3 py-1 rounded-full bg-slate-800 text-slate-300 ring-1 ring-slate-700">
      {label}
    </span>
  );
}

function Arrow() {
  return (
    <span className="text-slate-600">&rarr;</span>
  );
}

function ModeCard({
  mode,
  description,
}: {
  mode: string;
  description: string;
}) {
  return (
    <div className="rounded-lg bg-slate-800/50 p-3 ring-1 ring-slate-700">
      <p className="text-white font-medium text-sm mb-1">
        {mode}
      </p>
      <p className="text-slate-400 text-xs leading-relaxed">
        {description}
      </p>
    </div>
  );
}
