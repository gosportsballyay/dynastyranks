import Link from "next/link";

export default function PrivacyPolicyPage() {
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

      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold text-white mb-8">Privacy Policy</h1>

        <div className="prose prose-invert prose-slate max-w-none space-y-8">
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">
              What We Collect
            </h2>
            <ul className="text-slate-300 space-y-2 list-disc list-inside">
              <li>
                Email address and password hash (for authentication)
              </li>
              <li>
                League data fetched from connected platforms (Sleeper,
                Fleaflicker, ESPN, Yahoo)
              </li>
              <li>Feedback submissions sent through the in-app button</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">
              What We Don&apos;t Collect
            </h2>
            <ul className="text-slate-300 space-y-2 list-disc list-inside">
              <li>
                No tracking cookies — Vercel Analytics is cookieless and
                privacy-friendly
              </li>
              <li>No advertising trackers or third-party ad networks</li>
              <li>No selling or sharing of personal data</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">
              How Data Is Used
            </h2>
            <p className="text-slate-300 leading-relaxed">
              Your league data is used exclusively to compute league-specific
              player rankings and trade values. We do not use your data for any
              purpose other than providing the MyDynastyValues service to you.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">
              Third-Party Services
            </h2>
            <ul className="text-slate-300 space-y-2 list-disc list-inside">
              <li>
                <strong>Neon Postgres</strong> — database hosting
              </li>
              <li>
                <strong>Vercel</strong> — application hosting and cookieless
                analytics
              </li>
              <li>
                <strong>Sentry</strong> — error tracking (captures error
                details, not personal data)
              </li>
              <li>
                <strong>Platform APIs</strong> — Sleeper, Fleaflicker, ESPN, and
                Yahoo for league data
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">
              Data Retention
            </h2>
            <p className="text-slate-300 leading-relaxed">
              During the beta period, data may be cleared and accounts may be
              reset as part of development and testing. We will make reasonable
              efforts to notify users before any data resets.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">
              Your Rights
            </h2>
            <p className="text-slate-300 leading-relaxed">
              You may request deletion of your account and all associated data
              at any time by using the in-app Feedback button. We will process
              deletion requests promptly.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Contact</h2>
            <p className="text-slate-300 leading-relaxed">
              For privacy-related questions, use the in-app Feedback button to
              reach us.
            </p>
          </section>

          <p className="text-sm text-slate-500 pt-4 border-t border-slate-700">
            Last updated: February 24, 2026
          </p>
        </div>
      </main>
    </div>
  );
}
