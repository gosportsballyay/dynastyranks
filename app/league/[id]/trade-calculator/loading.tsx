export default function TradeCalculatorLoading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="h-8 w-40 bg-slate-700/50 rounded animate-pulse" />

      {/* Two-side trade layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[...Array(2)].map((_, s) => (
          <div
            key={s}
            className="bg-slate-800/50 rounded-xl ring-1 ring-slate-700 p-4 space-y-4"
          >
            <div className="h-9 w-full bg-slate-700/50 rounded animate-pulse" />
            <div className="h-9 w-full bg-slate-700/50 rounded animate-pulse" />
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between py-2"
                >
                  <div className="flex items-center gap-2">
                    <div className="h-5 w-12 bg-slate-700/50 rounded animate-pulse" />
                    <div className="h-4 w-28 bg-slate-700/50 rounded animate-pulse" />
                  </div>
                  <div className="h-4 w-14 bg-slate-700/50 rounded animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Analysis panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {[...Array(2)].map((_, i) => (
          <div
            key={i}
            className="bg-slate-800/50 rounded-xl ring-1 ring-slate-700 p-4"
          >
            <div className="h-5 w-32 bg-slate-700/50 rounded animate-pulse mb-4" />
            <div className="h-3 w-full bg-slate-700/50 rounded-full animate-pulse mb-3" />
            <div className="space-y-2">
              {[...Array(3)].map((_, j) => (
                <div key={j} className="flex justify-between">
                  <div className="h-4 w-24 bg-slate-700/50 rounded animate-pulse" />
                  <div className="h-4 w-16 bg-slate-700/50 rounded animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
