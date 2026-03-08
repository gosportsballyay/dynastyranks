# Value Engine Diff

## Trigger
Any modification to files in `lib/value-engine/`.

## Workflow

### Before making changes
```bash
export $(grep -v '^#' .env.local | xargs) && npx tsx scripts/value-engine-diff.ts --snapshot
```

This snapshots top-20 per position across a representative set of
leagues (mix of platforms, IDP configs, superflex).

### Make your code changes
Edit files in `lib/value-engine/` as needed.

### After making changes
```bash
export $(grep -v '^#' .env.local | xargs) && npx tsx scripts/value-engine-diff.ts --diff
```

This recomputes the representative leagues and compares before/after:
- Per position: biggest movers (up/down) with value + rank delta
- Flags any player who moved 10+ rank positions
- Flags any position where the top-5 composition changed
- Shows platform breakdown (did Sleeper leagues shift differently than ESPN?)

### Review the diff output
- Expected movements from your change should appear
- Unexpected movements warrant investigation before committing
- If a position has wholesale top-5 reshuffling that isn't explained
  by your change, something is wrong

### Commit only if diff looks clean
Bump `ENGINE_VERSION` in `compute-unified.ts` for any value-affecting change.

## Post-deploy
After merging any value engine change:
```bash
export $(grep -v '^#' .env.local | xargs) && npx tsx scripts/recompute-all-leagues.ts
```
