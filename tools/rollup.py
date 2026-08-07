#!/usr/bin/env python3
"""Materialise L2 aggregates from the metric views.

The views are the definition; these tables are only a cache. Anything the
dashboard asks for over a range longer than a week reads from here, because
scanning 180k events per question does not survive a term of real data.

    python3 tools/rollup.py --db aac.db [--window-days 14]

Idempotent: deletes and rewrites the rows it owns.
"""
from __future__ import annotations

import argparse
import sqlite3
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def rollup_daily_metrics(conn: sqlite3.Connection) -> int:
    """agg_daily_metric: the TRUE daily value, with `n` always alongside.

    min_n suppression is enforced at READ time, at the reader's own grain —
    never at write time. Writing NULL for a below-min_n day looked safe but
    destroyed every window aggregate built on top: correction_adjacent_rate
    runs ~6 corrections/day against min_n=10, so almost every daily row was
    NULL and a 28-day window with 170 real samples reported from the 53 that
    happened to cluster (measured: 0.15 shown vs 0.51 true). A day-grain
    reader (timeseries, charts) masks days below min_n; a window-grain reader
    (dashboard cards, MCP get_metrics) sums n across the window and suppresses
    on the WINDOW total. `n` stored per day is what makes both possible, and
    still distinguishes "too little data" from "nothing happened".
    """
    conn.execute("DELETE FROM agg_daily_metric")
    cur = conn.execute("""
        INSERT INTO agg_daily_metric (child_id, day_local, metric_id, value, n)
        SELECT v.child_id, v.day_local, v.metric_id, v.value, v.n
        FROM v_daily_metrics_all v
        WHERE v.day_local IS NOT NULL
    """)
    return cur.rowcount


def rollup_card_stats(conn: sqlite3.Connection, window_days: int) -> int:
    conn.execute("DELETE FROM agg_card_stats")
    cur = conn.execute(f"""
        INSERT INTO agg_card_stats
          (child_id, card_id, window_start, window_end, taps, mistaps,
           adjacent_corrections, repeat_runs, zero_days, last_used_day, scenes_used)
        SELECT
          s.child_id, s.card_id,
          date((SELECT MAX(day_local) FROM events), '-{window_days - 1} days'),
          (SELECT MAX(day_local) FROM events),
          s.taps,
          COALESCE(m.mistaps, 0),
          COALESCE(m.adjacent, 0),
          COALESCE(r.repeat_runs, 0),
          s.days_since_last,
          s.last_day,
          COALESCE(sc.scenes, '[]')
        FROM v_card_stats s
        LEFT JOIN (
          SELECT child_id, card_id, COUNT(*) AS mistaps, SUM(correction_adjacent) AS adjacent
          FROM v_mistaps GROUP BY child_id, card_id
        ) m ON m.child_id = s.child_id AND m.card_id = s.card_id
        LEFT JOIN v_repeat_runs_by_card r
               ON r.child_id = s.child_id AND r.card_id = s.card_id
        LEFT JOIN (
          SELECT child_id, label, json_group_array(DISTINCT scene) AS scenes
          FROM v_scene_matrix GROUP BY child_id, label
        ) sc ON sc.child_id = s.child_id AND sc.label = s.label
    """)
    return cur.rowcount


def rollup_cell_heat(conn: sqlite3.Connection, window_days: int) -> int:
    conn.execute("DELETE FROM agg_cell_heat")
    cur = conn.execute(f"""
        INSERT INTO agg_cell_heat
          (child_id, board_id, grid_rows, grid_cols, grid_row, grid_col,
           window_start, window_end, taps, mistaps)
        SELECT child_id, board_id, grid_rows, grid_cols, grid_row, grid_col,
               date((SELECT MAX(day_local) FROM events), '-{window_days - 1} days'),
               (SELECT MAX(day_local) FROM events),
               SUM(taps), SUM(mistaps)
        FROM v_cell_heat
        WHERE day_local >= date((SELECT MAX(day_local) FROM events), '-{window_days - 1} days')
        GROUP BY child_id, board_id, grid_rows, grid_cols, grid_row, grid_col
    """)
    return cur.rowcount


def rollup_word_pairs(conn: sqlite3.Connection, window_days: int) -> int:
    conn.execute("DELETE FROM agg_word_pairs")
    cur = conn.execute(f"""
        INSERT INTO agg_word_pairs
          (child_id, word_a, word_b, window_start, window_end, solo_a, solo_b, together)
        SELECT child_id, word_a, word_b,
               date((SELECT MAX(day_local) FROM events), '-{window_days - 1} days'),
               (SELECT MAX(day_local) FROM events),
               solo_a, solo_b, together
        FROM v_word_pairs
    """)
    return cur.rowcount


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(ROOT / "aac.db"))
    ap.add_argument("--window-days", type=int, default=28)
    args = ap.parse_args()

    conn = sqlite3.connect(args.db)
    conn.execute("PRAGMA foreign_keys = ON")
    started = time.monotonic()

    counts = {
        "agg_daily_metric": rollup_daily_metrics(conn),
        "agg_card_stats":   rollup_card_stats(conn, args.window_days),
        "agg_cell_heat":    rollup_cell_heat(conn, args.window_days),
        "agg_word_pairs":   rollup_word_pairs(conn, args.window_days),
    }
    conn.commit()

    suppressed = conn.execute(
        "SELECT COUNT(*) FROM agg_daily_metric WHERE value IS NULL"
    ).fetchone()[0]
    conn.execute("ANALYZE")
    conn.commit()
    conn.close()

    elapsed = time.monotonic() - started
    print(f"rollup complete in {elapsed:.2f}s")
    for table, n in counts.items():
        print(f"  {table:<20} {n:>7,}")
    print(f"  {'suppressed (n<min_n)':<20} {suppressed:>7,}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
