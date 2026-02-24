# Player Dropdown Redesign

## Goal

Replace the current expanded row in the rankings table (and add to team
roster view) with a cleaner, more informative player detail panel. Show
trade-relevant info at a glance without algorithm internals.

## Layout: Horizontal Bands

```
┌──────────────────────────────────────────────────────────────────────────┐
│  #1  Bijan Robinson    RB1   ATL   23   468.6  9564.0  +239.6  T1  Own │  ← existing row
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  🟡 Questionable · Rd 1, #8 (2023) · 3rd season · Ascending ↑ · ~6 yrs  │  ← bio band
│                                                                          │
│  ┌─ SEASON HISTORY ──────────────────┐  ┌─ VALUE ──────────────────────┐ │
│  │  Season    Pts    GP    PPG       │  │  Overall        #1           │ │
│  │  2025    468.6    17   27.6       │  │  Position       RB1          │ │
│  │  2024    412.3    15   27.5       │  │  VORP           +239.6       │ │
│  │  2023    320.1    14   22.9       │  │  Projected Pts  443.0        │ │
│  │  ────────────────────────────     │  │  Consensus      9800         │ │
│  │  2026p   443.0                    │  │  League Value   9564         │ │
│  └───────────────────────────────────┘  └──────────────────────────────┘ │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Bio Band (single row of inline badges)

- **Injury status** — colored dot + text, only shown if not healthy
  - Red: "Out", "IR", "Out for Season"
  - Yellow: "Questionable", "Day-to-Day"
  - Hidden when null/healthy
- **Draft capital** — "Rd 1, #8 (2023)" or "UDFA (2019)"
  - Derived from `canonicalPlayers.draftRound`, `draftPick`, `rookieYear`
- **Experience** — "3rd season" from `yearsExperience`
- **Age phase** — "Ascending ↑" / "Prime ●" / "Declining ↓"
  - From `age-curves.ts::getAgeTier(position, age)`
  - Green for ascending, blue for prime, amber for declining
- **Window** — "~6 yrs left" from `getExpectedProductiveYears()`

### Season History (left panel)

- Last 3 seasons from `historicalStats` table
- Each line: season year, total fantasy points, games played, per-game avg
- Points scored using league's scoring rules (via `scoreGame()`)
- Separator, then projected season below in muted style
- Projected points from `playerValues.projectedPoints`

### Value Panel (right panel)

- Overall rank (#N)
- Position rank (POS + N)
- VORP (+N.N)
- Projected points for upcoming season
- Consensus value — single blended number from `aggregatedValues.aggregatedValue`
- League value — from `playerValues.value`

### What's Removed (vs current dropdown)

- Value Source label
- Scarcity Multiplier
- Age Curve Multiplier
- Replacement Level points
- Consensus vs League Signal % breakdown
- Individual source values (KTC, FC, DP shown separately)
- Low Confidence badge
- Eligibility Position

### Mobile Behavior

- Bio band wraps naturally (inline badges)
- Two panels stack vertically (grid-cols-1 on mobile, grid-cols-2 on sm+)

## Surfaces

1. **Rankings table** — `components/rankings/rankings-table.tsx` (`ValueBreakdown`)
2. **Team roster view** — `components/team/team-roster-view.tsx` (add expandable rows)

## Data Requirements

**Already available in rankings page queries:**
- All `playerValues` fields (ranks, VORP, projected points, consensus values)
- All `canonicalPlayers` fields (age, team, position)

**New data needed:**
- `historicalStats` (last 3 seasons) — not currently fetched on rankings page
- `canonicalPlayers` bio fields: `draftRound`, `draftPick`, `rookieYear`,
  `yearsExperience`, `injuryStatus` — exist in schema but may not be in
  current rankings query
- `aggregatedValues.aggregatedValue` for consensus number

**Approach:** Fetch historical stats via server action on row expand (lazy
load), or preload top ~50 players. Bio fields can be added to existing
rankings query join.

## Age Tier Logic (from age-curves.ts)

| Phase | Criteria | Display |
|-------|----------|---------|
| Ascending | Below peak age for position | Green "Ascending ↑" |
| Prime | Within peak window | Blue "Prime ●" |
| Declining | Past peak, before cliff | Amber "Declining ↓" |
| Aging | Well past peak / post-cliff | Red "Aging ↓↓" |

Peak ages by position: QB 28-33, RB 24-27, WR 25-29, TE 26-30,
IDP varies by position.
