import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800">
      <nav className="border-b border-slate-700 bg-slate-900/50 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center">
              <span className="text-xl font-bold text-white font-[family-name:var(--font-display)]">
                MyDynastyValues
              </span>
              <span className="ml-2 px-2 py-0.5 text-xs font-medium rounded-full bg-blue-600/20 text-blue-400 ring-1 ring-blue-500/30">
                Beta
              </span>
            </div>
            <Link
              href="/login"
              className="text-sm font-medium text-slate-300 hover:text-white transition-colors"
            >
              Log in
            </Link>
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-2xl px-4 pt-24 pb-16 sm:px-6 sm:pt-32 sm:pb-24">
        <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
          <span className="font-[family-name:var(--font-display)] font-extrabold text-blue-400">Your league.</span>{" "}
          Your values.
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-slate-400">
          Not generic rankings. Values calculated from your scoring
          rules, roster size, and league format. Connect your league
          and get values that reflect how your league actually scores.
        </p>

        <div className="mt-8 flex items-center gap-4">
          <Link
            href="/signup"
            className="inline-block rounded-md bg-blue-600 px-6 py-3 text-base font-semibold text-white hover:bg-blue-500 transition-colors"
          >
            Get started
          </Link>
          <Link
            href="/login"
            className="inline-block rounded-md px-6 py-3 text-base font-semibold text-slate-300 ring-1 ring-slate-600 hover:text-white hover:ring-slate-500 transition-colors"
          >
            Log in
          </Link>
        </div>

        <dl className="mt-16 divide-y divide-slate-700/50 text-sm">
          <div className="flex items-center gap-x-3 pb-4">
            <dt className="text-slate-200 font-bold w-36 shrink-0 font-[family-name:var(--font-display)] text-base">
              IDP-native
            </dt>
            <dd className="text-slate-300">
              DL, LB, DB, and granular positions like EDR, IL, CB, S
              &mdash; scored from your league&apos;s IDP settings.
            </dd>
          </div>
          <div className="flex items-center gap-x-3 py-4">
            <dt className="text-slate-200 font-bold w-36 shrink-0 font-[family-name:var(--font-display)] text-base">
              VORP rankings
            </dt>
            <dd className="text-slate-300">
              Value over replacement calculated per-position based on
              your roster depth and flex eligibility.
            </dd>
          </div>
          <div className="flex items-center gap-x-3 py-4">
            <dt className="text-slate-200 font-bold w-36 shrink-0 font-[family-name:var(--font-display)] text-base">
              Trade calculator
            </dt>
            <dd className="text-slate-300">
              Side-by-side value comparison with fairness verdict,
              market divergence, and roster impact analysis.
            </dd>
          </div>
          <div className="flex items-center gap-x-3 pt-4">
            <dt className="text-slate-200 font-bold w-36 shrink-0 font-[family-name:var(--font-display)] text-base">
              Age curves
            </dt>
            <dd className="text-slate-300">
              Position-specific aging factored into every value.
              A 24-year-old RB and a 29-year-old RB aren&apos;t equal.
            </dd>
          </div>
        </dl>

        <p className="mt-12 text-sm text-slate-500">
          Works with Sleeper, Fleaflicker, ESPN, and Yahoo.{" "}
          <Link
            href="/how-it-works"
            className="text-slate-400 hover:text-white transition-colors"
          >
            How it works &rarr;
          </Link>
        </p>
      </div>

      <footer className="border-t border-slate-700 bg-slate-900">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-slate-400">
            <p>&copy; 2026 MyDynastyValues</p>
            <div className="flex gap-6">
              <Link
                href="/privacy"
                className="hover:text-white transition-colors"
              >
                Privacy
              </Link>
              <Link
                href="/terms"
                className="hover:text-white transition-colors"
              >
                Terms
              </Link>
              <Link
                href="/how-it-works"
                className="hover:text-white transition-colors"
              >
                How It Works
              </Link>
              <Link
                href="/idp-trends"
                className="hover:text-white transition-colors"
              >
                IDP Trends
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
