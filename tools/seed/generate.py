#!/usr/bin/env python3
"""Generate the seeded demo database.

Deterministic: every child has its own PRNG seed, so adding a child does not
shift anyone else's history, and two runs produce byte-identical output.

    python3 -m tools.seed.generate --db aac.db --days 42 --end 2026-08-07

Writes L0 (events) and L1 (utterances, partner_turns). Run tools/rollup.py
afterwards to materialise L2.
"""
from __future__ import annotations

import argparse
import json
import random
import sqlite3
import uuid
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

from . import vocab
from .personas import PERSONAS, Persona

ROOT = Path(__file__).resolve().parent.parent.parent
TZ_OFFSET_MIN = 720
# A sitting ends when the device is idle this long. 20 minutes separates
# "went to lunch" from "paused to think".
IDLE_GAP_MS = 20 * 60 * 1000                      # NZST, fixed for the demo
ORG_ID = "org_demo"
CLASS_ID = "class_y3"

# Scene by local hour on a school day. Deliberately lumpy: a real child does not
# communicate uniformly, and flat data makes every time-based metric look wrong.
SCHOOL_SCENES = [
    (8, "home"), (9, "classroom"), (10, "therapy"), (11, "classroom"),
    (12, "free_play"), (13, "classroom"), (14, "classroom"), (15, "free_play"),
    (16, "home"), (17, "home"), (18, "home"),
]
WEEKEND_SCENES = [(9, "home"), (11, "community"), (13, "home"), (15, "free_play"), (17, "home")]


def uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def epoch_ms(d: date, hour: int, minute: int, second: int = 0) -> int:
    dt = datetime.combine(d, time(hour, minute, second), tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000) - TZ_OFFSET_MIN * 60_000


# ---------------------------------------------------------------------------
# Board geometry, accounting for layout changes over time
# ---------------------------------------------------------------------------

class Layout:
    """Where each card sits, and how that changed on a given day.

    Maya's board is rearranged on day 33 by a well-meaning adult following our
    own I3 advice. Two learned buttons move. This is what I8 exists to catch.
    """

    def __init__(self, persona: Persona):
        self.persona = persona
        self.rows = len(persona.grid)
        self.cols = len(persona.grid[0])
        self.base = {cid: (r, c) for r, c, cid in vocab.grid_cards(persona.grid)}
        self.buried = vocab.BURIED[persona.child_id]

        self.change_day = persona.layout_change_day
        self.swapped: tuple[str, str] | None = ("water", "more") if self.change_day else None

    def position(self, card_id: str, day_index: int) -> tuple[int, int] | None:
        pos = self.base.get(card_id)
        if pos is None:
            return None
        if self.swapped and self.change_day is not None and day_index >= self.change_day:
            a, b = self.swapped
            if card_id == a:
                return self.base[b]
            if card_id == b:
                return self.base[a]
        return pos

    def nav_depth(self, card_id: str) -> int:
        return 0 if card_id in self.base else self.buried.get(card_id, 2)

    def available(self) -> list[str]:
        return list(self.base) + list(self.buried)

    def neighbours(self, pos: tuple[int, int], day_index: int) -> list[str]:
        r, c = pos
        out = []
        for cid in self.base:
            p = self.position(cid, day_index)
            if p and p != pos and abs(p[0] - r) <= 1 and abs(p[1] - c) <= 1:
                out.append(cid)
        return out


# ---------------------------------------------------------------------------
# Vocabulary weighting — this is where the planted conditions live
# ---------------------------------------------------------------------------

def weighted_vocab(p: Persona, layout: Layout, scene: str, rng: random.Random) -> list[tuple[str, float]]:
    weights: list[tuple[str, float]] = []
    for cid in layout.available():
        card = vocab.CARD_BY_ID[cid]
        w = 1.0

        # core words dominate real AAC use
        if vocab.is_core(cid):
            w *= 3.2
        if card.is_essential:
            w *= 2.4

        # --- planted: Maya reaches for "snack" constantly and it is 4 hops away
        if p.child_id == "maya_t" and cid == "snack":
            w *= 22.0
        # --- planted: Liam's two never-combined words are both very frequent
        if p.never_combine and cid in p.never_combine:
            w *= 9.0
        # --- planted: dead word is never selected at all
        if p.dead_word and cid == p.dead_word:
            w = 0.0
        # --- planted: disliked item is refused in ONE scene, normal elsewhere.
        # Scene-specific on purpose: a global zero would look obsolete (I4 case A)
        # rather than like a preference (I4 case B), and the two need opposite
        # responses.
        if p.disliked and cid == p.disliked[0] and scene == p.disliked[1]:
            w = 0.0
        # --- planted: scene-bound politeness
        if p.scene_bound and cid == p.scene_bound[0]:
            w = 14.0 if scene == p.scene_bound[1] else 0.0

        # buried cards cost effort, so they are used less — except where planted
        depth = layout.nav_depth(cid)
        if depth and not (p.child_id == "maya_t" and cid == "snack"):
            w *= 0.45 ** depth

        # scene colouring
        if scene in ("home", "community") and card.category in ("food", "drink", "place"):
            w *= 1.8
        if scene == "therapy" and vocab.is_core(cid):
            w *= 1.5
        if scene == "free_play" and card.category == "play":
            w *= 2.5

        if w > 0:
            weights.append((cid, w))
    return weights


def pick(weights: list[tuple[str, float]], rng: random.Random) -> str:
    total = sum(w for _, w in weights)
    x = rng.random() * total
    for cid, w in weights:
        x -= w
        if x <= 0:
            return cid
    return weights[-1][0]


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------

class Generator:
    def __init__(self, conn: sqlite3.Connection, days: int, end: date):
        self.conn = conn
        self.days = days
        self.end = end
        self.start = end - timedelta(days=days - 1)
        self.events: list[tuple] = []
        self.utterances: list[tuple] = []
        self.partner_turns: list[tuple] = []
        self.revisions: list[tuple] = []
        self.structures: list[tuple] = []

    # -- reference data ------------------------------------------------------

    def write_reference(self) -> None:
        c = self.conn
        now = epoch_ms(self.end, 12, 0)
        c.execute("INSERT INTO orgs VALUES (?,?)", (ORG_ID, "Demo Primary School"))
        c.execute("INSERT INTO classes VALUES (?,?,?)", (CLASS_ID, ORG_ID, "Year 3 — Mrs Patel"))

        adults = [
            ("adult_patel", "Mrs Patel", "teacher"),
            ("adult_slt",   "J. Okonkwo (SLT)", "slt"),
            ("adult_parent_maya", "Maya's parent", "parent"),
        ]
        c.executemany("INSERT INTO adults VALUES (?,?,?,?)",
                      [(a, ORG_ID, n, r) for a, n, r in adults])

        for word, category in vocab.EMOTION_LEXICON:
            c.execute("INSERT INTO emotion_lexicon VALUES (?,?,?)", (word, "en", category))

        for pid, name, seq, example, stage in vocab.SYNTAX_PATTERNS:
            c.execute("INSERT INTO syntax_patterns VALUES (?,?,?,?,?)",
                      (pid, name, seq, example, stage))

        for word, rank, wclass in vocab.CORE_WORDS:
            c.execute("INSERT INTO core_word_list VALUES (?,?,?,?)", (word, "en", rank, wclass))

        for card in vocab.CARDS:
            c.execute(
                "INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (card.card_id, card.label, card.spoken_text, card.category, card.function,
                 1 if card.label in vocab.CORE_SET else 0, 1 if card.is_essential else 0,
                 card.pos,
                 f"/icons/{card.card_id}.png", "icon_pack", card.label, now),
            )

        for p in PERSONAS:
            c.execute(
                "INSERT INTO children VALUES (?,?,?,?,?,?,?,?)",
                (p.child_id, ORG_ID, CLASS_ID, p.display_name, p.year_group,
                 p.profile_note, f"board_{p.child_id}", now),
            )
            c.execute("INSERT INTO roster VALUES (?,?,?,?,?)",
                      (p.child_id, "adult_patel", "teacher", now, None))
            c.execute("INSERT INTO roster VALUES (?,?,?,?,?)",
                      (p.child_id, "adult_slt", "slt", now, None))
            for tier in ("aggregate", "card_labels"):
                c.execute("INSERT INTO consent VALUES (?,?,?,?,?)",
                          (p.child_id, tier, "adult_patel", now, None))

            # One parent, rostered to one child, so the parent-facing path is
            # actually reachable in the demo. Parents hold the utterance_text
            # tier that teachers do not — the tier difference is the point.
            if p.child_id == "maya_t":
                c.execute("INSERT INTO roster VALUES (?,?,?,?,?)",
                          (p.child_id, "adult_parent_maya", "parent", now, None))
                c.execute("INSERT INTO consent VALUES (?,?,?,?,?)",
                          (p.child_id, "utterance_text", "adult_parent_maya", now, None))

            layout = Layout(p)
            board_id = f"board_{p.child_id}"
            c.execute("INSERT INTO boards VALUES (?,?,?,?,?,?,?,?)",
                      (board_id, p.child_id, "Robust board", "robust",
                       layout.rows, layout.cols, "system", now))
            for r, col, cid in vocab.grid_cards(p.grid):
                c.execute("INSERT INTO board_cells VALUES (?,?,?,?,?,?,?)",
                          (board_id, r, col, cid, 1, 0, 0))

            for cid in layout.available():
                c.execute("INSERT INTO child_vocabulary VALUES (?,?,?,?)",
                          (p.child_id, cid, layout.nav_depth(cid), now))

            # A "mode" is a FILTERED VIEW of the robust board — it holds no
            # positions of its own. Constraint C4.
            mode_id = f"mode_{p.child_id}_snack"
            c.execute("INSERT INTO boards VALUES (?,?,?,?,?,?,?,?)",
                      (mode_id, p.child_id, "Snack time", "mode",
                       layout.rows, layout.cols, "ai", now))
            for cid in ("want", "more", "no", "finished", "water", "please"):
                if cid in layout.base or cid in layout.buried:
                    c.execute("INSERT INTO mode_selection VALUES (?,?,?,?)",
                              (mode_id, cid, "highlight", None))

    # -- events --------------------------------------------------------------

    def add_event(self, **kw) -> None:
        self.events.append((
            kw["event_id"], kw["child_id"], kw["ts"], kw["day_local"], TZ_OFFSET_MIN,
            kw["session_id"], kw["scene"], kw.get("actor", "child"), kw["type"],
            kw.get("utterance_id"), kw.get("board_id"), kw.get("card_id"), kw.get("label"),
            kw.get("grid_row"), kw.get("grid_col"), kw.get("grid_rows"), kw.get("grid_cols"),
            kw.get("nav_depth"), kw.get("source"), kw.get("ms_delta"),
            json.dumps(kw.get("payload", {})),
        ))

    def generate_child(self, p: Persona) -> None:
        rng = random.Random(p.seed)
        layout = Layout(p)
        board_id = f"board_{p.child_id}"

        if p.layout_change_day is not None and layout.swapped:
            a, b = layout.swapped
            d = self.start + timedelta(days=p.layout_change_day)
            self.revisions.append((
                uid("rev"), board_id, epoch_ms(d, 8, 30), d.isoformat(), "move",
                a, *layout.base[a], *layout.base[b], None, None, None, None,
                "adult_patel",
                "Moved 'water' into easier reach and swapped 'more' down",
                "I3",
            ))

        for day_index in range(self.days):
            d = self.start + timedelta(days=day_index)
            weekend = d.weekday() >= 5

            if p.silence_from_day is not None and day_index >= p.silence_from_day:
                continue                                  # the planted silence streak

            lo, hi = p.utterances_per_school_day
            n = rng.randint(lo, hi)
            if weekend:
                n = max(1, int(n * p.weekend_activity))
            if p.improving:
                n = int(n * (0.82 + 0.36 * day_index / self.days))

            slots = WEEKEND_SCENES if weekend else SCHOOL_SCENES
            session_id = uid("sess")
            day_utterance_ids: list[str] = []

            for i in range(n):
                hour, scene = slots[rng.randrange(len(slots))]
                minute = rng.randrange(60)
                minutes_into_session = (i / max(n, 1)) * 45
                made = self.generate_utterance(
                    p, layout, rng, d, day_index, hour, minute, scene,
                    session_id, board_id, minutes_into_session,
                )
                if made:
                    day_utterance_ids.append(made)

            self.generate_modeling(p, layout, rng, d, day_index, session_id, board_id)
            self.generate_partner_turns(p, rng, d, weekend, day_utterance_ids)

            self.conn.execute(
                "INSERT INTO events VALUES (" + ",".join("?" * 21) + ")",
                (uid("ev"), p.child_id, epoch_ms(d, 8, 0), d.isoformat(), TZ_OFFSET_MIN,
                 session_id, "classroom", "child", "session_start", None, board_id,
                 None, None, None, None, None, None, None, None, None, "{}"),
            )

    def generate_utterance(self, p, layout, rng, d, day_index, hour, minute, scene,
                           session_id, board_id, minutes_into_session) -> str | None:
        utt_id = uid("utt")
        base_ts = epoch_ms(d, hour, minute, rng.randrange(60))

        # Most of what a child says is an answer to something. Emitting partner
        # turns at random times made only 1% of utterances pair with one, so
        # "answers vs starts" read as 99% self-started — a measurement artifact,
        # not a finding. A partner turn now precedes a realistic share of them.
        answered = rng.random() < 0.62
        if answered:
            lead = rng.randint(1200, 9000)
            dur = rng.randint(1200, 4200)
            self.partner_turns.append((
                uid("pt"), p.child_id, base_ts - lead - dur, d.isoformat(), session_id,
                scene, dur, "stt", None, 1, lead,
                None,
            ))

        # symbol count — Liam is planted at essentially 1.0
        target = max(1, min(6, int(rng.gauss(p.mean_symbols, 0.7) + 0.5)))
        weights = weighted_vocab(p, layout, scene, rng)
        if not weights:
            return None

        chosen: list[str] = []
        for _ in range(target):
            cid = pick(weights, rng)
            # planted: these two words are never combined
            if p.never_combine and cid in p.never_combine and any(
                x in p.never_combine for x in chosen
            ):
                continue
            chosen.append(cid)
        if not chosen:
            return None

        # fatigue: unintended presses climb through a session
        fatigue = 1.0 + 0.9 * (minutes_into_session / 45.0)
        mistap_p = p.base_mistap_rate * fatigue
        if p.layout_change_day is not None and day_index >= p.layout_change_day:
            mistap_p *= 2.3                       # the I8 plant: our advice made it worse

        latency = rng.randint(*p.base_latency_ms)
        ts = base_ts
        tap_count = 0
        delete_count = 0
        used_suggestion = rng.random() < p.suggestion_accept * 0.4

        for idx, cid in enumerate(chosen):
            pos = layout.position(cid, day_index)
            in_dead_row = pos is not None and pos[0] in p.dead_rows

            # an unintended press: reaching for a hard target hits a neighbour
            effective_p = mistap_p * (5.5 if in_dead_row else 1.0)
            if pos is not None and rng.random() < effective_p:
                neigh = layout.neighbours(pos, day_index)
                # A motor slip is corrected by the button next door. A semantic
                # error is corrected from somewhere else entirely. The mix is
                # what makes I1's classifier meaningful.
                semantic = rng.random() < p.semantic_error_share
                if semantic:
                    far = [c for c in layout.base
                           if (lp := layout.position(c, day_index))
                           and (abs(lp[0] - pos[0]) > 1 or abs(lp[1] - pos[1]) > 1)]
                    neigh = far or neigh
                if neigh:
                    wrong = rng.choice(neigh)
                    wpos = layout.position(wrong, day_index)
                    ts += rng.randint(400, 1200)
                    self.add_event(event_id=uid("ev"), child_id=p.child_id, ts=ts,
                                   day_local=d.isoformat(), session_id=session_id, scene=scene,
                                   type="card_tap", utterance_id=utt_id, board_id=board_id,
                                   card_id=wrong, label=vocab.CARD_BY_ID[wrong].label,
                                   grid_row=wpos[0], grid_col=wpos[1],
                                   grid_rows=layout.rows, grid_cols=layout.cols,
                                   nav_depth=0, source="board",
                                   ms_delta=None if idx == 0 else rng.randint(600, 2200))
                    gap = rng.randint(250, 1300)
                    ts += gap
                    self.add_event(event_id=uid("ev"), child_id=p.child_id, ts=ts,
                                   day_local=d.isoformat(), session_id=session_id, scene=scene,
                                   type="delete_last", utterance_id=utt_id, board_id=board_id,
                                   card_id=wrong, label=vocab.CARD_BY_ID[wrong].label,
                                   grid_row=wpos[0], grid_col=wpos[1],
                                   grid_rows=layout.rows, grid_cols=layout.cols,
                                   ms_delta=gap)
                    tap_count += 1
                    delete_count += 1

            # repeated pressing — NOT an error. Exploration, stimming, or a
            # word she does not have. Constraint C1: never logged as a mistake.
            repeats = 1
            if rng.random() < (0.11 if p.child_id == "maya_t" else 0.05):
                repeats = rng.randint(3, 5)

            for rep in range(repeats):
                # Real AAC selection is SLOW. 500-2600ms between symbols implied
                # ~27 words per minute, which no AAC user achieves and which a
                # speech therapist would flag on sight. Direct selection with a
                # motor impairment runs 2-6 seconds per symbol.
                delta = None if (idx == 0 and rep == 0) else rng.randint(2000, 6500)
                ts += delta or latency
                self.add_event(event_id=uid("ev"), child_id=p.child_id, ts=ts,
                               day_local=d.isoformat(), session_id=session_id, scene=scene,
                               type="card_tap", utterance_id=utt_id, board_id=board_id,
                               card_id=cid, label=vocab.CARD_BY_ID[cid].label,
                               grid_row=pos[0] if pos else None,
                               grid_col=pos[1] if pos else None,
                               grid_rows=layout.rows, grid_cols=layout.cols,
                               nav_depth=layout.nav_depth(cid),
                               source="suggestion" if used_suggestion and idx == 0 else "board",
                               ms_delta=delta)
                tap_count += 1

        abandoned = rng.random() < p.abandon_rate
        head = vocab.CARD_BY_ID[chosen[0]]
        ms_compose = ts - base_ts + latency

        if abandoned:
            self.add_event(event_id=uid("ev"), child_id=p.child_id, ts=ts + 4000,
                           day_local=d.isoformat(), session_id=session_id, scene=scene,
                           type="abandon", utterance_id=utt_id, board_id=board_id,
                           payload={"reason": "timeout", "ms_alive": ms_compose})
        else:
            self.add_event(event_id=uid("ev"), child_id=p.child_id, ts=ts + 300,
                           day_local=d.isoformat(), session_id=session_id, scene=scene,
                           type="speak", utterance_id=utt_id, board_id=board_id,
                           payload={"symbol_count": len(chosen)})

        # Which structures APPEARED. A contiguous run of parts of speech that
        # matches a known pattern. Nothing is recorded for what is absent —
        # a missing determiner is not a fact about the child when the board
        # has no determiner card.
        pos_seq = " ".join(vocab.CARD_BY_ID[c].pos or "?" for c in chosen)
        if not abandoned:
            for pid, _n, seq, _e, _s in vocab.SYNTAX_PATTERNS:
                if seq in pos_seq:
                    self.structures.append((utt_id, pid))

        self.utterances.append((
            utt_id, p.child_id, base_ts, d.isoformat(), session_id, scene, "child", board_id,
            json.dumps(chosen), json.dumps([vocab.CARD_BY_ID[c].label for c in chosen]),
            len(chosen),
            # Words in the COMPOSED utterance. Summing each card's standalone
            # sentence counted "I want water." as three words for a single tap
            # and inflated every rate built on it. A multi-symbol utterance
            # speaks the labels joined, not three separate sentences.
            (len(vocab.CARD_BY_ID[chosen[0]].spoken_text.split()) if len(chosen) == 1
             else sum(len(vocab.CARD_BY_ID[c].label.split()) for c in chosen)),
            tap_count, delete_count,
            None if abandoned else ms_compose,
            latency, 1 if used_suggestion else 0, 0,
            0 if abandoned else 1,
            "timeout" if abandoned else None,
            head.function, "card" if head.function else None,
        ))
        return utt_id

    def generate_modeling(self, p, layout, rng, d, day_index, session_id, board_id) -> None:
        """Adult taps — aided language input. actor='adult'."""
        lo, hi = p.modeling_per_day
        for _ in range(rng.randint(lo, hi)):
            cid = pick(weighted_vocab(p, layout, "classroom", rng), rng)
            pos = layout.position(cid, day_index)
            self.add_event(event_id=uid("ev"), child_id=p.child_id,
                           ts=epoch_ms(d, rng.randrange(9, 15), rng.randrange(60)),
                           day_local=d.isoformat(), session_id=session_id, scene="classroom",
                           actor="adult", type="card_tap", board_id=board_id,
                           card_id=cid, label=vocab.CARD_BY_ID[cid].label,
                           grid_row=pos[0] if pos else None,
                           grid_col=pos[1] if pos else None,
                           grid_rows=layout.rows, grid_cols=layout.cols,
                           nav_depth=layout.nav_depth(cid), source="board")

    def generate_partner_turns(self, p, rng, d, weekend, utterance_ids) -> None:
        # Turns the child did NOT answer. The answered ones are emitted next to
        # the utterance they precede, in generate_utterance.
        for _ in range(rng.randint(3, 9)):
            hour = rng.randrange(9, 16)
            ts = epoch_ms(d, hour, rng.randrange(60))
            responded = False
            self.partner_turns.append((
                uid("pt"), p.child_id, ts, d.isoformat(), uid("sess"),
                "home" if weekend else "classroom",
                rng.randint(1200, 5000), "stt",
                rng.randint(*p.partner_wait_ms) if not responded else None,
                1 if responded else 0,
                rng.randint(1500, 8000) if responded else None,
                # An interruption must reference a REAL utterance the child was
                # mid-way through; a synthetic id would pass generation and fail
                # every join downstream.
                (rng.choice(utterance_ids)
                 if utterance_ids and rng.random() < p.partner_interrupt_rate else None),
            ))

    # -- flush ---------------------------------------------------------------

    def flush(self) -> None:
        c = self.conn
        c.executemany("INSERT INTO events VALUES (" + ",".join("?" * 21) + ")", self.events)
        c.executemany("INSERT INTO utterances VALUES (" + ",".join("?" * 22) + ")", self.utterances)
        c.executemany("INSERT INTO partner_turns VALUES (" + ",".join("?" * 12) + ")",
                      self.partner_turns)
        c.executemany("INSERT INTO board_revisions VALUES (" + ",".join("?" * 17) + ")",
                      self.revisions)
        # De-duplicated: one row per (utterance, pattern), and a pattern can
        # match twice in a long utterance.
        c.executemany("INSERT OR IGNORE INTO utterance_structures VALUES (?,?)",
                      self.structures)
        self.materialise_sessions(c)
        c.commit()

    def materialise_sessions(self, c: sqlite3.Connection) -> None:
        """One row per SITTING, split on idle gaps — not one row per day.

        The first version grouped by the generator's session_id, which is issued
        per day, and produced 10-hour "sessions". That is a day wearing a
        session label, and it destroys the only reason to have the grain: a bad
        day is very often one bad sitting, and a day-shaped row cannot show that.

        Splitting on a gap is also how this works against real data, where
        nothing tells you a child put the tablet down.
        """
        c.execute(f"""
            INSERT INTO sessions
              (session_id, child_id, day_local, started_at, ended_at, minutes, scene,
               end_reason, utterances, taps, mistaps, abandoned, new_words, fatigue_ratio)
            WITH marked AS (
              SELECT child_id, ts, day_local, scene, type, ms_delta,
                     CASE WHEN LAG(ts) OVER w IS NULL
                           OR ts - LAG(ts) OVER w > {IDLE_GAP_MS}
                          THEN 1 ELSE 0 END AS starts_session
              FROM events
              WHERE actor = 'child' AND type IN ('card_tap','delete_last','speak','abandon')
              WINDOW w AS (PARTITION BY child_id ORDER BY ts)
            ),
            grouped AS (
              SELECT *, SUM(starts_session) OVER (PARTITION BY child_id ORDER BY ts) AS sid
              FROM marked
            )
            SELECT
              g.child_id || '_s' || g.sid,
              g.child_id,
              MIN(g.day_local),
              MIN(g.ts), MAX(g.ts),
              ROUND((MAX(g.ts) - MIN(g.ts)) / 60000.0, 1),
              (SELECT scene FROM grouped x
                WHERE x.child_id = g.child_id AND x.sid = g.sid
                GROUP BY scene ORDER BY COUNT(*) DESC LIMIT 1),
              'normal',
              0, 0, 0, 0, 0, NULL
            FROM grouped g
            GROUP BY g.child_id, g.sid
            HAVING SUM(CASE WHEN g.type = 'card_tap' THEN 1 ELSE 0 END) >= 3
        """)

        # Counts, joined on the time range rather than on a shared id — the
        # sessions above are derived, so nothing carries their key yet.
        c.execute("""
            UPDATE sessions SET
              taps = (SELECT COUNT(*) FROM events e
                       WHERE e.child_id = sessions.child_id AND e.actor='child'
                         AND e.type='card_tap' AND e.ts BETWEEN sessions.started_at AND sessions.ended_at),
              mistaps = (SELECT COUNT(*) FROM events e
                       WHERE e.child_id = sessions.child_id AND e.actor='child'
                         AND e.type='delete_last' AND e.ms_delta < 1500
                         AND e.ts BETWEEN sessions.started_at AND sessions.ended_at),
              utterances = (SELECT COUNT(*) FROM utterances u
                       WHERE u.child_id = sessions.child_id AND u.spoken = 1
                         AND u.ts BETWEEN sessions.started_at AND sessions.ended_at),
              abandoned = (SELECT COUNT(*) FROM utterances u
                       WHERE u.child_id = sessions.child_id AND u.spoken = 0
                         AND u.ts BETWEEN sessions.started_at AND sessions.ended_at)
        """)

        # Fatigue: unintended presses in the last third of a sitting against the
        # first third. Above ~1.5 points at tiredness, not at the layout — and
        # the answer is a break, not a board change.
        c.execute("""
            UPDATE sessions SET fatigue_ratio = (
              WITH b AS (
                SELECT e.type, e.ms_delta,
                       (e.ts - sessions.started_at) * 1.0
                         / NULLIF(sessions.ended_at - sessions.started_at, 0) AS frac
                FROM events e
                WHERE e.child_id = sessions.child_id AND e.actor = 'child'
                  AND e.ts BETWEEN sessions.started_at AND sessions.ended_at
              )
              SELECT ROUND(
                (SELECT CAST(SUM(CASE WHEN type='delete_last' AND ms_delta<1500 THEN 1 ELSE 0 END) AS REAL)
                        / NULLIF(SUM(CASE WHEN type='card_tap' THEN 1 ELSE 0 END),0)
                   FROM b WHERE frac >= 0.67)
                / NULLIF(
                (SELECT CAST(SUM(CASE WHEN type='delete_last' AND ms_delta<1500 THEN 1 ELSE 0 END) AS REAL)
                        / NULLIF(SUM(CASE WHEN type='card_tap' THEN 1 ELSE 0 END),0)
                   FROM b WHERE frac < 0.33), 0), 2)
            )
            WHERE minutes >= 10 AND taps >= 20
        """)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(ROOT / "aac.db"))
    ap.add_argument("--days", type=int, default=42)
    ap.add_argument("--end", default="2026-08-07")
    args = ap.parse_args()

    db_path = Path(args.db)
    if db_path.exists():
        db_path.unlink()
    for suffix in ("-wal", "-shm"):
        p = Path(str(db_path) + suffix)
        if p.exists():
            p.unlink()

    conn = sqlite3.connect(str(db_path))
    for sql_file in ("schema.sql", "indices.sql", "seed_catalogues.sql"):
        conn.executescript((ROOT / "db" / sql_file).read_text())

    gen = Generator(conn, args.days, date.fromisoformat(args.end))
    gen.write_reference()
    for persona in PERSONAS:
        gen.generate_child(persona)
    gen.flush()

    counts = {
        t: conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
        for t in ("events", "utterances", "partner_turns", "board_revisions", "cards")
    }
    print(f"seeded {db_path}")
    for k, v in counts.items():
        print(f"  {k:<16} {v:>7,}")
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
