import Link from "next/link";

export default function TermsOfServicePage() {
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
        <h1 className="text-3xl font-bold text-white mb-8">
          Terms of Service
        </h1>

        <div className="prose prose-invert prose-slate max-w-none space-y-8">
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">
              Beta Status
            </h2>
            <p className="text-slate-300 leading-relaxed">
              MyDynastyValues is currently in beta. The service is provided
              &quot;as-is&quot; with no guarantees of availability, accuracy, or
              data persistence. Features may change, and data (including
              accounts and league connections) may be reset during the beta
              period.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">
              Acceptable Use
            </h2>
            <p className="text-slate-300 leading-relaxed">
              MyDynastyValues is intended for personal fantasy football analysis
              only. You agree not to use the service for commercial purposes,
              scrape data from the platform, or interfere with the operation of
              the service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">
              Account and Data
            </h2>
            <p className="text-slate-300 leading-relaxed">
              To use MyDynastyValues, you create an account with an email address
              and password. Your password is stored as a cryptographic hash and
              is never stored in plain text. League data is fetched from
              third-party platforms (Sleeper, Fleaflicker, ESPN, Yahoo) using
              the credentials or access you provide.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">
              Intellectual Property
            </h2>
            <p className="text-slate-300 leading-relaxed">
              MyDynastyValues owns all rights to the tool, including the ranking
              algorithms, user interface, and value engine. You retain ownership
              of your personal data and league information. Player data and
              statistics are sourced from publicly available third-party
              platforms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">
              Limitation of Liability
            </h2>
            <p className="text-slate-300 leading-relaxed">
              MyDynastyValues is a hobby project and free beta service. To the
              maximum extent permitted by law, MyDynastyValues and its creators
              shall not be liable for any indirect, incidental, special, or
              consequential damages arising from your use of the service. This
              includes but is not limited to trade decisions made based on
              player values, rankings, or analysis provided by the tool.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">
              Contact
            </h2>
            <p className="text-slate-300 leading-relaxed">
              For questions about these terms, use the in-app Feedback button
              to reach us.
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
