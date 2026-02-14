#!/usr/bin/env python3
"""
KeepTradeCut Scraper for DynastyRanks

Scrapes dynasty rankings from KeepTradeCut and inserts into our database.
Handles 1QB, SuperFlex, and TE Premium variants.

Usage:
    python scripts/scrape_ktc.py
    python scripts/scrape_ktc.py --dry-run
    python scripts/scrape_ktc.py --superflex --tep

Based on: https://github.com/ees4/KeepTradeCut-Scraper
"""

import os
import sys
import argparse
from datetime import datetime
from typing import Optional
import json

import requests
from bs4 import BeautifulSoup
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
    from psycopg2.extras import execute_values
except ImportError:
    print("psycopg2 not installed. Run: pip install psycopg2-binary")
    sys.exit(1)


# Constants
KTC_BASE_URL = "https://keeptradecut.com"
DYNASTY_RANKINGS_URL = f"{KTC_BASE_URL}/dynasty-rankings"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"

# Position mapping (KTC uses different names)
POSITION_MAP = {
    "QB": "QB",
    "RB": "RB",
    "WR": "WR",
    "TE": "TE",
    "K": "K",
    # IDP positions (if KTC ever adds them)
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
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
    })
    return session


def scrape_ktc_rankings(
    superflex: bool = False,
    te_premium: bool = False,
    max_pages: int = 10,
) -> list[dict]:
    """
    Scrape dynasty rankings from KeepTradeCut.

    Args:
        superflex: Whether to scrape SuperFlex rankings
        te_premium: Whether to scrape TE Premium rankings
        max_pages: Maximum number of pages to scrape

    Returns:
        List of player dictionaries with rankings data
    """
    session = get_session()
    players = []

    # Build URL with parameters
    params = []
    if superflex:
        params.append("format=2")  # 2 = SuperFlex
    else:
        params.append("format=1")  # 1 = 1QB

    if te_premium:
        params.append("tep=1")

    param_str = "&".join(params) if params else ""

    print(f"Scraping KTC rankings (SF={superflex}, TEP={te_premium})...")

    for page in tqdm(range(1, max_pages + 1), desc="Pages"):
        url = f"{DYNASTY_RANKINGS_URL}?page={page}&{param_str}"

        try:
            response = session.get(url, timeout=30)
            response.raise_for_status()
        except requests.RequestException as e:
            print(f"Error fetching page {page}: {e}")
            continue

        soup = BeautifulSoup(response.text, "html.parser")

        # Find all player rows
        player_rows = soup.find_all("div", class_="onePlayer")

        if not player_rows:
            # No more players, stop
            break

        for row in player_rows:
            player = parse_player_row(row)
            if player:
                player["is_superflex"] = superflex
                player["is_te_premium"] = te_premium
                players.append(player)

    print(f"Scraped {len(players)} players")
    return players


def extract_team_from_name(player_name: str) -> tuple[str, str, bool]:
    """
    Extract team abbreviation from player name suffix.
    KTC appends team codes to names like "Patrick MahomesKCC" or "Bijan RobinsonRATL".

    Returns: (clean_name, team, is_rookie)
    """
    if not player_name:
        return "", "", False

    # Check for various suffixes: RFA, R+team (rookie), FA, or team abbrev
    suffix = ""
    if len(player_name) >= 3 and player_name[-3:] == "RFA":
        suffix = "RFA"
    elif len(player_name) >= 4 and player_name[-4] == "R" and player_name[-3:].isupper():
        # Rookie designation: R + 3-letter team (e.g., "RATL")
        suffix = player_name[-4:]
    elif len(player_name) >= 2 and player_name[-2:] == "FA":
        suffix = "FA"
    elif len(player_name) >= 3 and player_name[-3:].isupper():
        # Standard 3-letter team (e.g., "KCC")
        suffix = player_name[-3:]
    elif len(player_name) >= 2 and player_name[-2:].isupper():
        # 2-letter team (e.g., "GB", "SF")
        suffix = player_name[-2:]

    # Clean the name
    clean_name = player_name.replace(suffix, "").strip() if suffix else player_name

    # Determine team and rookie status
    is_rookie = False
    team = ""
    if suffix:
        if suffix == "RFA" or suffix == "FA":
            team = "FA"
        elif suffix.startswith("R") and len(suffix) == 4:
            team = suffix[1:]  # Remove 'R' prefix
            is_rookie = True
        else:
            team = suffix

    return clean_name, team, is_rookie


def parse_player_row(row) -> Optional[dict]:
    """Parse a single player row from KTC HTML."""
    try:
        # Player name - get raw text which includes team suffix
        name_elem = row.find("a", class_="player-name")
        if not name_elem:
            name_elem = row.find("div", class_="player-name")

        raw_name = name_elem.text.strip() if name_elem else None
        if not raw_name:
            return None

        # Extract team from name suffix (KTC format)
        name, team, is_rookie = extract_team_from_name(raw_name)

        # Check if this is a draft pick (e.g., "2028 Early 1st")
        if any(year in name for year in ["2025", "2026", "2027", "2028", "2029"]):
            # This is a draft pick, not a player
            position = "PICK"
            position_rank = None
        else:
            # Position - get from position element
            pos_elem = row.find("p", class_="position")
            if not pos_elem:
                pos_elem = row.find("span", class_="position")
            position_raw = pos_elem.text.strip() if pos_elem else "?"

            # Extract position and position rank (e.g., "WR15" -> "WR", 15)
            position = ""
            position_rank = None
            for i, char in enumerate(position_raw):
                if char.isdigit():
                    position = position_raw[:i]
                    position_rank = int(position_raw[i:])
                    break
            else:
                position = position_raw

            # Map position to our standard names
            position = POSITION_MAP.get(position, position)

        # Value
        value_elem = row.find("div", class_="value")
        if not value_elem:
            value_elem = row.find("p", class_="value")
        value_text = value_elem.text.strip() if value_elem else "0"
        # Handle comma-separated numbers
        value_clean = value_text.replace(",", "")
        value = int(value_clean) if value_clean.isdigit() else 0

        # Age - from hidden-xs position element
        age_elem = row.find("p", class_="position hidden-xs")
        if not age_elem:
            age_elem = row.find("p", class_="age")
        age = None
        if age_elem:
            age_text = age_elem.text.strip()
            # Extract just the number from age text
            age_text = "".join(c for c in age_text if c.isdigit() or c == ".")
            try:
                age = float(age_text) if age_text else None
            except ValueError:
                pass

        # Tier (if available)
        tier_elem = row.find("div", class_="tier")
        tier = None
        if tier_elem:
            tier_text = tier_elem.text.strip().replace("Tier ", "")
            try:
                tier = int(tier_text)
            except ValueError:
                pass

        # Rank (overall)
        rank_elem = row.find("p", class_="rank")
        rank = None
        if rank_elem:
            rank_text = rank_elem.text.strip()
            try:
                rank = int(rank_text)
            except ValueError:
                pass

        return {
            "name": name,
            "position": position,
            "position_rank": position_rank,
            "team": team,
            "value": value,
            "age": age,
            "tier": tier,
            "rank": rank,
            "is_rookie": is_rookie,
        }

    except Exception as e:
        print(f"Error parsing player row: {e}")
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
            print(f"  {i+1}. {p['name']} ({p['position']}) - Value: {p['value']}")
        if len(players) > 20:
            print(f"  ... and {len(players) - 20} more")
        return

    conn = get_db_connection()
    cur = conn.cursor()

    try:
        # Get current season
        now = datetime.now()
        season = now.year if now.month >= 9 else now.year - 1

        # Prepare data for insert
        data = []
        for p in players:
            data.append((
                "ktc",  # source
                p["name"],
                p["position"],
                p.get("team"),
                p.get("rank"),
                p.get("position_rank"),
                p.get("value"),
                p.get("tier"),
                p.get("is_superflex", False),
                p.get("is_te_premium", False),
                season,
            ))

        # Upsert into external_rankings
        insert_sql = """
            INSERT INTO external_rankings (
                source, player_name, position, nfl_team,
                rank, position_rank, value, tier,
                is_super_flex, is_te_premium, season, fetched_at
            ) VALUES %s
            ON CONFLICT (source, player_name, position, is_super_flex, is_te_premium, season)
            DO UPDATE SET
                nfl_team = EXCLUDED.nfl_team,
                rank = EXCLUDED.rank,
                position_rank = EXCLUDED.position_rank,
                value = EXCLUDED.value,
                tier = EXCLUDED.tier,
                fetched_at = NOW()
        """

        # Add template for execute_values
        template = "(%(source)s, %(name)s, %(position)s, %(team)s, %(rank)s, %(pos_rank)s, %(value)s, %(tier)s, %(sf)s, %(tep)s, %(season)s, NOW())"

        # Use execute_values for efficient bulk insert
        values = [
            {
                "source": "ktc",
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
            }
            for p in players
        ]

        # Execute with explicit SQL
        for v in tqdm(values, desc="Inserting"):
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
            """, v)

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
    parser = argparse.ArgumentParser(description="Scrape KeepTradeCut dynasty rankings")
    parser.add_argument("--dry-run", action="store_true", help="Don't write to database")
    parser.add_argument("--superflex", "-sf", action="store_true", help="Scrape SuperFlex rankings")
    parser.add_argument("--tep", action="store_true", help="Scrape TE Premium rankings")
    parser.add_argument("--all", action="store_true", help="Scrape all variants (1QB, SF, TEP)")
    parser.add_argument("--pages", type=int, default=10, help="Max pages to scrape")

    args = parser.parse_args()

    if args.all:
        # Scrape all variants
        variants = [
            (False, False),  # 1QB
            (True, False),   # SuperFlex
            (False, True),   # TEP
            (True, True),    # SF + TEP
        ]

        all_players = []
        for sf, tep in variants:
            players = scrape_ktc_rankings(
                superflex=sf,
                te_premium=tep,
                max_pages=args.pages,
            )
            all_players.extend(players)

        insert_rankings(all_players, dry_run=args.dry_run)
    else:
        # Scrape single variant
        players = scrape_ktc_rankings(
            superflex=args.superflex,
            te_premium=args.tep,
            max_pages=args.pages,
        )
        insert_rankings(players, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
