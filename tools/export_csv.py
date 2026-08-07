#!/usr/bin/env python3
"""Export the analytics data as CSV.

    python3 tools/export_csv.py --db aac.db --out exports/
    python3 tools/export_csv.py --fixture mcp/fixtures/maya_t-last_14d.json --out exports/
    python3 tools/export_csv.py --db aac.db --child maya_t --excel

Source: the DATABASE by default. The MCP fixtures are nested envelopes holding
fourteen differently-shaped payloads; flattening them loses rows the tools
truncated with a `limit`. Use --fixture only when you specifically want the
snapshot a model was given.

TWO THINGS CSV DESTROYS IF YOU LET IT
-------------------------------------
1. A null metric means "measured, but below min_n" — NOT zero. An empty cell is
   summed as zero by Excel and averaged as skipped by Sheets, and the two
   disagree. Every metric export therefore carries an explicit `status` column
   (ok / below_min_n / not_collected) and writes nothing in `value` when
   suppressed, so a reader has to look at `status` to get a number.

2. Polarity. Outside the API nobody knows that a rising `repeat_tap_rate` is
   neutral, and someone will colour it red. Every export carries `polarity`,
   and metric_catalog.csv ships alongside so the caveats travel with the data.
"""
from __future__ import annotations

import argparse
import csv
import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tools.csv_docs import check_coverage, write_dictionaries   # noqa: E402

ROOT = Path(__file__).resolve().parent.parent

# Excel on Windows and on Chinese-locale macOS reads a BOM-less UTF-8 CSV as the
# system codepage and mangles every non-ASCII character. The BOM costs 3 bytes.
BOM = "utf-8-sig"


def write_csv(path: Path, rows: list[dict], columns: list[str] | None = None,
              encoding: str = "utf-8") -> int:
    if not rows:
        path.write_text("", encoding=encoding)
        return 0
    cols = columns or list(rows[0].keys())
    with path.open("w", newline="", encoding=encoding) as fh:
        writer = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    return len(rows)


def q(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> list[dict]:
    cur = conn.execute(sql, params)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


# ---------------------------------------------------------------------------
# Database exports
# ---------------------------------------------------------------------------

def export_from_db(conn: sqlite3.Connection, out: Path, child: str | None,
                   encoding: str) -> dict[str, int]:
    where = "AND a.child_id = ?" if child else ""
    p: tuple = (child,) if child else ()
    written: dict[str, int] = {}

    # --- long format: one row per child/day/metric. The analysable shape. ----
    daily = q(conn, f"""
        SELECT a.child_id, c.display_name, a.day_local, a.metric_id, m.name AS metric_name,
               m.group_code, m.unit, m.polarity, m.tier,
               a.value, a.n, m.min_n,
               CASE
                 WHEN a.value IS NOT NULL       THEN 'ok'
                 WHEN a.n = 0                   THEN 'not_collected'
                 ELSE 'below_min_n'
               END AS status
        FROM agg_daily_metric a
        JOIN metrics_catalog m ON m.metric_id = a.metric_id
        JOIN children c        ON c.child_id  = a.child_id
        WHERE 1=1 {where}
        ORDER BY a.child_id, a.day_local, m.group_code, a.metric_id""", p)
    written["metrics_daily_long.csv"] = write_csv(out / "metrics_daily_long.csv", daily,
                                                  encoding=encoding)

    # --- wide pivot: what actually gets opened in a spreadsheet -------------
    metric_ids = [r["metric_id"] for r in q(conn,
        "SELECT metric_id FROM metrics_catalog WHERE status='shown' ORDER BY group_code, metric_id")]
    pivot: dict[tuple[str, str], dict] = {}
    for row in daily:
        key = (row["child_id"], row["day_local"])
        rec = pivot.setdefault(key, {
            "child_id": row["child_id"],
            "display_name": row["display_name"],
            "day_local": row["day_local"],
        })
        # Suppressed values stay EMPTY and the reason goes in a sibling column.
        # Writing 0 here would be a lie a spreadsheet cannot detect.
        rec[row["metric_id"]] = row["value"] if row["status"] == "ok" else ""
        if row["status"] != "ok":
            rec[f"{row['metric_id']}__status"] = row["status"]
    wide_cols = ["child_id", "display_name", "day_local"]
    for mid in metric_ids:
        wide_cols += [mid, f"{mid}__status"]
    written["metrics_daily_wide.csv"] = write_csv(
        out / "metrics_daily_wide.csv",
        sorted(pivot.values(), key=lambda r: (r["child_id"], r["day_local"])),
        wide_cols, encoding)

    # --- the dictionary travels with the data ------------------------------
    written["metric_catalog.csv"] = write_csv(out / "metric_catalog.csv", q(conn, """
        SELECT metric_id, name, group_code, plain_explanation, formula, unit,
               polarity, tier, audience, min_n, status, cut_reason, caveat
        FROM metrics_catalog ORDER BY group_code, metric_id"""), encoding=encoding)

    written["insight_catalog.csv"] = write_csv(out / "insight_catalog.csv", q(conn, """
        SELECT insight_id, name, plain_statement, trigger_rule, target_audience,
               action_kind, recommended_actions, forbidden_actions, safety_note
        FROM insights_catalog ORDER BY insight_id"""), encoding=encoding)

    cw = "AND f.child_id = ?" if child else ""
    written["fired_rules.csv"] = write_csv(out / "fired_rules.csv", q(conn, f"""
        SELECT f.fired_rule_id, f.child_id, ch.display_name, f.insight_id, ic.name AS insight_name,
               ic.action_kind, ic.target_audience,
               datetime(f.fired_at/1000, 'unixepoch') AS fired_at_utc,
               f.window_start, f.window_end,
               json_array_length(f.evidence) AS evidence_rows,
               f.evidence, f.thresholds_used, f.classification,
               CASE WHEN f.dismissed_at IS NULL THEN 'open' ELSE 'dismissed' END AS state,
               f.dismiss_reason
        FROM fired_rules f
        JOIN insights_catalog ic ON ic.insight_id = f.insight_id
        JOIN children ch         ON ch.child_id   = f.child_id
        WHERE f.superseded_by IS NULL {cw}
        ORDER BY f.child_id, f.insight_id""", p), encoding=encoding)

    cw = "WHERE s.child_id = ?" if child else ""
    written["card_stats.csv"] = write_csv(out / "card_stats.csv", q(conn, f"""
        SELECT s.child_id, ch.display_name, s.card_id, c.label,
               c.is_core, c.is_essential, c.default_function,
               cv.nav_depth, s.taps, s.mistaps, s.adjacent_corrections,
               s.repeat_runs, s.zero_days, s.last_used_day, s.scenes_used
        FROM agg_card_stats s
        JOIN cards c    ON c.card_id  = s.card_id
        JOIN children ch ON ch.child_id = s.child_id
        LEFT JOIN child_vocabulary cv
               ON cv.child_id = s.child_id AND cv.card_id = s.card_id
        {cw}
        ORDER BY s.child_id, s.taps DESC""", p), encoding=encoding)

    cw = "WHERE h.child_id = ?" if child else ""
    written["cell_heat.csv"] = write_csv(out / "cell_heat.csv", q(conn, f"""
        SELECT h.child_id, h.board_id, h.grid_rows, h.grid_cols,
               h.grid_row, h.grid_col, c.label, h.taps, h.mistaps,
               ROUND(CAST(h.mistaps AS REAL)/NULLIF(h.taps+h.mistaps,0), 4) AS error_share
        FROM agg_cell_heat h
        LEFT JOIN board_cells bc ON bc.board_id = h.board_id
             AND bc.grid_row = h.grid_row AND bc.grid_col = h.grid_col
        LEFT JOIN cards c ON c.card_id = bc.card_id
        {cw}
        ORDER BY h.child_id, h.grid_row, h.grid_col""", p), encoding=encoding)

    cw = "AND child_id = ?" if child else ""
    written["word_pairs.csv"] = write_csv(out / "word_pairs.csv", q(conn, f"""
        SELECT child_id, word_a, word_b, solo_a, solo_b, together,
               MIN(solo_a, solo_b) AS weaker_solo
        FROM agg_word_pairs
        WHERE together = 0 AND solo_a >= 10 AND solo_b >= 10 {cw}
        ORDER BY child_id, weaker_solo DESC""", p), encoding=encoding)

    cw = "AND u.child_id = ?" if child else ""
    written["utterances.csv"] = write_csv(out / "utterances.csv", q(conn, f"""
        SELECT u.utterance_id, u.child_id, ch.display_name, u.day_local, u.scene,
               u.labels, u.symbol_count, u.word_count, u.tap_count, u.delete_count,
               u.ms_compose, u.ms_to_first_tap, u.used_suggestion, u.spoken,
               u.abandon_reason, u.function
        FROM utterances u JOIN children ch ON ch.child_id = u.child_id
        WHERE u.actor = 'child' {cw}
        ORDER BY u.child_id, u.ts""", p), encoding=encoding)

    written["children.csv"] = write_csv(out / "children.csv", q(conn, """
        SELECT c.child_id, c.display_name, c.year_group, c.profile_note, cl.name AS class_name,
               (SELECT COUNT(DISTINCT day_local) FROM events e WHERE e.child_id = c.child_id) AS active_days,
               (SELECT COUNT(*) FROM child_vocabulary v WHERE v.child_id = c.child_id) AS vocabulary_size
        FROM children c LEFT JOIN classes cl ON cl.class_id = c.class_id
        ORDER BY c.display_name"""), encoding=encoding)

    return written


# ---------------------------------------------------------------------------
# Fixture exports — flatten only the payloads that are genuinely tabular
# ---------------------------------------------------------------------------

TABULAR = {
    "get_metrics":        ("metrics", "fixture_metrics.csv"),
    "get_card_stats":     ("cards", "fixture_card_stats.csv"),
    "get_cell_heat":      ("cells", "fixture_cell_heat.csv"),
    "get_word_pairs":     ("pairs", "fixture_word_pairs.csv"),
    "get_utterances":     ("utterances", "fixture_utterances.csv"),
    "list_children":      ("children", "fixture_children.csv"),
    "get_attention_queue": ("queue", "fixture_attention_queue.csv"),
}


def export_from_fixture(path: Path, out: Path, encoding: str) -> dict[str, int]:
    doc = json.loads(path.read_text())
    child = doc["_about"]["child_id"]
    written: dict[str, int] = {}

    for tool, (key, filename) in TABULAR.items():
        entry = doc["tools"].get(tool)
        if not entry or "response" not in entry:
            continue
        rows = entry["response"]["data"].get(key) or []
        if not rows:
            continue
        flat = []
        for r in rows:
            rec = {"child_id": child}
            for k, v in r.items():
                rec[k] = json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v
            flat.append(rec)
        written[filename] = write_csv(out / filename, flat, encoding=encoding)

    # Guidance is not tabular but it is the part a reader most needs, so it
    # gets its own file rather than being dropped on the floor.
    guidance = []
    for tool, entry in doc["tools"].items():
        for g in (entry.get("response", {}).get("guidance") or []):
            guidance.append({"tool": tool, "level": g["level"], "code": g["code"],
                             "detail": g["detail"],
                             "affects": ", ".join(g.get("affects") or [])})
    if guidance:
        written["fixture_guidance.csv"] = write_csv(out / "fixture_guidance.csv",
                                                    guidance, encoding=encoding)
    return written


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(ROOT / "aac.db"))
    ap.add_argument("--fixture", help="export from an MCP fixture instead of the database")
    ap.add_argument("--child", help="limit the database export to one child")
    ap.add_argument("--out", default=str(ROOT / "exports"))
    ap.add_argument("--excel", action="store_true",
                    help="UTF-8 with BOM, so Excel does not mangle non-ASCII text")
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    encoding = BOM if args.excel else "utf-8"

    if args.fixture:
        source = Path(args.fixture)
        if not source.exists():
            print(f"error: no fixture at {source}", file=sys.stderr)
            return 1
        print(f"source   : {source}  (snapshot the model was given)")
        written = export_from_fixture(source, out, encoding)
    else:
        if not Path(args.db).exists():
            print(f"error: no database at {args.db}. Run ./tools/build.sh first.", file=sys.stderr)
            return 1
        print(f"source   : {args.db}  (database — complete, not truncated by tool limits)")
        conn = sqlite3.connect(args.db)
        conn.execute("PRAGMA query_only = ON")
        written = export_from_db(conn, out, args.child, encoding)
        conn.close()

    # The dictionaries ship in the same folder as the data. Whoever opens
    # card_stats.csv next month will not go looking for a markdown file.
    written.update(write_dictionaries(out, encoding))

    print(f"encoding : {'UTF-8 with BOM (Excel-safe)' if args.excel else 'UTF-8'}")
    if args.child:
        print(f"child    : {args.child}")
    print(f"output   : {out}\n")
    total = 0
    for name, n in sorted(written.items()):
        size = (out / name).stat().st_size / 1024
        print(f"  {name:<28} {n:>7,} rows  {size:>7.1f} KB")
        total += n
    print(f"\n  {total:,} rows across {len(written)} files")
    print("\n  _column_dictionary.csv    every column in every file, with its gotchas")
    print("  _mcp_response_fields.csv  every field in the MCP envelope")
    print("  metric_catalog.csv        unit, polarity, min_n and caveat per metric")
    print("\n  A `status` of below_min_n or not_collected means the value cell is EMPTY")
    print("  ON PURPOSE — it is not zero, and Excel will sum it as one if you let it.")

    undocumented = check_coverage(out, encoding)
    if undocumented:
        print(f"\n  WARNING: {len(undocumented)} undocumented column(s):")
        for c in undocumented[:12]:
            print(f"    {c}")
        print("  Add them to COLUMN_DOCS in tools/csv_docs.py.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
