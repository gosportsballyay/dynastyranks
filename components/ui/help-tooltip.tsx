"use client";

import { useState, useRef, useEffect } from "react";

interface HelpTooltipProps {
  text: React.ReactNode;
  learnMoreHref?: string;
}

/**
 * Small (?) icon with tooltip on hover (desktop) or click (mobile).
 */
export function HelpTooltip({ text, learnMoreHref }: HelpTooltipProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleOutside);
    }
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="inline-flex items-center justify-center w-4 h-4
          rounded-full bg-slate-700 text-slate-400 text-[10px]
          font-bold hover:bg-slate-600 hover:text-slate-200
          transition-colors cursor-help"
        aria-label="Help"
      >
        ?
      </button>
      {open && (
        <div
          className="fixed sm:absolute z-[60] left-4 right-4 bottom-4
            sm:left-1/2 sm:right-auto sm:bottom-full sm:-translate-x-1/2
            sm:mb-2 sm:w-64
            px-3 py-2 rounded-lg bg-slate-800 border
            border-slate-600 shadow-lg text-xs text-slate-300
            leading-relaxed"
        >
          {text}
          {learnMoreHref && (
            <a
              href={learnMoreHref}
              className="block mt-1 text-blue-400
                hover:text-blue-300 text-xs underline underline-offset-2"
            >
              Learn more &rarr;
            </a>
          )}
          <div
            className="hidden sm:block absolute top-full left-1/2 -translate-x-1/2
              -mt-px w-0 h-0 border-x-[6px] border-x-transparent
              border-t-[6px] border-t-slate-600"
          />
        </div>
      )}
    </div>
  );
}
