# Architecture walkthrough — presentation script

Open **https://aac-slides.kason.app** · press **▶ Play story**, or click each chip yourself as
you reach its beat. Cues in brackets tell you what to click and what to point at.

---

## Main script (~3 minutes)

**[Open — chip ✳️ everything · sweep your hand across the whole stage]**

"This is our entire system on one board — and we drew it the way our users see the world:
every component is a symbol card, and the moving dots are real data paths. Three zones.
On the left, the people: a child on the communication board, and the adults on the dashboard.
In the middle, one app server and the data core. On the right, the AI — kept deliberately
behind a wall we'll come back to."

**[🍎 a tap — Flow 1 · point at the pulsing ring on the apple card]**

"Everything starts with a child. Mia taps *apple*, then *more*, then presses speak — and the
tablet talks for her. But every tap is also evidence. The board logs exactly where it happened —
row, column, grid size, how deep in the category tree — because you cannot reconstruct that
later. If the tablet is offline, an IndexedDB queue holds every word until it can ship. And at
the events API, ingest is strict: a tap that arrives without its grid position isn't quietly
accepted — it's rejected, loudly. Bad data never enters the system."

**[⚙️ the rules — Flow 2 · point at the spinning gear]**

"Now the pipeline thinks — and here's our first big design decision: the rules are plain SQL,
not a model. Events roll up into daily metrics, rule views fire findings, and a 42-check
clinical-safety gate signs off on every build. Why not a model? Because a speech therapist has
to be able to trace every finding back to a number. Deterministic, auditable, explainable —
that's the bar for anything that touches a child's therapy."

**[📈 the insight — Flow 3 · point at the attention queue lighting up]**

"Insight reaches the adults — but only when it's earned. Nothing is flagged until a child has
fourteen active days and forty of their own utterances; we gate on real activity, not the
calendar, so no child is judged on a week of noise. And access is filtered in the query layer
itself — teacher, therapist, parent each see exactly what consent allows. A page can forget a
check; a query that cannot return unauthorised rows is a guarantee."

**[💬 the question — Flow 4 · trace the purple path with your finger]**

"Then the teacher asks *why*. The ask panel sends the question to our agent, which picks a
model — Vertex Gemini by default, OpenAI or Anthropic if you switch it in settings, keys never
leave the server. But here's the important part: the model doesn't get the database. It gets
fourteen read-only MCP tools — that wall on the right. Query-only, no attach, and the children's
actual utterance text isn't even readable by that process — that's a filesystem fact, not a
setting. The answer streams back grounded in real numbers, and a guard blocks clinically unsafe
advice — it will never suggest moving or resizing a learned button, because that destroys a
child's motor plan."

**[💻 tomorrow — Flow 5 · point at the dashed box]**

"And the same wall is our roadmap. Because the MCP server is one sealed door, tomorrow a local
Gemma 3 4B on its own device can dial *outbound* into it — no inbound ports, no cloud, fully
private analysis on any network. Same tools, same read-only rules, and it can only write an
insight that cites the fired rule that justifies it. No rule, no prose."

**[Close — chip ✳️ everything · pause a beat]**

"So that's the loop: the child speaks, the data flows, the adults understand — and every single
arrow into that database is read-only or whitelisted. The architecture isn't just how it works;
it's how we keep a nonspeaking child safe while making their progress visible."

---

## 60-second version

**[✳️ everything]** "Our whole system on one board — the dots are real data paths."

**[🍎]** "A child taps *apple*. The board logs row, column and depth, queues it offline in
IndexedDB, and ships it to the events API — where malformed taps are rejected loudly."

**[⚙️]** "A deterministic pipeline — plain SQL, not a model — turns taps into findings a
therapist can trace to a number. A 42-check safety gate signs off."

**[📈]** "Insights unlock only after 14 active days and 40 utterances, and every query is role-
and consent-scoped before the attention queue lights up."

**[💬]** "The teacher asks *why*. Our agent picks a cloud model, pulls real numbers through
read-only MCP tools, and a guard blocks clinically unsafe advice — like moving a learned button."

**[💻]** "Next: local Gemma 3 4B dialing outbound into the same MCP door — private, offline,
same safety rules."

**[✳️]** "One loop: the child speaks, the data flows, the adults understand."

---

## 30-second version

"A child taps a symbol; every tap becomes validated data. A deterministic SQL pipeline — not a
model — turns taps into findings a therapist can audit. Insights unlock only after a real
baseline and reach only the adults allowed to see them. When a teacher asks *why*, an AI agent
answers using read-only tools over real numbers, with a guard blocking clinically unsafe advice.
And soon, a local Gemma model joins through the same door. The child speaks, the data flows,
the adults understand."

---

## Q&A pocket answers (if judges dig in)

- **"Why not let the LLM query the database directly?"** — One sealed seam. The MCP tool surface
  is query-only with a deny-ATTACH authorizer, and utterance text lives in a file that process
  cannot read. Any model — cloud or local — gets the same fourteen tools and nothing else.
- **"What stops the AI giving bad therapy advice?"** — A guard layer plus the data model itself:
  forbidden actions are stored per insight and *displayed*, informational insights render no
  action button, and neutral metrics can never be shown as good or bad.
- **"Why SQL rules instead of ML?"** — Explainability is a clinical requirement, not a
  preference. A therapist must trace a finding to a number; a 42-check verification gate runs on
  every build and fails it loudly.
- **"How does it scale?"** — One writer, many readers in WAL mode, proven with a concurrency
  harness; the analysis workload connects outbound, so the origin needs no inbound ports at all.
