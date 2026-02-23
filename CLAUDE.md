# DynastyRanks - Project Brief

## Vision
A **lighter dynasty-daddy.com clone** with first-class IDP support and
league-specific roster/size considerations baked into every value calculation.
Not a stats playground - a tool dynasty managers actually use on trade day.

## IMPORTANT: Stop scope-creeping. Ship the MVP.
The value engine and ranking pipeline are DONE. Do NOT spend more time tweaking
stats, adding data sources, or polishing the ranking algorithm unless a user
reports a concrete bug. Focus exclusively on the MVP feature gaps below.

---

## Current State (as of 2026-02-23)

### Working Features
| Feature | Route | Notes |
|---------|-------|-------|
| Auth (email/password) | `/login`, `/signup` | NextAuth.js v5, JWT |
| Dashboard | `/dashboard` | Lists connected leagues |
| League connect | `/dashboard/connect` | Sleeper, Fleaflicker, ESPN; Yahoo "Coming Soon" |
| Player rankings | `/league/[id]/rankings` | Full filters, CSV export, valuation emphasis modes |
| Power rankings | `/league/[id]/summary` | Team-level value breakdown with needs/surplus analysis |
| My Team | `/league/[id]/team` | Roster by slot (START/BN/IR/TAXI), team switcher |
| Trade calculator | `/league/[id]/trade-calculator` | Draft picks, fairness verdict, market divergence, roster impact |
| League settings | `/league/[id]/settings` | Team selection, sync, valuation mode |
| Beta gate | `/beta` | Middleware-based access code (env `BETA_ACCESS_CODE`) |
| Feedback | Floating button | `FeedbackButton` component, `/api/feedback` endpoint |
| Admin diagnostics | `/admin/diagnostics` | Debug tooling |
| Consensus pipeline | `scripts/run-rankings-pipeline.sh` | KTC + FantasyCalc + DynastyProcess scrapers |

### Tech Stack
- Next.js 14 (App Router, RSC)
- Tailwind CSS v4 (no component library)
- Drizzle ORM + Neon Postgres
- NextAuth.js v5 (credentials)
- pnpm package manager

### Data Pipeline
- Pipeline NOTE: TypeScript scripts need env loaded:
  `export $(grep -v '^#' .env.local | xargs) && npx tsx scripts/<script>.ts`
- Key scripts: `run-rankings-pipeline.sh`, `recompute-all-leagues.ts`,
  `diagnose-player.ts`, `seed-sleeper-idp-stats.ts`

---

## MVP Gaps - Priority Order

### P0: Must ship (core dynasty tool features)

1. **Player Profile Pages**
   - No `/league/[id]/player/[playerId]` route exists
   - Need: stats breakdown, value trend, age curve projection,
     ownership info, trade value from all sources
   - This is table stakes for any dynasty tool

2. **Draft Pick Management UI**
   - Draft pick values are computed (`lib/trade-engine/draft-pick-values.ts`)
     and picks work in the trade calculator
   - Missing: standalone pick value browser, pick ownership viewer,
     future draft board

### P1: Should ship (competitive features)

3. **Startup vs Redraft Mode**
   - Current rankings are one-size-fits-all
   - Startups weight youth/dynasty premium much higher
   - Note: "Valuation emphasis" (Auto/Market/Balanced/League) exists
     but serves a different purpose than startup vs redraft
   - Need mode toggle on rankings page

4. **Rookie Draft Rankings**
   - Separate view filtered to rookies/incoming players
   - Important during draft season (Apr-Aug)

### P2: Nice to have (polish)

5. **Player Comparison Tool** - side-by-side multi-player stats
6. **Trade Finder** - suggest trades between league teams
7. **Projected Points Charts** - visualize player arcs

### Done (previously listed as gaps)

- ~~Draft pick trading~~ — picks fully integrated in trade calculator
- ~~Trade calc "who wins" indicator~~ — `FairnessPanel` with verdict
- ~~Roster impact analysis~~ — `RosterImpactPanel` with before/after lineups
- ~~ESPN + Yahoo adapters~~ — both fully implemented (643 and 877 lines)
- ~~Mobile responsive audit~~ — responsive padding, hidden columns, scroll wrappers

---

## Architecture Notes

### Value Engine (`lib/value-engine/`)
- `compute-values.ts` - Main pipeline: projections -> fantasy pts -> VORP -> dynasty adj -> final value
- `compute-unified.ts` - Unified value computation (consensus + league signal blend)
- `blend.ts` - Consensus blending logic
- `vorp.ts` - VORP + fantasy point calculations
- `replacement-level.ts` - Dynamic replacement level by league config
- `age-curves.ts` - Position-specific aging + dynasty premium
- `offseason-projections.ts` - Historical stats -> projected stats
- `league-signal.ts` - League-specific signal calculation
- `sigmoid.ts` - Sigmoid curve fitting for value normalization
- `team-needs.ts` - Team need/surplus/upgrade analysis
- `idp-normalization.ts` - IDP position normalization
- `aggregate.ts` - Consensus rankings from KTC/FC/DP

### Trade Engine (`lib/trade-engine/`)
- `trade-analysis.ts` - Fairness computation + market divergence
- `draft-pick-values.ts` - Draft pick valuation curves
- `optimal-lineup.ts` - Optimal lineup solver
- `roster-projection.ts` - Roster value projection over time
- `roster-efficiency.ts` - Roster efficiency metrics
- `types.ts` - Shared types for trade analysis

### Adapters (`lib/adapters/`)
- `sleeper.ts` - Full implementation
- `fleaflicker.ts` - Full implementation
- `espn.ts` - Full implementation (public + cookie-based private leagues)
- `yahoo.ts` - Full implementation (OAuth-based)

### Key Schema Tables (`lib/db/schema.ts`)
- `leagues` + `leagueSettings` - League config + structured rules
- `canonicalPlayers` - Master player DB with multi-platform IDs
- `playerValues` - Computed VORP-based values (per league)
- `aggregatedValues` - Consensus blended values (per league)
- `draftPicks` - Draft pick ownership + values
- `externalRankings` - Raw scraped rankings
- `rosters` + `teams` - League membership data
- `projections` - Player projections
- `historicalStats` - Historical stats with `gameLogs` for per-game scoring
- `userFeedback` - Beta feedback submissions

### IDP Value Engine Design Constraint

IDP dynasty values have no industry consensus. KTC, FantasyCalc, and
DynastyProcess publish **zero** IDP rankings. DynastyRanks must compute
IDP values entirely from league-specific signals (stats, projections,
league config). This is a first-class design constraint, not a fallback:

- Positions with <20% consensus coverage are "signal-primary" — their
  values come from `IDP_SIGNAL_DISCOUNT × leagueSignal` with no penalty.
- Offensive positions with >50% consensus coverage where a specific
  player has zero consensus get `NO_CONSENSUS_PENALTY` (0.55) applied —
  absence of consensus is a strong negative signal for offense.
- Future improvements: depth charts, snap counts, expert IDP opinions,
  contract data. But the engine must always work without external
  consensus as the baseline.

Do NOT re-introduce consensus-dependent assumptions for IDP positions.
The `signal_primary` valueSource exists specifically for this case.

### Scoring Design Constraint: Deterministic Per-Game Scoring

All fantasy point calculations MUST be deterministic:
- Per-game bonus thresholds are evaluated against actual per-game stats
  from the `gameLogs` column on `historicalStats`, NOT estimated from
  season averages.
- When per-game data is unavailable (projections, missing gameLogs),
  bonuses are simply not scored. Do NOT introduce probabilistic
  estimation or CV-based modeling.
- The `scoreGame()` function in `vorp.ts` is the canonical per-game
  scorer. All bonus evaluation goes through it.
- This applies to ALL platforms (Fleaflicker, Sleeper, ESPN, Yahoo).
  Platform scoring rules (from FetchLeagueRules or equivalent API)
  must drive scoring -- never hardcode multipliers.

---

## Conventions
- Server components for data fetching, client components only when needed
- All DB queries in page.tsx or server actions, never in client components
- FilterChip pattern for URL-based filter state (no client state for filters)
- Parallel Promise.all for independent DB queries
- Value engine is league-specific: every value considers scoring, roster, league size

### After any value engine change
Player values are pre-computed and stored in the database — they do NOT
recalculate on page load. After modifying any file in `lib/value-engine/`,
you **must** recompute all leagues for the changes to be reflected on the site:

```bash
export $(grep -v '^#' .env.local | xargs) && npx tsx scripts/recompute-all-leagues.ts
```
