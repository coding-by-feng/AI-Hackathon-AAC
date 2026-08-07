#!/usr/bin/env python3
"""Capture real MCP responses to a JSON fixture file.

    python3 tools/gen_fixtures.py --db aac.db --child sofia_r --window last_14d

Drives the actual server over stdio and records what comes back, so the fixture
can never drift from the implementation the way a hand-written example does.

Two audiences:
  - whoever builds the dashboard, who needs response shapes to code against
    before the backend is deployed
  - whoever writes the MCP client for the analysis model, who needs to see the
    envelope fields that carry the interpretation rules
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def build_calls(child: str, window: str, class_id: str, adult: str) -> list[tuple[str, dict]]:
    return [
        ("list_children",         {"adult_id": adult}),
        ("get_child_profile",     {"child_id": child}),
        ("get_metrics",           {"child_id": child, "window": window}),
        ("get_metric_timeseries", {"child_id": child, "metric_id": "mistap_rate"}),
        ("get_card_stats",        {"child_id": child, "limit": 12, "order_by": "taps_desc"}),
        ("get_cell_heat",         {"child_id": child}),
        ("get_word_pairs",        {"child_id": child, "limit": 8}),
        ("get_scene_breakdown",   {"child_id": child, "by": "function"}),
        ("get_utterances",        {"child_id": child, "limit": 5}),
        ("get_partner_metrics",   {"child_id": child}),
        ("get_board_revisions",   {"child_id": child}),
        ("get_fired_rules",       {"child_id": child}),
        ("get_attention_queue",   {"class_id": class_id}),
        ("query", {"sql": "SELECT scene, COUNT(*) AS utterances FROM utterances "
                          f"WHERE child_id = '{child}' AND spoken = 1 GROUP BY scene "
                          "ORDER BY utterances DESC"}),
    ]


def run(db: str, calls: list[tuple[str, dict]]) -> list[dict]:
    lines = [
        json.dumps({"jsonrpc": "2.0", "id": i, "method": "tools/call",
                    "params": {"name": name, "arguments": args}})
        for i, (name, args) in enumerate(calls)
    ]
    proc = subprocess.run(
        ["node", str(ROOT / "mcp" / "server.ts"), "--db", db],
        input="\n".join(lines) + "\n", capture_output=True, text=True,
    )
    if proc.returncode != 0:
        print(proc.stderr, file=sys.stderr)
        raise SystemExit(f"server exited {proc.returncode}")

    out = []
    for line in proc.stdout.splitlines():
        if line.strip().startswith("{"):
            out.append(json.loads(line))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(ROOT / "aac.db"))
    ap.add_argument("--child", default="sofia_r")
    ap.add_argument("--window", default="last_14d")
    ap.add_argument("--class-id", default="class_y3")
    ap.add_argument("--adult", default="adult_patel")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    calls = build_calls(args.child, args.window, args.class_id, args.adult)
    responses = run(args.db, calls)

    captured: dict[str, object] = {}
    for (name, call_args), resp in zip(calls, responses):
        if "error" in resp:
            captured[name] = {"request": call_args, "error": resp["error"]}
            continue
        body = json.loads(resp["result"]["content"][0]["text"])
        captured[name] = {"request": call_args, "response": body}

    out_path = Path(args.out) if args.out else (
        ROOT / "mcp" / "fixtures" / f"{args.child}-{args.window}.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    doc = {
        "_about": {
            "description": (
                "Real MCP responses captured from the seeded database. Not hand-written — "
                "regenerate with tools/gen_fixtures.py so this can never drift from the server."
            ),
            "child_id": args.child,
            "window": args.window,
            "generated_from": Path(args.db).name,
            "envelope": {
                "data": "tool-specific payload",
                "meta": "window, row_count, truncated, data_freshness",
                "dictionary": "one metrics_catalog entry per metric present — unit, polarity, min_n, caveat",
                "guidance": "warnings computed for THIS result. Read before the numbers.",
                "forbidden_actions": "recommendations that must never be made, whatever the evidence suggests",
                "next_calls": "what the MCP CLIENT should fetch next. Not a hint to the model.",
            },
            "null_semantics": {
                "value null + n > 0": "measured, but below min_n. NOT zero.",
                "value null + n = 0": "never observed. The feature is not in use for this child.",
                "direction not_applicable": "the metric's polarity is neutral — it is neither good nor bad.",
            },
            "read_first": [
                "docs/aac-clinical-constraints.md — the eight clinical constraints",
                "docs/mcp-api.md — the full contract",
            ],
        },
        "tools": captured,
    }

    out_path.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")

    size_kb = out_path.stat().st_size / 1024
    print(f"wrote {out_path.relative_to(ROOT)}  ({size_kb:.1f} KB, {len(captured)} tools)")
    for name, entry in captured.items():
        if "error" in entry:
            print(f"  {name:<24} ERROR {entry['error'].get('message', '')[:50]}")
        else:
            body = entry["response"]
            tok = len(json.dumps(body)) // 4
            flags = []
            if body.get("guidance"):
                flags.append(f"{len(body['guidance'])} guidance")
            if body.get("forbidden_actions"):
                flags.append(f"{len(body['forbidden_actions'])} forbidden")
            if body.get("next_calls"):
                flags.append(f"{len(body['next_calls'])} next_calls")
            print(f"  {name:<24} ~{tok:>6,} tok   {' · '.join(flags)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
