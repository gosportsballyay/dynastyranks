#!/usr/bin/env python3
"""
FantasyPros IDP Dynasty ECR Scraper for MyDynastyValues.

Fetches IDP dynasty rankings from FantasyPros across the combined
page and all three position-specific pages (LB, DL, DB), then
deduplicates and inserts into external_rankings.

Pages scraped:
  - dynasty-idp.php  (combined top ~67)
  - dynasty-lb.php   (linebackers, ~40)
  - dynasty-dl.php   (defensive linemen, ~23)
  - dynasty-db.php   (defensive backs, ~30)

Usage:
    python scripts/scrape_fantasypros_idp.py
    python scripts/scrape_fantasypros_idp.py --dry-run
"""

import math
import os
import re
import sys
import argparse
import json
from datetime import datetime
from typing import Optional

import requests

# Load environment variables from .env.local
try:
    from dotenv import load_dotenv
    load_dotenv(".env.local")
except ImportError:
    pass

# Database connection
try:
    import psycopg2
except ImportError:
    print("psycopg2 not installed. Run: pip install psycopg2-binary")
    sys.exit(1)


FP_BASE = "https://www.fantasypros.com/nfl/rankings"
FP_PAGES: dict[str, str] = {
    "combined": f"{FP_BASE}/dynasty-idp.php",
    "lb": f"{FP_BASE}/dynasty-lb.php",
    "dl": f"{FP_BASE}/dynasty-dl.php",
    "db": f"{FP_BASE}/dynasty-db.php",
}

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)

POSITION_MAP: dict[str, str] = {
    "LB": "LB",
    "DL": "DL",
    "DB": "DB",
    "DE": "EDR",
    "DT": "IL",
    "CB": "CB",
    "S": "S",
    "EDR": "EDR",
    "ED": "EDR",
}


def rank_to_value(rank: int) -> int:
    """Convert ECR rank to a value on the 0-10000 scale.

    NOTE:
    The exponential decay constant (0.012) controls tier compression.
    This should be calibrated against offensive value curves.
    Do not change without testing first 50 ranks visually.
    """
    raw = 10000 * math.exp(-0.012 * (rank - 1))
    return max(100, int(raw))


def _normalize_name(name: str) -> str:
    """Normalize a player name for deduplication."""
    return (
        name.lower()
        .replace(".", "")
        .replace("'", "")
        .replace("-", "")
        .strip()
    )


def _fetch_page(
    session: requests.Session, url: str
) -> list[dict]:
    """Fetch a single FantasyPros page and extract players."""
    try:
        response = session.get(url, timeout=30)
        response.raise_for_status()
    except requests.RequestException as e:
        print(f"  Error fetching {url}: {e}")
        return []

    html = response.text
    players = _extract_from_ecr_data(html)

    if not players:
        players = _extract_from_html_table(html)

    return players


def fetch_fantasypros_idp() -> list[dict]:
    """Fetch IDP dynasty ECR from all FantasyPros pages.

    Strategy:
    1. Fetch the combined IDP page for overall ranking
    2. Fetch each position page (LB, DL, DB) for deeper lists
    3. Deduplicate: prefer combined-page rank when available
    4. Players only on position pages get continuation ranks
       starting after the last combined-page rank

    Returns:
        Deduplicated list of player dicts sorted by rank.
    """
    session = requests.Session()
    session.headers.update({
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml",
    })

    # --- Fetch combined page (authoritative overall rank) ---
    print(f"Fetching combined IDP page: {FP_PAGES['combined']}")
    combined = _fetch_page(session, FP_PAGES["combined"])
    print(f"  Combined: {len(combined)} players")

    seen: dict[str, dict] = {}
    for p in combined:
        key = _normalize_name(p["name"])
        seen[key] = p

    # --- Fetch position pages for deeper coverage ---
    extras: list[dict] = []
    for label, url in FP_PAGES.items():
        if label == "combined":
            continue

        print(f"Fetching {label.upper()} page: {url}")
        pos_players = _fetch_page(session, url)
        print(f"  {label.upper()}: {len(pos_players)} players")

        for p in pos_players:
            key = _normalize_name(p["name"])
            if key in seen:
                # Update position if the position page gives a
                # more specific position (e.g. S vs DB)
                existing = seen[key]
                if (
                    existing["position"] in ("DB", "DL")
                    and p["position"] not in ("DB", "DL")
                ):
                    existing["position"] = p["position"]
                # Keep position_rank from position page
                if p.get("position_rank") is not None:
                    existing["position_rank"] = p["position_rank"]
            else:
                extras.append(p)
                seen[key] = p

    # --- Assign continuation ranks to position-page-only players ---
    # Sort extras by their position_rank as a rough proxy for quality
    extras.sort(key=lambda p: p.get("position_rank") or 999)
    next_rank = max((p["rank"] for p in combined), default=0) + 1

    for p in extras:
        p["rank"] = next_rank
        p["value"] = rank_to_value(next_rank)
        next_rank += 1

    # --- Merge and sort ---
    all_players = sorted(seen.values(), key=lambda p: p["rank"])

    print(
        f"\nTotal: {len(all_players)} unique IDP players "
        f"({len(combined)} from combined, "
        f"{len(extras)} additional from position pages)"
    )
    return all_players


def _extract_from_ecr_data(html: str) -> list[dict]:
    """Extract player data from the ecrData JavaScript variable."""
    match = re.search(
        r'var\s+ecrData\s*=\s*({.*?});',
        html,
        re.DOTALL,
    )
    if not match:
        return []

    try:
        data = json.loads(match.group(1))
    except json.JSONDecodeError as e:
        print(f"  Failed to parse ecrData JSON: {e}")
        return []

    players_raw = data.get("players", [])
    players: list[dict] = []

    for p in players_raw:
        parsed = _parse_ecr_player(p)
        if parsed:
            players.append(parsed)

    return players


def _parse_ecr_player(raw: dict) -> Optional[dict]:
    """Parse a single player from ecrData JSON."""
    try:
        name = raw.get("player_name", "").strip()
        if not name:
            return None

        pos_raw = raw.get("player_position_id", "")
        position = POSITION_MAP.get(pos_raw, pos_raw)
        if not position or position not in POSITION_MAP.values():
            return None

        team = raw.get("player_team_id", "")
        rank_ecr = raw.get("rank_ecr")
        if rank_ecr is None:
            return None

        rank_ecr = int(float(rank_ecr))
        pos_rank_str = raw.get("pos_rank", "")
        pos_rank = None
        if pos_rank_str:
            # pos_rank is like "LB5" — extract numeric part
            digits = re.sub(r'[^\d]', '', str(pos_rank_str))
            if digits:
                pos_rank = int(digits)

        tier = raw.get("tier")
        if tier is not None:
            tier = int(tier)

        value = rank_to_value(rank_ecr)

        return {
            "name": name,
            "position": position,
            "team": team if team else None,
            "rank": rank_ecr,
            "position_rank": pos_rank,
            "value": value,
            "tier": tier,
        }
    except (ValueError, TypeError) as e:
        print(f"  Error parsing player {raw.get('player_name', '?')}: {e}")
        return None


def _extract_from_html_table(html: str) -> list[dict]:
    """Fallback: extract player data from HTML ranking table."""
    players: list[dict] = []
    rank = 0

    row_pattern = re.compile(
        r'<tr[^>]*class="[^"]*mpb-player[^"]*"[^>]*>(.*?)</tr>',
        re.DOTALL,
    )
    name_pattern = re.compile(
        r'class="player-name"[^>]*>([^<]+)</a>',
    )
    team_pattern = re.compile(
        r'class="player-team"[^>]*>([^<]+)',
    )
    pos_pattern = re.compile(
        r'class="player-position"[^>]*>([^<]+)',
    )

    for row_match in row_pattern.finditer(html):
        row_html = row_match.group(1)
        rank += 1

        name_match = name_pattern.search(row_html)
        if not name_match:
            continue

        name = name_match.group(1).strip()

        team_match = team_pattern.search(row_html)
        team = team_match.group(1).strip() if team_match else None

        pos_match = pos_pattern.search(row_html)
        pos_raw = pos_match.group(1).strip() if pos_match else ""
        position = POSITION_MAP.get(pos_raw, pos_raw)

        if position not in POSITION_MAP.values():
            continue

        value = rank_to_value(rank)

        players.append({
            "name": name,
            "position": position,
            "team": team,
            "rank": rank,
            "position_rank": None,
            "value": value,
            "tier": None,
        })

    return players


def get_db_connection():
    """Get a connection to the database."""
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise ValueError("DATABASE_URL environment variable not set")

    return psycopg2.connect(database_url)


def insert_rankings(
    players: list[dict],
    dry_run: bool = False,
) -> None:
    """Insert scraped IDP rankings into the database."""
    if dry_run:
        print("\n[DRY RUN] Would insert the following IDP players:")
        for i, p in enumerate(players):
            print(
                f"  {p['rank']:>3}. {p['name']} ({p['position']}) "
                f"- Value: {p['value']}"
                f"{' [pos page only]' if p['rank'] > 67 else ''}"
            )
        return

    conn = get_db_connection()
    cur = conn.cursor()

    try:
        now = datetime.now()
        season = now.year if now.month >= 9 else now.year - 1

        for p in players:
            cur.execute("""
                INSERT INTO external_rankings (
                    source, player_name, position, nfl_team,
                    rank, position_rank, value, tier,
                    is_super_flex, is_te_premium, season,
                    fetched_at
                ) VALUES (
                    %(source)s, %(name)s, %(position)s, %(team)s,
                    %(rank)s, %(pos_rank)s, %(value)s, %(tier)s,
                    %(sf)s, %(tep)s, %(season)s, NOW()
                )
                ON CONFLICT (
                    source, player_name, position,
                    is_super_flex, is_te_premium, season
                )
                DO UPDATE SET
                    nfl_team = EXCLUDED.nfl_team,
                    rank = EXCLUDED.rank,
                    position_rank = EXCLUDED.position_rank,
                    value = EXCLUDED.value,
                    tier = EXCLUDED.tier,
                    fetched_at = NOW()
            """, {
                "source": "fantasypros",
                "name": p["name"],
                "position": p["position"],
                "team": p.get("team"),
                "rank": p.get("rank"),
                "pos_rank": p.get("position_rank"),
                "value": p.get("value"),
                "tier": p.get("tier"),
                "sf": False,
                "tep": False,
                "season": season,
            })

        conn.commit()
        print(f"\nInserted/updated {len(players)} IDP rankings")

    except Exception as e:
        conn.rollback()
        print(f"Error inserting rankings: {e}")
        raise
    finally:
        cur.close()
        conn.close()


def main() -> None:
    """Entry point for the FantasyPros IDP scraper."""
    parser = argparse.ArgumentParser(
        description="Fetch FantasyPros IDP dynasty ECR rankings",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Don't write to database",
    )

    args = parser.parse_args()

    players = fetch_fantasypros_idp()
    if players:
        insert_rankings(players, dry_run=args.dry_run)
    else:
        print("No players fetched, skipping insert")


if __name__ == "__main__":
    main()
