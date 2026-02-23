# Platform Stats Fetching Design

## Problem

2025 IDP stats are missing from the database. nflverse hasn't published
`player_stats_def_2025.csv`, and a re-seed attempt deleted the existing
1,494 IDP players. Additionally, nflverse PBP-aggregated stats produce
different tackle counts than official NFL box score stats used by
Fleaflicker and Sleeper, causing 10-30 pt scoring discrepancies.

## Key Finding: Fleaflicker API Limitation

Fleaflicker's `FetchRoster` and `FetchPlayerListing` endpoints only
return **4 display stat columns** per position group:

| Position Group | Display Stats |
|---------------|---------------|
| QB | Completion %, Pass Yds, Pass TDs, INTs |
| RB/WR/TE | Rush/Rec Yds, Target % Caught, Rec Yds, TDs |
| IDP (LB/DL/DB) | Assisted Tackles, Solo Tackles, INTs, Sacks |

The `viewingActualPoints` value is accurate (includes all scoring
categories) but individual stats like tackle-for-loss, forced fumbles,
pass deflections, QB hits, etc. are not returned. This makes it
impossible to reconstruct individual stat lines from the Fleaflicker
API alone.

## Solution: Sleeper Weekly Stats as Canonical Source

Sleeper's public API at `/stats/nfl/regular/{season}/{week}` returns
**complete per-game stat breakdowns for all 2,300+ NFL players**,
including full IDP stats:

- `idp_tkl`, `idp_tkl_solo`, `idp_tkl_ast`, `idp_tkl_loss`
- `idp_sack`, `idp_qb_hit`, `idp_ff`, `idp_fum_rec`
- `idp_pass_def`, `idp_int`, `idp_td`, `idp_safe`, `idp_blk_kick`
- Plus all offense stats: `pass_yd`, `rush_yd`, `rec_yd`, etc.

These are **official NFL stats** (same data feed Fleaflicker and other
platforms consume). Using Sleeper stats with each league's own scoring
rules should produce accurate fantasy point calculations.

## Architecture

### Data Flow

```
Sleeper API (/stats/nfl/regular/{season}/{week})
    ↓
seed-sleeper-stats.ts (expanded from seed-sleeper-idp-stats.ts)
    ↓
historical_stats table (stats + gameLogs columns)
    ↓
compute-unified.ts → calculateFantasyPoints(gameLogs, structuredRules)
    ↓
player_values table (accurate per-game scoring)
```

### Script Changes

**`scripts/seed-sleeper-idp-stats.ts`** (rename to reflect expanded scope)

Current behavior:
- Fetches weekly IDP stats only (15 stat keys)
- Aggregates to season totals
- Merges IDP stats into existing nflverse rows
- Discards per-week breakdowns

New behavior:
- Fetches ALL stats (offense + IDP, ~30 stat keys)
- Stores per-week breakdowns in `gameLogs` column
- Aggregates to season totals in `stats` column
- Merges with existing nflverse rows (overwrite stats + add gameLogs)
- Player matching via sleeperId (primary) and gsis_id (fallback)

### Stat Key Mapping

Offense keys (existing canonical mapping in Sleeper adapter):

| Sleeper Key | Canonical Key |
|------------|---------------|
| pass_yd | pass_yd |
| pass_td | pass_td |
| pass_att | pass_att |
| pass_cmp | pass_cmp |
| pass_int | int |
| pass_2pt | pass_2pt |
| rush_yd | rush_yd |
| rush_td | rush_td |
| rush_att | rush_att |
| rush_2pt | rush_2pt |
| rec | rec |
| rec_yd | rec_yd |
| rec_td | rec_td |
| rec_tgt | rec_tgt |
| rec_2pt | rec_2pt |
| fum_lost | fum_lost |
| fum | fum |

IDP keys (existing in SLEEPER_TO_OUR_KEYS):

| Sleeper Key | Canonical Key |
|------------|---------------|
| idp_tkl | tackle |
| idp_tkl_solo | tackle_solo |
| idp_tkl_ast | tackle_assist |
| idp_sack | sack |
| idp_qb_hit | qb_hit |
| idp_tkl_loss | tackle_loss |
| idp_ff | fum_force |
| idp_fum_rec | fum_rec |
| idp_pass_def | pass_def |
| idp_int | def_int |
| idp_int_yd | def_int_yd |
| idp_td | def_td |
| idp_safe | safety |
| idp_blk_kick | blk_kick |

Kicking keys (new):

| Sleeper Key | Canonical Key |
|------------|---------------|
| fgm | fg |
| fgm_0_19 | fg_0_19 |
| fgm_20_29 | fg_20_29 |
| fgm_30_39 | fg_30_39 |
| fgm_40_49 | fg_40_49 |
| fgm_50_59 | fg_50_59 |
| fgm_60p | fg_60_plus |
| fgmiss | fg_miss |
| xpm | xp |
| xpmiss | xp_miss |

### Merge Strategy

For each player-season:
1. Check if nflverse row exists in `historical_stats`
2. If exists: **overwrite** `stats` and `gamesPlayed` with Sleeper data,
   add `gameLogs` — Sleeper stats are more accurate than PBP-aggregated
3. If not exists: insert new row with source="sleeper"

This replaces the old merge approach (IDP stats only). Since Sleeper
provides complete offense + defense stats, there's no need to preserve
partial nflverse data.

### Validation

Create `scripts/validate-fleaflicker-points.ts` that:
1. For each Fleaflicker league, for each rostered player
2. Fetches `viewingActualPoints` per week from FetchRoster
3. Compares against our `scoreGame(gameLogs[week], structuredRules)`
4. Reports discrepancies > 0.5 pts

This validates that Sleeper stats + Fleaflicker rules produce
accurate results without requiring Fleaflicker's limited stat data.

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Sleeper stats differ from Fleaflicker's source | Low | Both use official NFL data feed. Validate with comparison script. |
| Sleeper API rate limits | Low | 100ms delay between requests, 18 calls per season. Well within limits. |
| Missing players in Sleeper data | Low | 2,312 players per week. All NFL active players included. |
| nflverse offense stats overwritten | Acceptable | Sleeper offense stats are more accurate (official vs PBP-aggregated). |
| Future seasons | None | Same script works for any season. Run weekly during the NFL season. |

## Non-Goals

- Fleaflicker-specific stats fetching (API too limited)
- ESPN/Yahoo stats fetching (not needed yet, same Sleeper source works)
- Changing the value engine or scoring layer
- Modifying projection logic
