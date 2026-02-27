export default function RankingsLoading() {
  return (
    <div className="space-y-4">
      {/* Header area */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="h-8 w-40 bg-slate-700/50 rounded animate-pulse" />
        <div className="h-8 w-24 bg-slate-700/50 rounded animate-pulse" />
        <div className="h-5 w-20 bg-slate-700/50 rounded animate-pulse" />
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="h-8 w-20 bg-slate-700/50 rounded-full animate-pulse"
          />
        ))}
      </div>

      {/* Table skeleton */}
      <div className="bg-slate-800/50 rounded-xl ring-1 ring-slate-700">
        <div className="h-10 border-b border-slate-700/50" />
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700">
              {[...Array(8)].map((_, i) => (
                <th key={i} className="px-4 py-3">
                  <div className="h-3 bg-slate-700/50 rounded animate-pulse" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...Array(15)].map((_, i) => (
              <tr
                key={i}
                className={`border-b border-slate-700/50 ${
                  i % 2 === 0 ? "bg-slate-800/30" : ""
                }`}
              >
                <td className="px-4 py-3">
                  <div className="h-4 w-8 bg-slate-700/50 rounded animate-pulse" />
                </td>
                <td className="px-4 py-3">
                  <div className="h-4 w-28 bg-slate-700/50 rounded animate-pulse" />
                </td>
                <td className="px-4 py-3">
                  <div className="h-5 w-12 bg-slate-700/50 rounded animate-pulse" />
                </td>
                <td className="px-4 py-3">
                  <div className="h-4 w-10 bg-slate-700/50 rounded animate-pulse" />
                </td>
                <td className="px-4 py-3">
                  <div className="h-4 w-6 bg-slate-700/50 rounded animate-pulse" />
                </td>
                <td className="px-4 py-3">
                  <div className="h-4 w-12 bg-slate-700/50 rounded animate-pulse ml-auto" />
                </td>
                <td className="px-4 py-3">
                  <div className="h-4 w-12 bg-slate-700/50 rounded animate-pulse ml-auto" />
                </td>
                <td className="px-4 py-3">
                  <div className="h-6 w-6 bg-slate-700/50 rounded-full animate-pulse" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
