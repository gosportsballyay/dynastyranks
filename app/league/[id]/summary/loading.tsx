export default function SummaryLoading() {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="h-8 w-48 bg-slate-700/50 rounded animate-pulse" />

      {/* View mode selector */}
      <div className="bg-slate-800/50 rounded-xl ring-1 ring-slate-700">
        <div className="px-6 py-3 border-b border-slate-700 flex items-center gap-2">
          <div className="h-4 w-24 bg-slate-700/50 rounded animate-pulse" />
          <div className="h-7 w-28 bg-slate-700/50 rounded animate-pulse" />
        </div>

        {/* Table skeleton */}
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700">
              {[...Array(6)].map((_, i) => (
                <th key={i} className="px-6 py-3">
                  <div className="h-3 bg-slate-700/50 rounded animate-pulse" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...Array(10)].map((_, i) => (
              <tr key={i} className="border-b border-slate-700">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="h-6 w-6 bg-slate-700/50 rounded animate-pulse" />
                    <div className="space-y-1.5">
                      <div className="h-4 w-32 bg-slate-700/50 rounded animate-pulse" />
                      <div className="h-3 w-20 bg-slate-700/50 rounded animate-pulse" />
                    </div>
                  </div>
                </td>
                {[...Array(4)].map((_, j) => (
                  <td key={j} className="px-6 py-4">
                    <div className="flex justify-center">
                      <div className="h-8 w-8 bg-slate-700/50 rounded-full animate-pulse" />
                    </div>
                  </td>
                ))}
                <td className="px-6 py-4">
                  <div className="h-4 w-16 bg-slate-700/50 rounded animate-pulse ml-auto" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
