"use client";

import { useState, useEffect } from "react";
import { Header } from "./header";
import { Sidebar } from "./sidebar";
import { FeedbackButton } from "@/components/feedback-button";
import { BetaBanner } from "./beta-banner";

interface League {
  id: string;
  name: string;
  provider: string;
}

interface LeagueLayoutProps {
  leagues: League[];
  currentLeagueId: string;
  userEmail: string;
  children: React.ReactNode;
}

export function LeagueLayout({
  leagues,
  currentLeagueId,
  userEmail,
  children,
}: LeagueLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Close mobile menu on route change or resize
  useEffect(() => {
    function handleResize() {
      if (window.innerWidth >= 1024) {
        setMobileMenuOpen(false);
      }
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Load sidebar state from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("sidebarCollapsed");
    if (saved !== null) {
      setSidebarCollapsed(saved === "true");
    }
  }, []);

  function handleSidebarToggle() {
    const newState = !sidebarCollapsed;
    setSidebarCollapsed(newState);
    localStorage.setItem("sidebarCollapsed", String(newState));
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800">
      {/* Header */}
      <Header
        leagues={leagues}
        currentLeagueId={currentLeagueId}
        userEmail={userEmail}
        onMenuClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        showMenuButton={true}
      />

      {/* Mobile overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar - desktop */}
      <div className="hidden lg:block">
        <Sidebar
          leagueId={currentLeagueId}
          collapsed={sidebarCollapsed}
          onToggle={handleSidebarToggle}
        />
      </div>

      {/* Sidebar - mobile */}
      <div
        className={`fixed inset-y-0 left-0 z-40 transform transition-transform duration-300 lg:hidden ${
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="pt-16">
          <Sidebar
            leagueId={currentLeagueId}
            collapsed={false}
            onToggle={() => setMobileMenuOpen(false)}
          />
        </div>
      </div>

      {/* Main content */}
      <main
        className={`pt-16 transition-all duration-300 ${
          sidebarCollapsed ? "lg:pl-16" : "lg:pl-56"
        }`}
      >
        <div className="px-3 py-4 sm:px-4 sm:py-5 md:p-6">
          <BetaBanner />
          {children}
        </div>
      </main>
      <FeedbackButton leagueId={currentLeagueId} />
    </div>
  );
}
