#!/bin/bash
set -euo pipefail
IFS=$'\n\t'

# DynastyRanks Rankings Pipeline
# Runs all scrapers and aggregation for external dynasty rankings
#
# Usage:
#   ./scripts/run-rankings-pipeline.sh          # Full pipeline
#   ./scripts/run-rankings-pipeline.sh --dry-run # Dry run (no DB writes)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Check for dry-run flag
DRY_RUN=""
if [[ "${1:-}" == "--dry-run" ]]; then
    DRY_RUN="--dry-run"
    echo "=== DRY RUN MODE ==="
fi

cd "$PROJECT_DIR"

echo "=== DynastyRanks Rankings Pipeline ==="
echo "Started at: $(date)"
echo ""

# Step 1: Scrape KTC rankings (all variants)
echo ">>> Step 1: Scraping KeepTradeCut rankings..."
python3 scripts/scrape_ktc.py --all --pages 15 $DRY_RUN

echo ""

# Step 2: Fetch FantasyCalc rankings (all variants)
echo ">>> Step 2: Fetching FantasyCalc rankings..."
python3 scripts/scrape_fantasycalc.py --all $DRY_RUN

echo ""

# Step 3: Fetch DynastyProcess rankings
echo ">>> Step 3: Fetching DynastyProcess rankings..."
python3 scripts/scrape_dynastyprocess.py $DRY_RUN

echo ""

# Step 3.5: Fetch FantasyPros IDP dynasty ECR
echo ">>> Step 3.5: Fetching FantasyPros IDP dynasty rankings..."
python3 scripts/scrape_fantasypros_idp.py $DRY_RUN

echo ""

# Step 4: Match external rankings to canonical players (TypeScript)
if [[ -z "$DRY_RUN" ]]; then
    echo ">>> Step 4: Matching rankings to canonical players..."
    npx tsx scripts/match-rankings.ts
else
    echo ">>> Step 4: Skipping player matching (dry-run mode)"
fi

echo ""

# Step 5: Compute unified values (consensus aggregation + league-specific blend)
if [[ -z "$DRY_RUN" ]]; then
    echo ">>> Step 5: Computing unified values (consensus + league signal)..."
    npx tsx scripts/compute-unified-values.ts
else
    echo ">>> Step 5: Skipping unified value computation (dry-run mode)"
fi

echo ""
echo "=== Pipeline Complete ==="
echo "Finished at: $(date)"
