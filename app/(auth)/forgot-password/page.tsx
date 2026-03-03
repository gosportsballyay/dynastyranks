"use client";

import { useState } from "react";
import Link from "next/link";
import { requestPasswordReset } from "@/lib/auth/actions";

export default function ForgotPasswordPage() {
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const formData = new FormData(e.currentTarget);
      const result = await requestPasswordReset(formData);

      if (result.success) {
        setSubmitted(true);
      } else {
        setError(result.error || "Something went wrong");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link
            href="/"
            className="text-2xl font-bold text-white font-[family-name:var(--font-display)]"
          >
            MyDynastyValues
          </Link>
          <p className="mt-2 text-slate-400">Reset your password</p>
        </div>

        <div className="bg-slate-800/50 rounded-xl p-8 ring-1 ring-slate-700">
          {submitted ? (
            <div className="text-center space-y-4">
              <div className="bg-blue-500/10 border border-blue-500/50 rounded-lg p-4 text-blue-300 text-sm">
                If an account exists with that email, we sent a
                reset link. Check your inbox.
              </div>
              <Link
                href="/login"
                className="inline-block text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors text-sm"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <form onSubmit={handleSubmit} className="space-y-6">
                {error && (
                  <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 text-red-400 text-sm">
                    {error}
                  </div>
                )}

                <p className="text-slate-400 text-sm">
                  Enter the email address associated with your
                  account and we&apos;ll send you a link to reset
                  your password.
                </p>

                <div>
                  <label
                    htmlFor="email"
                    className="block text-sm font-medium text-slate-300 mb-2"
                  >
                    Email
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    className="w-full rounded-lg bg-slate-900 border border-slate-700 px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="you@example.com"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-lg bg-blue-600 px-4 py-3 text-white font-medium hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? "Sending..." : "Send reset link"}
                </button>
              </form>

              <div className="mt-6 text-center">
                <Link
                  href="/login"
                  className="text-slate-400 hover:text-slate-300 text-sm underline underline-offset-2 transition-colors"
                >
                  Back to sign in
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
