#!/usr/bin/env python3
"""Regenerate the metric index in docs/analytics-metrics.md from metrics_catalog.

The index used to be hand-maintained and drifted from the catalogue twice.
Now it is generated, so the database is the only place a metric is defined.

    python3 tools/gen_metric_index.py [--db aac.db]

Rewrites everything between the METRIC-INDEX markers. Idempotent.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

DOC = Path(__file__).resolve().parent.parent / "docs" / "analytics-metrics.md"
START = "<!-- METRIC-INDEX:START -->"
END = "<!-- METRIC-INDEX:END -->"

GROUP_NAMES = {
    "A": "Effort & speed",
    "B": "Errors & motor",
    "C": "Volume & vocabulary",
    "D": "Layout & context",
    "E": "Whose voice",
    "F": "AI value",
    "G": "Communication partner",
    "H": "Communication style",
}

# The six that carry the product story. Kept here rather than in the DB because
# it is an editorial choice about the pitch, not a property of the metric.
STARRED = {
    "taps_per_utterance",
    "taps_saved",
    "vocabulary_gaps",
    "silence_streak",
    "mistap_rate",
    "independence_rate",
}

AUDIENCE_SHORT = {"teacher": "T", "parent": "P", "slt": "S"}


def short_audience(csv: str) -> str:
    parts = [AUDIENCE_SHORT.get(a.strip(), a.strip()) for a in csv.split(",") if a.strip()]
    return "ALL" if len(parts) == 3 else " ".join(parts)


def esc(text: str | None) -> str:
    """Escape for a markdown table cell."""
    if not text:
        return "—"
    return text.replace("|", "\\|").replace("\n", " ").strip()


def truncate(text: str, limit: int) -> str:
    text = text.strip()
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0]
    return cut + "…"


def build(conn: sqlite3.Connection) -> str:
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT * FROM metrics_catalog ORDER BY group_code, rowid"
    ).fetchall()

    shown = [r for r in rows if r["status"] == "shown"]
    logged = [r for r in rows if r["status"] == "logged"]
    cut = [r for r in rows if r["status"] == "cut"]

    # Ref codes: A1, A2, B1 … assigned by position within group, shown metrics only.
    refs: dict[str, str] = {}
    counters: dict[str, int] = {}
    for r in shown:
        g = r["group_code"]
        counters[g] = counters.get(g, 0) + 1
        refs[r["metric_id"]] = f"{g}{counters[g]}"

    out: list[str] = [START, ""]
    out.append(
        f"The whole measurement surface in one table — **{len(rows)} metrics: "
        f"{len(shown)} shown, {len(logged)} logged only, {len(cut)} cut**. "
        "Generated from `metrics_catalog`; edit the database, not this table "
        "(`python3 tools/gen_metric_index.py`). Full derivations and thresholds are in §5–§7."
    )
    out.append("")
    out.append(
        "**Legend** — `Tier`: P0 build now · P1 if time · P2 later. "
        "`Who`: T teacher · P parent · S speech therapist · ALL everyone. "
        "`Feeds`: which insight in §8 depends on it. "
        "`Pol`: ↑ higher better · ↓ lower better · **=** neutral, and a neutral metric "
        "must never be styled as good or bad. `★` marks the six that carry the product story."
    )
    out.append("")

    polarity_glyph = {"higher_better": "↑", "lower_better": "↓", "neutral": "="}

    # ---- shown, grouped -----------------------------------------------------
    out.append(f"### Shown on the dashboard — {len(shown)}")
    out.append("")
    for g in sorted({r["group_code"] for r in shown}):
        members = [r for r in shown if r["group_code"] == g]
        out.append(f"**{g}. {GROUP_NAMES.get(g, g)}**")
        out.append("")
        out.append("| Ref | Metric · `id` | What it tells you | Pol | Tier · Who | min n | Feeds |")
        out.append("|---|---|---|---|---|---|---|")
        for r in members:
            mid = r["metric_id"]
            star = " ★" if mid in STARRED else ""
            feeds = json.loads(r["feeds_insights"]) or []
            out.append(
                f"| {refs[mid]}{star} | {esc(r['name'])} · `{mid}` "
                f"| {esc(truncate(r['plain_explanation'], 110))} "
                f"| {polarity_glyph[r['polarity']]} "
                f"| {r['tier']} · {short_audience(r['audience'])} "
                f"| {r['min_n']} "
                f"| {' '.join(feeds) if feeds else '—'} |"
            )
        out.append("")

    # ---- logged only --------------------------------------------------------
    out.append(f"### Logged but not charted — {len(logged)}")
    out.append("")
    out.append("Derivable and queryable today; enabling a chart later is a config flag, not a migration.")
    out.append("")
    out.append("| Metric · `id` | What it tells you | Why no chart |")
    out.append("|---|---|---|")
    for r in logged:
        out.append(
            f"| {esc(r['name'])} · `{r['metric_id']}` "
            f"| {esc(truncate(r['plain_explanation'], 100))} "
            f"| {esc(r['cut_reason'])} |"
        )
    out.append("")

    # ---- cut ----------------------------------------------------------------
    out.append(f"### Cut — {len(cut)}")
    out.append("")
    out.append("Recorded so the decision is not re-litigated every week.")
    out.append("")
    out.append("| Metric · `id` | What it would have told you | Why cut |")
    out.append("|---|---|---|")
    for r in cut:
        out.append(
            f"| {esc(r['name'])} · `{r['metric_id']}` "
            f"| {esc(truncate(r['plain_explanation'], 90))} "
            f"| {esc(r['cut_reason'])} |"
        )
    out.append("")

    # ---- the six ------------------------------------------------------------
    out.append("### The six that carry the story")
    out.append("")
    out.append("If everything else were cut, these still make the case:")
    out.append("")
    out.append("| Metric | Why this one |")
    out.append("|---|---|")
    why = {
        "taps_per_utterance": "the whole product claim, in one number",
        "taps_saved": "the same claim in effort, not ratios",
        "vocabulary_gaps": "becomes the teacher's to-do list",
        "silence_streak": "finds the child who stopped talking",
        "mistap_rate": "finds the child fighting the hardware",
        "independence_rate": "proves the AI assists rather than replaces",
    }
    by_id = {r["metric_id"]: r for r in rows}
    for mid, reason in why.items():
        if mid in by_id:
            out.append(f"| `{mid}` — {esc(by_id[mid]['name'])} | {reason} |")
    out.append("")
    out.append(END)
    return "\n".join(out)


def _deny_attach(action, _a1, _a2, _db, _trigger):
    """Refuse ATTACH/DETACH. query_only alone does not block them, which would
    let a caller reach aac_text.db and read utterance text."""
    if action in (sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH):
        return sqlite3.SQLITE_DENY
    return sqlite3.SQLITE_OK


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="aac.db")
    args = ap.parse_args()

    db_path = Path(args.db)
    if not db_path.exists():
        print(f"error: database not found: {db_path}", file=sys.stderr)
        return 1

    # NOT `mode=ro`: SQLite cannot open a WAL database read-only, because it
    # needs to create the -shm file. Use query_only + a deny-ATTACH authorizer,
    # which is also what the MCP server must do. See docs/mcp-api.md §10.
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA query_only = ON")
    conn.set_authorizer(_deny_attach)
    try:
        block = build(conn)
    finally:
        conn.close()

    doc = DOC.read_text()
    if START not in doc or END not in doc:
        print(
            f"error: markers not found in {DOC}.\n"
            f"Add {START} and {END} around the index section.",
            file=sys.stderr,
        )
        return 1

    head, _, rest = doc.partition(START)
    _, _, tail = rest.partition(END)
    DOC.write_text(head + block + tail)
    print(f"regenerated metric index in {DOC}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
