# Scarcity-Adjusted Value (SAV) Engine Update

## Objective

Fix the "Shallow IDP" problem where low-variance positions (IL, CB) are over-ranked. Replace current scarcity formula with NFL market-based scarcity ratio, and add multi-year dynasty smoothing.

---

## Research Findings: The Dynasty/IDP Landscape

### The Gap in the Market (Sources: [IDP+](https://idpplus.com/idp-scoring-systems-and-how-to-pick-one-in-2025/), [Dynasty League Football Forum](https://forum.dynastyleaguefootball.com/viewtopic.php?t=232803), [IDynastyP](https://idynastyp.com/about))

1. **IDP scoring varies wildly** - No standard exists. Ranges from "balanced offense/defense" to "tackle premium"
2. **Position designations differ** - Some leagues use DL (combined), others split EDR+IL
3. **IDP starter counts vary** - 2-11 IDPs per team
4. **KTC/KeepTradeCut weakness**: Crowdsourced, doesn't account for league-specific settings, [IDP not included](https://forum.dynastyleaguefootball.com/viewtopic.php?t=245428)
5. **Dynasty Daddy strength**: Free, IDP support, but [requires JS](https://dynasty-daddy.com)

### What Makes Our Solution Universal

Our approach is ALREADY universal because we:
- Import actual league scoring rules (not crowdsourced)
- Import actual roster positions from the league
- Support position mappings (DL -> EDR+IL, DB -> CB+S)
- Calculate replacement level dynamically per league

The **scarcity ratio** formula works for ALL leagues because `calcStarterDemand()` already accounts for each league's specific roster settings.

---

## Current State (Already Implemented in test-new-rankings.ts)

| Feature | Status | Notes |
|---------|--------|-------|
| PPG calculation | Done | Single season only |
| Pedigree floor | Done | Draft capital-based floors for <34 career games |
| IDP variance buffer | Done | +2.0 to stddev for defensive positions |
| Games-played regression | Done | Small samples regress to mean |
| Scarcity factor | REPLACE | Current: `1/sqrt(starters)` - needs new formula |
| Multi-year smoothing | Missing | Only target season PPG used |

---

## Changes Required

### 1. NFL Starter Pool Constant (with Position Mapping Support)

The NFL_POOL represents the total viable fantasy-relevant players at each position archetype:

```typescript
const NFL_POOL_BASE: Record<string, number> = {
  QB: 32,   // 32 starting QBs
  RB: 40,   // ~40 viable fantasy RBs (bellcows + backups with value)
  WR: 80,   // Deep position - WR1/2/3 on most teams
  TE: 32,   // 32 starting TEs
  K: 32,
  EDR: 64,  // Edge rushers (32 teams x 2)
  IL: 64,   // Interior linemen / DTs
  LB: 96,   // Off-ball linebackers (many 4-3 and 3-4 schemes)
  CB: 64,   // Cornerbacks (32 teams x 2)
  S: 64,    // Safeties (32 teams x 2)
};
```

### 2. Replace Scarcity Formula

**Current:** `scarcityFactors[pos] = 1 / Math.sqrt(demand);`

**New:** `scarcityRatio[pos] = leagueStarters / nflPool;`

Example (10-team league):
| Position | League Starters | NFL Pool | Scarcity Ratio |
|----------|-----------------|----------|----------------|
| RB | 30 (3/team x 10) | 40 | 0.75 (scarce!) |
| WR | 30 (3/team x 10) | 80 | 0.38 |
| TE | 10 (1/team x 10) | 32 | 0.31 |
| IL | 10 (1/team x 10) | 64 | 0.16 (deep!) |
| CB | 10 (1/team x 10) | 64 | 0.16 (deep!) |

### 3. Multi-Year Dynasty Smoothing

Weighted PPG: Current 60%, Year-1 30%, Year-2 10%

Edge cases:
- Rookies (0 history): Fall back to pedigree floor
- 1 year of data: Use 100% of that year
- 2 years of data: 60/30 split normalized to ~67/33

### 4. Top 50 Output

Change output from top 30 to top 50.

---

## Implementation Order

1. Add `NFL_POOL` constant
2. Add `calcMultiYearPPG()` function
3. Modify PPG calculation to use multi-year smoothing
4. Replace scarcity factor with scarcity ratio formula
5. Update output to show top 50
6. Run test and verify results

---

## Expected Results

Top 50 should show:
- Elite bell-cow RBs rising (high scarcity ratio ~0.75)
- Elite QBs rising (high scarcity in superflex-like value)
- ILs and CBs falling significantly (scarcity ratio ~0.16)
- Only statistical anomalies at IL/CB in top 50

---

## Roadmap: What's Missing to Compete with Dynasty Daddy

### Currently Have
| Feature | Status |
|---------|--------|
| League-specific scoring import | Via Fleaflicker adapter |
| Custom roster positions | Done |
| IDP support (all positions) | Done |
| Position mappings (DL<->EDR+IL) | Done |
| Player values/rankings | This PR |
| Dynasty premium (age curves) | Done |
| Draft pick anchoring | avg top 12 rookies |
| Pedigree floor (rookie protection) | Done |

### High Priority (Next Features)
| Feature | Why It Matters |
|---------|----------------|
| **Trade Calculator** | #1 requested feature in dynasty. KTC/DD both have this. |
| **Draft Pick Values** | Full pick valuation (1.01-4.12), not just "1st round avg" |
| **Team Power Rankings** | Aggregate roster values per team |
| **Sleeper/MFL League Sync** | Fleaflicker is niche; Sleeper is dominant |

### Medium Priority
| Feature | Why It Matters |
|---------|----------------|
| **"What If" Trade Analyzer** | Show how trade affects team value |
| **Startup Draft Rankings** | Different from redraft - age matters more |
| **Rookie-only Rankings** | Separate view for rookie drafts |
| **Contract/Salary Support** | MFL leagues with cap management |

### Lower Priority (Future)
| Feature | Notes |
|---------|-------|
| Devy (college prospects) | Niche but growing |
| Crowdsourced values | KTC-style voting (we use calculated instead) |
| Mobile-friendly responsive design | Ensure all pages work well on phones/tablets |

---

## Summary: Why Our Approach is Universal

1. **Scarcity Ratio** = `leagueStarters / getNFLPool(position)` - adapts to ANY roster config
2. **Position Mappings** - handles consolidated (DL, DB) or granular (EDR, IL, CB, S)
3. **League-specific scoring** - imported from platform, not assumed
4. **Multi-year smoothing** - rewards consistency, dampens one-off seasons

This works for:
- 10-team SF with 2 IDPs
- 12-team full IDP with 11 defensive starters
- 16-team tackle-premium LB-heavy leagues
- Any custom configuration
