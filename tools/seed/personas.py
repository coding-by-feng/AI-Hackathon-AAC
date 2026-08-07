"""The seeded cohort: five children, each with a deliberately planted condition.

Seed data is NOT random. Each persona carries a specific pathology so that every
one of the eight insight rules fires at least once — the acceptance criterion in
docs/analytics-metrics.md. If an insight cannot be made to fire on plausible
data, the rule is wrong, and tools/verify.py fails the build.

Amara is the control. She has nothing planted. If any insight fires on her, the
rules are too eager, and a dashboard that cries wolf gets ignored within a week.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from . import vocab


@dataclass(frozen=True)
class Persona:
    child_id: str
    display_name: str
    year_group: str
    profile_note: str
    grid: list[list[str | None]]
    seed: int

    # --- baseline behaviour --------------------------------------------------
    utterances_per_school_day: tuple[int, int]   # (min, max)
    mean_symbols: float                          # drives MLU
    base_mistap_rate: float
    base_latency_ms: tuple[int, int]             # time-to-first-tap range
    suggestion_accept: float
    weekend_activity: float                      # multiplier

    # --- planted conditions --------------------------------------------------
    dead_rows: tuple[int, ...] = ()              # rows she cannot reach  -> I1 motor
    # Share of unintended presses that are SEMANTIC (correction lands far away)
    # rather than MOTOR (correction lands next door). Without a mix, I1's
    # classifier is degenerate and always answers "motor".
    semantic_error_share: float = 0.45
    scan_slow: bool = False                      # correct but slow       -> I2
    silence_from_day: int | None = None          # goes quiet             -> queue
    abandon_rate: float = 0.06
    never_combine: tuple[str, str] | None = None #                        -> I5
    scene_bound: tuple[str, str] | None = None   # (card_id, scene)       -> I6
    modeling_per_day: tuple[int, int] = (4, 12)  # adult taps             -> I7 when ~0
    modeling_gap_category: str | None = None     #                        -> I7
    dead_word: str | None = None                 # 0 taps everywhere      -> I4A
    disliked: tuple[str, str] | None = None      # (card_id, scene)       -> I4B
    layout_change_day: int | None = None         # an adult moves buttons -> I8
    partner_wait_ms: tuple[int, int] = (2800, 6000)
    partner_interrupt_rate: float = 0.05
    improving: bool = False                      # steady upward trend

    fires: tuple[str, ...] = field(default_factory=tuple)


PERSONAS: list[Persona] = [
    # -----------------------------------------------------------------------
    # MAYA — reach problem plus a well-meaning layout change that makes it worse.
    # The showcase persona: I1 (motor), I3 (buried word), I8 (our own advice).
    # -----------------------------------------------------------------------
    Persona(
        child_id="maya_t",
        display_name="Maya T.",
        year_group="Year 3",
        profile_note="CP / dysarthria",
        grid=vocab.MAYA_GRID,
        seed=1001,
        utterances_per_school_day=(28, 52),
        mean_symbols=2.1,
        base_mistap_rate=0.07,
        base_latency_ms=(2200, 4800),
        suggestion_accept=0.38,
        weekend_activity=0.35,
        dead_rows=(3,),
        semantic_error_share=0.14,               # overwhelmingly a reach problem
        abandon_rate=0.09,
        disliked=("cookie", "classroom"),        # taps "no" at snack time, never "cookie"
        layout_change_day=33,                    # adult swaps two cells -> mis-taps rise
        fires=("I1", "I3", "I4", "I8"),
    ),

    # -----------------------------------------------------------------------
    # JONAH — dense board, slow scanning, and an adult who fills the silence.
    # Then he stops communicating entirely for the last four days.
    # -----------------------------------------------------------------------
    Persona(
        child_id="jonah_k",
        display_name="Jonah K.",
        year_group="Year 3",
        profile_note="CP / cortical visual impairment",
        grid=vocab.JONAH_GRID,
        seed=1002,
        utterances_per_school_day=(14, 26),
        mean_symbols=1.6,
        base_mistap_rate=0.04,
        base_latency_ms=(5200, 9000),            # slow, but taps are correct
        suggestion_accept=0.44,
        weekend_activity=0.2,
        scan_slow=True,
        semantic_error_share=0.58,               # visual, not motor
        silence_from_day=38,                     # quiet for the final 4 days
        abandon_rate=0.14,
        partner_wait_ms=(900, 1900),             # adult waits under 2s -> I2 partner side
        partner_interrupt_rate=0.22,
        fires=("I2",),
    ),

    # -----------------------------------------------------------------------
    # AMARA — the control. Nothing planted. Steady improvement.
    # If a rule fires on her, that rule is too eager.
    # -----------------------------------------------------------------------
    Persona(
        child_id="amara_o",
        display_name="Amara O.",
        year_group="Year 4",
        profile_note="Dysarthria",
        grid=vocab.AMARA_GRID,
        seed=1003,
        utterances_per_school_day=(48, 78),
        mean_symbols=3.4,
        base_mistap_rate=0.02,
        base_latency_ms=(1400, 3000),
        suggestion_accept=0.29,
        weekend_activity=0.6,
        abandon_rate=0.04,
        semantic_error_share=0.5,
        improving=True,
        modeling_per_day=(8, 18),
        fires=(),
    ),

    # -----------------------------------------------------------------------
    # LIAM — plenty of vocabulary, no combining. Gives up often.
    # -----------------------------------------------------------------------
    Persona(
        child_id="liam_w",
        display_name="Liam W.",
        year_group="Year 2",
        profile_note="CP / apraxia",
        grid=vocab.LIAM_GRID,
        seed=1004,
        utterances_per_school_day=(24, 44),
        mean_symbols=1.08,                       # essentially single words
        base_mistap_rate=0.05,
        base_latency_ms=(2600, 5200),
        suggestion_accept=0.33,
        weekend_activity=0.4,
        abandon_rate=0.31,                       # builds sentences, gives up
        semantic_error_share=0.42,
        never_combine=("want", "biscuit"),       # both used constantly, never together
        dead_word="helicopter",                  # 0 taps across every scene -> I4A
        fires=("I4", "I5"),
    ),

    # -----------------------------------------------------------------------
    # SOFIA — polite in therapy, silent about it everywhere else, and nobody
    # has modelled social language at her in a fortnight.
    # -----------------------------------------------------------------------
    Persona(
        child_id="sofia_r",
        display_name="Sofia R.",
        year_group="Year 2",
        profile_note="Nonspeaking / autistic",
        grid=vocab.SOFIA_GRID,
        seed=1005,
        utterances_per_school_day=(18, 34),
        mean_symbols=1.9,
        base_mistap_rate=0.03,
        base_latency_ms=(2000, 4400),
        suggestion_accept=0.41,
        weekend_activity=0.5,
        abandon_rate=0.07,
        semantic_error_share=0.47,
        scene_bound=("thank you", "therapy"),    # never says it outside therapy -> I6
        modeling_per_day=(0, 1),                 # nobody is modelling  -> I7
        modeling_gap_category="core",
        fires=("I6", "I7"),
    ),
]


PERSONA_BY_ID = {p.child_id: p for p in PERSONAS}

# Every insight must be fired by at least one persona. verify.py asserts this
# against the database rather than against this list, but the mismatch here is
# the first thing to check when the gate fails.
EXPECTED_FIRING: dict[str, list[str]] = {}
for _p in PERSONAS:
    for _i in _p.fires:
        EXPECTED_FIRING.setdefault(_i, []).append(_p.child_id)

ALL_INSIGHTS = ["I1", "I2", "I3", "I4", "I5", "I6", "I7", "I8"]
UNCOVERED = [i for i in ALL_INSIGHTS if i not in EXPECTED_FIRING]
assert not UNCOVERED, f"no persona plants these insights: {UNCOVERED}"
