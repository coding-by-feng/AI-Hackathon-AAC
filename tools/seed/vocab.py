"""Vocabulary and board layouts for the seeded demo cohort.

Core word list is a trimmed standard set — about 200 words account for ~80% of
everyday communication, so `is_core` is resolved by joining this list rather
than by anyone's judgement. See docs/aac-clinical-constraints.md C5.
"""
from __future__ import annotations

from typing import NamedTuple

# ---------------------------------------------------------------------------
# Core vocabulary (rank-ordered, trimmed to what the demo boards actually use)
# ---------------------------------------------------------------------------

CORE_WORDS: list[tuple[str, int, str]] = [
    ("I", 1, "pronoun"),        ("you", 2, "pronoun"),      ("it", 3, "pronoun"),
    ("want", 4, "verb"),        ("go", 5, "verb"),          ("more", 6, "adjective"),
    ("stop", 7, "verb"),        ("help", 8, "verb"),        ("like", 9, "verb"),
    ("no", 10, "adverb"),       ("yes", 11, "adverb"),      ("what", 12, "pronoun"),
    ("where", 13, "adverb"),    ("my", 14, "pronoun"),      ("that", 15, "pronoun"),
    ("do", 16, "verb"),         ("put", 17, "verb"),        ("look", 18, "verb"),
    ("turn", 19, "verb"),       ("finished", 20, "adjective"), ("different", 21, "adjective"),
    ("again", 22, "adverb"),    ("please", 23, "adverb"),   ("thank you", 24, "phrase"),
    ("good", 25, "adjective"),  ("bad", 26, "adjective"),   ("here", 27, "adverb"),
    ("this", 28, "pronoun"),    ("not", 29, "adverb"),      ("all done", 30, "phrase"),
]

CORE_SET = {w for w, _, _ in CORE_WORDS}


class Card(NamedTuple):
    card_id: str
    label: str
    spoken_text: str
    category: str
    function: str | None       # one of the eight communication functions
    is_essential: bool
    pos: str | None            # part of speech — drives "sentence shapes"


def _c(cid, label, spoken, cat, fn=None, essential=False, pos=None) -> Card:
    return Card(cid, label, spoken, cat, fn, essential, pos)


# Part of speech per card. Used ONLY to spot which structures are appearing —
# never to mark anything missing. A board with no determiner card cannot produce
# a determiner, and counting that against the child would score them for our
# vocabulary decisions.
POS = {
    'I':'pronoun','you':'pronoun','my':'pronoun','this':'pronoun','that':'pronoun','what':'pronoun',
    'want':'verb','go':'verb','like':'verb','look':'verb','turn':'verb','do':'verb','stop':'verb',
    'help':'verb','swimming':'verb','pain':'verb',
    'more':'adjective','good':'adjective','different':'adjective','finished':'adjective',
    'no':'adverb','yes':'adverb','not':'adverb','again':'adverb','here':'adverb','where':'adverb',
    'please':'adverb',
    'thank you':'phrase','all done':'phrase',
    'water':'noun','biscuit':'noun','milkshake':'noun','snack':'noun','dad':'noun','mum':'noun',
    'teacher':'noun','ball':'noun','book':'noun','home':'noun','tooth':'noun','helicopter':'noun',
    'cookie':'noun','music':'noun','outside':'noun','toilet':'noun',
    'Dad':'noun','Mum':'noun','hurt':'verb',
    'happy':'adjective','sad':'adjective','tired':'adjective','scared':'adjective','excited':'adjective',
}

# Pre-classified feeling words, per proposed_metrics.docx. Deliberately SHORT:
# assigning an emotional reading to core vocabulary ("help" = distress) is the
# overreach the metric's caveat warns about. Only genuinely emotion-bearing
# words are here, and the dashboard shows how few there are.
EMOTION_LEXICON = [
    ('happy',   'positive'), ('good',    'positive'), ('like',   'positive'),
    ('excited', 'positive'), ('thank you','positive'),
    ('finished','neutral'),  ('all done','neutral'),  ('tired',  'neutral'),
    ('sad',     'upset'),    ('scared',  'upset'),    ('hurt',   'upset'),
]

# Structures worth noticing, in rough developmental order. Matched as a
# contiguous run of parts of speech inside an utterance.
SYNTAX_PATTERNS = [
    ('two_word_request', 'want + thing',      'verb noun',            'want biscuit',  1),
    ('agent_action',     'I + doing word',    'pronoun verb',         'I want',        1),
    ('more_thing',       'more + thing',      'adjective noun',       'more water',    1),
    ('agent_act_object', 'I + doing + thing', 'pronoun verb noun',    'I want water',  2),
    ('action_again',     'doing + again',     'verb adverb',          'go again',      2),
    ('describe_thing',   'feeling + thing',   'adjective noun',       'happy dad',     3),
]


# ---------------------------------------------------------------------------
# Card library. `is_core` is derived from CORE_SET at load time, never hardcoded.
# ---------------------------------------------------------------------------

CARDS: list[Card] = [
    # essentials — always available, never re-ranked, never AI-generated
    _c("yes",       "yes",       "Yes.",                      "essential", "give_opinion", True),
    _c("no",        "no",        "No.",                       "essential", "protest",      True),
    _c("stop",      "stop",      "Stop.",                     "essential", "direct",       True),
    _c("help",      "help",      "I need help.",              "essential", "request",      True),
    _c("toilet",    "toilet",    "I need the toilet.",        "essential", "request",      True),
    _c("pain",      "hurt",      "It hurts.",                 "essential", "comment",      True),

    # core
    _c("I",         "I",         "I",                         "core", None),
    _c("you",       "you",       "you",                       "core", None),
    _c("want",      "want",      "I want",                    "core", "request"),
    _c("more",      "more",      "More, please.",             "core", "request"),
    _c("go",        "go",        "Let's go.",                 "core", "direct"),
    _c("like",      "like",      "I like it.",                "core", "give_opinion"),
    _c("what",      "what",      "What is that?",             "core", "ask_question"),
    _c("where",     "where",     "Where is it?",              "core", "ask_question"),
    _c("my",        "my",        "my",                        "core", None),
    _c("look",      "look",      "Look at that!",             "core", "comment"),
    _c("finished",  "finished",  "I'm finished.",             "core", "comment"),
    _c("different", "different", "I want something different.","core", "protest"),
    _c("again",     "again",     "Again, please.",            "core", "request"),
    _c("please",    "please",    "Please.",                   "core", "request"),
    _c("thank you", "thank you", "Thank you.",                "core", "start_conversation"),
    _c("good",      "good",      "That's good.",              "core", "give_opinion"),
    _c("all done",  "all done",  "All done.",                 "core", "comment"),
    _c("this",      "this",      "this one",                  "core", "request"),
    _c("turn",      "turn",      "My turn.",                  "core", "direct"),
    _c("not",       "not",       "not",                       "core", None),
    _c("here",      "here",      "Over here.",                "core", "direct"),
    _c("do",        "do",        "do",                        "core", None),

    # fringe — specific nouns and specialised verbs
    _c("water",     "water",     "I want water.",             "drink",    "request"),
    _c("biscuit",   "biscuit",   "I want a biscuit.",         "food",     "request"),
    _c("milkshake", "milkshake", "I want a milkshake.",       "drink",    "request"),
    _c("snack",     "snack",     "I want a snack.",           "food",     "request"),
    _c("swimming",  "swimming",  "I went swimming.",          "activity", "share_news"),
    _c("dad",       "Dad",       "Dad",                       "people",   None),
    _c("mum",       "Mum",       "Mum",                       "people",   None),
    _c("teacher",   "teacher",   "my teacher",                "people",   None),
    _c("ball",      "ball",      "I want the ball.",          "play",     "request"),
    _c("book",      "book",      "I want a book.",            "play",     "request"),
    _c("home",      "home",      "I want to go home.",        "place",    "request"),
    _c("tooth",     "tooth",     "My tooth hurts.",           "body",     "comment"),
    _c("helicopter","helicopter","a helicopter",              "vehicle",  "comment"),
    _c("cookie",    "cookie",    "I want a cookie.",          "food",     "request"),
    _c("music",     "music",     "I want music.",             "play",     "request"),
    _c("outside",   "outside",   "I want to go outside.",     "place",    "request"),

    # A feelings folder. Real boards have one, and without it the feeling-words
    # metric would have almost nothing to count — which is itself the caveat.
    _c("happy",     "happy",     "I feel happy.",             "feeling",  "comment"),
    _c("sad",       "sad",       "I feel sad.",               "feeling",  "comment"),
    _c("tired",     "tired",     "I am tired.",               "feeling",  "comment"),
    _c("scared",    "scared",    "I feel scared.",            "feeling",  "comment"),
    _c("excited",   "excited",   "I am excited!",             "feeling",  "comment"),
]

# Attach the part of speech from the table above rather than repeating it on
# every _c() call — one place to correct a tagging mistake.
CARDS = [c._replace(pos=POS.get(c.label)) for c in CARDS]
CARD_BY_ID = {c.card_id: c for c in CARDS}


def is_core(card_id: str) -> bool:
    return CARD_BY_ID[card_id].label in CORE_SET


# ---------------------------------------------------------------------------
# Board layouts
#
# board_cells holds the HOME page only. Cards reachable through folders carry a
# nav_depth > 0 and no home-grid coordinates. This mirrors the real product:
# `nav_depth` is logged on every tap, positions exist only for the home grid.
# ---------------------------------------------------------------------------

# Maya — 4x4. Row 3 is the planted dead zone: she cannot comfortably reach it.
# Note that no ESSENTIAL card sits there; adults naturally place those in reach,
# which is exactly why a reach problem can hide for weeks.
MAYA_GRID: list[list[str | None]] = [
    ["I",     "want",     "more",    "help"],
    ["you",   "go",       "stop",    "yes"],
    ["no",    "like",     "toilet",  "pain"],
    ["water", "finished", "what",    None],      # (3,3) empty
]

# Jonah — 6x6. Dense on purpose: the planted problem is visual scanning load.
JONAH_GRID: list[list[str | None]] = [
    ["I",      "you",       "want",   "more",     "go",        "stop"],
    ["yes",    "no",        "help",   "toilet",   "pain",      "like"],
    ["what",   "where",     "my",     "look",     "finished",  "different"],
    ["again",  "please",    "thank you", "good",  "all done",  "this"],
    ["turn",   "not",       "here",   "do",       "water",     "biscuit"],
    ["ball",   "book",      "home",   "music",    "outside",   "snack"],
]

AMARA_GRID: list[list[str | None]] = JONAH_GRID          # control: same board, no plants
LIAM_GRID: list[list[str | None]] = [
    ["I",     "want",  "more",     "help",  "go"],
    ["you",   "yes",   "no",       "stop",  "like"],
    ["toilet","pain",  "finished", "what",  "my"],
    ["water", "biscuit","ball",    "book",  "home"],
]
SOFIA_GRID: list[list[str | None]] = [
    ["I",         "want",  "more",     "help",   "go"],
    ["you",       "yes",   "no",       "stop",   "like"],
    ["please",    "thank you", "good", "again",  "what"],
    ["toilet",    "pain",  "finished", "water",  "snack"],
]

# Cards reachable only through folders: card_id -> nav_depth
FEELINGS = {"happy": 2, "sad": 2, "tired": 2, "scared": 3, "excited": 3}

BURIED: dict[str, dict[str, int]] = {
    # Maya: "snack" is her most-wanted fringe word and it is four hops away.
    # This is the I3 plant.
    "maya_t":  {"snack": 4, "milkshake": 3, "swimming": 3, "dad": 2, "mum": 2,
                "biscuit": 3, "cookie": 4, "helicopter": 4, "book": 3, "ball": 3},
    "jonah_k": {"swimming": 2, "dad": 2, "mum": 2, "teacher": 2, "cookie": 3,
                "helicopter": 3, "milkshake": 3, "tooth": 3},
    "amara_o": {"swimming": 2, "dad": 2, "mum": 2, "teacher": 2, "cookie": 3,
                "helicopter": 3, "milkshake": 2, "tooth": 3},
    "liam_w":  {"snack": 2, "cookie": 3, "swimming": 3, "dad": 2, "mum": 2,
                "milkshake": 3, "music": 2, "outside": 2, "helicopter": 4},
    "sofia_r": {"swimming": 2, "dad": 2, "mum": 2, "teacher": 2, "biscuit": 2,
                "cookie": 3, "book": 2, "ball": 2, "helicopter": 4, "home": 2},
}


for _child in list(BURIED):
    BURIED[_child].update(FEELINGS)


def grid_cards(grid: list[list[str | None]]) -> list[tuple[int, int, str]]:
    """Yield (row, col, card_id) for every filled cell."""
    return [
        (r, c, cid)
        for r, row in enumerate(grid)
        for c, cid in enumerate(row)
        if cid is not None
    ]
