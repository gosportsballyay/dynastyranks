"use client";

import { useState, useRef, useEffect } from "react";

interface FeedbackButtonProps {
  leagueId?: string;
  engineVersion?: string | null;
}

/** Small fixed feedback button that opens a modal with textarea. */
export function FeedbackButton({
  leagueId,
  engineVersion,
}: FeedbackButtonProps) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        modalRef.current &&
        !modalRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () =>
      document.removeEventListener("mousedown", handleClick);
  }, [open]);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          leagueId: leagueId ?? null,
          engineVersion: engineVersion ?? null,
          page: window.location.pathname,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Something went wrong.");
        return;
      }
      setDone(true);
      setMessage("");
      setTimeout(() => {
        setOpen(false);
        setDone(false);
      }, 1500);
    } catch {
      setError("Failed to send feedback.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-50 rounded-full
          bg-slate-700 px-3 py-1.5 text-xs font-medium
          text-slate-300 hover:bg-slate-600 hover:text-white
          transition-colors shadow-lg border border-slate-600"
      >
        Feedback
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div
            ref={modalRef}
            className="w-full max-w-md mx-4 rounded-lg bg-slate-800
              border border-slate-700 p-5 shadow-xl"
          >
            <h3 className="text-sm font-semibold text-white mb-3">
              Send Feedback
            </h3>

            {done ? (
              <p className="text-sm text-green-400">
                Thanks for your feedback!
              </p>
            ) : (
              <>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="What's on your mind? (min 5 chars)"
                  rows={4}
                  className="w-full rounded-md bg-slate-900
                    border border-slate-700 px-3 py-2 text-sm
                    text-white placeholder-slate-500
                    focus:outline-none focus:ring-2
                    focus:ring-blue-500 focus:border-transparent
                    resize-none"
                />
                {error && (
                  <p className="text-xs text-red-400 mt-1">
                    {error}
                  </p>
                )}
                <div className="flex justify-end gap-2 mt-3">
                  <button
                    onClick={() => setOpen(false)}
                    className="rounded-md px-3 py-1.5 text-xs
                      text-slate-400 hover:text-white
                      transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={
                      submitting || message.trim().length < 5
                    }
                    className="rounded-md bg-blue-600 px-3
                      py-1.5 text-xs font-medium text-white
                      hover:bg-blue-500 transition-colors
                      disabled:opacity-40
                      disabled:cursor-not-allowed"
                  >
                    {submitting ? "Sending..." : "Submit"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
