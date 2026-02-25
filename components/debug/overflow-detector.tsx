"use client";

import { useState, useEffect } from "react";

/**
 * TEMPORARY debug component. Scans the DOM for elements wider
 * than the viewport and displays them in a small overlay.
 * Remove once horizontal overflow is resolved.
 */
export function OverflowDetector() {
  const [overflows, setOverflows] = useState<string[]>([]);
  const [show, setShow] = useState(false);

  useEffect(() => {
    function scan() {
      const vw = document.documentElement.clientWidth;
      const found: string[] = [];

      document.querySelectorAll("*").forEach((el) => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        if (rect.right > vw + 1 || rect.left < -1) {
          const tag = el.tagName.toLowerCase();
          const cls = (el.className || "").toString().slice(0, 60);
          const w = Math.round(rect.width);
          const r = Math.round(rect.right);
          found.push(`<${tag}> w=${w} right=${r} .${cls}`);
        }
      });

      setOverflows(found);
    }

    // Scan after page settles
    const timer = setTimeout(scan, 2000);
    // Re-scan on resize
    window.addEventListener("resize", scan);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", scan);
    };
  }, []);

  if (overflows.length === 0) {
    return (
      <div className="fixed bottom-12 left-2 z-[9999] bg-green-800 text-green-200 text-[10px] px-2 py-1 rounded opacity-80">
        0 overflows
      </div>
    );
  }

  return (
    <div className="fixed bottom-12 left-2 z-[9999]">
      <button
        onClick={() => setShow(!show)}
        className="bg-red-700 text-white text-[10px] px-2 py-1 rounded"
      >
        {overflows.length} overflow(s)
      </button>
      {show && (
        <div className="mt-1 bg-black/90 text-red-300 text-[9px] p-2 rounded max-h-48 overflow-y-auto w-72">
          {overflows.map((o, i) => (
            <div key={i} className="border-b border-red-900/50 py-0.5">
              {o}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
