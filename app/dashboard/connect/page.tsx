"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

type Provider = "sleeper" | "fleaflicker" | "espn" | "yahoo";

interface Team {
  id: string;
  name: string | null;
  owner: string | null;
}

interface League {
  id: string;
  name: string;
  teams: number;
}

const yahooEnabled =
  process.env.NEXT_PUBLIC_YAHOO_ENABLED === "true";

function ConnectLeagueContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [provider, setProvider] = useState<Provider | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [season, setSeason] = useState(new Date().getFullYear().toString());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ESPN cookie inputs
  const [showCookieInputs, setShowCookieInputs] = useState(false);
  const [espnS2, setEspnS2] = useState("");
  const [swid, setSwid] = useState("");

  // League selection state (for Sleeper/Yahoo multi-league)
  const [availableLeagues, setAvailableLeagues] = useState<League[]>([]);
  const [selectedLeagueId, setSelectedLeagueId] = useState<string | null>(null);
  const [showLeagueSelection, setShowLeagueSelection] = useState(false);

  // Team selection state
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [showTeamSelection, setShowTeamSelection] = useState(false);

  // Check for Yahoo OAuth success/error from URL params
  useEffect(() => {
    const yahooStatus = searchParams.get("yahoo");
    const oauthError = searchParams.get("error");

    if (yahooStatus === "connected") {
      setProvider("yahoo");
      setError(null);
    } else if (oauthError) {
      setError(`OAuth error: ${oauthError}`);
    }
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!provider) return;
    if (provider !== "yahoo" && !identifier) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/leagues/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          identifier: identifier.trim(),
          season: parseInt(season),
          leagueId: selectedLeagueId,
          // ESPN-specific cookies
          ...(provider === "espn" && espnS2 && { espnS2 }),
          ...(provider === "espn" && swid && { swid }),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        // Handle Yahoo OAuth requirement
        if (data.requiresOAuth) {
          window.location.href = "/api/auth/yahoo";
          return;
        }
        throw new Error(data.error || "Failed to connect league");
      }

      // Check if we need league selection (Sleeper/Yahoo multi-league)
      if (data.selectLeague && data.leagues?.length > 0) {
        setAvailableLeagues(data.leagues);
        setShowLeagueSelection(true);
        setLoading(false);
        return;
      }

      // Show team selection inline (new league or already connected)
      setLeagueId(data.leagueId);
      if (data.selectTeam && data.teams?.length > 0) {
        setTeams(data.teams);
        setShowTeamSelection(true);
        setLoading(false);
      } else {
        // League already connected with no teams — fetch them
        await fetchTeamsForLeague(data.leagueId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect league");
      setLoading(false);
    }
  }

  async function fetchTeamsForLeague(id: string) {
    try {
      const response = await fetch(`/api/leagues/${id}/teams`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch teams");
      }

      if (data.teams?.length > 0) {
        setTeams(data.teams);
        setShowTeamSelection(true);
      } else {
        // No teams found, just redirect
        router.push(`/league/${id}/summary`);
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load teams");
    } finally {
      setLoading(false);
    }
  }

  async function handleLeagueSelect(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedLeagueId) return;

    // Reset and resubmit with selected league
    setShowLeagueSelection(false);
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/leagues/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          identifier: identifier.trim(),
          season: parseInt(season),
          leagueId: selectedLeagueId,
          ...(provider === "espn" && espnS2 && { espnS2 }),
          ...(provider === "espn" && swid && { swid }),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to connect league");
      }

      setLeagueId(data.leagueId);
      if (data.selectTeam && data.teams?.length > 0) {
        setTeams(data.teams);
        setShowTeamSelection(true);
        setLoading(false);
      } else {
        await fetchTeamsForLeague(data.leagueId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect league");
      setLoading(false);
    }
  }

  async function handleTeamSelect(e?: React.FormEvent | React.MouseEvent) {
    e?.preventDefault();
    if (!leagueId || !selectedTeamId) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/leagues/${leagueId}/select-team`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: selectedTeamId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to select team");
      }

      // Redirect to the league
      router.push(`/league/${leagueId}/summary`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to select team");
      setLoading(false);
    }
  }

  function handleYahooConnect() {
    // Redirect to Yahoo OAuth
    window.location.href = "/api/auth/yahoo";
  }

  function getProviderLabel(): string {
    switch (provider) {
      case "sleeper":
        return "Sleeper Username";
      case "fleaflicker":
      case "espn":
        return "League ID";
      case "yahoo":
        return "League ID (optional)";
      default:
        return "Identifier";
    }
  }

  function getProviderPlaceholder(): string {
    switch (provider) {
      case "sleeper":
        return "Your Sleeper username";
      case "fleaflicker":
        return "e.g., 123456";
      case "espn":
        return "e.g., 12345678";
      case "yahoo":
        return "Leave empty to see all leagues";
      default:
        return "";
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800">
      <nav className="border-b border-slate-700 bg-slate-900/50 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/dashboard" className="text-xl font-bold text-white">
                DynastyRanks
              </Link>
              <span className="text-slate-500">/</span>
              <span className="text-slate-300">Connect League</span>
            </div>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white">Connect Your League</h1>
          <p className="mt-2 text-slate-400">
            Choose your fantasy platform and enter your league details
          </p>
        </div>

        <div className="bg-slate-800/50 rounded-xl p-8 ring-1 ring-slate-700">
          {/* League Selection Step (for multi-league platforms) */}
          {showLeagueSelection ? (
            <form onSubmit={handleLeagueSelect} className="space-y-6">
              <div className="text-center mb-4">
                <h2 className="text-xl font-semibold text-white">
                  Select a League
                </h2>
                <p className="text-slate-400 mt-1">
                  Multiple leagues found. Choose the one you want to connect.
                </p>
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 text-red-400 text-sm">
                  {error}
                </div>
              )}

              <div>
                <label
                  htmlFor="league"
                  className="block text-sm font-medium text-slate-300 mb-2"
                >
                  League
                </label>
                <select
                  id="league"
                  value={selectedLeagueId || ""}
                  onChange={(e) => setSelectedLeagueId(e.target.value)}
                  required
                  className="w-full rounded-lg bg-slate-900 border border-slate-700 px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select a league...</option>
                  {availableLeagues.map((league) => (
                    <option key={league.id} value={league.id}>
                      {league.name} ({league.teams} teams)
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                disabled={loading || !selectedLeagueId}
                className="w-full rounded-lg bg-blue-600 px-4 py-3 text-white font-medium hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? "Connecting..." : "Connect League"}
              </button>
            </form>
          ) : (
            <>
              {/* Provider Selection */}
              <div className="mb-8">
                <label className="block text-sm font-medium text-slate-300 mb-4">
                  Select Platform
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={() => {
                      setProvider("sleeper");
                      setError(null);
                    }}
                    className={`p-4 rounded-lg border-2 transition-all ${
                      provider === "sleeper"
                        ? "border-blue-500 bg-blue-500/10"
                        : "border-slate-700 hover:border-slate-600"
                    }`}
                  >
                    <div className="text-lg font-semibold text-white">Sleeper</div>
                    <div className="text-sm text-slate-400 mt-1">
                      Enter your username
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProvider("fleaflicker");
                      setError(null);
                    }}
                    className={`p-4 rounded-lg border-2 transition-all ${
                      provider === "fleaflicker"
                        ? "border-blue-500 bg-blue-500/10"
                        : "border-slate-700 hover:border-slate-600"
                    }`}
                  >
                    <div className="text-lg font-semibold text-white">
                      Fleaflicker
                    </div>
                    <div className="text-sm text-slate-400 mt-1">
                      Enter your league ID
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProvider("espn");
                      setError(null);
                    }}
                    className={`p-4 rounded-lg border-2 transition-all ${
                      provider === "espn"
                        ? "border-blue-500 bg-blue-500/10"
                        : "border-slate-700 hover:border-slate-600"
                    }`}
                  >
                    <div className="text-lg font-semibold text-white">ESPN</div>
                    <div className="text-sm text-slate-400 mt-1">
                      Enter your league ID
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!yahooEnabled) return;
                      setProvider("yahoo");
                      setError(null);
                    }}
                    disabled={!yahooEnabled}
                    className={`p-4 rounded-lg border-2 transition-all relative ${
                      !yahooEnabled
                        ? "border-slate-700 opacity-60 cursor-not-allowed"
                        : provider === "yahoo"
                          ? "border-blue-500 bg-blue-500/10"
                          : "border-slate-700 hover:border-slate-600"
                    }`}
                  >
                    <div className="text-lg font-semibold text-white">Yahoo</div>
                    <div className="text-sm text-slate-400 mt-1">
                      {yahooEnabled ? "Connect with OAuth" : "Coming Soon"}
                    </div>
                  </button>
                </div>
              </div>

              {provider && (
                <form onSubmit={handleSubmit} className="space-y-6">
                  {error && (
                    <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 text-red-400 text-sm">
                      {error}
                    </div>
                  )}

                  {/* Yahoo OAuth Button */}
                  {provider === "yahoo" && !searchParams.get("yahoo") && (
                    <div className="text-center py-4">
                      <p className="text-slate-400 mb-4">
                        Yahoo requires authorization to access your leagues.
                      </p>
                      <button
                        type="button"
                        onClick={handleYahooConnect}
                        className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-6 py-3 text-white font-medium hover:bg-purple-500 transition-colors"
                      >
                        <svg
                          className="w-5 h-5"
                          fill="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
                        </svg>
                        Authorize with Yahoo
                      </button>
                    </div>
                  )}

                  {/* Show form for non-Yahoo or after Yahoo OAuth */}
                  {(provider !== "yahoo" || searchParams.get("yahoo") === "connected") && (
                    <>
                      <div>
                        <label
                          htmlFor="identifier"
                          className="block text-sm font-medium text-slate-300 mb-2"
                        >
                          {getProviderLabel()}
                        </label>
                        <input
                          id="identifier"
                          type="text"
                          value={identifier}
                          onChange={(e) => setIdentifier(e.target.value)}
                          required={provider !== "yahoo"}
                          className="w-full rounded-lg bg-slate-900 border border-slate-700 px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder={getProviderPlaceholder()}
                        />
                        {provider === "sleeper" && (
                          <p className="mt-2 text-sm text-slate-500">
                            After entering your username, you&apos;ll be able to select
                            from your leagues
                          </p>
                        )}
                        {provider === "fleaflicker" && (
                          <p className="mt-2 text-sm text-slate-500">
                            Find your league ID in the URL: fleaflicker.com/nfl/leagues/
                            <span className="text-blue-400">123456</span>
                          </p>
                        )}
                        {provider === "espn" && (
                          <p className="mt-2 text-sm text-slate-500">
                            Find your league ID in the URL: fantasy.espn.com/football/league?leagueId=
                            <span className="text-blue-400">12345678</span>
                          </p>
                        )}
                        {provider === "yahoo" && (
                          <p className="mt-2 text-sm text-slate-500">
                            Leave empty to see all your leagues, or enter a specific league ID
                          </p>
                        )}
                      </div>

                      {/* ESPN Cookie Inputs (for private leagues) */}
                      {provider === "espn" && (
                        <div className="border-t border-slate-700 pt-4">
                          <button
                            type="button"
                            onClick={() => setShowCookieInputs(!showCookieInputs)}
                            className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-300"
                          >
                            <svg
                              className={`w-4 h-4 transition-transform ${showCookieInputs ? "rotate-90" : ""}`}
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M9 5l7 7-7 7"
                              />
                            </svg>
                            Private league? Add ESPN cookies
                          </button>

                          {showCookieInputs && (
                            <div className="mt-4 space-y-4">
                              <p className="text-sm text-slate-500">
                                For private leagues, you need to provide your ESPN cookies.
                                <a
                                  href="https://github.com/cwendt94/espn-api/discussions/150"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-400 ml-1 hover:underline"
                                >
                                  How to find them
                                </a>
                              </p>
                              <div>
                                <label
                                  htmlFor="espnS2"
                                  className="block text-sm font-medium text-slate-300 mb-2"
                                >
                                  espn_s2 Cookie
                                </label>
                                <input
                                  id="espnS2"
                                  type="text"
                                  value={espnS2}
                                  onChange={(e) => setEspnS2(e.target.value)}
                                  className="w-full rounded-lg bg-slate-900 border border-slate-700 px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                                  placeholder="AEB..."
                                />
                              </div>
                              <div>
                                <label
                                  htmlFor="swid"
                                  className="block text-sm font-medium text-slate-300 mb-2"
                                >
                                  SWID Cookie
                                </label>
                                <input
                                  id="swid"
                                  type="text"
                                  value={swid}
                                  onChange={(e) => setSwid(e.target.value)}
                                  className="w-full rounded-lg bg-slate-900 border border-slate-700 px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                                  placeholder="{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      <div>
                        <label
                          htmlFor="season"
                          className="block text-sm font-medium text-slate-300 mb-2"
                        >
                          Season
                        </label>
                        <select
                          id="season"
                          value={season}
                          onChange={(e) => setSeason(e.target.value)}
                          className="w-full rounded-lg bg-slate-900 border border-slate-700 px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          {[2026, 2025, 2024, 2023].map((year) => (
                            <option key={year} value={year}>
                              {year}
                            </option>
                          ))}
                        </select>
                      </div>

                      {!showTeamSelection && (
                        <button
                          type="submit"
                          disabled={loading || (provider !== "yahoo" && !identifier)}
                          className="w-full rounded-lg bg-blue-600 px-4 py-3 text-white font-medium hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {loading ? "Connecting..." : "Connect League"}
                        </button>
                      )}

                      {/* Inline team selection */}
                      {showTeamSelection && teams.length > 0 && (
                        <div className="border-t border-slate-700 pt-6 space-y-4">
                          <div className="flex items-center gap-2 text-green-400 text-sm">
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                            League connected
                          </div>
                          <div>
                            <label
                              htmlFor="team"
                              className="block text-sm font-medium text-slate-300 mb-2"
                            >
                              Which team is yours?
                            </label>
                            <select
                              id="team"
                              value={selectedTeamId || ""}
                              onChange={(e) => setSelectedTeamId(e.target.value)}
                              className="w-full rounded-lg bg-slate-900 border border-slate-700 px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            >
                              <option value="">Select your team...</option>
                              {teams.map((team) => (
                                <option key={team.id} value={team.id}>
                                  {team.name || "Unnamed Team"} ({team.owner || "Unknown"})
                                </option>
                              ))}
                            </select>
                          </div>
                          <button
                            type="button"
                            onClick={handleTeamSelect}
                            disabled={loading || !selectedTeamId}
                            className="w-full rounded-lg bg-blue-600 px-4 py-3 text-white font-medium hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            {loading ? "Saving..." : "Continue"}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </form>
              )}
            </>
          )}
        </div>

        <div className="mt-8 text-center">
          <Link
            href="/dashboard"
            className="text-slate-400 hover:text-white transition-colors"
          >
            &larr; Back to Dashboard
          </Link>
        </div>
      </main>
    </div>
  );
}

function LoadingFallback() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex items-center justify-center">
      <div className="text-white">Loading...</div>
    </div>
  );
}

export default function ConnectLeaguePage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <ConnectLeagueContent />
    </Suspense>
  );
}
