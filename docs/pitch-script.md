# Reading the Board — 5-minute speaker script

Deck: `docs/pitch.html` (open in a browser · ← → to navigate · **N** toggles these notes
on-screen). Ten slides, ~30 seconds each. Lines are written to be **said**, not read —
contractions and short sentences on purpose. Timings assume a brisk but unhurried pace.

---

## 1 · Title — 0:00–0:25

> This is live — three public URLs, running right now.
> A communication board for nonspeaking children. An analytics dashboard for their
> teachers and speech therapists. And an AI layer whose clinical guardrails live in the
> code, not the prompt.
> Five minutes, four ideas.

*(Gesture at the URLs. Don't read them out.)*

## 2 · The problem — 0:25–1:00

> These children talk by pressing symbols — every press is a word. And every press is
> data that today just evaporates. Teachers guess; a therapist sees forty minutes a week.
>
> But here's the trap: naive analytics on this data gives actively harmful advice.
> "Move her favourite button closer" sounds helpful — it destroys months of muscle
> memory. It's rearranging a blind person's furniture.
>
> So the product question isn't "what can we show?" It's "what must we refuse to say?"

## 3 · The child's side — 1:00–1:30

> This is a full AAC system, not a demo grid. Seventy-six AI-generated symbols in the
> standard colour code. A sentence bar that speaks with real grammar — "I want water."
> Picture sign-in. An alphabet keyboard for spellers — that's a clinical requirement,
> not a nice-to-have. And it's an offline PWA, because a wifi outage must never take
> away a child's voice.
>
> Every tap logs an event with its exact grid position. That's the raw material.

## 4 · Safety as code — 1:30–2:10

*(This is the differentiator — slow down here.)*

> Here's what makes this project unusual. We read the AAC clinical literature and turned
> it into eight binding constraints that live in the schema and the query layer — not in
> a system prompt.
>
> The database **rejects** a "move this button" proposal — the AI cannot even propose it.
> Repetition is typed *neutral* in the metrics catalogue, so no screen can ever paint
> stimming as a problem. And a refusal finding renders **no action button** — because a
> child's "no" has to count.

## 5 · The adult's side — 2:10–2:40

> The teacher's side opens with a queue, not charts: who needs a human today, and why.
> Jonah's on top — he hasn't spoken in five days.
>
> The findings come from plain SQL rules — deliberately not a model — so a therapist can
> trace every claim to a number. Every figure carries its sample size. And what isn't
> measured says "not recorded" — never a fabricated zero.

## 6 · Findings — 2:40–3:10

> Each finding argues its case: the exact numbers, the thresholds they crossed, and — in
> red — what practice forbids doing about it.
>
> The human always decides. "Does that match what you see?" — and a "no" with a reason
> feeds back into the rules.
>
> And the whole report exports as a real PDF, caveats included, for the IEP meeting.

## 7 · The AI layer — 3:10–3:50

> The Ask panel is a real agent. This table took eleven tool calls — five children
> queried in parallel.
>
> But three things make it safe. Scope is injected server-side — the model never picks
> whose data it reads. A guard checks every answer against the forbidden list and
> rewrites violations. And it's multi-provider: Gemini 3 by default, GPT or Claude with
> a key in Settings. Swap the brain — the guardrails stay.

## 8 · Architecture — 3:50–4:20

> Architecture in one breath: one Next.js app serves both surfaces, split by hostname.
> SQLite in WAL mode — proven under a hundred thousand concurrent reads and writes.
> The MCP server is the single seam between the data and any model — twenty read-only
> tools, zero npm dependencies. And a Python pipeline rebuilds everything
> deterministically, behind a forty-two-check clinical safety gate.

## 9 · Verified — 4:20–4:45

> And we tested it like it matters. A hundred and ninety-four feature checks with exact
> expected outputs. Every metric recomputed independently from raw events on a half-year
> cohort — the dashboard, the chatbot, and the SQL agree to the digit: one-thirty-five
> out of one-thirty-five. Our own verification passes caught twenty-three bugs —
> including one that had been invisible since the first commit.

## 10 · Close — 4:45–5:00

> Every finding in this system points at something an **adult** can change — wait longer,
> model more, add a copy. The board stays exactly where the child learned it.
>
> That's the whole idea: data that helps the adults change, so the child doesn't have to.
>
> It's live — try it. Thank you.

---

## Q&A ammunition (don't present; keep loaded)

- **"Why not let the AI write the rules?"** — A therapist has to trace a finding to a
  number. Rules are SQL views; the AI narrates and answers questions, it never decides
  what fires.
- **"What about privacy?"** — Role and consent scoping live in the query layer; the chat
  model physically can't name a child outside its roster (enum-constrained tool schemas).
  Utterance text lives in a separate file the MCP process user cannot read.
- **"Does it scale?"** — One school = one box today, by design (WAL needs one
  filesystem). The seam is MCP — the analytics move behind it without touching clients.
- **"Whose clinical guidance?"** — AssistiveWare's published practice guidance, cited
  per constraint (C1–C8 in `docs/aac-clinical-constraints.md`). Read, not yet reviewed
  by a clinician — that's stated honestly in the repo.
- **"What did AI build?"** — The 76 symbols (Gemini image gen), the icons pipeline, the
  narration, and most of the code — under a 42-check clinical gate and a 33-case API
  suite that ran on every change.
