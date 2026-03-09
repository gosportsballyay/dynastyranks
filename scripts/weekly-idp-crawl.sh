#!/bin/bash
set -euo pipefail
IFS=$'\n\t'

# Weekly IDP trends crawler
# Run via cron: 0 3 * * 0 /path/to/scripts/weekly-idp-crawl.sh
# (Every Sunday at 3am)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Load env
if [ -f .env.local ]; then
  export $(grep -v '^#' .env.local | xargs)
fi

echo "[$(date)] Starting weekly IDP crawl..."

npx tsx scripts/crawl-sleeper-idp.ts \
  --depth 2 \
  --max-leagues 5000 \
  --delay 150

echo "[$(date)] Crawl complete. Checking for changes..."

# Check if data changed
if git diff --quiet data/idp-trends.json 2>/dev/null; then
  echo "[$(date)] No changes to IDP trends data."
else
  echo "[$(date)] Data updated. Changes:"
  git diff --stat data/idp-trends.json
  echo ""
  echo "Run 'git add data/idp-trends.json && git commit' to commit."
fi
