"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface League {
  id: string;
  name: string;
  provider: string;
}

interface HeaderProps {
  leagues: League[];
  currentLeagueId: string;
  userEmail: string;
  onMenuClick: () => void;
  showMenuButton: boolean;
}

export function Header({
  leagues,
  currentLeagueId,
  userEmail,
  onMenuClick,
  showMenuButton,
}: HeaderProps) {
  const router = useRouter();
  const [leagueDropdownOpen, setLeagueDropdownOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const leagueRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  const currentLeague = leagues.find((l) => l.id === currentLeagueId);

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (leagueRef.current && !leagueRef.current.contains(event.target as Node)) {
        setLeagueDropdownOpen(false);
      }
      if (userRef.current && !userRef.current.contains(event.target as Node)) {
        setUserDropdownOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleLeagueSelect(leagueId: string) {
    setLeagueDropdownOpen(false);
    router.push(`/league/${leagueId}/summary`);
  }

  return (
    <header className="fixed top-0 left-0 right-0 h-16 bg-slate-900 border-b border-slate-700 z-50">
      <div className="h-full px-4 flex items-center justify-between">
        {/* Left side: Menu button + Logo */}
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          {showMenuButton && (
            <button
              onClick={onMenuClick}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 text-slate-400 hover:text-white focus-visible:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:rounded transition-colors shrink-0"
            >
              <MenuIcon />
            </button>
          )}

          <Link href="/dashboard" className="font-bold text-white hover:text-blue-400 transition-colors shrink-0">
            <span className="text-xl hidden sm:inline">DynastyRanks</span>
            <span className="text-lg sm:hidden">DR</span>
          </Link>

          {/* League Switcher */}
          {currentLeague && leagues.length > 0 && (
            <div className="relative" ref={leagueRef}>
              <button
                onClick={() => setLeagueDropdownOpen(!leagueDropdownOpen)}
                aria-expanded={leagueDropdownOpen}
                aria-haspopup="listbox"
                aria-label={`Switch league, current: ${currentLeague.name}`}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors"
              >
                <span className="hidden sm:inline text-slate-500">League:</span>
                <span className="font-medium truncate max-w-[100px] sm:max-w-[150px] md:max-w-[200px]">
                  {currentLeague.name}
                </span>
                <ChevronDownIcon />
              </button>

              {leagueDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-64 bg-slate-800 rounded-lg shadow-lg border border-slate-700 py-1 z-50">
                  {leagues.map((league) => (
                    <button
                      key={league.id}
                      onClick={() => handleLeagueSelect(league.id)}
                      className={`w-full text-left px-4 py-2 hover:bg-slate-700 transition-colors ${
                        league.id === currentLeagueId
                          ? "text-blue-400 bg-blue-600/10"
                          : "text-slate-300"
                      }`}
                    >
                      <div className="font-medium truncate">{league.name}</div>
                      <div className="text-xs text-slate-500 capitalize">
                        {league.provider}
                      </div>
                    </button>
                  ))}

                  <div className="border-t border-slate-700 mt-1 pt-1">
                    <Link
                      href="/dashboard/connect"
                      onClick={() => setLeagueDropdownOpen(false)}
                      className="flex items-center gap-2 w-full text-left px-4 py-2 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                    >
                      <PlusIcon />
                      <span>Connect League</span>
                    </Link>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right side: User menu */}
        <div className="relative" ref={userRef}>
          <button
            onClick={() => setUserDropdownOpen(!userDropdownOpen)}
            aria-expanded={userDropdownOpen}
            aria-haspopup="true"
            aria-label="User menu"
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors"
          >
            <UserIcon />
            <span className="hidden sm:inline truncate max-w-[150px]">{userEmail}</span>
            <ChevronDownIcon />
          </button>

          {userDropdownOpen && (
            <div className="absolute top-full right-0 mt-1 w-48 bg-slate-800 rounded-lg shadow-lg border border-slate-700 py-1 z-50">
              <div className="px-4 py-2 text-sm text-slate-400 border-b border-slate-700 sm:hidden">
                {userEmail}
              </div>
              {currentLeague && (
                <Link
                  href={`/league/${currentLeague.id}/settings`}
                  onClick={() => setUserDropdownOpen(false)}
                  className="flex items-center gap-2 w-full text-left px-4 py-2 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
                >
                  <SettingsIcon />
                  <span>League Settings</span>
                </Link>
              )}
              <form action="/api/auth/signout" method="POST">
                <button
                  type="submit"
                  className="flex items-center gap-2 w-full text-left px-4 py-2 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
                >
                  <LogoutIcon />
                  <span>Sign out</span>
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

// Icons
function MenuIcon() {
  return (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}
