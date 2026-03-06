#!/usr/bin/env python3
"""
IDP Show Dynasty Rankings CSV Importer for MyDynastyValues.

Parses the IDP Show dynasty rankings CSV and inserts into
external_rankings with source="idpshow". Uses the same
exponential decay rank-to-value formula as the FantasyPros IDP
scraper for consistent cross-source value scaling.

CSV format: OVR, PLAYER, TEAM, POS (ED/IDL/LB/CB/S), POS RK, ...

Usage:
    python scripts/import_idpshow.py
    python scripts/import_idpshow.py --dry-run
    python scripts/import_idpshow.py --csv data/IDPShow_custom.csv
"""

import csv
import math
import os
import sys
import argparse
from datetime import datetime
from typing import Optional

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


DEFAULT_CSV = "data/IDPShow Dynasty Data 022326.csv"

POSITION_MAP: dict[str, str] = {
    "ED": "EDR",
    "IDL": "IL",
    "LB": "LB",
    "CB": "CB",
    "S": "S",
}


def rank_to_value(rank: int) -> int:
    """Convert OVR rank to a value on the 0-10000 scale.

    Uses the same exponential decay constant (0.012) as the
    FantasyPros IDP scraper for consistent cross-source scaling.
    """
    raw = 10000 * math.exp(-0.012 * (rank - 1))
    return max(100, int(raw))


def parse_csv(csv_path: str) -> list[dict]:
    """Parse IDP Show CSV into a list of player dicts."""
    players: list[dict] = []

    with open(csv_path, "r", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = next(reader)

        # Find column indices by name
        col_map = {h.strip(): i for i, h in enumerate(header)}
        ovr_idx = col_map.get("OVR", 0)
        name_idx = col_map.get("PLAYER", 1)
        team_idx = col_map.get("TEAM", 2)
        pos_idx = col_map.get("POS", 3)
        pos_rk_idx = col_map.get("POS RK", 4)

        for row in reader:
            if len(row) < 5:
                continue

            ovr_str = row[ovr_idx].strip()
            try:
                ovr = int(ovr_str)
            except ValueError:
                continue

            name = row[name_idx].strip()
            team = row[team_idx].strip() or None
            pos_raw = row[pos_idx].strip()
            pos_rk = row[pos_rk_idx].strip()

            position = POSITION_MAP.get(pos_raw)
            if not position:
                print(f"  Unknown position '{pos_raw}' for {name}")
                continue

            # Extract numeric position rank (e.g. "CB001" → 1)
            pos_rank_num: Optional[int] = None
            if pos_rk:
                digits = "".join(c for c in pos_rk if c.isdigit())
                if digits:
                    pos_rank_num = int(digits)

            value = rank_to_value(ovr)

            players.append({
                "name": name,
                "position": position,
                "team": team,
                "rank": ovr,
                "position_rank": pos_rank_num,
                "value": value,
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
    """Insert IDP Show rankings into the database."""
    if dry_run:
        print(f"\n[DRY RUN] Would insert {len(players)} IDP Show "
              "players:")
        for p in players:
            print(
                f"  {p['rank']:>3}. {p['name']:<30} "
                f"({p['position']}) "
                f"- Value: {p['value']}"
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
                    rank, position_rank, value,
                    is_super_flex, is_te_premium, season,
                    fetched_at
                ) VALUES (
                    %(source)s, %(name)s, %(position)s, %(team)s,
                    %(rank)s, %(pos_rank)s, %(value)s,
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
                    fetched_at = NOW()
            """, {
                "source": "idpshow",
                "name": p["name"],
                "position": p["position"],
                "team": p.get("team"),
                "rank": p.get("rank"),
                "pos_rank": p.get("position_rank"),
                "value": p.get("value"),
                "sf": False,
                "tep": False,
                "season": season,
            })

        conn.commit()
        print(f"\nInserted/updated {len(players)} IDP Show rankings")

    except Exception as e:
        conn.rollback()
        print(f"Error inserting rankings: {e}")
        raise
    finally:
        cur.close()
        conn.close()


def main() -> None:
    """Entry point for the IDP Show importer."""
    parser = argparse.ArgumentParser(
        description="Import IDP Show dynasty rankings from CSV",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Don't write to database",
    )
    parser.add_argument(
        "--csv",
        default=DEFAULT_CSV,
        help=f"Path to CSV file (default: {DEFAULT_CSV})",
    )

    args = parser.parse_args()

    if not os.path.exists(args.csv):
        print(f"CSV file not found: {args.csv}")
        sys.exit(1)

    print(f"=== IDP Show Rankings Import ===")
    print(f"CSV: {args.csv}")
    print()

    players = parse_csv(args.csv)
    if not players:
        print("No players parsed from CSV")
        sys.exit(1)

    # Position breakdown
    pos_counts: dict[str, int] = {}
    for p in players:
        pos_counts[p["position"]] = (
            pos_counts.get(p["position"], 0) + 1
        )

    print(f"Parsed {len(players)} players")
    print(f"Positions: {pos_counts}")
    print()

    insert_rankings(players, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
