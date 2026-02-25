# Design: Dynasty Sanity Check Skill

## Overview

A project-level Claude Code skill that encodes accepted dynasty fantasy
football knowledge as sanity-check assertions. Auto-invokes when editing
value engine or trade engine files. Also callable manually via
`/dynasty-sanity-check`. Includes a post-change verification checklist
that actively validates engine output against domain expectations.

## Skill Location

`.claude/skills/dynasty-sanity-check/SKILL.md`

## Approach

**Reference + Validation Checklist (Approach B)**

The skill has two parts:
1. **Accepted Truths** — domain assertions Claude treats as invariants.
   If an engine change contradicts any, Claude flags it before proceeding.
2. **Verification Checklist** — active checks Claude runs after engine
   changes, including script-based output validation.

## Skill Metadata

```yaml
---
name: dynasty-sanity-check
description: >
  Use when modifying any file in lib/value-engine/ or lib/trade-engine/,
  or when validating rankings output. Dynasty football domain knowledge
  and post-change verification checklist.
allowed-tools: Bash, Read, Grep
---
```

- Auto-invokes on engine file edits (description match)
- Manually callable via `/dynasty-sanity-check`
- Has Bash/Read/Grep access for verification steps

## Accepted Dynasty Truths

### Age Curves
- RB *typically* peaks 24-27, steep cliff after 28 (10%+ annual
  decline) — but outliers exist (e.g., Derrick Henry, Frank Gore)
- WR *typically* peaks 24-28, gradual decline (~4%/year)
- TE *typically* peaks 26-29, slow developers, late breakouts common
- QB *typically* peaks 28-33, longest productive window, slowest decline
- These are statistical tendencies, not hard ceilings. The engine should
  apply curves as probability-weighted adjustments, not cliff penalties

### Positional Scarcity
- RB and TE are the scarcest skill positions in most formats
- WR is the deepest skill position (lowest scarcity)
- QB scarcity jumps dramatically in superflex/2QB formats
- K is highly replaceable in all formats

### Superflex / TE Premium Effects
- In SF leagues, elite QBs should be the most valuable assets
  (1.5-2x non-SF value)
- TE premium (1.5+ PPR) should boost elite TEs into WR1 value range
- These effects should be automatic from league scoring — no manual
  overrides

### IDP — Scoring System Is the Primary Variable
- **Tackle-heavy leagues** (tackle:sack ratio <= 3:1): LBs dominate
  scoring. Top LBs outscore top EDRs significantly. LB depth is high
  (like WR on offense) — usable starters available deep.
- **Big-play-heavy leagues** (tackle:sack ratio >= 5:1): EDRs and
  ball-hawks gain value. Elite pass rushers carry more dynasty premium.
- **Balanced leagues** (4:1 ratio): Both positions competitive at
  the top; scarcity becomes the tiebreaker.

### IDP — Positional Scarcity (the drop-off problem)
- EDR/DL has the steepest drop-off in IDP — the gap from DL1 to DL8
  is significant, then falls off a cliff. Like RB on offense.
- LB has the flattest curve — high scoring but deep position. Like WR
  on offense. However, NFL's shift to nickel/dime base defenses is
  shrinking the pool of every-down LBs.
- DB is the deepest IDP position — wait on them unless elite safeties
  are available.
- **The engine should account for both total scoring ceiling AND
  positional drop-off rate, not just raw point totals.** A position
  with fewer elite options but steeper drop-off should carry higher
  scarcity value even if its top scorer has fewer total points.

### IDP — Consensus & DynastyRanks' Role
- KTC, FantasyCalc, and DynastyProcess do not publish IDP dynasty
  values
- IDP-specific sites exist (PFF, The IDP Show, DynastyNerds,
  DynastySharks) but rankings vary because they don't disclose the
  scoring assumptions they're based on
- This is the core problem DynastyRanks solves: computing IDP values
  from your league's actual scoring rules and roster construction
- IDP values should be conservative relative to offense due to higher
  replacement-level volatility

### IDP — Platform Position Mapping
- EDGEs are classified differently across platforms — some map to LB,
  some to DL/DE (Sleeper groups EDR under DL)
- The engine must handle this mapping correctly; a 3-4 OLB who rushes
  the passer may be an "LB" on one platform and a "DL" on another

### IDP — Future Enrichment (do not add without explicit approval)
- Snap count data (65%+ snap share = every-down player)
- Depth charts (starter vs rotational)
- Contract data (guaranteed money = coaching commitment)
- NFL defensive scheme classification (4-3 vs 3-4 vs hybrid)

### Draft Picks
- 1.01 is roughly equivalent to a top-12 dynasty asset
- Pick value drops steeply after round 1 (hit rates: ~75% at 1.01,
  ~28% at 2.12)
- Future picks discount ~10% per year out
- Rookie draft capital should add a small premium (youth at ~22)

### Trade Analysis
- The 5% "fair" threshold is a structural baseline, not a universal
  rule
- Real trades are context-dependent: contenders may overpay for
  win-now assets, rebuilders may sell at a discount to shed points
  and acquire draft capital
- The engine evaluates structural fairness only — situational context
  (contender vs rebuilder, roster needs, league dynamics) is the
  user's judgment call
- Consolidation (fewer studs) should carry a premium over depth
- Extra roster spots consumed have a real cost

### Consensus Blending
- Standard leagues should lean toward market consensus (~70%)
- Complex/unusual leagues should lean toward league signal (~65%)
- IDP positions with no consensus coverage are "signal-primary" — by
  design, not a bug

## Post-Change Verification Checklist

### Quick Sanity Checks (no scripts needed)
1. Read the changed file — does any hardcoded constant contradict the
   accepted truths above?
2. Are IDP values still computed from league signals only (no consensus
   dependency)?
3. Do age curve adjustments still allow for outliers (no hard cliff
   penalties that zero out value)?
4. In SF leagues, are top QBs still the most valuable assets?
5. Does the change respect the deterministic per-game scoring
   constraint (no probabilistic estimation)?

### Output Validation (run scripts)
6. Run `diagnose-player.ts` on a known elite RB (age 25) — VORP
   should be positive and value should be top-tier
7. Run `diagnose-player.ts` on a known aging RB (age 30+) — value
   should show meaningful decline from peak but not zero
8. Run `diagnose-player.ts` on a known elite QB — in a SF league
   config, value should be 1.5-2x what it would be in a 1QB league
9. Spot-check that the positional drop-off pattern holds: EDR gap
   from #1 to #10 should be steeper than LB gap from #1 to #10
10. If consensus blending was changed: verify IDP positions with zero
    consensus coverage still get values (signal-primary path, no
    penalty)

### Regression Guards
11. No player with positive projected points should have a final
    value of 0 — players with zero production/consensus can
    legitimately be 0
12. Draft pick 1.01 should be in the top ~12 overall asset values
13. A structurally fair trade (equal value both sides) should get a
    "balanced" verdict, not "imbalanced"
14. `ENGINE_VERSION` in `compute-unified.ts` should be bumped if any
    value-affecting constant changed

### When Checks Fail
- Do NOT proceed with the change
- Flag the specific check that failed and the expected vs actual result
- Ask the user whether this is an intentional deviation or a bug

## Known Engine Improvement Opportunities

These are noted for future reference, not current bugs:

1. **Dynamic IDP depth factors** — The current depth factors in
   `lib/value-engine/league-signal.ts` are static (LB: 0.9, EDR: 1.1).
   These don't account for the interaction between a league's scoring
   system and positional scarcity. In tackle-heavy leagues, LB scarcity
   should decrease further; in big-play leagues, EDR scarcity should
   increase. Could eventually derive these dynamically from the actual
   scoring rules.

2. **Sigmoid floor review** — The sigmoid function in
   `lib/value-engine/sigmoid.ts` has a FLOOR of 200. Players with
   genuinely zero value (no production, no consensus) should be
   allowed to reach 0. The floor may be artificially inflating
   worthless roster spots.

## Implementation

Single file: `.claude/skills/dynasty-sanity-check/SKILL.md`

No code changes, no npm installs, no config changes. The skill is
pure Markdown with YAML frontmatter.
