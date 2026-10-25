"""Recompute Category 1-5 hospital/ED access on the regional graph, single OSM facility vs verified 24h EDs.
Usage: python scripts/recompute_access.py   (read-only; prints a markdown table)
Facilities in facilities_verified.csv are positional approximations (see position_quality); entrances NOT verified."""
import sys
from dataclasses import replace
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.engine import Engine  # noqa: E402

REG = ROOT / "data" / "regional"


def main():
    base = Engine.load(REG)
    ver = replace(base, facilities=pd.read_csv(REG / "facilities_verified.csv"), _cache={})
    print("| Cat | Flagler only: origins / nodes | 3 verified EDs: origins / nodes |\n|---|---|---|")
    for c in range(6):
        a, b = base.summary(c), ver.summary(c)
        print(f"| {c} | {a['origins_with_route']}/{a['origins_sampled']} / {a['nodes_with_route']}/{a['nodes_total']} "
              f"| {b['origins_with_route']}/{b['origins_sampled']} / {b['nodes_with_route']}/{b['nodes_total']} |")


if __name__ == "__main__":
    main()
