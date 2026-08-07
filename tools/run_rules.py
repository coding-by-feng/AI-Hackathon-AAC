#!/usr/bin/env python3
"""Evaluate the eight diagnostic rules and materialise `fired_rules`.

    python3 tools/run_rules.py --db aac.db

Runs nightly (the /api/cron/rules handler in production). Plain SQL, no model:
the rules must be deterministic and explainable to a speech therapist.

Why this exists rather than the MCP server querying the views directly: the
insight views scan the event table with window functions. Under concurrent
write load they took over five seconds at p99 — the dashboard would stall
whenever a class was mid-session. tools/concurrency_test.py catches that.
So the rules run once, here, and everyone reads the resulting rows.

A model may later narrate a fired rule (`insights.fired_rule_id`), but it can
never invent one.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Which view carries the evidence for each rule, and how much of it to keep.
# I4 is capped because unused-vocabulary housekeeping can return dozens of rows
# and nobody acts on more than a handful.
RULES: dict[str, tuple[str, int]] = {
    "I1": ("v_i1_mistap_classification", 1),
    "I2": ("v_i2_scanning_load", 1),
    "I3": ("v_i3_buried_words", 10),
    "I4": ("v_i4_unused_vocabulary", 15),
    "I5": ("v_i5_summary", 1),
    "I6": ("v_i6_scene_bound", 10),
    "I7": ("v_i7_modeling_gap", 1),
    "I8": ("v_i8_layout_disruption", 10),
}


def rows_as_dicts(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> list[dict]:
    cur = conn.execute(sql, params)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(ROOT / "aac.db"))
    ap.add_argument("--keep-dismissed", action="store_true",
                    help="preserve dismissals by superseding rather than deleting")
    args = ap.parse_args()

    conn = sqlite3.connect(args.db)
    conn.execute("PRAGMA foreign_keys = ON")
    started = time.monotonic()

    window = conn.execute("SELECT w_start, w_end FROM v_window").fetchone()
    now_ms = int(time.time() * 1000)

    # A dismissal is the only feedback we get on whether a rule is any good, so
    # a re-run must never silently erase one. Previous rows are superseded.
    conn.execute("""
        UPDATE fired_rules SET superseded_by = 'pending'
        WHERE superseded_by IS NULL AND dismissed_at IS NULL
    """)

    fired: dict[str, int] = {}
    for insight_id, (view, cap) in RULES.items():
        rows = rows_as_dicts(conn, f"SELECT * FROM {view} WHERE triggered = 1")
        by_child: dict[str, list[dict]] = {}
        for r in rows:
            by_child.setdefault(r["child_id"], []).append(r)

        cat = conn.execute(
            "SELECT default_thresholds FROM insights_catalog WHERE insight_id = ?",
            (insight_id,)).fetchone()
        thresholds = cat[0] if cat else "{}"

        for child_id, evidence in by_child.items():
            fired_rule_id = f"fr_{uuid.uuid4().hex[:16]}"
            classification = None
            if insight_id == "I1" and evidence:
                e = evidence[0]
                adj = e.get("adjacent_ratio") or 0
                classification = json.dumps({
                    "motor_share": round(adj, 3),
                    "semantic_share": round(1 - adj, 3),
                    "verdict": e.get("classification"),
                })
            conn.execute(
                "INSERT INTO fired_rules (fired_rule_id, child_id, insight_id, fired_at,"
                " window_start, window_end, evidence, thresholds_used, classification)"
                " VALUES (?,?,?,?,?,?,?,?,?)",
                (fired_rule_id, child_id, insight_id, now_ms, window[0], window[1],
                 json.dumps(evidence[:cap], default=str), thresholds, classification),
            )
            fired[insight_id] = fired.get(insight_id, 0) + 1

    # Point the superseded rows at whatever replaced them, per child and rule.
    conn.execute("""
        UPDATE fired_rules AS old
        SET superseded_by = (
          SELECT new.fired_rule_id FROM fired_rules AS new
          WHERE new.child_id = old.child_id AND new.insight_id = old.insight_id
            AND new.fired_at = ? AND new.superseded_by IS NULL
          LIMIT 1)
        WHERE old.superseded_by = 'pending'
    """, (now_ms,))
    # Nothing replaced them: the rule stopped firing, which is a resolution.
    conn.execute("UPDATE fired_rules SET superseded_by = NULL WHERE superseded_by = 'pending'")
    conn.commit()

    open_now = conn.execute("""
        SELECT COUNT(*) FROM fired_rules
        WHERE dismissed_at IS NULL AND superseded_by IS NULL
    """).fetchone()[0]
    conn.close()

    print(f"rules evaluated in {time.monotonic() - started:.2f}s  "
          f"window {window[0]} .. {window[1]}")
    for iid in RULES:
        print(f"  {iid}  {fired.get(iid, 0)} child(ren)")
    print(f"  open findings: {open_now}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
