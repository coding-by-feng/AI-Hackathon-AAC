# Dashboard v1 — Design Spec

**Status:** historical — this spec was built, then evolved past. Kept for the rationale;
do **not** treat routes or scope here as current. What shipped: routes live under
`/dashboard` (not `/class` — the class view is `/dashboard`, students at
`/dashboard/student/[id]`), the "LATER" sessions page shipped as `/dashboard/sessions`,
reports shipped at `/dashboard/reports`, and a streaming Ask panel was added. Current
truth: [`feature/README.md`](./feature/README.md) (dashboard domain) and
[`dashboard-design.md`](./dashboard-design.md); a dark report-layout redesign is in
flight ([`feature/dashboard/dashboard-redesign.md`](./feature/dashboard/dashboard-redesign.md)).

**Original header — Status:** design, awaiting approval
**Source of truth for metrics:** [`analytics-metrics.md`](./analytics-metrics.md) — every widget here references a slug from §5 of that document
**Stack:** [`TECH_STACK.md`](./TECH_STACK.md) — Next.js + SQLite + MCP. This supersedes §14 open decisions 1 and 2 in the metrics spec (not Supabase, not Flutter Web).
**Scope:** Step 4 of the §13 implementation checklist

---

## 1. Scope

Four pages. Twelve of the twenty-two shown metrics. All six story metrics present.

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  DASHBOARD v1 - SCOPE                                                                              │
│                                                                                                    │
│   /class                        SHIP   the daily-use surface. build first.                         │
│     +- Attention Queue          SHIP   ranked by the §9 score, scoring shown on demand             │
│     +- roster table             SHIP   C1 · A1 · E1 · C3 + flags                                   │
│                                                                                                    │
│   /student/:id                  SHIP   overview                                                    │
│     +- KPI tiles                SHIP   A1 · C1 · E1 · F1   (4 only)                                │
│     +- caption line             SHIP   words_per_minute as TEXT, never a tile                      │
│     +- charts                   SHIP   C2 top cards · C3 new words · B3 abandonment trend          │
│     +- action queue             SHIP   F3 gaps + fired insight cards                               │
│                                                                                                    │
│   /student/:id/ai-impact        SHIP   F1 · F2 · F3 · F4     <- the demo surface                   │
│   /student/:id/access           SHIP   B4 heat pair · B1 · B2 · A2 · A3                            │
│                                                                                                    │
│   /student/:id/vocabulary       LATER  C5 C6 C7 are P1; nothing in v1 depends on them              │
│   /student/:id/sessions         LATER  needs consent tier 3 UI + its own retention clock           │
│   /settings/consent             LATER  v1 reads consent, does not edit it                          │
│   child "my week" view          LATER  §14 open decision 5 -> post-hackathon                       │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Build order:** `/class` → `/student/:id` → `/ai-impact` → `/access`.
The class page is the daily-use surface and everything else hangs off it.

---

## 2. `/class`

Where a teacher or SLT lands. The Attention Queue answers one question — *who needs a human today* — and the roster is the fallback for everything else.

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  CLASS  ·  Year 3  ·  Mrs Patel          [ Today v ]      analysis ran 04:12 today  OK             │
├────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  ATTENTION QUEUE                                                    why this order? [ scoring ]    │
│                                                                                                    │
│  +--------------------------------------------------------------------------------------+          │
│  | 1   Jonah K.                                                     score 5     [ Open ] |         │
│  |     silence_streak 3 days                                          +3                 |         │
│  |     4 vocabulary_gaps unreviewed                                   +1                 |         │
│  |     I4 fired, not dismissed                                        +1                 |         │
│  +--------------------------------------------------------------------------------------+          │
│  | 2   Liam W.                                                      score 4     [ Open ] |         │
│  |     abandonment_rate 31%                                           +2                 |         │
│  |     mistap_rate 14%                                                +2                 |         │
│  +--------------------------------------------------------------------------------------+          │
│  | 3   Maya T.                                                      score 2     [ Open ] |         │
│  |     mistap_rate 13%                                                +2                 |         │
│  +--------------------------------------------------------------------------------------+          │
│                                                                                                    │
│   Amara O. and Sofia R. scored 0 - nothing needs you today.                                        │
├────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  ROSTER                                                                                            │
│                                                                                                    │
│  child        C1 silence   A1 taps/utt   E1 indep   C3 new   flags                                 │
│  -----------  ----------   -----------   --------   ------   -------------------------------       │
│  Jonah K.        3 d          5.8          22%        0      I4 · 4 gaps                           │
│  Liam W.         0 d          3.0          55%        2      abandonment · mis-taps                │
│  Maya T.         0 d          2.3          71%        6      I1 motor                              │
│  Amara O.        0 d          1.9          84%        4      -                                     │
│  Sofia R.        1 d          4.4          41%        1      baseline (day 6 of 14)                │
│                                                                                                    │
│  [ Export SLT report ]     [ Add vocabulary to class ]                                             │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Design rules**

- **The queue must be able to be empty.** "Nothing needs you today" is a valid, good screen. A queue that always has five rows trains people to ignore it.
- **Score breakdown is visible, not hidden.** A teacher who can't see why Jonah ranks first won't trust the order. The §9 formula is simple enough to just show.
- Children inside their baseline window appear in the roster but can never enter the queue.

---

## 3. `/student/:id` — overview

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  Maya T.  ·  Year 3        [ Overview ] [ Access ] [ AI impact ]        [ This week v ]            │
├────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  +--------------------+ +--------------------+ +--------------------+ +--------------------+       │
│  | A1 TAPS / SENTENCE | | C1 SILENCE STREAK  | | E1 INDEPENDENCE    | | F1 AI ACCEPTANCE   |       │
│  |                    | |                    | |                    | |                    |       │
│  |       2.3          | |       0 days       | |       71%          | |       38%          |       │
│  |   -0.9 vs last wk  | |   spoke today      | |   -4 pts vs last   | |   of 121 shown     |       │
│  |   n=47             | |                    | |   n=47             | |                    |       │
│  +--------------------+ +--------------------+ +--------------------+ +--------------------+       │
│                                                                                                    │
│  8.2 words per minute this week (typical for AAC is 2-15; compare only to her own history).        │
├────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  NEEDS YOUR ATTENTION                                                          2 items             │
│                                                                                                    │
│  [ insight card ]                                                                                  │
│  [ vocabulary gaps: 3 concepts she reached for that did not exist ]  [ Review ]                    │
├────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  C2 TOP CARDS this week            C3 NEW WORDS              B3 ABANDONMENT trend                  │
│                                                                                                    │
│  more      #################  31   swimming    5 d ago       25% |                                 │
│  I want    ##############     26   milkshake   3 d ago           |    ###                          │
│  toilet    #########          17   Mrs Patel   2 d ago       10% |###    ###                       │
│  finished  ########           15   pool        1 d ago           |          ######                 │
│  Coke Zero ######             11   goggles     1 d ago        0% +---+---+---+---+---              │
│  swimming  ####                8   towel       today             M  T  W  T  F                     │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Design rules**

- **Every tile carries `n`.** 38% acceptance from 121 impressions and from 8 are different claims. A tile without its sample size lies by omission.
- **`words_per_minute` is caption text, never a tile** (metrics spec §6). A tile invites comparison against typing speed, which is meaningless and demoralising.
- Four tiles maximum. A fifth dilutes all of them.

---

## 4. Insight card — one component, seven rules

The most reused component in the product, and the one carrying its ethical framing. Every one of the seven §8 insights renders through this shape.

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  +----------------------------------------------------------------------------------------+        │
│  |  THIS LOOKS LIKE A REACH PROBLEM                              I1 · confidence 0.78     |        │
│  |                                                                                        |        │
│  |  Maya's mis-taps cluster in the bottom-right of the Cafe board, and 78% of her          |       │
│  |  corrections land on a neighbouring cell. That pattern usually means the finger         |       │
│  |  missed, not that the word was wrong.                                                   |       │
│  |                                                                                        |        │
│  |  EVIDENCE                                                    [ see the data ]          |        │
│  |    mistap_rate            13%    over 7 sessions   (trigger > 8%)                      |        │
│  |    correction_adjacent    78%    of 31 mis-taps                                        |        │
│  |    time_to_first_tap      2.6 s  normal for her                                        |        │
│  |    fired_rule_id          fr_8813   ·   analysed 04:12 today                           |        │
│  |                                                                                        |        │
│  |  DOES THAT MATCH WHAT YOU SEE?                                                         |        │
│  |  [ Yes - show me options ]   [ No, that's not it v ]   [ Not now ]                     |        │
│  +----------------------------------------------------------------------------------------+        │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Anatomy

| # | Element | Rule |
|---|---|---|
| 1 | Hypothesis headline | Plain language. Never a diagnosis, never a label for the child. |
| 2 | Rule id + confidence | Traceable to §8, honest about certainty. |
| 3 | Plain-language why | One sentence a parent could read. |
| 4 | Evidence block | Every signal that fired, its value, and the threshold it crossed. |
| 5 | `fired_rule_id` + timestamp | Provenance from the local Gemma run. No prose reaches a teacher without SQL behind it. |
| 6 | Question, not verdict | "Does that match what you see?" |
| 7 | Three responses | Yes → actions · No → reason, logged · Not now → resurfaces later |

### The dismiss reason is the only feedback loop

```
[ No, that's not it v ]  ->  wrong pattern
                             already knew
                             not important right now
                             I disagree with the recommendation
                             other
```

Written to `insight_events.dismiss_reason`. After a term, rules nobody ever accepts can be retired. Without this, there is no way to know which of the seven produce noise.

### Per-rule copy and behaviour

| Rule | Headline | Behaviour |
|---|---|---|
| I1 | "This looks like a reach problem" | Default to MOTOR when the split is ambiguous (§8 safety note) |
| I2 | "She knows the word but can't find it" | Only fires when the tap was **correct** and no delete followed |
| I3 | "'more' is 4 screens deep" | `[ Promote to home grid ]` — one click, records who approved |
| I4a | "'helicopter' hasn't been used in 30 days" | `[ Replace card ]` |
| I4b | "She doesn't want the cookie" | **Informational only. No action button at all.** |
| I5 | "'want' and 'candy' are never combined" | Names the specific pair, never "longer sentences" |
| I6 | "'thank you' stops at the classroom door" | Marked reduced-confidence (§7) |
| I7 | "Social words aren't being modelled" | Teacher sees it first — never surfaced parent-first |

I4b's lack of an action button is a **component-level requirement**, not copy. If the card shell always renders a primary action, that case will grow one, and the product will end up drilling a child to request something they refused.

---

## 5. `/student/:id/ai-impact` — the demo surface

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  F2  TAPS SAVED                                                                                    │
│                                                                                                    │
│     without a suggestion   |##########  4.1 taps per sentence   n=73                               │
│     with a suggestion      |###         1.4 taps per sentence   n=44                               │
│                                                                                                    │
│     2.7 taps saved  x  44 sentences  =  119 taps she did not have to make this week                │
├────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  F1  SUGGESTION FUNNEL                    F4  WHERE VISUALS CAME FROM                              │
│                                                                                                    │
│   shown       121 |####################|   icon_pack    |################  61%   free              │
│   tapped       46 |########            |   card_library |######            22%   free              │
│   spoken       44 |#######             |   hash_cache   |###               11%   free              │
│                                           semantic      |#                  4%   free              │
│   acceptance 38%                          generated     |#                  2%   $0.08             │
│   above the 20% clutter line                                                                       │
│                                           94% free  ·  target >= 90%   OK                          │
├────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  F3  VOCABULARY GAPS  -  words she reached for that did not exist         3 unreviewed             │
│                                                                                                    │
│   "science experiment"   asked 2x   classroom    Tue, Thu      [ Add card ]  [ Not needed ]        │
│   "my new shoes"         asked 1x   free_play    Wed           [ Add card ]  [ Not needed ]        │
│   "Mrs Patel"            asked 3x   classroom    Mon,Tue,Thu   [ Add card ]  [ Not needed ]        │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

One screen, one argument. The taps-saved sentence is what a judge reads if they read nothing else. The gap list is the most operationally useful thing on the entire dashboard — it *is* the teacher's to-do list.

---

## 6. `/student/:id/access`

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  B4  USAGE HEAT             B4  MIS-TAP HEAT              READ THEM TOGETHER                       │
│                                                                                                    │
│      c1  c2  c3  c4             c1  c2  c3  c4            Row 4 has almost no successful           │
│    +---+---+---+---+          +---+---+---+---+           taps AND the highest mis-tap             │
│  r1| ##|###| # | . |        r1| . | . | . | . |           density.                                 │
│    +---+---+---+---+          +---+---+---+---+                                                    │
│  r2|###| ##| ##| . |        r2| . | . | . | # |           She is REACHING for row 4 and            │
│    +---+---+---+---+          +---+---+---+---+           missing. That is not a                   │
│  r3| # | ##| . | . |        r3| # | . | # | ##|           vocabulary problem.                      │
│    +---+---+---+---+          +---+---+---+---+                                                    │
│  r4| . | . | . | . |        r4| ##| ##|###|###|           [ Move row 4 cards up ]                  │
│    +---+---+---+---+          +---+---+---+---+           [ Drop to 3x3 grid ]                     │
│     DEAD ZONE                  ERRORS CLUSTER                                                      │
├────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  B1 mis-tap rate        13%    trigger > 8%      B2 correction adjacency   78%   -> MOTOR          │
│  A2 composition time    6.9 s                    A3 time to first tap      2.6 s  normal           │
│                                                                                                    │
│  MISTAP_MS is currently 1500 ms for Maya.        [ adjust for slower correction cycles ]           │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Always render the two maps as a pair.** A cold cell ringed by errors is a hard-to-reach target, not an unknown word — and neither map alone shows that.

Buckets are keyed by `(modeId, gridRows, gridCols)`; grids of different sizes never merge.
`MISTAP_MS` is per-child and adjustable — 2500 ms is often truer for athetoid CP (metrics spec §5 B1).

---

## 7. Three states v1 dashboards get wrong

### 7.1 New child, still in baseline

```
+--------------------------------------------------------------------------------+
|  Sofia R.  ·  day 6 of 14                                                       |
|                                                                                 |
|  Learning what normal looks like for Sofia.                                     |
|  Numbers are shown, but nothing will be flagged until day 14 - thresholds        |
|  tuned to another child would be worse than no thresholds.                      |
|                                                                                 |
|  A1  4.4 taps    C1  1 day    E1  41%    n=19                                   |
|  [========------] baseline 43% complete                                          |
+--------------------------------------------------------------------------------+
```

Show real numbers. Suppress every threshold, flag, insight and queue entry.
`isInBaseline` is cross-cutting — tiles, flags, queue, and insight generation all read it. Cheap as one guard now; expensive later as four separate patches.

### 7.2 Analysis is stale

```
header pill, always present:   analysis ran 04:12 today          OK
                               analysis last ran 2 days ago      STALE  [ why? ]
```

With batch analysis on a separate Gemma device, stale is a **normal condition, not an error**. Charts still render from `daily_metrics`; only insight cards grey out with "waiting on analysis since Tue". Never show two-day-old insights as though they were current.

### 7.3 Consent-gated panel

```
+--------------------------------------------------------------------------------+
|  [lock]  Utterance history                                                      |
|                                                                                 |
|  What Maya actually said is available to her parent and SLT, and only with      |
|  signed consent. You have teacher access.                                       |
|                                                                                 |
|  You can see: how often, how fast, which cards.                                 |
|  You cannot see: the sentences themselves.                                      |
+--------------------------------------------------------------------------------+
```

**Show the lock, don't hide the panel.** A hidden panel makes people request access they don't need; a visible lock explains the boundary and usually ends the conversation.

---

## 8. Components

| Component | Responsibility |
|---|---|
| `insight-card` | All seven rules. Evidence, provenance, three responses, optional action. |
| `kpi-tile` | Value + delta + **n**. Baseline-aware — suppresses delta and flags during baseline. |
| `heat-grid` | Cell heat, keyed by `(modeId, gridRows, gridCols)`. Always rendered in pairs. |
| `attention-row` | Queue entry with its score breakdown expanded inline. |
| `consent-lock` | Locked-panel state with an explanation of what is and isn't visible. |
| `analysis-freshness` | Header pill. Present on every page, never only on error. |
| `gap-row` | One vocabulary gap + `[ Add card ]` / `[ Not needed ]`. |

---

## 9. Files

```
app/dashboard/class/page.tsx                    Attention Queue + roster (RSC)
app/dashboard/student/[id]/page.tsx             overview
app/dashboard/student/[id]/access/page.tsx      heat pair + B1 B2 A2 A3
app/dashboard/student/[id]/ai-impact/page.tsx   F1 F2 F3 F4

components/insight-card.tsx
components/kpi-tile.tsx
components/heat-grid.tsx
components/attention-row.tsx
components/consent-lock.tsx
components/analysis-freshness.tsx
components/gap-row.tsx

lib/metrics/*.ts        12 readers, keyed by the §5 slug
lib/insights/copy.ts    per-rule headline + explanation strings
lib/baseline.ts         isInBaseline(childId) - read by tiles, queue, flags, insights
```

---

## 10. Open items

| # | Question | Blocking |
|---|---|---|
| 1 | Does the roster show all children, or only those the adult has an active `roster` row for? | `/class` query |
| 2 | Baseline window — 14 days fixed, or *n* utterances? A child who barely uses the app never leaves a day-based baseline. | `lib/baseline.ts` |
| 3 | Does `[ Promote to home grid ]` (I3) write directly, or queue a change for the child's next sync? | `/student/:id` actions |
| 4 | Who can adjust `MISTAP_MS` — SLT only, or teacher too? | `/access` |

Everything else in this document is decided.
