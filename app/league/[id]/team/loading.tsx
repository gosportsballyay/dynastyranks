export default function TeamLoading() {
  return (
    <div className="space-y-6">
      {/* Header + team selector */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="h-8 w-32 bg-slate-700/50 rounded animate-pulse" />
        <div className="h-9 w-48 bg-slate-700/50 rounded animate-pulse" />
      </div>

      {/* Roster sections */}
      {[...Array(3)].map((_, s) => (
        <div
          key={s}
          className="bg-slate-800/50 rounded-xl ring-1 ring-slate-700"
        >
          <div className="px-4 py-3 border-b border-slate-700">
            <div className="h-5 w-28 bg-slate-700/50 rounded animate-pulse" />
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700">
                {[...Array(6)].map((_, i) => (
                  <th key={i} className="px-4 py-3">
                    <div className="h-3 bg-slate-700/50 rounded animate-pulse" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...Array(s === 0 ? 8 : 4)].map((_, i) => (
                <tr
                  key={i}
                  className={`border-b border-slate-700/50 ${
                    i % 2 === 0 ? "bg-slate-800/30" : ""
                  }`}
                >
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
                    <div className="h-4 w-14 bg-slate-700/50 rounded animate-pulse ml-auto" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-4 w-6 bg-slate-700/50 rounded-full animate-pulse" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
