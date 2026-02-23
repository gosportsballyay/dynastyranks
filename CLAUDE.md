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

## Current State (as of 2026-02-06)

### Working Features
| Feature | Route | Notes |
|---------|-------|-------|
| Auth (email/password) | `/login`, `/signup` | NextAuth.js v5, JWT |
| Dashboard | `/dashboard` | Lists connected leagues |
| League connect | `/dashboard/connect` | Sleeper + Fleaflicker |
| Player rankings | `/league/[id]/rankings` | Full filters, CSV export, Consensus/Stats toggle |
| Power rankings | `/league/[id]/summary` | Team-level value breakdown |
| My Team | `/league/[id]/team` | Roster by slot (START/BN/IR/TAXI) |
| Trade calculator | `/league/[id]/trade-calculator` | Side-by-side value comparison |
| League settings | `/league/[id]/settings` | Team selection, sync, config |
| Consensus pipeline | `scripts/run-rankings-pipeline.sh` | KTC + FantasyCalc + DynastyProcess scrapers |

### Data Pipeline Status
- `external_rankings`: 3,686 rows (scraped 2026-02-06)
- `aggregated_values`: 984 rows (496/league x 2 leagues)
- `player_values`: ~4,600 rows (computed stats-based values)
- `projections`: 1,509 rows
- `historical_stats`: 8,510 rows
- Pipeline NOTE: TypeScript scripts need env loaded:
  `export $(grep -v '^#' .env.local | xargs) && npx tsx scripts/<script>.ts`

### Tech Stack
- Next.js 15 (App Router, RSC)
- Tailwind CSS v4 (no component library)
- Drizzle ORM + Neon Postgres
- NextAuth.js v5 (credentials)
- pnpm package manager

---

## MVP Gaps - Priority Order

### P0: Must ship (core dynasty tool features)

1. **Draft Pick Values**
   - `draft_picks` table exists in schema but has NO UI
   - Need: pick value calculator, pick trading in trade calc
   - Dynasty Daddy's #1 used feature after trade calc
   - Files: `lib/db/schema.ts` (table exists), need new route + component

2. **Trade Calculator Improvements**
   - Current: basic side-by-side value comparison
   - Need: draft pick support in trades, "who wins" indicator,
     roster impact analysis (show team before/after)
   - File: `components/trade-calculator/trade-calculator.tsx`

3. **Player Profile Pages**
   - No `/league/[id]/player/[playerId]` route exists
   - Need: stats breakdown, value trend, age curve projection,
     ownership info, trade value from all sources
   - This is table stakes for any dynasty tool

### P1: Should ship (competitive features)

4. **ESPN + Yahoo Adapters**
   - Adapter stubs exist but throw "not implemented"
   - Sleeper + Fleaflicker only covers ~40% of dynasty market
   - Files: `lib/adapters/espn.ts`, `lib/adapters/yahoo.ts`

5. **Startup vs Redraft Mode**
   - Current rankings are one-size-fits-all
   - Startups weight youth/dynasty premium much higher
   - Need mode toggle on rankings page

6. **Rookie Draft Rankings**
   - Separate view filtered to rookies/incoming players
   - Important during draft season (Apr-Aug)

### P2: Nice to have (polish)

7. **Player Comparison Tool** - side-by-side multi-player stats
8. **Mobile Responsive Audit** - Tailwind responsive exists but untested
9. **Trade Finder** - suggest trades between league teams
10. **Projected Points Charts** - visualize player arcs

---

## Architecture Notes

### Value Engine (`lib/value-engine/`)
- `compute-values.ts` - Main pipeline: projections -> fantasy pts -> VORP -> dynasty adj -> final value
- `aggregate.ts` - Consensus rankings from KTC/FC/DP
- `vorp.ts` - VORP + fantasy point calculations
- `replacement-level.ts` - Dynamic replacement level by league config
- `age-curves.ts` - Position-specific aging + dynasty premium
- `offseason-projections.ts` - Historical stats -> projected stats

### Adapters (`lib/adapters/`)
- `sleeper.ts` - Full implementation
- `fleaflicker.ts` - Full implementation
- `espn.ts` - Stub only
- `yahoo.ts` - Stub only

### Key Schema Tables
- `leagues` + `league_settings` - League config
- `canonical_players` - Master player DB with multi-platform IDs
- `player_values` - Computed VORP-based values (per league)
- `aggregated_values` - Consensus blended values (per league)
- `draft_picks` - Draft pick ownership (exists, no UI)
- `external_rankings` - Raw scraped rankings
- `rosters` + `teams` - League membership data

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
