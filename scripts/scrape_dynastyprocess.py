#!/usr/bin/env python3
"""
DynastyProcess Scraper for DynastyRanks

Fetches dynasty rankings from DynastyProcess's open GitHub data repository.
DynastyProcess values are built on FantasyPros ECR, so this gives us both.

Data source: https://github.com/dynastyprocess/data

Usage:
    python scripts/scrape_dynastyprocess.py
    python scripts/scrape_dynastyprocess.py --dry-run

CSV columns: player, pos, team, age, draft_year, ecr_1qb, ecr_2qb, ecr_pos,
             value_1qb, value_2qb, scrape_date, fp_id
"""

import os
import sys
import csv
import argparse
from datetime import datetime
from io import StringIO

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
DP_VALUES_URL = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/values.csv"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"

# Position mapping
POSITION_MAP = {
    "QB": "QB",
    "RB": "RB",
    "WR": "WR",
    "TE": "TE",
    "K": "K",
    "PICK": "PICK",
    # IDP positions (if DP ever adds them)
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
        "Accept": "text/csv,text/plain,*/*",
    })
    return session


def fetch_dynastyprocess_rankings() -> list[dict]:
    """
    Fetch dynasty rankings from DynastyProcess GitHub CSV.

    Returns:
        List of player dictionaries with rankings data for both 1QB and SF
    """
    session = get_session()

    print("Fetching DynastyProcess rankings...")

    try:
        response = session.get(DP_VALUES_URL, timeout=30)
        response.raise_for_status()
    except requests.RequestException as e:
        print(f"Error fetching DynastyProcess data: {e}")
        return []

    # Parse CSV
    csv_data = StringIO(response.text)
    reader = csv.DictReader(csv_data)

    players_1qb = []
    players_sf = []

    for row in tqdm(list(reader), desc="Processing"):
        # Create 1QB entry
        player_1qb = parse_row(row, superflex=False)
        if player_1qb:
            players_1qb.append(player_1qb)

        # Create SuperFlex entry
        player_sf = parse_row(row, superflex=True)
        if player_sf:
            players_sf.append(player_sf)

    print(f"Fetched {len(players_1qb)} players (1QB) + {len(players_sf)} players (SF)")
    return players_1qb + players_sf


def parse_row(row: dict, superflex: bool) -> dict | None:
    """Parse a single row from DynastyProcess CSV."""
    try:
        name = row.get("player", "").strip()
        if not name:
            return None

        # Position
        position_raw = row.get("pos", "").strip()
        position = POSITION_MAP.get(position_raw, position_raw)

        # Team
        team = row.get("team", "").strip()
        if team == "NA" or not team:
            team = None

        # Value and ECR based on format
        if superflex:
            value_str = row.get("value_2qb", "")
            ecr_str = row.get("ecr_2qb", "")
        else:
            value_str = row.get("value_1qb", "")
            ecr_str = row.get("ecr_1qb", "")

        # Parse value
        value = None
        if value_str and value_str != "NA":
            try:
                value = int(float(value_str))
            except (ValueError, TypeError):
                pass

        # Parse ECR as rank
        rank = None
        if ecr_str and ecr_str != "NA":
            try:
                rank = int(float(ecr_str))
            except (ValueError, TypeError):
                pass

        # Skip if no value
        if value is None:
            return None

        # Age
        age = None
        age_str = row.get("age", "")
        if age_str and age_str != "NA":
            try:
                age = float(age_str)
            except (ValueError, TypeError):
                pass

        # Position rank from ecr_pos
        position_rank = None
        ecr_pos_str = row.get("ecr_pos", "")
        if ecr_pos_str and ecr_pos_str != "NA":
            try:
                position_rank = int(float(ecr_pos_str))
            except (ValueError, TypeError):
                pass

        return {
            "name": name,
            "position": position,
            "position_rank": position_rank,
            "team": team,
            "value": value,
            "age": age,
            "tier": None,
            "rank": rank,
            "is_superflex": superflex,
            "is_te_premium": False,
        }

    except Exception as e:
        print(f"Error parsing row: {e}")
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
        # Show 1QB top 10
        players_1qb = [p for p in players if not p["is_superflex"]]
        players_1qb.sort(key=lambda x: x.get("value", 0) or 0, reverse=True)
        print("\n1QB Rankings:")
        for i, p in enumerate(players_1qb[:10]):
            print(f"  {i+1}. {p['name']} ({p['position']}) - Value: {p['value']}, ECR: {p.get('rank')}")

        # Show SF top 10
        players_sf = [p for p in players if p["is_superflex"]]
        players_sf.sort(key=lambda x: x.get("value", 0) or 0, reverse=True)
        print("\nSuperFlex Rankings:")
        for i, p in enumerate(players_sf[:10]):
            print(f"  {i+1}. {p['name']} ({p['position']}) - Value: {p['value']}, ECR: {p.get('rank')}")

        print(f"\n  Total: {len(players)} entries")
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
                "source": "dynastyprocess",
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
    parser = argparse.ArgumentParser(description="Fetch DynastyProcess dynasty rankings")
    parser.add_argument("--dry-run", action="store_true", help="Don't write to database")

    args = parser.parse_args()

    players = fetch_dynastyprocess_rankings()
    insert_rankings(players, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
