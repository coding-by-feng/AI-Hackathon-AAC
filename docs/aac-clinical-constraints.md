# AAC Clinical Constraints

**Status:** binding design constraints — overrides `analytics-metrics.md` where they conflict
**Source:** [AssistiveWare Learn AAC](https://www.assistiveware.com/learn-aac), read 2026-08-07
**Why this file exists:** several metrics and two of the seven insights, as originally specified, would have produced advice that harms AAC users. This records what changed and why.

---

## 0. The eight constraints

| # | Constraint | What it invalidates |
|---|---|---|
| C1 | Repetition is communication, not error | `mistap_rate` as originally scoped |
| C2 | Motor plans depend on stable button positions | I1's "resize the grid" advice |
| C3 | Never relocate a learned button | I3's "promote to home grid" advice |
| C4 | Topic boards must not replace a robust board | the entire Communication Modes feature |
| C5 | Core vocabulary is the central measure | our decision to cut `core_fringe_ratio` |
| C6 | Requesting-only is the named failure mode | our decision to cut `pragmatic_function_mix` |
| C7 | Slow output may be the partner's fault | `time_to_first_tap` read as a child metric |
| C8 | A robust system needs alphabet access | we have no keyboard at all |

---

## C1 — Repetition is communication, not error

> "Students may repeat it many times in a row when learning to find it on their AAC."
> "The repeated sound or sensation of pressing the same button can provide comfort or pleasure."
> **"Trying to reduce or stop repetitive tapping leads to less overall communication."**

AssistiveWare gives four causes for repeated tapping, and only one of them is a mistake:

1. **Communication** — frustration, excitement, or a meaning they have no word for
2. **Device exploration** — repetition is *how* motor automaticity is built
3. **Language development** — gestalt processors, or wanting to hear a word again
4. **Stimming** — self-regulation; explicitly to be supported, not corrected

### What changes

- `mistap_rate` **requires a delete**. Repetition without a delete is never counted as an error, anywhere, ever.
- New signal `repeat_tap_rate` (P0), filed under **Communication**, never under Errors. Its dashboard copy is neutral-to-positive.
- High `repeat_tap_rate` + low vocabulary coverage in that scene routes to the **vocabulary gap queue** — the hypothesis is "they lack the word", not "they made a mistake".
- No insight, chart, or recommendation may propose reducing repetition. This is enforced in the insight catalogue, not left to copywriting.

---

## C2 — Motor plans depend on stable positions

> **"Each time we change the grid size, we all need to re-learn where the words are."**

Progressive Language is the recommended alternative: **mask** buttons to start and unmask as language grows, so "words the user has already learned stay in the same place." Start with a grid as large as the user can see and touch, rather than growing into it.

### What changes

- I1's MOTOR branch previously recommended "drop 4×4 → 3×3". **Removed.** Shrinking the grid relocates every button and destroys the motor plan the child has built.
- Replacement recommendations, in order of preference:
  1. **Mask** the neighbouring cells of an error-prone target (position of everything else preserved)
  2. Physical access changes — keyguard, mount angle, dwell-select, touch-hold threshold
  3. Increase the *touch target* within the same grid (padding), not the grid size
  4. Resize only as a last resort, deliberately, with the disruption measured
- `grid_size_suggestion` is renamed `access_recommendation` and reordered accordingly.
- New signal `layout_stability` (P1): position changes per window, plus the mis-tap delta in the 7 days following each change. **A system that recommends layout changes must measure the harm they cause.**

---

## C3 — Never relocate a learned button

I3 previously read: *"A top-5% word four screens deep is pure tax → promote it to the home grid."* The diagnosis is right; the prescription breaks C2.

### What changes

- I3's action becomes: **add a copy** at a stable prime position, or **unmask** an existing one — never move the original.
- Duplicate cards are therefore a first-class concept, not a data-quality problem. `board_cells` allows the same `card_id` at multiple positions; exactly one is flagged `canonical`.
- The one-click "Promote" affordance becomes "Add a copy here", and it records a `board_revisions` row so C2's disruption tracking sees it.

---

## C4 — Topic boards must not replace a robust board

This one challenges the product concept directly. Our AI-generated Communication Modes (Café, Doctor, Dentist) *are* topic boards. AssistiveWare's five objections:

1. You can only say what's on the board — no way to change topic
2. Users don't learn where words live in their real system
3. Inconsistent placement across boards prevents motor automaticity
4. Words learned on a topic board don't generalise
5. Building them consumes time better spent on modelling

They do not ban them. They permit topic boards **alongside** a robust system, and recommend building them **from the robust vocabulary itself, so users still learn word locations consistently.**

### What changes — this is the most valuable correction in the document

**An AI-generated mode is a filtered, highlighted view of the robust board — not a new board with new positions.**

```
   WRONG (as originally designed)          RIGHT
   ────────────────────────────────        ─────────────────────────────────
   "Café mode" = new 3x3 grid              "Café mode" = the robust board with
   with new cards at new positions          café-relevant cards HIGHLIGHTED and
                                            irrelevant ones dimmed or masked
   ↓                                        ↓
   every mode teaches a new motor plan      one motor plan, reinforced every time
   nothing generalises                      café words are the SAME words, in the
   the child is lost when the mode ends       same places, as everywhere else
```

The AI keeps its job — surfacing the right vocabulary for the situation — and stops undermining motor learning while doing it. New vocabulary the robust board genuinely lacks is *added to the robust board* at a stable position, then highlighted.

- New signal `position_consistency` (P1): the fraction of cards in a generated mode sitting at their canonical position. **Target: 1.0.** Anything less is our own AI causing harm.
- New insight **I8 — system-induced motor disruption** (below).
- The robust board is the spine. Modes are a lens over it. This is now an architectural invariant, expressed in the schema as `boards.kind ∈ {robust, mode}` with modes holding no independent positions.

---

## C5 — Core vocabulary is the central measure

> "A list of only 200 words accounts for about 80% of the words you use every day."

Core words are verbs, adjectives, prepositions, pronouns, articles, conjunctions — only ~10% of the top 200 are nouns, and those are general ("girl", "house"). Fringe words are specific nouns and specialised verbs, and should sit in folders "without too many navigation steps."

We cut `core_fringe_ratio` on the grounds that it "needs a curated word list per language and age band." That objection was weak: the list is ~200 words, standard, and published.

### What changes

- `core_fringe_ratio` **reinstated at P1.**
- New table `core_word_list (word, lang, rank, word_class)` seeded with a standard 200-word core set. Classification becomes a join, not a judgement call.
- Fringe-word `nav_depth` gets its own read: fringe should be reachable in few steps, which makes D1 clinically load-bearing rather than a nicety.

---

## C6 — Requesting-only is the named failure mode

> "Most often, AAC is used for only one communication function—requesting."

The eight functions, verbatim: **request · protest · comment · direct · ask questions · give opinions · share news · start a conversation.**

We cut `pragmatic_function_mix` because tagging every card was authoring work. But this is the single most-cited roadblock in AAC practice, and having the exact taxonomy removes most of the ambiguity from the tagging job.

### What changes

- `pragmatic_function_mix` **reinstated at P1**, with those eight values as a closed enum.
- `cards.default_function` is set at authoring; utterances inherit it from the head card, with LLM classification as fallback for multi-function utterances.
- I6 (generalisation) recovers full confidence, since it can now compare *function* across scenes rather than just word frequency.

---

## C7 — Slow output may be the partner's fault

> "AAC users produce ~15 words per minute versus 150–170 for speech."
> Partners should allow extended response time, not fill silences, not switch topics mid-composition, and not conduct rapid-fire questioning.

`time_to_first_tap` was specified as a child metric. A long latency may equally mean the adult gave no processing time, or interrupted, or moved on.

### What changes

- New table `partner_turns` capturing partner speech segments from STT.
- New signals (both P2, both about the adult):
  - `partner_wait_time` — median gap before the partner speaks *again* when the child hasn't yet responded
  - `partner_interruption_rate` — partner speech beginning while the child has an open utterance
- I2's card must offer both readings: *"long scan time"* and *"was the child given time?"* — and show `partner_wait_time` alongside, so the adult sees their own number next to the child's.

---

## C8 — A robust system needs alphabet access

The fourth pillar of a robust AAC system is keyboard access, "from early stages of learning." Our spec has no keyboard.

### What changes

- Flagged as a **product gap**, not a metrics gap. Out of scope for the hackathon build, in scope for honesty about what we've built.
- `keyboard_use` defined at P2 so the schema anticipates it: spelling attempts, words spelled that don't exist as cards (a direct vocabulary-gap signal), and prediction acceptance.

---

## New insight — I8: system-induced motor disruption

The only insight that points at *us*.

```
TRIGGER  a board_revisions row with change_kind IN (move, resize)
   OR    position_consistency < 1.0 for an active generated mode
   AND   mistap_rate in the 7 days after > mistap_rate in the 7 days before
   AND   the increase exceeds the child's own week-to-week variance

ACTION   revert the position change · rebuild the mode as a filtered view of the
         robust board · never present this as the child regressing
```

Without I8, every layout recommendation the dashboard makes is unfalsifiable. With it, the system is accountable for its own advice.

---

## Copy rules, enforced in the insight catalogue

These are stored as fields on `insights_catalog`, not left to whoever writes the UI string:

| Rule | Enforcement |
|---|---|
| Never recommend reducing repetition | `insights_catalog.forbidden_actions` includes `reduce_repetition` |
| Never recommend relocating a learned card | `forbidden_actions` includes `move_card`, `resize_grid` |
| Never frame a preference as a training gap | I4B has `action_kind = 'informational'`, no intervention field |
| Never frame a metric as a target the child must hit | `insights_catalog.target_audience = 'adult'` on I2, I6, I7, I8 |
| Never present repetition, stimming, or refusal as a problem | `metrics_catalog.polarity = 'neutral'` blocks red/warning styling |

`metrics_catalog.polarity ∈ {higher_better, lower_better, neutral}` exists specifically so the UI cannot colour a neutral signal as a warning. Stimming does not get a red badge.

---

## Metric count after these changes

| | Before | After |
|---|---|---|
| Shown | 22 | **30** |
| Logged only | 4 | 4 |
| Cut | 6 | 4 |
| **Defined** | **32** | **38** |

New at P0: `repeat_tap_rate` (safety — stops the system pathologising normal behaviour).
New at P1: `layout_stability`, `position_consistency`, `core_fringe_ratio`, `pragmatic_function_mix`.
New at P2: `partner_wait_time`, `partner_interruption_rate`, `keyboard_use`.

---

## Sources

All from https://www.assistiveware.com/learn-aac:

- `/repeated-button-tapping` — C1
- `/choosing-a-grid-size` — C2, C3
- `/topic-boards-vs-robust-aac` — C4
- `/4-things-every-robust-aac-has` — C4, C5, C8
- `/learn-about-core-word-teaching-strategies` — C5
- `/consider-communication-functions` — C6
- `/follow-their-lead-how-to-be-a-respectful-communication-partner` — C7
- `/start-modeling` — reinforces E2 `teacher_modeling` and I7
