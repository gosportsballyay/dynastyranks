# MyDynastyValues - Project Brief

## Vision
A **lighter dynasty-daddy.com clone** with first-class IDP support and
league-specific roster/size considerations baked into every value calculation.
Not a stats playground - a tool dynasty managers actually use on trade day.

## IMPORTANT: Stop scope-creeping. Ship the MVP.
The value engine and ranking pipeline are DONE. Do NOT spend more time tweaking
stats, adding data sources, or polishing the ranking algorithm unless a user
reports a concrete bug. Focus exclusively on the MVP feature gaps below.

---

## Current State (as of 2026-03-11)

### Quick Start
```bash
pnpm dev          # Start dev server (Next.js)
pnpm build        # Production build
pnpm lint         # ESLint
pnpm test         # Vitest (run once)
pnpm test:watch   # Vitest (watch mode)
pnpm db:studio    # Drizzle Studio (DB browser)
pnpm db:push      # Push schema changes to DB
```

### Working Features
| Feature | Route | Notes |
|---------|-------|-------|
| Auth (email/password) | `/login`, `/signup` | NextAuth.js v5, JWT |
| Forgot/reset password | `/forgot-password`, `/reset-password` | Email-based reset flow |
| Dashboard | `/dashboard` | Lists connected leagues |
| League connect | `/dashboard/connect` | Sleeper, Fleaflicker, ESPN, Yahoo, MFL |
| Player rankings | `/league/[id]/rankings` | Full filters, CSV export, valuation emphasis modes |
| Power rankings | `/league/[id]/summary` | Team-level value breakdown with needs/surplus analysis |
| My Team | `/league/[id]/team` | Roster by slot (START/BN/IR/TAXI), team switcher |
| Trade calculator | `/league/[id]/trade-calculator` | Draft picks, fairness verdict, market divergence, roster impact |
| League settings | `/league/[id]/settings` | Team selection, sync, valuation mode |
| IDP Trends | `/idp-trends` | Sleeper ecosystem IDP data explorer |
| Beta gate | `/beta` | Middleware-based access code (env `BETA_ACCESS_CODE`) |
| Feedback | Floating button | `FeedbackButton` component, `/api/feedback` endpoint |
| Admin diagnostics | `/admin/diagnostics` | Debug tooling |
| Admin dashboard | `/admin` | User listing, feedback overview, signup stats |
| How It Works | `/how-it-works` | Value pipeline explanation + methodology |
| Legal pages | `/terms`, `/privacy` | Accessible without beta cookie |
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
- `IDPShow Dynasty Data 022326.csv` — Raw IDP player data export
  (Feb 2023). Potential future input for IDP rankings enrichment.
  Not currently consumed by the pipeline.

---

## MVP Gaps - Priority Order

### P0: Must ship (core dynasty tool features)

1. **Player Profile Pages**
   - No `/league/[id]/player/[playerId]` route exists
   - Active worktree: `.worktrees/player-dropdown/` (branch `feature/player-dropdown-redesign`)
   - Plan doc: `docs/plans/2026-02-23-player-dropdown-redesign.md` (horizontal bands layout)
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

5. **Admin Dashboard** (partially done)
   - ~~User listing~~ done at `/admin`
   - Signup notifications (email or in-app alert when new user registers)
   - Basic user management (delete account, reset data)
6. **Player Comparison Tool** - side-by-side multi-player stats
7. **Trade Finder** - suggest trades between league teams
8. **Projected Points Charts** - visualize player arcs

### Infrastructure (shipped)
- Sentry error tracking, Vercel Analytics + Speed Insights
- Security headers, OpenGraph/Twitter meta, `robots.txt` + `sitemap.xml`
- Beta disclaimer banner, help tooltips on key features

---

## Architecture Notes

### Value Engine (`lib/value-engine/`)
- `index.ts` - Barrel exports
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
- `effective-baseline.ts` - Blends starter/waiver baselines per position
- `position-normalization.ts` - Resolves defensive positions **per league** (see below)
- `compute-last-season.ts` - Historical fantasy points using league scoring rules
- `format-complexity.ts` - League config complexity (0-1) for blend weights

### Trade Engine (`lib/trade-engine/`)
- `trade-analysis.ts` - Fairness computation + market divergence
- `draft-pick-values.ts` - Draft pick valuation curves
- `optimal-lineup.ts` - Optimal lineup solver
- `roster-projection.ts` - Roster value projection over time
- `roster-efficiency.ts` - Roster efficiency metrics
- `types.ts` - Shared types for trade analysis
- `market-divergence.ts` - League-consensus divergence detection

### Adapters (`lib/adapters/`)
- `base.ts` - Base adapter interface/types
- `index.ts` - Adapter factory/registry
- `sleeper.ts` - Full implementation
- `fleaflicker.ts` - Full implementation
- `espn.ts` - Full implementation (public + cookie-based private leagues)
- `yahoo.ts` - Full implementation (OAuth-based)
- `mfl.ts` - Full implementation (API key for private, public access)

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

### IDP Position Resolution — Per-League, Not Global

**Full reference: `docs/IDP_POSITION_REFERENCE.md`**

The engine does NOT globally consolidate IDP positions to 3 groups.
Each platform uses different position taxonomies:

| Platform | IDP Positions | Per-Position Scoring? |
|----------|--------------|----------------------|
| Sleeper | DL, LB, DB (consolidated) | No |
| Fleaflicker | EDR, IL, LB, CB, S (granular) | Yes (`applyTo`) |
| ESPN | DE, DT, LB, CB, S / DL, DB | Yes (`pointsOverrides`) |
| Yahoo | DE, DT, LB, CB, S / DL, DB | No |
| MFL | DE, DT, LB, CB, S (granular natively) | Yes (per-position rules) |

`resolveDefensivePosition()` in `position-normalization.ts` resolves
each player's position based on the league's actual roster slots:
- League has `DB` slot → CB/S players resolve to `DB`
- League has `CB` + `S` slots → players keep granular positions
- Same player can be `DL` in a Sleeper league and `EDR` in a
  Fleaflicker league — this is correct behavior

The `IDP_POSITION_GROUPS` mapping in `aggregate.ts` (cb/s→db,
edr/il/de/dt→dl) is ONLY for cross-source consensus matching.
It does NOT affect per-league value calculations.

Cross-taxonomy sibling resolution in `position-normalization.ts`:
EDR↔DE, IL↔DT. MFL uses DE/DT natively; canonical DB stores EDR/IL
(from DynastyProcess). The resolver maps between taxonomies per league.

Position resolution MUST happen before scoring override lookup in
`compute-unified.ts`. Overrides keyed to "DE" won't match canonical
"EDR" unless the player's position is resolved first.

Do NOT assume all leagues use 3 IDP groups. Do NOT force-consolidate
positions at data ingestion time. Always preserve the most granular
position available and let the per-league resolver handle it.

### IDP Value Engine Design Constraint

IDP dynasty values have no industry consensus. KTC, FantasyCalc, and
DynastyProcess publish **zero** IDP rankings. MyDynastyValues must compute
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
- If an approach hits 2+ unexpected blockers, stop and re-plan rather than pushing through

### Pre-Commit Verification
**MANDATORY: Before offering to commit, verify the dev site loads correctly.**
Next.js `.next` cache frequently corrupts during code editing (HMR chunk
errors, white/unstyled pages, 500 on CSS/JS assets). Fix: kill dev server,
`rm -rf .next`, restart `pnpm dev`. Always confirm the site renders with
the correct dark theme before committing.

### Deployment: Data Must Be Seamless for Users

Users should NEVER need to manually re-sync or take any action after a
deploy. If a code change affects stored data (values, picks, rosters),
the deploy process must include a server-side script to update that
data. Users seeing stale/broken data after a deploy will lose trust.

**MANDATORY: Claude MUST run the appropriate resync/recompute scripts
automatically after making changes to these directories. Do not ask
the user — just run them. The only exception is if you need the user
to provide secrets or credentials.**

**After any value engine change** (`lib/value-engine/`):
```bash
export $(grep -v '^#' .env.local | xargs) && npx tsx scripts/recompute-all-leagues.ts
```

**After any adapter change** (`lib/adapters/`) that affects roster data
or slot positions:
```bash
export $(grep -v '^#' .env.local | xargs) && npx tsx scripts/resync-all-rosters.ts [--provider sleeper]
```

**After any adapter change** (`lib/adapters/`) that affects draft pick
data:
```bash
export $(grep -v '^#' .env.local | xargs) && npx tsx scripts/resync-draft-picks.ts [--provider sleeper]
```

**Rule:** Every PR that changes adapter or value engine code MUST
include the post-deploy resync/recompute command in the PR description.
Claude must run these scripts as part of the implementation, not just
mention them.
