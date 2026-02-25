---
name: dynasty-sanity-check
description: >
  Use when modifying any file in lib/value-engine/ or lib/trade-engine/,
  or when validating rankings output. Dynasty football domain knowledge
  and post-change verification checklist.
allowed-tools: Bash, Read, Grep
---

# Dynasty Sanity Check

Accepted dynasty football truths and a verification checklist for
value engine and trade engine changes. If any change contradicts
these assertions, flag it before proceeding.

---

## Accepted Dynasty Truths

### Age Curves

- RB *typically* peaks 24-27, steep cliff after 28 (~10% annual
  decline). Outliers exist (Derrick Henry, Frank Gore).
- WR *typically* peaks 24-28, gradual decline (~4%/year).
- TE *typically* peaks 26-29, slow developers, late breakouts common.
- QB *typically* peaks 28-33, longest productive window, slowest
  decline.
- These are statistical tendencies, not hard ceilings. Apply curves
  as probability-weighted adjustments, not cliff penalties that zero
  out value.

### Positional Scarcity

- RB and TE are the scarcest skill positions in most formats.
- WR is the deepest skill position (lowest scarcity).
- QB scarcity jumps dramatically in superflex/2QB formats.
- K is highly replaceable in all formats.

### Superflex / TE Premium

- In SF leagues, elite QBs should be the most valuable assets
  (1.5-2x non-SF value).
- TE premium (1.5+ PPR) should boost elite TEs into WR1 value range.
- These effects must be automatic from league scoring rules — no
  manual overrides.

### IDP — Scoring System Is the Primary Variable

- **Tackle-heavy** (tackle:sack ratio <= 3:1): LBs dominate scoring.
  LB depth is high (like WR on offense) — usable starters deep.
- **Big-play-heavy** (tackle:sack ratio >= 5:1): EDRs and ball-hawks
  gain value. Elite pass rushers carry more dynasty premium.
- **Balanced** (4:1 ratio): Both positions competitive at top;
  scarcity becomes the tiebreaker.
- Scoring and the number of starting IDP roster spots are the two
  biggest factors in determining which IDP position is most valuable.

### IDP — Positional Drop-Off

- EDR/DL has the steepest drop-off — gap from DL1 to DL8 is large,
  then falls off a cliff. Like RB on offense.
- LB has the flattest curve — high scoring but deep. Like WR on
  offense. NFL shift to nickel/dime is shrinking every-down LB pool.
- DB is the deepest IDP position.
- **The engine must account for both total scoring ceiling AND
  positional drop-off rate.** A position with fewer elite options but
  steeper drop-off should carry higher scarcity value even if its top
  scorer has fewer total points.

### IDP — Consensus & DynastyRanks' Role

- KTC, FantasyCalc, DynastyProcess do not publish IDP dynasty values.
- IDP-specific sites (PFF, The IDP Show, DynastyNerds, DynastySharks)
  publish rankings but vary because they don't disclose scoring
  assumptions — this is the core problem DynastyRanks solves.
- IDP values computed from league signals should be conservative
  relative to offense (higher replacement-level volatility).

### IDP — Platform Position Mapping

- EDGEs are classified differently across platforms — some as LB,
  some as DL/DE (Sleeper groups EDR under DL).
- A 3-4 OLB who rushes the passer may be "LB" on one platform and
  "DL" on another. The engine must handle this mapping correctly.

### IDP — Future Enrichment (do NOT add without explicit approval)

- Snap counts (65%+ snap share = every-down player)
- Depth charts (starter vs rotational)
- Contract data (guaranteed money = coaching commitment)
- NFL defensive scheme classification (4-3 vs 3-4 vs hybrid)

### Draft Picks

- 1.01 is roughly equivalent to a top-12 dynasty asset.
- Pick value drops steeply after round 1 (~75% hit at 1.01, ~28% at
  2.12).
- Future picks discount ~10% per year out.
- Rookie draft capital adds a small premium (youth at ~22).

### Trade Analysis

- The 5% "fair" threshold is a structural baseline, not a universal
  rule.
- Real trades are context-dependent: contenders may overpay for
  win-now assets, rebuilders may sell at a discount to shed points
  and acquire draft capital.
- The engine evaluates structural fairness only — situational context
  (contender vs rebuilder, roster needs) is the user's judgment call.
- Consolidation (fewer studs) carries a premium over depth.
- Extra roster spots consumed have a real cost.

### Consensus Blending

- Standard leagues lean toward market consensus (~70%).
- Complex/unusual leagues lean toward league signal (~65%).
- IDP positions with no consensus coverage are "signal-primary" — by
  design, not a bug. Do NOT re-introduce consensus dependency for IDP.

---

## Post-Change Verification Checklist

After any modification to `lib/value-engine/` or `lib/trade-engine/`,
run through these checks:

### Quick Sanity Checks (read the code)

1. Does any hardcoded constant contradict the accepted truths above?
2. Are IDP values still computed from league signals only (no
   consensus dependency)?
3. Do age curve adjustments still allow for outliers (no hard cliff
   penalties that zero out value)?
4. In SF leagues, are top QBs still the most valuable assets?
5. Does the change respect deterministic per-game scoring (no
   probabilistic estimation)?

### Output Validation (run scripts)

```bash
export $(grep -v '^#' .env.local | xargs)
```

6. `npx tsx scripts/diagnose-player.ts` on a known elite RB (age 25)
   — VORP should be positive, value should be top-tier.
7. Same script on a known aging RB (age 30+) — value should show
   meaningful decline from peak but not zero.
8. Same script on a known elite QB — in SF league config, value
   should be 1.5-2x what it would be in 1QB.
9. Spot-check positional drop-off: EDR gap from #1 to #10 should be
   steeper than LB gap from #1 to #10.
10. If consensus blending changed: verify IDP positions with zero
    consensus coverage still get values (signal-primary path).

### Regression Guards

11. No player with positive projected points should have a final
    value of 0. Players with zero production/consensus can
    legitimately be 0.
12. Draft pick 1.01 should be in the top ~12 overall asset values.
13. A structurally fair trade (equal value both sides) should get a
    "balanced" verdict, not "imbalanced."
14. `ENGINE_VERSION` in `compute-unified.ts` should be bumped if any
    value-affecting constant changed.

### When Checks Fail

- Do NOT proceed with the change.
- Flag the specific check that failed with expected vs actual result.
- Ask the user whether this is an intentional deviation or a bug.

---

## Known Engine Improvement Opportunities

Noted for future reference. Do not implement without approval.

1. **Dynamic IDP depth factors** — Static depth factors in
   `lib/value-engine/league-signal.ts` (LB: 0.9, EDR: 1.1) don't
   account for the interaction between scoring system and positional
   scarcity. Tackle-heavy leagues should decrease LB scarcity further;
   big-play leagues should increase EDR scarcity. Could derive
   dynamically from actual scoring rules.

2. **Sigmoid floor review** — `lib/value-engine/sigmoid.ts` FLOOR of
   200 may artificially inflate worthless roster spots. Players with
   genuinely zero value should be allowed to reach 0.
