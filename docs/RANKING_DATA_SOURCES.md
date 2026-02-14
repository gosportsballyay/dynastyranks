# Ranking System Data Sources

This document explains how DynastyRanks generates player rankings and the data sources used at each layer.

## Overview

Rankings are computed using a layered approach:

```
Layer 3: Value (VORP × Scarcity × Dynasty Premium)
   ↑
Layer 2: Fantasy Points (from real stats or projections)
   ↑
Layer 1: Historical Stats (actual game stats)
   ↑
Layer 0: Canonical Players (player identity database)
```

## Data Sources

### Historical Stats (Primary Source)

**Source**: [nflverse](https://github.com/nflverse/nflverse-data)

Historical stats are the foundation of our ranking system. We use actual game stats to:
1. Calculate last season fantasy points (proof layer)
2. Generate offseason estimates when projections unavailable
3. Validate scoring engine correctness

**Coverage**:
- Seasons: 2020-2024
- Players: ~600 per season
- Stats: Passing, rushing, receiving, IDP (tackles, sacks, interceptions, etc.)

**Seeding**:
```bash
npx tsx scripts/seed-historical-stats.ts
npx tsx scripts/seed-historical-stats.ts --season 2024
```

### Projections (Future Seasons Only)

The `projections` table is reserved for external projection sources (e.g., FantasyPros consensus) when available. During the offseason or when projections are unavailable, the value engine generates estimates directly from historical stats:

1. Last season stats scaled to 17 games
2. Age curve adjustments
3. Career regression (for players with 3+ seasons)
4. Role security discounts (for injury-prone players)

**Key Principle**: Use real stats when available, only project what we don't know yet.

## Data Source Labels

Each player value is tagged with a `dataSource` field:

| Value | Meaning |
|-------|---------|
| `projections` | Using seeded projection data |
| `offseason_estimate` | Generated from historical stats + age curves |
| `last_season_only` | Flat position-based estimate (no individual data) |

## Value Computation Pipeline

### 1. Last Season Points Calculation

Before computing projections, we calculate fantasy points from actual last-season stats:
- Uses league-specific scoring rules
- Includes bonuses, PPR, position overrides
- Results stored in `lastSeasonPoints`, `lastSeasonRankOverall`, `lastSeasonRankPosition`

### 2. Projection Coverage Check

```typescript
const PROJECTION_COVERAGE_THRESHOLD = 0.70; // 70%

// Get top 300 players by last season performance
// Check what % have projection data
// If < 70%, switch to offseason estimate mode
```

### 3. Fantasy Points Calculation

For each player:
1. If projections available and coverage sufficient → use projections
2. Else if historical stats available → generate offseason estimate
3. Else → use flat position-based fallback (rare)

### 4. VORP Calculation

Value Over Replacement Player:
- Replacement level = Nth best player (based on roster slots × teams)
- VORP = Player Points - Replacement Points
- Normalized by positional demand

### 5. Final Value

```
Value = Normalized VORP × Scarcity Multiplier × Dynasty Premium × 100
```

## Sorting Modes

Rankings support three sort modes:

| Mode | Description | Default For |
|------|-------------|-------------|
| `value` | VORP-based dynasty value | Overall rankings |
| `projected` | Projected fantasy points | Position-specific views |
| `last_season` | Actual last season points | Validation/proof |

## Data Health Monitoring

Run the health check to validate data pipeline:

```bash
npx tsx scripts/data-health.ts
npx tsx scripts/data-health.ts --league <league-id>
```

Checks:
- Historical stats coverage by season and position
- Projections coverage
- VORP distribution (std dev should be > 5)
- Last season data population

## Warning Banners

The rankings page displays warnings when data quality is suboptimal:

1. **Yellow Banner** (Offseason Mode):
   > "Using offseason estimates. Only X% of players have projection data."

2. **Orange Banner** (Flat Estimates):
   > "X players using generic position estimates (no historical data)."

## Refreshing Data

To refresh data for a new season:

```bash
# 1. Seed historical stats (run after season ends)
npx tsx scripts/seed-historical-stats.ts --season 2024

# 2. Verify health
npx tsx scripts/data-health.ts

# 3. Recompute league values (happens automatically on rankings page visit)
```

## Architecture Notes

### Why Layered Approach?

1. **Proof Layer**: Historical stats prove scoring engine works correctly
2. **Separation of Concerns**: Projections can come from multiple sources
3. **Graceful Degradation**: System works even without projections
4. **Transparency**: Users see data source for each player

### League-Specific Scoring

All calculations use league-specific settings:
- PPR/half-PPR values
- Position-specific bonuses
- Custom scoring rules (points per rush attempt, etc.)
- IDP scoring variations

This ensures rankings are tailored to each league's unique configuration.
