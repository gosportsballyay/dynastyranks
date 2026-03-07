# IDP Position Reference

How fantasy platforms classify defensive players and how MyDynastyValues
adapts to each league's specific configuration.

---

## Why This Matters

This is the **core value proposition** of MyDynastyValues for IDP leagues.
Every major dynasty tool (KTC, FantasyCalc, DynastyProcess, Dynasty Daddy)
either ignores IDP entirely or treats all leagues identically. But IDP
position naming, roster construction, and scoring rules vary dramatically
across platforms. A "DL" on Sleeper contains edge rushers and interior
linemen pooled together; on Fleaflicker those are separate EDR and IL
slots with potentially different scoring rules.

MyDynastyValues resolves positions **per league** based on that league's
actual roster configuration. The same player can be valued as "DL" in a
Sleeper league and "EDR" in a Fleaflicker league, producing different
scarcity calculations, replacement levels, and final values. This is
correct behavior, not a bug.

---

## Platform Position Taxonomies

### Sleeper

**Structure: Consolidated**

Sleeper uses three parent IDP positions for roster slots:

| Roster Slot | Contains |
|-------------|----------|
| DL | Edge rushers, defensive tackles, defensive ends |
| LB | All linebackers (ILB, OLB, MLB) |
| DB | Cornerbacks, safeties |
| IDP_FLEX | Any DL/LB/DB |

Sleeper does NOT support position-specific IDP scoring. All defensive
players share the same scoring rules (e.g., one "tackle" value applies
to LBs and DBs equally). Player data from the Sleeper API labels
players with granular positions (e.g., "CB"), but roster slots are
always consolidated.

### Fleaflicker

**Structure: Granular (with optional consolidated)**

Fleaflicker supports the most granular IDP configuration:

| Roster Slot | Description |
|-------------|-------------|
| EDR | Edge Rusher (3-4 OLB, 4-3 DE) |
| IL | Interior Lineman (DT, NT) |
| LB | Linebacker (ILB, off-ball) |
| CB | Cornerback |
| S | Safety |
| DL | Consolidated defensive line (optional) |
| LB | Consolidated linebacker (optional) |
| DB | Consolidated defensive back (optional) |
| DL/LB/DB | IDP Flex |

Fleaflicker supports **position-specific scoring overrides** via the
`applyTo` field on scoring rules. A league can score sacks at 4 points
for EDR but 5 points for IL, or award different tackle values by
position. This is the most complex IDP scoring system among supported
platforms.

### ESPN

**Structure: Mixed (granular slots, consolidated slots, or both)**

ESPN maps numeric slot IDs to positions:

| Slot ID | Position | Type |
|---------|----------|------|
| 8 | DT | Granular |
| 9 | DE | Granular |
| 10 | LB | Both |
| 11 | DL | Consolidated |
| 12 | CB | Granular |
| 13 | S | Granular |
| 14 | DB | Consolidated |
| 15 | IDP_FLEX | Flex |

ESPN supports `pointsOverrides` for position-specific scoring.
Player positions use a separate numeric map where slot 14 = "EDR".

### Yahoo

**Structure: Consolidated (with granular player labels)**

| Position Code | Maps To |
|---------------|---------|
| DE | DE (granular) |
| DT | DT (granular) |
| LB | LB |
| CB | CB (granular) |
| S | S (granular) |
| DL | DL (consolidated) |
| DB | DB (consolidated) |
| D | IDP_FLEX |

Yahoo roster slots are typically consolidated (DL/LB/DB) but player
records carry granular positions. Scoring is uniform across defensive
positions (no position-specific overrides).

### MFL (not yet supported, for reference)

MFL is the most configurable platform:
- Supports "True Position" setting where EDGEs are separate from DL/LB
- Allows fully custom position names and scoring per position
- DE, DT, LB, CB, S as standard; DL, DB as consolidated options
- Position eligibility rules can be league-specific

---

## How the Engine Resolves Positions

### Position Normalization Layer (`lib/value-engine/position-normalization.ts`)

The `resolveDefensivePosition()` function resolves each player's position
per-league with this priority:

1. **Manual override exists** → use the override (from `player_position_overrides` table)
2. **Not a defensive sub-position** → pass through unchanged
3. **League uses consolidated parent slot** (e.g., `DB > 0` in roster config) → resolve to parent (`CB` → `DB`)
4. **League uses granular slot** (e.g., `CB > 0` in roster config) → keep granular position
5. **Fallback** → keep platform position

The consolidation groups are:
- `DB` ← `CB`, `S`
- `DL` ← `EDR`, `IL`, `DE`, `DT`
- `LB` stands alone (no sub-positions)

### Consensus Merging (`lib/value-engine/aggregate.ts`)

For cross-source consensus merging only (matching the same player across
KTC, FantasyCalc, etc.), positions are collapsed to parent groups:
`cb/s → db`, `edr/il/de/dt → dl`, `lb → lb`. This is necessary because
external sources use different position labels for the same player.

**This consensus-level collapsing is separate from the per-league
position resolution.** A player merged as "DL" in consensus can still
be valued as "EDR" in a Fleaflicker league that has granular EDR slots.

---

## Implications for New Data Sources

When integrating a new IDP data source (e.g., IDP Show, PFF):

1. **Map source positions to our canonical set**: `EDR`, `IL`, `LB`,
   `CB`, `S`, `DE`, `DT`, `DL`, `DB`
2. **Do NOT force-consolidate** — store the most granular position
   available from the source
3. **Cross-source matching** uses the `IDP_POSITION_GROUPS` mapping
   in aggregate.ts to match players across sources that use different
   naming conventions
4. **Per-league resolution** happens later in the value pipeline, not
   at data ingestion time

### Position Name Mapping Reference

| Platform/Source | Edge Rusher | Interior DL | Linebacker | Cornerback | Safety |
|-----------------|------------|-------------|------------|------------|--------|
| Sleeper | DL* | DL* | LB | DB* | DB* |
| Fleaflicker | EDR | IL | LB | CB | S |
| ESPN | DE | DT | LB | CB | S |
| Yahoo | DE | DT | LB | CB | S |
| MFL | DE | DT | LB | CB | S |
| IDP Show | ED | IDL | LB | CB | S |
| FantasyPros | DL* | DL* | LB | DB* | DB* |
| KTC/FC/DP | DL* | DL* | LB | DB* | DB* |

\* = consolidated (sub-positions pooled under parent)

---

## Scoring Variability

| Platform | Per-Position Scoring? | Mechanism |
|----------|-----------------------|-----------|
| Sleeper | No | Single scoring config for all positions |
| Fleaflicker | Yes | `applyTo` field on scoring rules |
| ESPN | Yes | `pointsOverrides` by position |
| Yahoo | No | Single scoring config |
| MFL | Yes | Full per-position scoring rules |

This matters for VORP calculations. In a Fleaflicker league where EDRs
get 5 pts/sack but ILs get 4 pts/sack, the same number of sacks produces
different fantasy points by position. The engine must use the platform's
actual scoring rules per position, never hardcoded multipliers.
