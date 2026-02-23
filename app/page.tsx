import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800">
      <nav className="border-b border-slate-700 bg-slate-900/50 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center">
              <span className="text-xl font-bold text-white">DynastyRanks</span>
              <span className="ml-2 px-2 py-0.5 text-xs font-medium rounded-full bg-blue-600/20 text-blue-400 ring-1 ring-blue-500/30">
                Beta
              </span>
            </div>
            <div />
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-5xl">
            Dynasty Rankings That
            <span className="text-blue-400"> Actually Understand</span>
            <br />
            Your League
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-slate-300">
            The only dynasty tool that calculates player values based on YOUR
            league&apos;s exact settings. IDP support, custom scoring, unique
            roster configurations - we handle it all.
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Link
              href="/login"
              className="rounded-md border border-slate-500 px-6 py-3 text-base font-semibold text-slate-200 hover:bg-slate-700 transition-colors"
            >
              Log In
            </Link>
            <Link
              href="/signup"
              className="rounded-md bg-blue-600 px-6 py-3 text-base font-semibold text-white shadow-sm hover:bg-blue-500 transition-colors"
            >
              Get Started
            </Link>
          </div>
        </div>

        <div className="mt-24 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureCard
            title="League-Specific Values"
            description="Your 12-team IDP league with TE premium scores differently than a standard league. We calculate values for YOUR exact settings."
          />
          <FeatureCard
            title="IDP Support"
            description="Finally, a tool that understands IDP. DL, LB, DB - even granular positions like EDR, IL, CB, S. Position-specific scoring included."
          />
          <FeatureCard
            title="VORP-Based Rankings"
            description="Value Over Replacement Player calculated per-position based on your league's roster depth and flex eligibility."
          />
          <FeatureCard
            title="Dynasty Age Curves"
            description="24-year-old RB vs 29-year-old RB? We factor in positional age curves to give you true dynasty value."
          />
          <FeatureCard
            title="Trade Calculator"
            description="Compare player values with full VORP breakdowns. See exactly why one side of a trade wins."
          />
          <FeatureCard
            title="Multiple Platforms"
            description="Connect Sleeper, Fleaflicker, ESPN, or Yahoo leagues. Same powerful analysis across all platforms."
          />
        </div>

        <div className="mt-24 rounded-2xl bg-slate-800/50 p-8">
          <h2 className="text-center text-2xl font-bold text-white">
            Why Other Tools Get It Wrong
          </h2>
          <div className="mt-8 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="py-4 pr-8 font-medium text-slate-300">
                    Feature
                  </th>
                  <th className="py-4 px-8 font-medium text-blue-400">
                    DynastyRanks
                  </th>
                  <th className="py-4 px-8 font-medium text-slate-400">
                    KeepTradeCut
                  </th>
                  <th className="py-4 px-8 font-medium text-slate-400">
                    DynastyDaddy
                  </th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                <tr className="border-b border-slate-700/50">
                  <td className="py-4 pr-8">League-Specific Values</td>
                  <td className="py-4 px-8 text-green-400">Yes</td>
                  <td className="py-4 px-8 text-red-400">No</td>
                  <td className="py-4 px-8 text-red-400">No</td>
                </tr>
                <tr className="border-b border-slate-700/50">
                  <td className="py-4 pr-8">Full IDP Support</td>
                  <td className="py-4 px-8 text-green-400">Yes</td>
                  <td className="py-4 px-8 text-red-400">No</td>
                  <td className="py-4 px-8 text-red-400">No</td>
                </tr>
                <tr className="border-b border-slate-700/50">
                  <td className="py-4 pr-8">Custom Scoring</td>
                  <td className="py-4 px-8 text-green-400">Full</td>
                  <td className="py-4 px-8 text-yellow-400">Limited</td>
                  <td className="py-4 px-8 text-yellow-400">Limited</td>
                </tr>
                <tr className="border-b border-slate-700/50">
                  <td className="py-4 pr-8">Position-Specific Scoring</td>
                  <td className="py-4 px-8 text-green-400">Yes</td>
                  <td className="py-4 px-8 text-red-400">No</td>
                  <td className="py-4 px-8 text-red-400">No</td>
                </tr>
                <tr>
                  <td className="py-4 pr-8">Superflex / TEP</td>
                  <td className="py-4 px-8 text-green-400">Automatic</td>
                  <td className="py-4 px-8 text-yellow-400">Toggle</td>
                  <td className="py-4 px-8 text-yellow-400">Toggle</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <footer className="border-t border-slate-700 bg-slate-900">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="text-center text-slate-400">
            <p>&copy; 2026 DynastyRanks. All rights reserved.</p>
            <div className="mt-4 flex justify-center gap-6">
              <Link href="/privacy" className="hover:text-white transition-colors">
                Privacy Policy
              </Link>
              <Link href="/terms" className="hover:text-white transition-colors">
                Terms of Service
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}

function FeatureCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl bg-slate-800/50 p-6 ring-1 ring-slate-700">
      <h3 className="text-lg font-semibold text-white">{title}</h3>
      <p className="mt-2 text-slate-400">{description}</p>
    </div>
  );
}
