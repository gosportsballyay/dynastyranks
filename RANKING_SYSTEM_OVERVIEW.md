# MyDynastyValues - Value Engine Specification

Engine version: `1.2.0`

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DATA SOURCES                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  1. Historical Stats (nflverse PBP)  →  historical_stats table              │
│  2. IDP Stats (Sleeper API)          →  merged into historical_stats        │
│  3. Projections (future seasons)     →  projections table                   │
│  4. External Rankings (KTC/FC/DP)    →  external_rankings table             │
│  5. League Settings (per adapter)    →  league_settings table               │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
┌──────────────────────────────┐   ┌──────────────────────────────┐
│   VORP VALUE ENGINE          │   │   CONSENSUS AGGREGATION      │
│   compute-values.ts          │   │   aggregate.ts               │
├──────────────────────────────┤   ├──────────────────────────────┤
│  1. Select data source       │   │  1. Fetch external rankings  │
│  2. Calculate fantasy points │   │  2. Group by player          │
│  3. Calculate VORP           │   │  3. Weighted average         │
│  4. Apply dynasty premium    │   │  4. Normalize & rank         │
│  5. Apply scarcity mult.     │   │                              │
│  6. Final value & rank       │   │                              │
└──────────────────────────────┘   └──────────────────────────────┘
          │                                    │
          ▼                                    ▼
   player_values table               aggregated_values table
```

The two pipelines run independently. The UI lets users toggle between
"Stats" (VORP engine) and "Consensus" (aggregation engine) views.

---

## 1. Fantasy Points

```
fantasyPoints = Σ(statValue × scoringRule)
```

**Position overrides** replace the general rule for a stat when present:

```
points -= statValue × generalRule
points += statValue × overrideRule
```

**Bonus thresholds** add per-game milestone bonuses using probability
estimation. For each threshold `{min, max?, bonus}` on a stat:

1. Compute `perGameAvg = seasonTotal / gamesPlayed`
2. If `perGameAvg < min × 0.7` → 0 bonus games
3. Otherwise estimate games hitting threshold via normal approximation:
   - `cv = 0.3` (coefficient of variation)
   - `stdDev = perGameAvg × cv`
   - `zScore = (min - perGameAvg) / stdDev`
   - `P(exceeds min) = 1 - normalCDF(zScore)`
   - If `max` defined: `P(in range) = normalCDF(zMax) - normalCDF(zMin)`
   - `bonusPoints += bonus × P × gamesPlayed`

---

## 2. Data Source Priority

The engine selects one data source per player in this order:

| Priority | Source | Condition | Label |
|----------|--------|-----------|-------|
| P1 | Target season actuals | `historical_stats` row exists for target season | `last_season_actual` |
| P2 | Official projections | `projections` row exists AND not in offseason mode | `projections` |
| P3 | Offseason estimate | Prior-season historical stats exist, passes gating | `offseason_estimate` |
| P4 | Skip | No data available or gated out | (player excluded) |

**Target season detection** (calendar-based, universal across leagues):
- January-August: `targetSeason = currentYear - 1` (most recent completed season)
- September-December: `targetSeason = currentYear` (in-season)

**Offseason mode triggers** when:
- `shouldUseOffseasonProjections()` returns true (target season is future or current year before July), OR
- Projection coverage is below 70% of top 300 players by last-season performance

When using P1 (actuals), stats are passed directly to fantasy points
calculation with no scaling or age adjustment.

---

## 3. Offseason Estimation (P3 path)

### Gating rules

Before generating an estimate, each player passes through
`shouldGenerateEstimate()`:

| Gate | Condition | Result |
|------|-----------|--------|
| Stale data | `targetSeason - mostRecentSeason > 2` | Exclude |
| Rookie | `yearsExperience === 0` | Exclude |
| FA Tier A | Free agent, but 8+ games or meets snap threshold (offense: 200, IDP: 400) | Generate at 50% discount |
| FA Tier B | Free agent, below thresholds | Exclude |
| Low production | Signed, below thresholds | Generate at 80% discount |
| Valid | Signed, meets thresholds | Generate at 100% |

Snap threshold is estimated as `gamesPlayed × snapsPerGame` (50 offense, 40 IDP).

### Estimation pipeline

1. **Filter** historical stats to prior seasons only (`season < targetSeason`)
2. **Sort** by season descending, take most recent
3. **17-game scaling**: if `gamesPlayed < 17`, scale all counting stats by `17 / gamesPlayed` (skip rate/pct stats)
4. **Age curve adjustment**: multiply all stats by `getAgeCurveMultiplier(position, age + 1)`
5. **Career regression** (if 2+ prior seasons available):
   - Weight seasons: `seasonAge 0 → 1.0`, `seasonAge 1 → 0.5`, older → 0
   - Compute weighted average stats
   - Blend: `projectedStat = recentScaled × 0.6 + weightedAvg × 0.4`
6. **Role security discount**: if `gamesPlayed < 12`, multiply all stats by `0.9`
7. Calculate fantasy points from projected stats
8. Apply FA discount from gating (`× 0.5` or `× 0.8` if applicable)
9. **Clamp** to position bounds (e.g., RB max 450, QB max 500)

---

## 4. VORP

```
rawVorp = max(0, playerPoints - replacementPoints)
```

`replacementPoints` = the fantasy points of the player ranked at the
replacement level threshold for that position.

**Normalization:**

```
starterDemand = directStarters + flexDemand  (see §5)
normalizedVorp = rawVorp / max(1, sqrt(starterDemand))
```

Division by `sqrt(starterDemand)` makes VORP comparable across positions
with different pool sizes.

---

## 5. Replacement Level

```
replacementRank = round(directStarters + flexDemand + benchFactor)
```

Minimum: 1.

**Direct starters:**
```
directStarters = rosterSlots[position] × totalTeams
```

If position mappings exist (e.g., `DL → [EDR, IL]`), consolidated slot
demand is split evenly: `+= consolidatedSlots / numGranularPositions`.

**Flex demand:**

For each flex rule where position is eligible:
```
flexSlots = rosterSlots[flexSlot] × totalTeams
flexDemand += flexSlots × usageWeight
```

Flex usage weights:

| Flex Slot | QB | RB | WR | TE | LB | DL | DB | EDR | IL | CB | S |
|-----------|----|----|----|----|----|----|----|----|----|----|---|
| FLEX | — | 0.40 | 0.40 | 0.20 | — | — | — | — | — | — | — |
| SUPERFLEX | 0.80 | 0.08 | 0.08 | 0.04 | — | — | — | — | — | — | — |
| IDP_FLEX | — | — | — | — | 0.50 | 0.25 | 0.25 | 0.15 | 0.10 | 0.12 | 0.13 |

If a position has no explicit weight, falls back to `1 / numEligible`.

**Bench factor:**
```
benchFactor = (benchSlots / totalTeams) × benchWeight[position]
```

Bench weights:

| Position | QB | RB | WR | TE | K | DST | DL | LB | DB | EDR | IL | CB | S |
|----------|----|----|----|----|---|-----|----|----|----|----|----|----|---|
| Weight | 0.5 | 1.0 | 1.0 | 0.7 | 0.1 | 0.3 | 0.6 | 0.8 | 0.6 | 0.5 | 0.4 | 0.5 | 0.5 |

---

## 6. Scarcity Multiplier

```
scarcity = 1 + (0.3 × depthFactor × tierFactor)
```

Range: 1.0 to ~1.5.

**Depth factors** (higher = scarcer):

| Position | QB | RB | WR | TE | K | LB | DL | DB | EDR | IL | CB | S |
|----------|----|----|----|----|---|----|----|----|----|----|----|---|
| Factor | 0.8 | 1.1 | 0.9 | 1.3 | 0.5 | 0.9 | 1.0 | 0.9 | 1.2 | 1.0 | 0.95 | 0.95 |

**Tier factor** (based on rank within position):

```
eliteThreshold = max(1, starterDemand × 0.25)
starterThreshold = max(1, starterDemand)

if rank <= eliteThreshold:       tierFactor = 1.0
elif rank <= starterThreshold:   tierFactor = 1 - (rank - elite) / (starter - elite)
else:                            tierFactor = 0
```

---

## 7. Age Curves

### Peak ages

| Position | QB | RB | WR | TE | K | LB | DL/EDR/IL | DB/CB | S |
|----------|----|----|----|----|---|----|----|----|----|
| Peak start | 28 | 24 | 24 | 26 | 25 | 25 | 25 | 25 | 25 |
| Peak end | 33 | 27 | 28 | 29 | 38 | 30 | 29 | 30 | 31 |

### Age curve multiplier

`getAgeCurveMultiplier(position, age)` returns:

- **In peak range**: `1.0`
- **Before peak**: `min(1.1, (1 - improvementRate)^yearsToGo × youthPremium)`
  - `youthPremium = 1.05` for RB, `1.0` otherwise
- **After peak**: `max(0.4, (1 - declineRate)^yearsPastPeak)`
  - **RB cliff** (age > 28): additional `0.85^(age - 28)` penalty, floor 0.3

### Decline / improvement rates

| Position | QB | RB | WR | TE | K | LB | DL/EDR | DB/CB | IL | S |
|----------|----|----|----|----|---|----|----|----|----|---|
| Decline | 0.025 | 0.10 | 0.04 | 0.05 | 0.02 | 0.05 | 0.06 | 0.04 | 0.05 | 0.04 |
| Improve | 0.08 | 0.06 | 0.07 | 0.08 | 0.02 | 0.04 | 0.04 | 0.04/0.05 | 0.04 | 0.04 |

---

## 8. Dynasty Premium

`getDynastyPremium(position, age, yearsExperience, draftRound)` returns a
multiplier in `[0.5, 1.4]`.

```
premium = 1.0
premium *= ageCurveMultiplier(position, age)
```

**Rookie/sophomore boost** (yearsExperience <= 2):
- Draft capital bonus: `+= max(0, (8 - draftRound) / 20)`
  - 1st round: +0.35, 2nd: +0.30, ..., 7th: +0.05
- RB age <= 24: `× 1.12`
- WR/TE in year 2: `× 1.08`

**Years 3-4 boost:**
- WR: `× 1.05`
- TE: `× 1.06`

Result clamped to `[0.5, 1.4]`.

---

## 9. Final Value

```
value = normalizedVorp × scarcityMultiplier × dynastyPremium × 100
```

Players are ranked by `value` descending. Tiers are assigned as
`tier = ceil(rank / 12)`.

---

## 10. Consensus Aggregation

A separate pipeline (`aggregate.ts`) computes `aggregated_values` from
external dynasty ranking sources.

### Source weights

**Offense** (QB, RB, WR, TE):

| Source | Weight |
|--------|--------|
| KTC (KeepTradeCut) | 0.40 |
| FantasyCalc | 0.35 |
| DynastyProcess | 0.25 |

**IDP** (LB, DL, DB, EDR, IL, CB, S, DE, DT):

| Source | Weight |
|--------|--------|
| KTC | 0.20 |
| FantasyCalc | 0.20 |
| DynastyProcess | 0.10 |
| IDP stats model | 0.50 |

### Aggregation method

1. Fetch `external_rankings` rows matching league context (SuperFlex, TE Premium, season)
2. Group by player (normalized name + position key)
3. For each player:
   - `weightedSum += sourceValue × sourceWeight` (only for sources with data)
   - `totalWeight += sourceWeight`
   - `aggregatedValue = round(weightedSum / totalWeight)`
4. All values normalized to 0-10000 scale
5. Assign overall rank and position rank by aggregated value descending

Missing sources are excluded and remaining weights are renormalized.

---

## 11. Known Limitations

1. **IDP stats model weight is unimplemented.** The IDP weights allocate
   50% to `idpModel`, but `player.idpValue` is never populated (always
   `null`). IDP consensus values rely entirely on the renormalized
   KTC/FC/DP weights when those sources have IDP data.

2. **Rookies get 0 from the VORP engine.** The estimator gate excludes
   `yearsExperience === 0`, and rookies rarely have target-season actuals
   or projections. They only appear in consensus rankings.

3. **Consensus and VORP pipelines are disconnected.** `player_values`
   (VORP) and `aggregated_values` (consensus) are computed and stored
   independently. There is no unified value that blends both.

4. **Position bounds are hard-coded.** The plausibility clamp values
   (e.g., RB max 450) are not derived from league scoring settings.

5. **Offseason projection function in `offseason-projections.ts` is not
   called.** The main engine in `compute-values.ts` implements its own
   inline offseason estimation logic. The standalone
   `generateOffseasonProjection()` function exists but is unused by the
   main pipeline.

---

## 12. Position Bounds (plausibility clamp)

| Position | Min | Max |
|----------|-----|-----|
| QB | 50 | 500 |
| RB | 20 | 450 |
| WR | 20 | 450 |
| TE | 15 | 350 |
| LB | 30 | 350 |
| EDR | 25 | 350 |
| CB | 20 | 300 |
| S | 25 | 300 |
| IL | 20 | 250 |
| DB | 20 | 300 |

---

## 13. File Reference

| File | Purpose |
|------|---------|
| `lib/value-engine/compute-values.ts` | Main VORP value computation pipeline |
| `lib/value-engine/vorp.ts` | VORP calculation, fantasy points, scarcity multiplier |
| `lib/value-engine/age-curves.ts` | Age curves, dynasty premium, productive years |
| `lib/value-engine/replacement-level.ts` | Replacement level, starter demand, flex weights |
| `lib/value-engine/offseason-projections.ts` | Standalone offseason projection (unused by main pipeline) |
| `lib/value-engine/compute-last-season.ts` | Last-season points, target season detection |
| `lib/value-engine/aggregate.ts` | Consensus aggregation from KTC/FC/DP |
| `scripts/seed-historical-stats.ts` | Seeds historical stats from nflverse |
| `scripts/seed-sleeper-idp-stats.ts` | Seeds IDP stats from Sleeper API |
| `scripts/scoring-audit.ts` | Validates scoring calculations |
| `scripts/explain-player-points.ts` | Shows full point breakdown for a player |
| `scripts/data-health.ts` | Checks data quality |
| `scripts/run-rankings-pipeline.sh` | Runs full consensus scrape + aggregation |
