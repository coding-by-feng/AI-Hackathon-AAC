# AAC Analytics Specification

**Status:** build spec — source of truth
**Scope:** event logging in the web app + the metrics and insights on the dashboard
**Audience:** the coding agent or engineer implementing this.

> **Read alongside:**
> - [`aac-clinical-constraints.md`](./aac-clinical-constraints.md) — **overrides this file where they conflict.** Eight constraints from AAC clinical practice changed two insights and added six metrics.
> - [`mcp-api.md`](./mcp-api.md) — the MCP surface the LLM consumes.
> - [`../db/schema.sql`](../db/schema.sql) — the implemented schema. Supersedes §12 below.

---

## 0. TL;DR for the implementer

Three things matter more than the rest of this document:

1. **Log `row`, `col`, `sceneTag`, `navDepth` and `actor` on every tap from day one.** These four fields cannot be backfilled. Without them, 5 of the 7 AI insights are permanently impossible, no matter how much work you do later.
2. **Log generously, display sparingly.** **38 signals** are defined: **30 shown**, 4 logged but not charted, 4 cut. Adding a chart later is config; recovering lost history is not.
3. **The insights are hypotheses with evidence attached, never diagnoses.** Every one surfaces as "this looks like X — does that match what you see?" with a one-tap dismiss, and every dismissal is logged.
4. **Some advice is forbidden, and the ban is enforced in data.** `insights_catalog.forbidden_actions` blocks recommendations that AAC practice says cause harm — resizing a grid, relocating a learned card, reducing repetition, retraining a refusal. See [`aac-clinical-constraints.md`](./aac-clinical-constraints.md). There are now **8** insights; I8 exists to catch the system harming the child through its own advice.

---

## 1. Metric index

<!-- METRIC-INDEX:START -->

The whole measurement surface in one table — **41 metrics: 33 shown, 4 logged only, 4 cut**. Generated from `metrics_catalog`; edit the database, not this table (`python3 tools/gen_metric_index.py`). Full derivations and thresholds are in §5–§7.

**Legend** — `Tier`: P0 build now · P1 if time · P2 later. `Who`: T teacher · P parent · S speech therapist · ALL everyone. `Feeds`: which insight in §8 depends on it. `Pol`: ↑ higher better · ↓ lower better · **=** neutral, and a neutral metric must never be styled as good or bad. `★` marks the six that carry the product story.

### Shown on the dashboard — 33

**A. Effort & speed**

| Ref | Metric · `id` | What it tells you | Pol | Tier · Who | min n | Feeds |
|---|---|---|---|---|---|---|
| A1 ★ | Buttons to say one thing · `taps_per_utterance` | How many buttons the child presses to say one thing. | ↓ | P0 · ALL | 5 | I3 |
| A2 | Composition time · `composition_time` | Seconds from the first button press to pressing Speak. | = | P0 · T S | 5 | — |
| A3 | Time to start answering · `time_to_first_tap` | The pause between someone finishing speaking and the child starting to answer. | = | P0 · S | 5 | I1 I2 |

**B. Errors & motor**

| Ref | Metric · `id` | What it tells you | Pol | Tier · Who | min n | Feeds |
|---|---|---|---|---|---|---|
| B1 ★ | Presses she did not mean · `mistap_rate` | How often a button was pressed and then deleted almost immediately - a press the child did not mean. | ↓ | P0 · T S | 30 | I1 I8 |
| B2 | Where corrections land · `correction_adjacent_rate` | When the child fixes a mistake, how often the replacement is the button right next door. | = | P0 · T S | 10 | I1 |
| B3 | Built but not spoken · `abandonment_rate` | How often the child builds a sentence and then gives up without speaking it. | ↓ | P0 · T S | 10 | I2 |
| B4 | Which buttons get reached · `cell_heat` | Which grid positions get pressed, and where mistakes cluster. | = | P1 · S | 50 | I1 I3 |

**C. Volume & vocabulary**

| Ref | Metric · `id` | What it tells you | Pol | Tier · Who | min n | Feeds |
|---|---|---|---|---|---|---|
| C1 ★ | Days since she last spoke · `silence_streak` | Days since the child last said anything at all. | ↓ | P0 · ALL | 1 | — |
| C2 | Her go-to words · `card_frequency` | Which cards the child actually uses, ranked. | = | P0 · ALL | 20 | I3 I4 |
| C3 | New words · `new_words` | Cards used for the very first time during this window. | ↑ | P0 · ALL | 1 | — |
| C4 | Days at zero · `zero_activation_days` | How long a card has gone unused, and in which situations. | = | P0 · T S | 1 | I4 |
| C5 | Number of different words · `ndw` | How many distinct words the child used. | ↑ | P1 · S | 30 | I5 |
| C6 | Words per utterance (MLU) · `mlu` | Average sentence length in symbols. | ↑ | P1 · S | 20 | I5 |
| C7 | Words not yet paired · `word_pairs` | Which two words the child uses often but never together. | = | P1 · S | 10 | I5 |
| C8 | Flexible words vs naming · `core_fringe_ratio` | How much of the child's output is flexible core vocabulary versus specific nouns. | = | P1 · S | 50 | — |
| C9 | Sentence shapes · `sentence_shapes` | Which sentence structures are starting to appear, like "want + thing" or "I + doing word". | ↑ | P1 · T S | 20 | — |

**D. Layout & context**

| Ref | Metric · `id` | What it tells you | Pol | Tier · Who | min n | Feeds |
|---|---|---|---|---|---|---|
| D1 | How deep words are buried · `nav_depth_by_card` | How many screens deep a card is buried. | ↓ | P1 · T S | 10 | I3 |
| D2 | Scene distribution · `scene_distribution` | Where the child communicates, and where they go quiet. | = | P1 · T S | 20 | I4 I6 |
| D3 | Layout stability · `layout_stability` | How often button positions have changed, and whether errors rose afterwards. | ↑ | P1 · T S | 1 | I8 |
| D4 | Position consistency · `position_consistency` | Whether AI-generated modes keep cards where the child already learned them. | ↑ | P1 · T S | 5 | I8 |

**E. Whose voice**

| Ref | Metric · `id` | What it tells you | Pol | Tier · Who | min n | Feeds |
|---|---|---|---|---|---|---|
| E1 ★ | Her own words · `independence_rate` | Share of sentences the child built themselves, without taking an AI suggestion. | ↑ | P0 · ALL | 10 | — |
| E2 | What language is used for · `pragmatic_function_mix` | The balance across the eight reasons people communicate. | = | P1 · T S | 20 | I6 |
| E3 | Adult demonstrating · `teacher_modeling` | How often the grown-up demonstrates on the device (aided language input). | ↑ | P1 · T S | 1 | I7 |
| E4 | Answers and topic starts · `answers_vs_starts` | How often the child answers someone, and how often they start a topic themselves. | = | P2 · T S | 20 | — |

**F. AI value**

| Ref | Metric · `id` | What it tells you | Pol | Tier · Who | min n | Feeds |
|---|---|---|---|---|---|---|
| F1 | Suggestion acceptance · `suggestion_acceptance` | How often the child taps an AI suggestion that was offered. | = | P0 · ALL | 20 | — |
| F2 ★ | Taps saved · `taps_saved` | How many button presses the AI spared the child. | ↑ | P0 · ALL | 20 | — |
| F3 ★ | Vocabulary gaps · `vocabulary_gaps` | Concepts the child reached for that did not exist on the board. | = | P0 · T S | 1 | — |
| F4 | Where images came from · `visual_source_split` | Share of image needs met from local icons and cache versus paid generation. | = | P1 · ALL | 10 | — |

**G. Communication partner**

| Ref | Metric · `id` | What it tells you | Pol | Tier · Who | min n | Feeds |
|---|---|---|---|---|---|---|
| G1 | How long the adult waits · `partner_wait_time` | How long the adult waits before speaking again when the child has not yet responded. | ↑ | P2 · T S | 10 | I2 |
| G2 | Partner interruptions · `partner_interruption_rate` | How often an adult starts talking while the child is mid-sentence. | ↓ | P2 · T S | 10 | I2 |

**H. Communication style**

| Ref | Metric · `id` | What it tells you | Pol | Tier · Who | min n | Feeds |
|---|---|---|---|---|---|---|
| H1 | Repeated pressing · `repeat_tap_rate` | How often the child presses the same button several times in a row. | = | P0 · T S | 10 | I4 |
| H2 | Spelling and the alphabet · `keyboard_use` | Spelling and alphabet access - words typed rather than selected. | = | P2 · T S | 5 | — |
| H3 | Feeling words · `feeling_words` | Which feeling words the child used, grouped as positive, neutral or upset. | = | P1 · ALL | 5 | — |

### Logged but not charted — 4

Derivable and queryable today; enabling a chart later is a config flag, not a migration.

| Metric · `id` | What it tells you | Why no chart |
|---|---|---|
| Words per minute · `words_per_minute` | Speaking rate in words of spoken output per active minute. | Recognisable but not actionable. Shown as small caption text under taps_per_utterance, never as a KPI tile. |
| Pause between taps · `inter_tap_interval` | Typical gap between one button press and the next within a sentence. | Fully derivable, no adult acts on it directly. |
| Utterances per day · `utterances_per_day` | How many things the child said today. | Superseded by silence_streak for decision-making. |
| Type-token ratio · `ttr` | Variety of vocabulary against repetition. | Redundant with ndw + mlu; unstable at our sample sizes. |

### Cut — 4

Recorded so the decision is not re-litigated every week.

| Metric · `id` | What it would have told you | Why cut |
|---|---|---|
| Wandering after a delete · `post_delete_entropy` | Whether recovery after a deletion is purposeful or scattered. | Fuzzy to define, and correction_adjacent_rate already separates motor from semantic reliably. |
| Time of day · `time_of_day_chart` | Hour-by-hour communication histogram. | Chart cut for surface area. tsLocal remains in every event, so this can be enabled later as config. |
| Peer baseline · `peer_baseline` | Where a child sits against similar children. | Statistical noise at our cohort size; presenting it would imply rigour we do not have. Insights compare against the child's own 4-week rolling average instead. |
| Generated card keep-rate · `generated_keep_rate` | Whether AI-generated cards actually get reused. | visual_source_split covers the cost story; retention deferred. |

### The six that carry the story

If everything else were cut, these still make the case:

| Metric | Why this one |
|---|---|
| `taps_per_utterance` — Buttons to say one thing | the whole product claim, in one number |
| `taps_saved` — Taps saved | the same claim in effort, not ratios |
| `vocabulary_gaps` — Vocabulary gaps | becomes the teacher's to-do list |
| `silence_streak` — Days since she last spoke | finds the child who stopped talking |
| `mistap_rate` — Presses she did not mean | finds the child fighting the hardware |
| `independence_rate` — Her own words | proves the AI assists rather than replaces |

<!-- METRIC-INDEX:END -->

---

## 2. Architecture

**Platform: web only.** No Android, no iOS, no Flutter, no Drift. One web app serves both the AAC board (used by the child and the teacher) and the dashboard.

```
   BROWSER — one PWA, two surfaces
   ┌────────────────────────────┐   ┌────────────────────────────┐
   │  AAC BOARD                 │   │  DASHBOARD                 │
   │  child + teacher           │   │  teacher · parent · SLT    │
   │  service worker + IndexedDB│   │  class view · insights     │
   └─────────────┬──────────────┘   └─────────────┬──────────────┘
                 │ POST /events (batched)         │ GET /api/metrics
                 │ queues offline, flushes on     │
                 │ reconnect                      │
                 ▼                                ▼
        ┌──────────────────────────────────────────────┐
        │  NODE API SERVER                             │
        │  writes L0 events · materialises L1          │
        │  nightly L2 rollup                           │
        └───────────────────┬──────────────────────────┘
                            │ read/write
                            ▼
             ┌───────────────────────────┐        ┌──────────────────┐
             │  aac.db      (SQLite,WAL) │        │  aac_text.db     │
             │  everything except text   │        │  utterance text  │
             └─────────────┬─────────────┘        └──────────────────┘
                           │ READ-ONLY                    ▲
                           ▼                              │ never attached
             ┌───────────────────────────┐                │ by MCP
             │  MCP SERVER  → the LLM    │────────────────┘
             └───────────────────────────┘
```

**What the platform change costs.** Offline communication was a P0 requirement, and a website cannot guarantee it the way an installed app can. Mitigation: PWA with a service worker caching the board, symbols and app shell; events queue in IndexedDB and flush on reconnect; speech via the Web Speech API with local voices. This holds for a returning user on a warm cache. It does **not** hold for a first visit with no network, and voice availability varies by browser — notably on iOS Safari, which an iPad user will hit even though iOS is not a target. Flagged rather than solved.

**Non-negotiable rules**

| Rule | Why |
|---|---|
| The board never blocks on the network | Communication must work offline. Events queue in IndexedDB and drain later. |
| The event log is append-only | Corrections are new rows, never updates. Deletions are tombstones. |
| Dashboard reads `agg_daily_metric` for ranges > 7 days | Raw-event scans do not scale past a term. |
| Nothing is logged in Private Mode | See §11. The child can switch it on and off themselves. |
| The MCP server opens `aac.db` read-only and never attaches `aac_text.db` | Utterance text is unreachable by architecture, not by policy. |
| A mode is a filtered view of the robust board, never a new layout | Motor planning. See constraint C4. |

---

## 3. Event schema

All events share a common envelope. `sceneTag` and `actor` are on **every** event — no exceptions.

### 3.1 Common envelope

```
EventEnvelope {
  eventId      String   uuid v4, generated on device
  childId      String
  ts           DateTime UTC, device clock
  tsLocal      DateTime local, with offset — needed for time-of-day analysis
  sessionId    String
  sceneTag     Scene    therapy | classroom | free_play | home | community | unknown
  actor        Actor    child | adult          ← adult ⇒ teacher/parent modelling
  appVersion   String
  synced       bool     local only, not transmitted
}

enum Scene  { therapy, classroom, free_play, home, community, unknown }
enum Actor  { child, adult }
```

`actor` is what makes signal `teacher_modeling` (§5, E) possible without a separate event type. When the app is in Modeling Mode, every emitted event carries `actor: adult`.

### 3.2 Event types

```
card_tap {
  cardId          String
  label           String        denormalised on purpose — labels change, history shouldn't
  modeId          String
  row             int    ★      0-indexed grid position
  col             int    ★
  gridRows        int    ★      grid dimensions AT THE TIME OF THE TAP
  gridCols        int    ★
  navDepth        int    ★      hops from the root board to reach this card (0 = home grid)
  source          enum          board | suggestion | essential | recent | search
  msSinceLastTap  int?          null for the first tap of an utterance
  utteranceId     String        groups taps into one sentence
}

speak {
  utteranceId     String
  cardIds         List<String>
  labels          List<String>
  symbolCount     int
  wordCount       int           expanded text word count, not symbol count
  msCompose       int           first tap → Speak press
  usedSuggestion  bool          true if any card came from source=suggestion
  wasExpanded     bool          true if the LLM expanded the phrase before speaking
}

delete_last {
  utteranceId     String
  cardId          String        the card removed
  msAfterTap      int           time between tapping it and deleting it
}

abandon {
  utteranceId     String
  cardIds         List<String>
  msAlive         int
  reason          enum          cleared | timeout | navigated_away | session_end
}

mode_switch {
  fromModeId      String?
  toModeId        String
  trigger         enum          manual | ai | scene_change
}

scene_change {
  from            Scene
  to              Scene
  setBy           enum          schedule | teacher | mode_selection | manual
}

listen {
  msDuration      int
  gotTranscript   bool
  aborted         bool
}

suggestion_shown {
  suggestionIds   List<String>
  labels          List<String>
  sources         List<String>  rag | context | recent | generic  (parallel to ids)
  latencyMs       int           request → chips rendered
}

suggestion_tap {
  suggestionId    String
  rank            int           0-indexed position in the strip
  source          String        rag | context | recent | generic
}

gap_detected {
  concept            String
  normalizedConcept  String
  resolvedBy         enum       icon_pack | card_library | hash_cache | semantic | generated | failed
  msResolve          int
  costUsd            double?    non-null only when resolvedBy = generated
}

card_created {
  cardId          String
  origin          enum          ai_mode | ai_gap | photo | manual
}

session {
  startTs         DateTime
  endTs           DateTime?
  endReason       enum          normal | idle_timeout | crash | battery | force_quit
  orientation     enum          portrait | landscape
}
```

★ = **cannot be backfilled.** If these are missing from the first build, the history is gone.

### 3.3 Derived at query time, not stored

Do not add fields for these — they fall out of the events above:

| Derived value | How |
|---|---|
| Correction adjacency | `delete_last(D)` then next `card_tap(N)`: `abs(D.row−N.row) ≤ 1 && abs(D.col−N.col) ≤ 1 && D.cardId ≠ N.cardId` |
| Taps per utterance | `count(card_tap)` grouped by `utteranceId` |
| Time-to-first-tap | first `card_tap.ts` of an utterance − preceding `listen.ts + msDuration` |
| Word pairs | pairwise combinations of `speak.labels` |

---

## 4. Metric registry — conventions

Every metric has a stable `id` slug. Code references the slug, never the display name.

| Field | Meaning |
|---|---|
| `id` | stable identifier used in code, config and the API |
| **Shown** | rendered on the dashboard |
| **Logged only** | derivable and queryable, but no chart — enabling it later is a config flag |
| **Dropped** | not implemented; reason recorded so it isn't re-litigated |
| **Tier** | P0 = build now · P1 = if time · P2 = post-hackathon |
| **Who** | T teacher · P parent · S speech therapist · ALL |
| **Feeds** | which of the 7 insights (§8) depends on it |

Default thresholds in this document are **starting values, tuned per child after two weeks of baseline.** Never ship them as fixed clinical cut-offs.

---

## 5. Signal catalogue — 22 shown

### A. Effort & speed

**A1 · `taps_per_utterance`** — P0 · ALL · feeds I3
`count(card_tap where utteranceId = U) for each speak`
Report the median per day, not the mean — one 12-tap struggle skews an average.
The single most important number in the product: the AI's purpose is to lower it. Baseline in week 1 and compare only against that child's own history.

**A2 · `composition_time`** — P0 · T S · feeds —
`speak.msCompose`, reported as a daily median in seconds.
Read alongside A1: slow with few taps means scanning or thinking; slow with many taps means fighting the board.

**A3 · `time_to_first_tap`** — P0 · S · feeds I1, I2
`first card_tap.ts − (listen.ts + listen.msDuration)`, only for utterances that follow a `listen` within 30 s.
The most diagnostic timing value available. It is where "didn't understand", "can't find it" and "can't reach it" separate.

### B. Errors & motor

**B1 · `mistap_rate`** — P0 · T S · feeds I1
`count(delete_last where msAfterTap < MISTAP_MS) / count(card_tap)`
`MISTAP_MS` default **1500**. Raise it for children with slower correction cycles — for athetoid CP, 2500 is often more accurate. Sustained above ~10% indicates a layout or target-size problem, not a learning problem.

**B2 · `correction_adjacent_rate`** — P0 · T S · feeds I1
Of all mis-taps, the fraction where the next tap is a grid neighbour (see §3.3).
The discriminator of the whole system. High = the finger slipped. Low = the mind changed. Costs one comparison because `row`/`col` are already logged.

**B3 · `abandonment_rate`** — P0 · T S · feeds —
`count(abandon) / (count(abandon) + count(speak))`
The quietest failure mode: the child composed something and gave up, so nothing was said and nobody noticed. Often more urgent than low volume.

**B4 · `cell_heat` / `cell_error_heat`** — P1 · S · feeds I1, I3
`count(card_tap) group by (modeId, row, col)` and the same for mis-taps.
Always render the pair side by side. A cold cell ringed by errors is a hard-to-reach target, not an unknown word. Bucket by `(gridRows, gridCols)` so grids of different sizes are never merged.

### C. Volume & vocabulary

**C1 · `silence_streak`** — P0 · ALL · feeds —
`days since max(speak.ts)`
The most actionable number on the dashboard and the primary driver of the Attention Queue. A child who stops talking needs a person today; totals-based views bury them because their historical average still looks healthy.

**C2 · `card_frequency`** — P0 · ALL · feeds I3, I4
`count(card_tap) group by label` over the window.
Feeds "top words" one way and dead-word detection the other. Two insights depend on it.

**C3 · `new_words`** — P0 · ALL · feeds —
Labels whose first-ever `card_tap` falls inside the window.
Growth signal, and a feedback loop on the adults' own work: it shows whether newly added cards were ever used.

**C4 · `zero_activation_days`** — P0 · T S · feeds I4
Per card: consecutive days with zero taps, plus the set of scenes in which it has been used at all.
Default removal candidate at **30 days across all scenes**. Clutter makes every live word harder to find.

**C5 · `ndw`** — P1 · S · feeds I5
`count(distinct label)` in the window. Standard AAC language-sampling measure.

**C6 · `mlu`** — P1 · S · feeds I5
`avg(speak.symbolCount)`. Parked near 1.0 for weeks is the syntax plateau that insight 5 acts on.

**C7 · `word_pairs`** — P1 · S · feeds I5
Co-occurrence matrix over `speak.labels`: for every ordered pair `(A,B)`, count utterances containing both.
This is what actually proves insight 5. Averages hide it — "want" 30×, "candy" 50×, together 0× is invisible to MLU when most utterances are length 1.

### D. Layout & context

**D1 · `nav_depth_by_card`** — P1 · T S · feeds I3
`avg(card_tap.navDepth) group by cardId`, crossed with C2.
A top-5% word at depth ≥ 3 is pure tax. This is the one insight that can be applied with a single confirm click.

**D2 · `scene_distribution`** — P1 · T S · feeds I4, I6
`count(speak) group by sceneTag`, and per-label scene breakdown.
Without the scene tag, insight 4B (dislike) and insight 6 (generalisation) are both undetectable.

### E. Whose voice

**E1 · `independence_rate`** — P0 · ALL · feeds —
`count(speak where usedSuggestion = false and actor = child) / count(speak where actor = child)`
The guardrail against the AI quietly becoming the speaker. Independence rising while A1 falls is the product working. Independence falling means the AI is over-reaching, regardless of how good acceptance looks.

**E2 · `teacher_modeling`** — P1 · T S · feeds I7
`count(card_tap where actor = adult) group by (day, category)`
The only signal in the system about the adult. Aided language modelling is among the strongest predictors of AAC progress and is invisible unless logged. **Requires Modeling Mode in the app** — see §10.

### F. AI value

**F1 · `suggestion_acceptance`** — P0 · ALL · feeds —
`count(suggestion_tap) / count(suggestion_shown expanded by suggestionIds)`
Below ~20%, the strip is visual clutter and should be shown less often — an ignored suggestion still costs scanning effort.

**F2 · `taps_saved`** — P0 · ALL · feeds —
`(median(taps_per_utterance where usedSuggestion = false) − median(taps_per_utterance where usedSuggestion = true)) × count(speak where usedSuggestion = true)`
The product claim as a number, in the unit that matters to someone with CP: physical effort not spent.

**F3 · `vocabulary_gaps`** — P0 · T S · feeds —
`gap_detected where resolvedBy = generated`, grouped by `normalizedConcept`.
One event, two products: an AI cost metric and the teacher's curriculum to-do list.

**F4 · `visual_source_split`** — P1 · ALL · feeds —
`count(gap_detected) group by resolvedBy`
Proves cost control: the share of visual needs that never reach the image API. Target ≥ 90% resolved at steps 1–4.

---

## 6. Logged but not shown — 4

Implemented as queries with no dashboard widget. Enabling them later is a config flag, not a migration.

| id | Name | Why not shown |
|---|---|---|
| `words_per_minute` | Words per minute | Recognisable but not actionable. Render as small caption text under A1, never as a KPI tile. AAC rates are 2–15 wpm; a tile invites comparison against typing speed, which is meaningless and demoralising. |
| `inter_tap_interval` | Pause between taps | Fully derivable; no adult acts on it directly. Query it if a specific question comes up. |
| `utterances_per_day` | Utterances per day | Folded into `silence_streak`, which is the version that drives action. |
| `ttr` | Type-token ratio | Keep `ndw` and `mlu`; TTR is unstable at small sample sizes and adds a third number that says roughly what the first two already said. |

---

## 7. Dropped — 4 (+2 partial)

Recorded here so the decision is not revisited every week.

| id | Name | Reason | Damage |
|---|---|---|---|
| `peer_baseline` | Cohort percentile | Statistical noise at our cohort size. Presenting it would imply rigour we don't have. | Insight 2 runs against the child's own 4-week rolling average instead — arguably the better comparison anyway. |
| `pragmatic_function_mix` | Request / reject / comment / social / question | Requires tagging every card in the seed library with a communicative function. Real authoring cost, high value — a strong post-hackathon addition. | Insight 6 survives on scene tag + frequency alone, at reduced confidence. |
| `post_delete_entropy` | Wandering after a delete | Fuzzy to define, and `correction_adjacent_rate` already separates motor from semantic. | None. |
| `core_fringe_ratio` | Core vs fringe mix | Needs a curated core-word list per language and age band. | None for the 7 insights. |
| `generated_keep_rate` *(partial)* | Reuse of generated cards | Keep `visual_source_split`; drop the retention half for now. | None. |
| `time_of_day_chart` *(partial)* | Hour-of-day histogram | `tsLocal` is still logged; only the chart is cut. | None. |

---

## 8. The 7 AI insights

Each insight is a rule over signals, a default threshold set, and a recommended action. All of them render as a hypothesis with its evidence and a one-tap dismiss. **Log every dismissal** — it is the only feedback available on whether the rules work.

### I1 — Concept confusion vs. motor mismatch

```
TRIGGER  mistap_rate (B1) > 8% over 5+ sessions

CLASSIFY per mis-tap event:
   correction_adjacent (B2) = true   AND  time_to_first_tap (A3) normal
        ──▶ MOTOR      confidence = share of mis-taps that are adjacent
   correction_adjacent = false       AND  time_to_first_tap elevated
        ──▶ SEMANTIC   confidence = 1 − adjacent share

ACTION   MOTOR     larger targets · fewer columns · relocate the card · dwell-to-select
         SEMANTIC  reteach the concept · pair with a real photo · reduce distractors
```

**Safety note.** With cerebral palsy, mis-taps are frequent and normal. A system that reads them as semantic confusion will recommend retraining a child whose comprehension was never in question. Default to the MOTOR reading when the split is ambiguous, and phrase the card as *"this looks like a reach problem — does that match what you see?"*

### I2 — Slow visual scanning

```
TRIGGER  time_to_first_tap (A3) > own_4wk_baseline + 2σ   (fallback: > 5000 ms)
   AND   the tap was contextually correct
   AND   no delete_last followed

ACTION   reduce cells per page · stabilise card positions across modes
         colour-code by category · anchor high-use cards to a fixed corner
```

The "tap was correct, no delete" condition is what separates this from I1. Without it the two insights fire on the same events.

### I3 — Buried high-use word

```
TRIGGER  card_frequency (C2) percentile ≥ 95
   AND   nav_depth_by_card (D1) ≥ 3

ACTION   promote to the home grid
```

The only insight safe to apply semi-automatically: show a one-click "Promote" that moves the card and records who approved it.

### I4 — Obsolete word vs. genuine preference

```
CASE A — OBSOLETE
  zero_activation_days (C4) ≥ 30  across ALL scenes (D2)
  ──▶ recommend replacing the card

CASE B — PREFERENCE
  zero activations for card X in scene S
  AND high "no"/"stop" activations in scene S
  AND the child is otherwise active in scene S
  ──▶ they know the board and do not want the thing. NO ACTION.
```

**Case B must never route to retraining.** Drilling a child to request something they have refused teaches them that their "no" does not count. The UI copy for case B is informational only, with no suggested intervention.

### I5 — Syntax plateau

```
TRIGGER  count(A) ≥ 20  AND  count(B) ≥ 20        (C2)
   AND   word_pairs[A][B] = 0                     (C7)
   AND   mlu (C6) < 1.3

ACTION   aided language stimulation for that specific pair
```

Target the named pair, not combining in general. "want + candy" is teachable; "make longer sentences" is not.

### I6 — Generalisation failure

```
TRIGGER  freq(label | scene = therapy) high                    (C2 × D2)
   AND   freq(label | scene ∈ {home, free_play}) = 0
   FOR   2 consecutive weeks

ACTION   coach the partner in the other setting — the child already has the skill
```

Reduced confidence while `pragmatic_function_mix` is dropped (§7). Label the card accordingly.

### I7 — Facilitator gap

```
TRIGGER  child's score in a vocabulary domain falling 2 consecutive weeks
   AND   teacher_modeling (E2) in that domain ≈ 0

ACTION   prompt the adult, not the child
```

The only insight aimed at a grown-up, and the one most likely to be resisted. Present evidence, never a verdict, and never surface it in a view a parent shares with a teacher without the teacher seeing it first.

---

## 9. Dashboard structure

```
/class                    ← teacher and SLT land here
      Attention Queue     ← ranked: silence_streak · abandonment_rate · mistap_rate · gaps
      roster table        ← C1 · A1 · E1 · C3 + flags

/student/:id              ← overview
      KPI tiles           ← A1 · C1 · E1 · F1
      caption line        ← words_per_minute (small text, not a tile)
      charts              ← C2 top cards · C3 new words · B3 abandonment trend
      action queue        ← F3 gaps · I1–I7 cards that have fired

/student/:id/access       ← B4 heat map pair · B1 · B2 · A2 · A3
/student/:id/vocabulary   ← C2 · C3 · C4 · C5 · C6 · C7 · D2
/student/:id/ai-impact    ← F1 · F2 · F3 · F4
/student/:id/sessions     ← utterance history, privacy-gated, OFF by default

/settings/consent         ← §11 tiers, retention, export, revoke
```

**Attention Queue ranking** — the feature teachers will actually use daily:

```
score = 3·(silence_streak ≥ 2 days)
      + 2·(abandonment_rate > 25%)
      + 2·(mistap_rate > 12%)
      + 1·(unreviewed vocabulary gaps ≥ 3)
      + 1·(any insight fired and not yet dismissed)
```

---

## 10. Roles and permissions

| Role | Sees | Never sees |
|---|---|---|
| **child** | optional "my week" view — streaks, new words, people talked to | any metric framed as a deficit |
| **teacher** | own class · aggregates + card labels | full utterance text · other classes |
| **parent** | own child · everything including utterances, if consented | any other child |
| **SLT** | caseload across classes · clinical export | children not on caseload |
| **admin** | school-level de-identified counts | any individual content |

**Design rule for the child-facing view: never show a child a declining metric.** Growth framing only — streaks, words unlocked, "you told 12 people something today".

### Modeling Mode (required for E2 / I7)

A toggle in the app, available to an adult, that sets `actor: adult` on all emitted events until switched off. It must:

- be visually unmistakable while active (persistent banner, distinct colour)
- auto-exit after 10 minutes of inactivity so adult taps are never silently attributed
- never affect the child's own metrics — adult events are excluded from every signal except E2

---

## 11. Privacy, consent, retention

| Data tier | Who | Default |
|---|---|---|
| Aggregate metrics (counts, rates, times) | teacher · parent · SLT | ON |
| Card / symbol labels | teacher · parent · SLT | ON |
| Full utterance text | parent · SLT only | **OFF** — opt in per child |
| Partner speech (STT transcript) | nobody | **OFF** — discarded after suggestions render |

**In-app guarantees, visible to the child rather than buried in settings:**

- **Recording indicator** — unmissable while Listen is active
- **Private Mode** — one tap, nothing logged, reachable by the child themselves
- **Delete this utterance** — long-press any history row; removes it everywhere, including from `daily_metrics`

**Retention:** raw events 90 days → daily aggregates 2 years → transcripts 7 days.
**Consent:** parent or guardian signs per tier; teacher access expires at end of term.
**Export:** a parent can export or delete everything at any time without raising a request.

Utterance text lives in a **separate table with its own RLS policy and its own retention clock**. This is a schema consequence, not a UI one — bolting it on later means a migration and a difficult conversation.

---

## 12. Data model

### 12.1 Server SQLite  →  superseded by `db/schema.sql`

```
usage_events
  event_id      TEXT PK
  child_id      TEXT NOT NULL
  ts            INTEGER NOT NULL          epoch ms UTC
  ts_local      INTEGER NOT NULL
  tz_offset_min INTEGER NOT NULL
  session_id    TEXT NOT NULL
  scene_tag     TEXT NOT NULL
  actor         TEXT NOT NULL             child | adult
  type          TEXT NOT NULL             card_tap | speak | ...
  payload       TEXT NOT NULL             JSON, per §3.2
  synced        INTEGER NOT NULL DEFAULT 0

  INDEX (child_id, ts)
  INDEX (type, ts)
  INDEX (synced) WHERE synced = 0

utterances                                 materialised for fast local queries
  utterance_id  TEXT PK
  child_id      TEXT
  ts            INTEGER
  scene_tag     TEXT
  mode_id       TEXT
  card_ids      TEXT                       JSON array
  labels        TEXT                       JSON array
  symbol_count  INTEGER
  word_count    INTEGER
  ms_compose    INTEGER
  tap_count     INTEGER
  used_suggestion INTEGER
  spoken        INTEGER                    0 = abandoned

daily_metrics
  child_id      TEXT
  day           TEXT                       YYYY-MM-DD local
  metric_id     TEXT                       the §5 slug
  value         REAL
  n             INTEGER                    sample size behind the value
  PRIMARY KEY (child_id, day, metric_id)
```

### 12.2 Postgres (cloud mirror)

Same three tables plus:

```
children        id · display_name · birth_year · profile_notes · org_id
roster          child_id · adult_id · role (teacher|parent|slt) · expires_at
consent         child_id · tier · granted_by · granted_at · revoked_at
utterance_text  utterance_id · text · created_at        ← separate RLS + retention
insight_events  id · child_id · insight_id · fired_at · evidence(jsonb)
                 · dismissed_at · dismissed_by · dismiss_reason
```

**RLS:** every table filters on `roster` membership. `utterance_text` additionally requires an active `consent` row for the `utterance_text` tier.

`insight_events.dismissed_*` is the feedback loop — without it there is no way to know which of the 7 rules are producing noise.

---

## 13. Implementation checklist

Dependency-ordered. Each step is shippable on its own.

**Step 1 — logging foundation (do this before any dashboard work)**
- [ ] `EventEnvelope` + the 12 event types from §3.2
- [ ] `EventLogger`: single write path, batched, offline-queued, honours Private Mode
- [ ] `card_tap` carries `row`, `col`, `gridRows`, `gridCols`, `navDepth`
- [ ] `sceneTag` + `actor` on every event
- [ ] `events` table + indices  →  DONE, see `db/schema.sql` + `db/indices.sql`
- [ ] Private Mode toggle, child-reachable, in the app shell

**Step 2 — local derivations**
- [ ] `utterances` materialisation on each `speak` / `abandon`
- [ ] The 22 metric functions from §5, keyed by slug
- [ ] Nightly `daily_metrics` rollup
- [ ] Unit tests: one fixture per metric with a hand-computed expected value

**Step 3 — sync + cloud**
- [ ] Batched upload of unsynced events, resumable, idempotent on `event_id`
- [ ] Postgres schema + RLS + roster/consent tables
- [ ] Cloud rollup job

**Step 4 — dashboard**
- [ ] `/class` with the Attention Queue (§9) — build this first, it is the daily-use surface
- [ ] `/student/:id` overview
- [ ] `/student/:id/ai-impact` — the demo surface
- [ ] `/student/:id/access` — heat map pair
- [ ] `/student/:id/vocabulary`

**Step 5 — insights**
- [ ] I1, I3, I4 first — highest confidence, clearest actions
- [ ] I5, I6, I2 next
- [ ] I7 last (depends on Modeling Mode shipping)
- [ ] Every insight card: evidence shown, one-tap dismiss, dismissal logged

**Step 6 — privacy**
- [ ] Consent tiers enforced at the query layer, not the UI layer
- [ ] `utterance_text` split table + separate retention job
- [ ] Parent export and delete

### Demo-data acceptance criterion

Seeded demo data must cause **every one of the 7 insights to fire at least once**, and the Attention Queue must rank at least three children with different reasons. If an insight cannot be made to fire with plausible data, its rule is wrong.

---

## 14. Open decisions

Everything above is decided. These are not.

| # | Question | Options | Blocking |
|---|---|---|---|
| 1 | ~~How do events reach the dashboard?~~ | **RESOLVED** — web-only: browser → Node API → server SQLite. No sync layer. | — |
| 2 | ~~Dashboard stack~~ | **RESOLVED** in `TECH_STACK.md` — Next.js + Recharts, same app as the board. | — |
| 3 | How is `sceneTag` actually set in a classroom? | timetable import · teacher toggle · inferred from active mode | Step 1 — needs an answer before logging starts |
| 4 | `MISTAP_MS` default per profile | one global 1500 · per-child after baseline · per-diagnosis preset | Step 2 |
| 5 | Does the child-facing "my week" view ship at all? | yes · post-hackathon | Step 4 |

**#3 is the urgent one.** `sceneTag` is unbackfillable and step 1 cannot start without deciding how it gets populated. If no answer is available, log `unknown` and set it from the active communication mode as a fallback — but decide deliberately rather than by default.
