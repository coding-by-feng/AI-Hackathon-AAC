#!/usr/bin/env python3
"""The gate. Fails the build if the analytics layer is lying.

    python3 tools/verify.py --db aac.db

Checks, in order of how badly a failure would hurt a real child:

  SAFETY     clinical constraints are enforced in data, not in copywriting
  COVERAGE   every insight rule can actually fire on plausible data
  RESTRAINT  the control child triggers no intervention
  INTEGRITY  metrics agree with their catalogue; no orphans; no silent nulls

An insight that cannot be made to fire on realistic seed data has a broken rule,
not unlucky data. That is the whole point of checking it here rather than
discovering it in front of a speech therapist.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTROL_CHILD = "amara_o"
ALL_INSIGHTS = ["I1", "I2", "I3", "I4", "I5", "I6", "I7", "I8"]

GREEN, RED, YELLOW, DIM, RESET = "\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[0m"


class Report:
    def __init__(self) -> None:
        self.failures: list[str] = []
        self.warnings: list[str] = []

    def check(self, section: str, name: str, ok: bool, detail: str = "") -> None:
        mark = f"{GREEN}PASS{RESET}" if ok else f"{RED}FAIL{RESET}"
        print(f"  [{mark}] {name}" + (f"  {DIM}{detail}{RESET}" if detail else ""))
        if not ok:
            self.failures.append(f"{section}: {name} — {detail}")

    def warn(self, name: str, detail: str = "") -> None:
        print(f"  [{YELLOW}WARN{RESET}] {name}" + (f"  {DIM}{detail}{RESET}" if detail else ""))
        self.warnings.append(f"{name} — {detail}")


# ---------------------------------------------------------------------------
# SAFETY — the clinical constraints, checked against data
# ---------------------------------------------------------------------------

def check_safety(conn: sqlite3.Connection, r: Report) -> None:
    print("\nSAFETY  (docs/aac-clinical-constraints.md)")

    # C1 — repetition must never be classified as an error
    row = conn.execute(
        "SELECT group_code, polarity FROM metrics_catalog WHERE metric_id='repeat_tap_rate'"
    ).fetchone()
    r.check("C1", "repeat_tap_rate is not filed under errors",
            row is not None and row[0] != "B", f"group={row[0] if row else 'MISSING'}")
    r.check("C1", "repeat_tap_rate polarity is neutral",
            row is not None and row[1] == "neutral",
            f"polarity={row[1] if row else 'MISSING'} — a neutral metric may not be styled as a warning")

    # The real test is that no rule RECOMMENDS it — not how many happen to
    # list it as forbidden. Counting forbid-entries was measuring paperwork.
    repetition_terms = ("reduc", "discourag", "stop the repet", "limit repet",
                        "extinguish", "prevent repet")
    offenders = [
        iid for iid, rec in conn.execute(
            "SELECT insight_id, lower(recommended_actions) FROM insights_catalog")
        if "repet" in rec and any(t in rec for t in repetition_terms)
    ]
    r.check("C1", "no insight recommends reducing repetition",
            not offenders, f"offenders: {offenders}")

    # C2/C3 — never move or resize. Test the BEHAVIOUR, not the DDL text: an
    # earlier version of this check passed by reading a comment that happened to
    # contain the word 'move'. Try the insert and require it to be rejected.
    rejected = []
    for kind in ("move", "resize", "remove"):
        try:
            conn.execute(
                "INSERT INTO board_change_proposals "
                "(proposal_id, child_id, board_id, proposed_at, proposed_by, "
                " change_kind, rationale) VALUES (?,?,?,?,?,?,?)",
                (f"_probe_{kind}", "maya_t", "board_maya_t", 0, "verify", kind, "probe"),
            )
            conn.execute("DELETE FROM board_change_proposals WHERE proposal_id=?",
                         (f"_probe_{kind}",))
        except sqlite3.IntegrityError:
            rejected.append(kind)
    conn.rollback()
    r.check("C2/C3", "board_change_proposals rejects move / resize / remove",
            len(rejected) == 3,
            f"rejected {rejected} — a model can propose masking, never relocating")

    bad = conn.execute("""
        SELECT insight_id FROM insights_catalog
        WHERE (recommended_actions LIKE '%resize the grid%'
            OR recommended_actions LIKE '%move the card%'
            OR recommended_actions LIKE '%relocate%')
    """).fetchall()
    r.check("C2/C3", "no insight recommends relocating a learned button",
            not bad, f"offenders: {[b[0] for b in bad]}")

    # An action must never appear in both lists for the same insight
    overlaps = []
    for iid, rec, forb in conn.execute(
        "SELECT insight_id, recommended_actions, forbidden_actions FROM insights_catalog"
    ):
        f_terms = set(json.loads(forb))
        rec_text = rec.lower()
        for term in f_terms:
            if term.replace("_", " ") in rec_text:
                overlaps.append(f"{iid}:{term}")
    r.check("consistency", "no action is both recommended and forbidden",
            not overlaps, f"overlaps: {overlaps}")

    # C4 — a mode must not carry its own positions
    drift = conn.execute("""
        SELECT child_id, value FROM agg_daily_metric
        WHERE metric_id = 'position_consistency' AND value < 1.0
    """).fetchall()
    r.check("C4", "every AI mode is a filtered view of the robust board",
            not drift, f"position_consistency < 1.0 for: {[d[0] for d in drift]}")

    # C4 — modes hold no coordinates, structurally
    mode_cells = conn.execute("""
        SELECT COUNT(*) FROM board_cells bc
        JOIN boards b ON b.board_id = bc.board_id WHERE b.kind = 'mode'
    """).fetchone()[0]
    r.check("C4", "no board_cells rows belong to a mode",
            mode_cells == 0, f"{mode_cells} rows found")

    # I4 case A must never propose removing core vocabulary
    core_removal = conn.execute("""
        SELECT COUNT(*) FROM v_i4_unused_vocabulary v
        JOIN cards c ON c.card_id = v.card_id
        WHERE v.triggered = 1 AND v.suggested_disposition = 'replace'
          AND (c.is_core = 1 OR c.is_essential = 1)
    """).fetchone()[0]
    r.check("C5", "never proposes removing a core or essential word",
            core_removal == 0,
            f"{core_removal} proposals — core vocabulary is a modelling target, not dead weight")

    # I4 case B must carry no intervention
    pref = conn.execute("""
        SELECT COUNT(*) FROM v_i4_unused_vocabulary
        WHERE case_kind = 'preference' AND suggested_disposition <> 'no_action'
    """).fetchone()[0]
    r.check("C1/autonomy", "a refusal is never routed to retraining",
            pref == 0, f"{pref} preference rows carry an intervention")


# ---------------------------------------------------------------------------
# COVERAGE — every rule must be able to fire
# ---------------------------------------------------------------------------

def check_coverage(conn: sqlite3.Connection, r: Report) -> None:
    print("\nCOVERAGE  (every rule fires on plausible data)")
    fired = {
        iid: (child, n)
        for iid, child, n in conn.execute(
            "SELECT insight_id, child_id, evidence_rows FROM v_insights_fired"
        )
    }
    # The coverage assertion, like the plant assertions below, is only
    # meaningful while some planter is active inside the rules' evaluation
    # window — persona day-indices are tuned for --days 42.
    win14 = conn.execute(
        "SELECT date(MAX(day_local), '-13 days'), MAX(day_local) FROM events"
    ).fetchone()
    sys.path.insert(0, str(ROOT))
    try:
        from tools.seed.personas import EXPECTED_FIRING as _EXP
    except Exception:                                          # pragma: no cover
        _EXP = {}
    for iid in ALL_INSIGHTS:
        hit = conn.execute(
            "SELECT child_id, evidence_rows FROM v_insights_fired WHERE insight_id=? LIMIT 1",
            (iid,),
        ).fetchone()
        name = conn.execute(
            "SELECT name FROM insights_catalog WHERE insight_id=?", (iid,)
        ).fetchone()
        if hit is None and iid in _EXP:
            planters_active = any(
                conn.execute(
                    "SELECT 1 FROM events WHERE child_id=? AND actor='child' "
                    "AND day_local BETWEEN ? AND ? LIMIT 1",
                    (c, win14[0], win14[1])).fetchone()
                for c in _EXP[iid])
            if not planters_active:
                r.warn(f"{iid} has no active planter at this horizon",
                       "every persona that plants this pattern is silent in the "
                       "final 14 days of data — the windowed rule correctly sees nothing")
                continue
        r.check("coverage", f"{iid} fires — {name[0] if name else '?'}",
                hit is not None,
                f"first hit: {hit[0]} ({hit[1]} rows)" if hit else
                "RULE IS BROKEN or no persona plants it")

    # personas.py declares what it plants; the database must agree
    sys.path.insert(0, str(ROOT))
    try:
        from tools.seed.personas import EXPECTED_FIRING
    except Exception as exc:                                   # pragma: no cover
        r.warn("persona expectations unavailable", str(exc))
        return

    # Plant assertions are only meaningful while the planted pattern is still
    # inside the rules' evaluation window. Persona day-indices are tuned for
    # --days 42; at longer horizons (a 180-day build) a child like jonah_k has
    # been silent for months, the windowed rule CORRECTLY stays quiet, and
    # failing here would push someone to "fix" a rule that is right. The gate
    # is data-driven, not horizon-driven: no child activity in the last 14
    # days of data ⇒ the plant is stale, warn instead of assert.
    win = conn.execute(
        "SELECT date(MAX(day_local), '-13 days'), MAX(day_local) FROM events"
    ).fetchone()
    for iid, children in EXPECTED_FIRING.items():
        for child in children:
            got = conn.execute(
                "SELECT 1 FROM v_insights_fired WHERE insight_id=? AND child_id=?",
                (iid, child),
            ).fetchone()
            if not got:
                active = conn.execute(
                    "SELECT 1 FROM events WHERE child_id=? AND actor='child' "
                    "AND day_local BETWEEN ? AND ? LIMIT 1",
                    (child, win[0], win[1]),
                ).fetchone()
                if not active:
                    r.warn(
                        f"{iid} plant for {child} predates the rule window",
                        "no child activity in the final 14 days of data — the "
                        "windowed rule cannot see the planted pattern at this horizon",
                    )
                    continue
            r.check("coverage", f"{iid} fires for {child} as planted", got is not None,
                    "" if got else "persona declares this plant but the rule did not fire")


# ---------------------------------------------------------------------------
# RESTRAINT — the control child
# ---------------------------------------------------------------------------

def check_restraint(conn: sqlite3.Connection, r: Report) -> None:
    print(f"\nRESTRAINT  (control child: {CONTROL_CHILD})")
    rows = conn.execute("""
        SELECT f.insight_id, ic.action_kind, f.evidence_rows
        FROM v_insights_fired f
        JOIN insights_catalog ic ON ic.insight_id = f.insight_id
        WHERE f.child_id = ?
    """, (CONTROL_CHILD,)).fetchall()

    interventions = [x for x in rows if x[1] == "intervention"]
    r.check("restraint", "control child triggers no intervention",
            not interventions,
            f"fired: {[x[0] for x in interventions]} — a dashboard that cries wolf gets ignored")

    informational = [x for x in rows if x[1] != "intervention"]
    if informational:
        print(f"  {DIM}      informational only (acceptable): "
              f"{[(x[0], x[2]) for x in informational]}{RESET}")


# ---------------------------------------------------------------------------
# INTEGRITY
# ---------------------------------------------------------------------------

def check_integrity(conn: sqlite3.Connection, r: Report) -> None:
    print("\nINTEGRITY")

    fk = conn.execute("PRAGMA foreign_key_check").fetchall()
    r.check("integrity", "no foreign key violations", not fk, f"{len(fk)} violations")

    orphan = conn.execute("""
        SELECT COUNT(*) FROM agg_daily_metric a
        LEFT JOIN metrics_catalog m ON m.metric_id = a.metric_id
        WHERE m.metric_id IS NULL
    """).fetchone()[0]
    r.check("integrity", "every stored metric exists in the catalogue",
            orphan == 0, f"{orphan} orphan rows")

    # min_n is enforced at READ time, at each reader's own grain — the store
    # keeps the true daily value so window aggregates are computable (writing
    # NULL destroyed them: a 28-day window with 170 corrections reported from
    # the 53 that cleared the daily bar). The publishable contract is therefore
    # that `n` rides with every value, so every reader CAN gate. A row with a
    # value and no n is the one thing that makes read-time suppression
    # impossible, and that is what fails the gate.
    ungated = conn.execute("""
        SELECT COUNT(*) FROM agg_daily_metric
        WHERE value IS NOT NULL AND (n IS NULL OR n <= 0)
    """).fetchone()[0]
    r.check("integrity", "every stored value carries the n a reader gates on",
            ungated == 0, f"{ungated} values stored without a sample size")

    # Not every shown metric is a daily scalar. The dimensional ones live in
    # their own tables; checking them against agg_daily_metric reported eleven
    # false gaps.
    DIMENSIONAL = {
        "cell_heat":              "SELECT COUNT(*) FROM agg_cell_heat",
        "card_frequency":         "SELECT COUNT(*) FROM agg_card_stats",
        "zero_activation_days":   "SELECT COUNT(*) FROM agg_card_stats WHERE zero_days > 0",
        "word_pairs":             "SELECT COUNT(*) FROM agg_word_pairs",
        "nav_depth_by_card":      "SELECT COUNT(*) FROM v_card_stats WHERE avg_nav_depth > 0",
        "scene_distribution":     "SELECT COUNT(*) FROM v_scene_matrix",
        "pragmatic_function_mix": "SELECT COUNT(*) FROM v_function_mix",
    }
    # Defined, deliberately not yet produced by the generator. Named so the gap
    # is a decision on the record rather than a silent blank tile.
    NOT_YET_GENERATED = {
        "suggestion_acceptance": "needs suggestion_shown / suggestion_tap events",
        "vocabulary_gaps":       "needs gap_detected events",
        "visual_source_split":   "needs gap_detected events",
        "keyboard_use":          "needs the alphabet feature to exist (constraint C8)",
    }

    for mid, sql in DIMENSIONAL.items():
        n = conn.execute(sql).fetchone()[0]
        r.check("integrity", f"{mid} has data", n > 0, f"{n:,} rows")

    scalar_missing = conn.execute("""
        SELECT m.metric_id FROM metrics_catalog m
        WHERE m.status = 'shown'
          AND NOT EXISTS (SELECT 1 FROM agg_daily_metric a WHERE a.metric_id = m.metric_id)
    """).fetchall()
    unexplained = [m[0] for m in scalar_missing
                   if m[0] not in DIMENSIONAL and m[0] not in NOT_YET_GENERATED]
    r.check("integrity", "no unexplained empty metric", not unexplained,
            f"unexplained: {unexplained}")
    if NOT_YET_GENERATED:
        r.warn("known gaps in seed data",
               "; ".join(f"{k} ({v})" for k, v in NOT_YET_GENERATED.items()))

    dupes = conn.execute("""
        SELECT COUNT(*) FROM (
          SELECT child_id, day_local, metric_id FROM agg_daily_metric
          GROUP BY 1,2,3 HAVING COUNT(*) > 1)
    """).fetchone()[0]
    r.check("integrity", "no duplicate metric rows", dupes == 0, f"{dupes} duplicates")

    days = conn.execute("SELECT COUNT(DISTINCT day_local) FROM events").fetchone()[0]
    kids = conn.execute("SELECT COUNT(*) FROM children").fetchone()[0]
    evts = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    r.check("integrity", "enough history for a 4-week baseline", days >= 28,
            f"{days} days, {kids} children, {evts:,} events")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(ROOT / "aac.db"))
    args = ap.parse_args()

    conn = sqlite3.connect(args.db)
    conn.execute("PRAGMA foreign_keys = ON")
    report = Report()

    check_safety(conn, report)
    check_coverage(conn, report)
    check_restraint(conn, report)
    check_integrity(conn, report)
    conn.close()

    print()
    if report.failures:
        print(f"{RED}FAILED{RESET} — {len(report.failures)} check(s)")
        for f in report.failures:
            print(f"  · {f}")
        return 1
    if report.warnings:
        print(f"{GREEN}PASSED{RESET} with {len(report.warnings)} warning(s)")
        return 0
    print(f"{GREEN}PASSED{RESET} — all checks green")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
