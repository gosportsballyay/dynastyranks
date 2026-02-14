# DynastyRanks Value System - Diagnostic Report

## Executive Summary

**THE PROBLEM:** Values and VORP are not working because the `projections` table is EMPTY. Without real projections, every player at the same position gets identical "estimated stats," making the rankings meaningless.

---

## How The Ranking System Works

### Pipeline Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Projections    │────▶│  Fantasy Points  │────▶│     VORP        │
│  (per player)   │     │  (per scoring)   │     │  (vs replacement)│
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                         │
                                                         ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Final Value   │◀────│  Dynasty Premium │◀────│    Scarcity     │
│  (normalized)   │     │  (age curves)    │     │  (positional)   │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

### Step 1: Get Projections

**File:** `lib/value-engine/compute-values.ts` (lines 99-161)

The system looks for projections in this order:
1. Check if "offseason mode" (Jan-June) → use offseason projection model
2. Query `projections` table for each player
3. **FALLBACK: Use generic "estimated stats"** ← THIS IS THE PROBLEM

**Current Estimated Stats (same for ALL players at position):**
```typescript
QB: { pass_yd: 3800, pass_td: 24, int: 10, rush_yd: 150, rush_td: 2 }
RB: { rush_yd: 800, rush_td: 6, rec: 35, rec_yd: 280, rec_td: 1 }
WR: { rec: 70, rec_yd: 900, rec_td: 5, rush_yd: 20 }
TE: { rec: 50, rec_yd: 550, rec_td: 4 }
```

**Result:** Patrick Mahomes and a random backup QB get the SAME projected fantasy points.

### Step 2: Calculate Fantasy Points

**File:** `lib/value-engine/vorp.ts` (lines 159-184)

```
Fantasy Points = Σ (projected_stat × scoring_rule)
```

Example for PPR league:
```
WR Points = (70 rec × 1 PPR) + (900 rec_yd × 0.1) + (5 rec_td × 6) = 70 + 90 + 30 = 190 pts
```

**Problem:** All WRs get ~190 points because they all use the same estimated stats.

### Step 3: Calculate VORP

**File:** `lib/value-engine/vorp.ts` (lines 35-102)

```
VORP = Player_Points - Replacement_Level_Points
```

**Replacement Level Calculation:**
```
Replacement_Rank = (Direct_Starters × Teams) + Flex_Demand + Bench_Factor
```

Example for 12-team league with 2 WR + 1 Flex:
```
WR Replacement = (2 × 12) + (1 × 12 × 0.4) + (6 × 1.0) = 24 + 4.8 + 6 = 35
```

So WR35 is the replacement level player.

**Problem:** When all WRs have ~190 points, VORP ≈ 0 for everyone.

### Step 4: Apply Scarcity Multiplier

**File:** `lib/value-engine/vorp.ts` (lines 110-154)

```
Scarcity = 1 + (0.3 × depth_factor × tier_factor)
```

Position depth factors:
- TE: 1.3 (scarce)
- RB: 1.1 (medium)
- WR: 0.9 (deep)
- QB: 0.8 (deep)
- K: 0.5 (replaceable)

**Problem:** Scarcity on near-zero VORP still produces tiny values.

### Step 5: Apply Dynasty Premium (Age Curves)

**File:** `lib/value-engine/age-curves.ts`

**Peak Ages:**
| Position | Peak Range | Decline Rate |
|----------|------------|--------------|
| QB       | 27-34      | 3%/year      |
| RB       | 23-26      | 12%/year     |
| WR       | 25-29      | 5%/year      |
| TE       | 26-30      | 4%/year      |

**Dynasty Premium Formula:**
```
Premium = Age_Curve × Rookie_Bonus × Draft_Capital
```

Example: 22-year-old RB drafted in 1st round
```
Premium = 1.05 (youth) × 1.1 (RB bonus) × 1.35 (1st rd capital) = 1.56x
```

### Step 6: Final Value

**File:** `lib/value-engine/compute-values.ts` (lines 230-235)

```
Final_Value = Normalized_VORP × Scarcity × Dynasty_Premium × 100
```

---

## THE ROOT CAUSE

### Missing Data: Projections Table is Empty

```sql
SELECT COUNT(*) FROM projections;
-- Result: 0
```

**Without projections:**
1. Every QB gets 3800 pass yards projected
2. Every RB gets 800 rush yards projected
3. Every WR gets 900 rec yards projected
4. VORP ≈ 0 because everyone at a position has the same points
5. Final values are tiny/meaningless

---

## THE FIX

### Option A: Seed Real Projections (Recommended)

Create a script to fetch projections from DynastyProcess or FantasyPros:

```typescript
// scripts/seed-projections.ts
async function seedProjections() {
  // Fetch from DynastyProcess CSV
  const projections = await fetchDynastyProcessProjections();

  // Insert into database
  for (const proj of projections) {
    await db.insert(projections).values({
      canonicalPlayerId: proj.playerId,
      source: "dynastyprocess",
      season: 2025,
      stats: proj.stats,  // { pass_yd: 4500, pass_td: 32, ... }
    });
  }
}
```

**Data Sources:**
- DynastyProcess: https://github.com/dynastyprocess/data
- FantasyPros: Requires API key
- Sleeper: Has projections in their player endpoint

### Option B: Improve Estimated Stats with Tiers

Instead of one set of stats per position, create tiers:

```typescript
const ESTIMATED_STATS = {
  QB: {
    elite: { pass_yd: 4800, pass_td: 38, ... },    // Top 5
    starter: { pass_yd: 4000, pass_td: 26, ... },  // 6-15
    backup: { pass_yd: 2500, pass_td: 14, ... },   // 16+
  },
  // ...
};
```

Assign tiers based on:
- ADP from external source
- Previous season performance
- Draft capital + age

### Option C: Use Historical Stats

If we have `historical_stats` table populated, generate projections from past performance:

```typescript
// Already implemented in offseason-projections.ts
generateOffseasonProjection(position, age, historicalStats, scoringRules);
```

---

## VERIFICATION CHECKLIST

After implementing the fix:

- [ ] `SELECT COUNT(*) FROM projections` returns > 500 rows
- [ ] Top QB has ~350+ projected points
- [ ] Top RB has ~300+ projected points
- [ ] Top WR has ~280+ projected points
- [ ] VORP for QB1 is significantly higher than QB20
- [ ] Final values range from ~500 (elite) to ~0 (waiver)
- [ ] Rankings match expected consensus (roughly)

---

## FILES TO MODIFY

| File | Change |
|------|--------|
| `scripts/seed-projections.ts` | NEW: Fetch and insert projections |
| `lib/value-engine/compute-values.ts` | Update to require projections |
| `lib/db/schema.ts` | May need `historical_stats` table |

---

## APPENDIX: Current Data Flow

```
User Connects League
        │
        ▼
League Settings Synced
(scoring rules, roster positions, flex rules)
        │
        ▼
Rosters Synced
(player assignments to teams)
        │
        ▼
computeLeagueValues() Called
        │
        ▼
Query Projections ──────────────▶ EMPTY TABLE!
        │
        ▼
Fallback to Generic Stats ◀───── ALL PLAYERS SAME
        │
        ▼
Calculate Fantasy Points ───────▶ All QBs ~190 pts
        │
        ▼
Calculate VORP ─────────────────▶ VORP ≈ 0
        │
        ▼
Apply Multipliers ──────────────▶ Still ≈ 0
        │
        ▼
BROKEN RANKINGS
```
