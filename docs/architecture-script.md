# Architecture walkthrough — 60-second script

Open https://aac-slides.kason.app · press **▶ Play story** (or click each chip as you speak).

**[Open — chip ✳️ everything]**
"This is our whole system on one board. Left: the people. Middle: the server and data. Right: the AI. Watch the dots — they are real data paths."

**[🍎 a tap — Flow 1]**
"It starts with a child. Mia taps *apple*. The board logs the tap — row, column, depth — queues it offline in IndexedDB, and ships it to the events API, where anything malformed is rejected loudly."

**[⚙️ the rules — Flow 2]**
"In the analytics database, a deterministic pipeline rolls events up and runs plain-SQL rules. No black box — a therapist can trace every finding to a number, and a 42-check safety gate signs off."

**[📈 the insight — Flow 3]**
"Insights reach the teacher's dashboard only after a baseline — 14 active days, 40 utterances — and every query is role- and consent-scoped."

**[💬 the question — Flow 4]**
"The teacher asks *why*. Our agent picks a cloud model, pulls real numbers through read-only MCP tools, and streams back a grounded answer. A guard blocks any clinically unsafe advice — like moving a learned button."

**[💻 tomorrow — Flow 5]**
"Next: Gemma 3 4B running locally on its own device, dialing outbound into the same MCP door — private, offline analysis, same safety rules."

**[Close — chip ✳️ everything]**
"One loop: the child speaks, the data flows, the adults understand — and every arrow into the database is read-only or whitelisted."

---

## 30-second version

"A child taps a symbol; every tap becomes validated data. A deterministic SQL pipeline — not a model — turns taps into findings a therapist can audit. Insights unlock only after a real baseline and reach only the adults allowed to see them. When a teacher asks *why*, an AI agent answers using read-only tools over real numbers, with a guard blocking clinically unsafe advice. And soon, a local Gemma model joins through the same door. The child speaks, the data flows, the adults understand."
