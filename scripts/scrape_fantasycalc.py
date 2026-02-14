#!/usr/bin/env python3
"""
FantasyCalc Scraper for DynastyRanks

Fetches dynasty rankings from FantasyCalc's public API and inserts into our database.
Handles 1QB and SuperFlex variants.

Usage:
    python scripts/scrape_fantasycalc.py
    python scripts/scrape_fantasycalc.py --dry-run
    python scripts/scrape_fantasycalc.py --superflex

API: https://api.fantasycalc.com/values/current
"""

import os
import sys
import argparse
from datetime import datetime
from typing import Optional

import requests
from tqdm import tqdm

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


# Constants
FC_API_URL = "https://api.fantasycalc.com/values/current"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"

# Position mapping
POSITION_MAP = {
    "QB": "QB",
    "RB": "RB",
    "WR": "WR",
    "TE": "TE",
    "K": "K",
    # IDP positions (if FantasyCalc ever adds them)
    "LB": "LB",
    "DL": "DL",
    "DB": "DB",
    "DE": "EDR",
    "DT": "IL",
    "CB": "CB",
    "S": "S",
}


def get_session() -> requests.Session:
    """Create a requests session with appropriate headers."""
    session = requests.Session()
    session.headers.update({
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
    })
    return session


def fetch_fantasycalc_rankings(
    superflex: bool = False,
    num_teams: int = 12,
    ppr: float = 1.0,
) -> list[dict]:
    """
    Fetch dynasty rankings from FantasyCalc API.

    Args:
        superflex: Whether to fetch SuperFlex rankings (numQbs=2)
        num_teams: Number of teams in league
        ppr: PPR scoring (0, 0.5, 1)

    Returns:
        List of player dictionaries with rankings data
    """
    session = get_session()

    # Build URL with parameters
    params = {
        "isDynasty": "true",
        "numQbs": 2 if superflex else 1,
        "numTeams": num_teams,
        "ppr": ppr,
    }

    print(f"Fetching FantasyCalc rankings (SF={superflex})...")

    try:
        response = session.get(FC_API_URL, params=params, timeout=30)
        response.raise_for_status()
    except requests.RequestException as e:
        print(f"Error fetching FantasyCalc data: {e}")
        return []

    raw_players = response.json()
    players = []

    for raw in tqdm(raw_players, desc="Processing"):
        player = parse_player(raw, superflex)
        if player:
            players.append(player)

    print(f"Fetched {len(players)} players")
    return players


def parse_player(raw: dict, superflex: bool) -> Optional[dict]:
    """Parse a single player from FantasyCalc API response."""
    try:
        # Player data is nested under 'player' key
        player_data = raw.get("player", raw)

        name = player_data.get("name")
        if not name:
            return None

        # Check if this is a draft pick
        position_raw = player_data.get("position", "")
        if position_raw == "PICK" or "Pick" in name or any(
            year in name for year in ["2025", "2026", "2027", "2028", "2029"]
        ):
            position = "PICK"
            position_rank = None
        else:
            position = POSITION_MAP.get(position_raw, position_raw)
            position_rank = raw.get("positionRank")

        # Team - FantasyCalc uses 'team' key
        team = player_data.get("team") or player_data.get("maybeTeam")

        # Value - FantasyCalc calls it 'value'
        value = raw.get("value", 0)
        if isinstance(value, float):
            value = int(value)

        # Rank
        rank = raw.get("overallRank")

        # Age
        age = player_data.get("age")

        return {
            "name": name,
            "position": position,
            "position_rank": position_rank,
            "team": team,
            "value": value,
            "age": age,
            "tier": None,  # FantasyCalc doesn't provide tiers
            "rank": rank,
            "is_superflex": superflex,
            "is_te_premium": False,  # FantasyCalc doesn't have TEP-specific values
        }

    except Exception as e:
        print(f"Error parsing player: {e}")
        return None


def get_db_connection():
    """Get a connection to the database."""
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise ValueError("DATABASE_URL environment variable not set")

    return psycopg2.connect(database_url)


def insert_rankings(players: list[dict], dry_run: bool = False):
    """Insert scraped rankings into the database."""
    if dry_run:
        print("\n[DRY RUN] Would insert the following players:")
        for i, p in enumerate(players[:20]):
            print(f"  {i+1}. {p['name']} ({p['position']}) - Value: {p['value']}, Rank: {p.get('rank')}")
        if len(players) > 20:
            print(f"  ... and {len(players) - 20} more")
        return

    conn = get_db_connection()
    cur = conn.cursor()

    try:
        # Get current season
        now = datetime.now()
        season = now.year if now.month >= 9 else now.year - 1

        # Insert each player
        for p in tqdm(players, desc="Inserting"):
            cur.execute("""
                INSERT INTO external_rankings (
                    source, player_name, position, nfl_team,
                    rank, position_rank, value, tier,
                    is_super_flex, is_te_premium, season, fetched_at
                ) VALUES (
                    %(source)s, %(name)s, %(position)s, %(team)s,
                    %(rank)s, %(pos_rank)s, %(value)s, %(tier)s,
                    %(sf)s, %(tep)s, %(season)s, NOW()
                )
                ON CONFLICT (source, player_name, position, is_super_flex, is_te_premium, season)
                DO UPDATE SET
                    nfl_team = EXCLUDED.nfl_team,
                    rank = EXCLUDED.rank,
                    position_rank = EXCLUDED.position_rank,
                    value = EXCLUDED.value,
                    tier = EXCLUDED.tier,
                    fetched_at = NOW()
            """, {
                "source": "fantasycalc",
                "name": p["name"],
                "position": p["position"],
                "team": p.get("team"),
                "rank": p.get("rank"),
                "pos_rank": p.get("position_rank"),
                "value": p.get("value"),
                "tier": p.get("tier"),
                "sf": p.get("is_superflex", False),
                "tep": p.get("is_te_premium", False),
                "season": season,
            })

        conn.commit()
        print(f"Inserted/updated {len(players)} rankings")

    except Exception as e:
        conn.rollback()
        print(f"Error inserting rankings: {e}")
        raise
    finally:
        cur.close()
        conn.close()


def main():
    parser = argparse.ArgumentParser(description="Fetch FantasyCalc dynasty rankings")
    parser.add_argument("--dry-run", action="store_true", help="Don't write to database")
    parser.add_argument("--superflex", "-sf", action="store_true", help="Fetch SuperFlex rankings")
    parser.add_argument("--all", action="store_true", help="Fetch all variants (1QB, SF)")
    parser.add_argument("--teams", type=int, default=12, help="Number of teams")
    parser.add_argument("--ppr", type=float, default=1.0, help="PPR scoring (0, 0.5, 1)")

    args = parser.parse_args()

    if args.all:
        # Fetch all variants
        all_players = []

        # 1QB
        players_1qb = fetch_fantasycalc_rankings(
            superflex=False,
            num_teams=args.teams,
            ppr=args.ppr,
        )
        all_players.extend(players_1qb)

        # SuperFlex
        players_sf = fetch_fantasycalc_rankings(
            superflex=True,
            num_teams=args.teams,
            ppr=args.ppr,
        )
        all_players.extend(players_sf)

        insert_rankings(all_players, dry_run=args.dry_run)
    else:
        # Fetch single variant
        players = fetch_fantasycalc_rankings(
            superflex=args.superflex,
            num_teams=args.teams,
            ppr=args.ppr,
        )
        insert_rankings(players, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
