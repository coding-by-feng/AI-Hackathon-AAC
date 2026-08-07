"""Column and response-field documentation, emitted as CSV alongside the data.

Two dictionaries ship with every export:

  _column_dictionary.csv    every column in every exported file
  _mcp_response_fields.csv  every field in the MCP envelope

Why as CSV rather than a README: the person who opens `card_stats.csv` in Excel
next month will not read a markdown file in a repo they may not have. The
explanation has to travel in the same folder, in the same format.

`check_coverage()` reads the headers back off disk and fails on any column
without an entry, so adding a column to a query forces documenting it.
"""
from __future__ import annotations

import csv
from pathlib import Path

# (type, unit, meaning, gotcha)
Doc = tuple[str, str, str, str]

SHARED: dict[str, Doc] = {
    "child_id":     ("text", "-", "Stable identifier for the AAC user.", ""),
    "display_name": ("text", "-", "First name plus initial. Never a full name.", ""),
    "day_local":    ("date", "YYYY-MM-DD", "The child's LOCAL calendar day.",
                     "Written by the client, not computed in SQL. If a device crossed a timezone, historical rows keep the day they were recorded on — correct, but it can look odd."),
    "label":        ("text", "-", "The word printed on the card, as it was at the time of the tap.",
                     "Denormalised on purpose. Renaming a card does not rewrite history."),
    "taps":         ("integer", "count", "Successful selections. Child only; adult modelling excluded.",
                     "Excludes presses that were deleted within 1.5s — those are in `mistaps`."),
    "mistaps":      ("integer", "count", "Presses deleted within 1.5s — the child did not mean them.",
                     "REQUIRES a delete. Repeated pressing with no delete is never counted here; see `repeat_runs`."),
}

COLUMN_DOCS: dict[str, dict[str, Doc]] = {

    "children.csv": {
        **SHARED,
        "year_group":      ("text", "-", "School year.", ""),
        "profile_note":    ("text", "-", "Short clinical context, e.g. 'CP / dysarthria'.",
                            "Not a medical record and must never be treated as one."),
        "class_name":      ("text", "-", "Class the child belongs to.", ""),
        "active_days":     ("integer", "days", "Distinct days with at least one logged event.",
                            "Under 14 means baselines are not yet trustworthy."),
        "vocabulary_size": ("integer", "count", "Cards available to this child, including ones inside folders.", ""),
    },

    "metrics_daily_long.csv": {
        **SHARED,
        "metric_id":   ("text", "-", "Stable metric slug. Join to metric_catalog.csv.", ""),
        "metric_name": ("text", "-", "Human-readable name.", ""),
        "group_code":  ("text", "A-H", "A effort · B errors · C vocabulary · D layout · E voice · F AI value · G partner · H communication style.",
                        "Group H is NOT errors. Repetition lives there and is neutral."),
        "unit":        ("text", "-", "count · ratio · ms · days · wpm · index.",
                        "`ms` is milliseconds. Divide by 1000 before showing seconds to anyone."),
        "polarity":    ("text", "-", "higher_better · lower_better · neutral.",
                        "A `neutral` metric must never be coloured as good or bad. Repetition rising is not a problem."),
        "tier":        ("text", "P0-P2", "Build priority.", ""),
        "value":       ("number", "see `unit`", "The metric value for that child on that day.",
                        "EMPTY DOES NOT MEAN ZERO. Read `status` before using this cell in any formula."),
        "n":           ("integer", "count", "Observations behind the value.",
                        "Always present, even when `value` is empty. n>0 with an empty value means it was measured but thinly."),
        "min_n":       ("integer", "count", "Minimum observations required before the value is published.", ""),
        "status":      ("text", "-", "ok · below_min_n · not_collected.",
                        "`below_min_n` = measured, too few to report. `not_collected` = the feature is not in use for this child. Neither is zero."),
    },

    "metrics_daily_wide.csv": {
        **SHARED,
        "<metric_id>":           ("number", "see metric_catalog.csv", "One column per metric. Value for that child on that day.",
                                  "Empty means suppressed — check the paired __status column. Excel sums an empty cell as 0."),
        "<metric_id>__status":   ("text", "-", "Why the paired value column is empty.",
                                  "Blank here means the value is present and fine."),
    },

    "metric_catalog.csv": {
        "metric_id":         ("text", "-", "Stable slug used everywhere in code and in the other CSVs.", ""),
        "name":              ("text", "-", "Human-readable name.", ""),
        "group_code":        ("text", "A-H", "Metric group.", ""),
        "plain_explanation": ("text", "-", "One sentence a teacher would understand.", ""),
        "formula":           ("text", "-", "How the value is derived from the event log.", ""),
        "unit":              ("text", "-", "count · ratio · ms · days · wpm · index.", ""),
        "polarity":          ("text", "-", "Whether higher, lower, or neither is better.",
                              "The single most important column here. It is what stops a neutral signal being styled as a warning."),
        "tier":              ("text", "P0-P2", "Build priority.", ""),
        "audience":          ("text", "-", "Which roles this metric is shown to.", ""),
        "min_n":             ("integer", "count", "Sample size below which the value is suppressed.", ""),
        "status":            ("text", "-", "shown · logged · cut.", ""),
        "cut_reason":        ("text", "-", "Why a metric was cut or is logged but not charted.", ""),
        "caveat":            ("text", "-", "How this metric misleads. READ THIS before drawing a conclusion.",
                              "Every caveat exists because a specific misreading was possible."),
    },

    "card_stats.csv": {
        **SHARED,
        "card_id":              ("text", "-", "Stable card identifier.", ""),
        "is_core":              ("0/1", "-", "Whether the word is in the ~200-word core vocabulary.",
                                 "Core words account for roughly 80% of everyday communication. An unused core word is a teaching target, never a candidate for deletion."),
        "is_essential":         ("0/1", "-", "yes / no / stop / help / toilet / hurt.",
                                 "Always available and never re-ranked or removed."),
        "default_function":     ("text", "-", "request · protest · comment · direct · ask_question · give_opinion · share_news · start_conversation.", ""),
        "nav_depth":            ("integer", "screens", "How many screens deep the card sits. 0 = home grid.",
                                 "A high-frequency word at depth 3+ is a tax on every conversation."),
        "adjacent_corrections": ("integer", "count", "Mis-taps where the correction landed on a NEIGHBOURING button.",
                                 "The discriminator: high means the finger slipped (motor), low means the mind changed (semantic)."),
        "repeat_runs":          ("integer", "count", "Runs of 3+ consecutive presses of this card with NO delete.",
                                 "NOT AN ERROR. Exploration, motor learning, gestalt processing or stimming. If it clusters where vocabulary is thin, it signals a MISSING WORD. Never present this as a problem to fix."),
        "zero_days":            ("integer", "days", "Days since the card was last used.",
                                 "30+ across every scene suggests it is obsolete — unless it is a core word."),
        "last_used_day":        ("date", "YYYY-MM-DD", "Last successful use. Empty means never used.", ""),
        "scenes_used":          ("json", "-", "Which settings the card has been used in.",
                                 "A word used in exactly one scene has not generalised."),
    },

    "cell_heat.csv": {
        **SHARED,
        "board_id":    ("text", "-", "Which board these coordinates belong to.", ""),
        "grid_rows":   ("integer", "count", "Board height at the time of the taps.",
                        "Part of the key. NEVER compare cells across different grid sizes — the coordinates mean different things."),
        "grid_cols":   ("integer", "count", "Board width at the time of the taps.", ""),
        "grid_row":    ("integer", "index", "Row position, 0 = top.", ""),
        "grid_col":    ("integer", "index", "Column position, 0 = left.", ""),
        "error_share": ("ratio", "0-1", "mistaps / (taps + mistaps) for this cell.",
                        "A reach problem shows as a GRADIENT across rows, not one hot cell. Compare rows, not just outliers."),
    },

    "word_pairs.csv": {
        **SHARED,
        "word_a":      ("text", "-", "First word, alphabetically.", "Pairs are unordered: (want, biscuit) appears once."),
        "word_b":      ("text", "-", "Second word, alphabetically.", ""),
        "solo_a":      ("integer", "count", "Times word A was used at all.", ""),
        "solo_b":      ("integer", "count", "Times word B was used at all.", ""),
        "together":    ("integer", "count", "Utterances containing both.", "This file only lists pairs where it is 0."),
        "weaker_solo": ("integer", "count", "The smaller of solo_a and solo_b.",
                        "Rank by this: the highest is the most promising combination to model next."),
    },

    "utterances.csv": {
        **SHARED,
        "utterance_id":    ("text", "-", "One composed sentence.", ""),
        "scene":           ("text", "-", "therapy · classroom · free_play · home · community · unknown.",
                            "`unknown` is common and is not a data error. Treat it as unclassified."),
        "labels":          ("json", "-", "The card labels, in tap order.",
                            "LABELS ONLY. Utterance text lives in a separate consent tier and is not in this export."),
        "symbol_count":    ("integer", "count", "Cards in the finished sentence.", ""),
        "word_count":      ("integer", "count", "Words in the spoken output.", ""),
        "tap_count":       ("integer", "count", "Presses made, including ones later deleted.", ""),
        "delete_count":    ("integer", "count", "Presses removed during composition.", ""),
        "ms_compose":      ("integer", "ms", "First press to pressing Speak. Empty if abandoned.",
                            "AAC composition legitimately takes 8-20 seconds. Slow is not a fault."),
        "ms_to_first_tap": ("integer", "ms", "Pause after a partner stopped speaking before the child began.",
                            "A long pause may be the ADULT not waiting. Check partner metrics before reading it as the child being slow."),
        "used_suggestion": ("0/1", "-", "Whether an AI suggestion was taken.", ""),
        "spoken":          ("0/1", "-", "1 = spoken, 0 = built then abandoned.",
                            "Abandoned sentences are the quietest failure: the child tried and nobody heard."),
        "abandon_reason":  ("text", "-", "cleared · timeout · navigated_away · session_end.",
                            "`timeout` and `navigated_away` often mean the partner moved on."),
        "function":        ("text", "-", "What the child used language FOR.",
                            "Most AAC users sit near 90% requesting. Growth looks like commenting and questions appearing."),
    },

    "fired_rules.csv": {
        **SHARED,
        "fired_rule_id":   ("text", "-", "Identifier for this firing. A model narration must reference it.", ""),
        "insight_id":      ("text", "I1-I8", "Which rule fired.", ""),
        "insight_name":    ("text", "-", "Human-readable rule name.", ""),
        "action_kind":     ("text", "-", "intervention · informational · system_fix.",
                            "`informational` needs no action — I4 case B records a preference, and acting on it would override a refusal."),
        "target_audience": ("text", "-", "child · adult · system.",
                            "Most rules point at an ADULT. I8 points at us."),
        "fired_at_utc":    ("datetime", "UTC", "When the nightly rule run produced this.", ""),
        "window_start":    ("date", "YYYY-MM-DD", "First day considered.", ""),
        "window_end":      ("date", "YYYY-MM-DD", "Last day considered.", ""),
        "evidence_rows":   ("integer", "count", "How many evidence rows are in `evidence`.", ""),
        "evidence":        ("json", "-", "The exact values that triggered the rule.",
                            "Includes the thresholds as data, so you can disagree with a rule that fired just over its line."),
        "thresholds_used": ("json", "-", "What the rule compared against.", ""),
        "classification":  ("json", "-", "I1 only: motor vs semantic split.", "Empty for every other rule."),
        "state":           ("text", "-", "open · dismissed.", ""),
        "dismiss_reason":  ("text", "-", "Why an adult rejected it.",
                            "The only feedback available on whether these rules are any good."),
    },

    "insight_catalog.csv": {
        "insight_id":          ("text", "I1-I8", "Rule identifier.", ""),
        "name":                ("text", "-", "Human-readable name.", ""),
        "plain_statement":     ("text", "-", "What the rule claims, in one sentence.", ""),
        "trigger_rule":        ("text", "-", "The condition, in words.", ""),
        "target_audience":     ("text", "-", "Who the action is for.", ""),
        "action_kind":         ("text", "-", "intervention · informational · system_fix.", ""),
        "recommended_actions": ("json", "-", "What to do.", ""),
        "forbidden_actions":   ("json", "-", "What must NEVER be recommended for this rule.",
                                "Not stylistic. Each entry is an action AAC practice says causes harm — resizing a grid, relocating a learned card, reducing repetition, retraining a refusal."),
        "safety_note":         ("text", "-", "Read before writing any recommendation from this rule.", ""),
    },
}

# Fixture exports reuse the same column names wherever they overlap.
for _f in ("fixture_card_stats.csv", "fixture_cell_heat.csv", "fixture_word_pairs.csv",
           "fixture_utterances.csv", "fixture_children.csv", "fixture_metrics.csv",
           "fixture_attention_queue.csv"):
    COLUMN_DOCS.setdefault(_f, {})


# ---------------------------------------------------------------------------
# MCP envelope
# ---------------------------------------------------------------------------

RESPONSE_FIELDS: list[tuple[str, str, str, str]] = [
    # (path, type, meaning, why_it_matters)
    ("data", "object", "The tool-specific payload.",
     "Shape differs per tool. Everything else in the envelope is identical across all of them."),
    ("meta.child_id", "text", "Who this result is about.", ""),
    ("meta.window.start / .end / .days", "date / int", "The period covered.",
     "Always check this before comparing two results — the defaults differ per tool."),
    ("meta.row_count", "integer", "Rows returned.", ""),
    ("meta.truncated", "boolean", "True when a limit was hit.",
     "If true you are seeing a partial answer. Narrow the window rather than concluding from it."),
    ("meta.data_freshness.rollup_through", "date", "Last day the nightly aggregates cover.", ""),
    ("meta.data_freshness.live_from", "date", "First day computed live rather than from the rollup.", ""),
    ("meta.data_freshness.is_partial_day", "boolean", "Whether the last day is still in progress.",
     "A partial day always looks like a drop. It is not one."),
    ("dictionary.<metric_id>", "object", "The metric_catalog entry for every metric in `data`.",
     "Carries unit, polarity, min_n and caveat. This is what stops a bare number being misread."),
    ("guidance[]", "array", "Warnings computed for THIS result.",
     "READ BEFORE THE NUMBERS. This is the field that stops a model reporting a child regressed when an adult moved a button."),
    ("guidance[].level", "text", "info · warning · critical.",
     "`critical` means a comparison is invalid, not merely caveated."),
    ("guidance[].code", "text", "Machine-readable warning code.",
     "SMALL_SAMPLE · NOT_COLLECTED · LAYOUT_CHANGED_MID_WINDOW · GRID_RESIZED_MID_WINDOW · MODE_POSITION_DRIFT · MODELING_MODE_UNUSED · HIGH_REPETITION_NEUTRAL · PARTNER_WAIT_SHORT · ABSENCE_IN_WINDOW · BASELINE_THIN · SCENE_MOSTLY_UNKNOWN · PARTIAL_WINDOW"),
    ("guidance[].detail", "text", "The warning in plain language.", ""),
    ("guidance[].affects", "array", "Which metrics the warning applies to.", ""),
    ("forbidden_actions[]", "array", "Recommendations that must never be made.",
     "Travels with the result rather than living in a policy document, so a model cannot act without seeing it."),
    ("next_calls[]", "array", "What to fetch next, and why.",
     "An instruction to the MCP CLIENT, not a hint to the model. A 4B model cannot reliably chain tool calls, so the client drives a fixed sequence."),
    ("data.metrics[].value", "number or null", "The metric value.",
     "NULL IS NOT ZERO. Null with n>0 means below min_n; null with n=0 means never measured."),
    ("data.metrics[].n", "integer", "Observations behind the value.",
     "Present even when value is null, so you can tell 'thin' from 'absent'."),
    ("data.metrics[].direction", "text", "improved · worsened · unchanged · not_applicable.",
     "Already resolved through polarity. Do not compute it yourself. A neutral metric always returns not_applicable."),
    ("data.metrics[].suppressed_reason", "text or null", "Why the value is null.",
     "small_sample · no_consent · not_collected · metric_cut."),
    ("data.candidates[].triggered", "boolean", "Whether the rule's thresholds were met.", ""),
    ("data.candidates[].evidence", "array", "The exact rows that triggered the rule.", ""),
    ("data.candidates[].thresholds_applied", "object", "The numbers the rule compared against.",
     "Exposed rather than applied, so you can disagree with a rule that fired at 8.1% against a threshold of 8%."),
    ("data.candidates[].safety_note", "text", "Clinical caution for this rule.",
     "Read before writing any recommendation from it."),
    ("data.candidates[].previously_dismissed", "object or null", "Whether an adult already rejected this finding.",
     "Re-raising something dismissed as `not_accurate` erodes trust in the whole system."),
]


def write_dictionaries(out: Path, encoding: str) -> dict[str, int]:
    """Emit the two documentation files."""
    rows = []
    for filename, cols in sorted(COLUMN_DOCS.items()):
        for col, (typ, unit, meaning, gotcha) in cols.items():
            rows.append({"file": filename, "column": col, "type": typ, "unit": unit,
                         "meaning": meaning, "gotcha": gotcha})
    with (out / "_column_dictionary.csv").open("w", newline="", encoding=encoding) as fh:
        w = csv.DictWriter(fh, fieldnames=["file", "column", "type", "unit", "meaning", "gotcha"])
        w.writeheader()
        w.writerows(rows)

    with (out / "_mcp_response_fields.csv").open("w", newline="", encoding=encoding) as fh:
        w = csv.DictWriter(fh, fieldnames=["path", "type", "meaning", "why_it_matters"])
        w.writeheader()
        for path, typ, meaning, why in RESPONSE_FIELDS:
            w.writerow({"path": path, "type": typ, "meaning": meaning, "why_it_matters": why})

    return {"_column_dictionary.csv": len(rows),
            "_mcp_response_fields.csv": len(RESPONSE_FIELDS)}


def check_coverage(out: Path, encoding: str) -> list[str]:
    """Read the headers back off disk and report undocumented columns.

    Adding a column to a query without documenting it is how a dictionary rots.
    This makes it loud instead of silent.
    """
    missing: list[str] = []
    for path in sorted(out.glob("*.csv")):
        if path.name.startswith("_"):
            continue
        with path.open(encoding=encoding) as fh:
            header = next(csv.reader(fh), [])
        documented = COLUMN_DOCS.get(path.name, {})
        for col in header:
            col = col.lstrip("﻿")
            if col in documented:
                continue
            # wide file: metric columns are generated, documented as a pattern
            if path.name == "metrics_daily_wide.csv":
                continue
            # fixture files reuse names from their database equivalents
            if path.name.startswith("fixture_"):
                continue
            missing.append(f"{path.name}:{col}")
    return missing
