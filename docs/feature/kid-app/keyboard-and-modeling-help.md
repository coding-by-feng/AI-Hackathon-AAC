# Keyboard & Modeling Help

> **Status: being built in parallel this wave (team-plan W5) — this doc is written from the plan, not from source. Verify every claim against the shipped code after integration, then remove this banner.**

## Function
Adds two patterns lifted from the TouchChat and Proloquo2Go manuals (the PDFs in `docs/`): an on-board **keyboard** so a child with alphabet access can spell words the grid does not have, and a **modeling help** surface that teaches adults how to model language on the board without their presses polluting the child's data.

## Purpose
Two documented gaps drive this:

- **Clinical gap C8** (`docs/aac-clinical-constraints.md` §C8 — "A robust system needs alphabet access / we have no keyboard at all"). Every robust AAC system pairs symbols with spelling; a symbol-only board caps a literate child at whatever an adult predicted they would want to say.
- **Metric H2** (`keyboard_use` in `docs/analytics-metrics.md`) has never had a source: no client emits typing events, so the metric renders "not recorded". The keyboard is what lights it — honestly, from real events, per the standing rule that a metric with no source never renders `0`.

Modeling help exists because aided language stimulation only works if adults actually do it, and the existing Modeling Mode (see [Communication Board](communication-board.md)) already separates adult presses from child data — what is missing is the guidance layer telling an adult *what* to model.

## Source Files
| File | Role |
|------|------|
| `components/kid/keyboard-layer.tsx` | The QWERTY spelling overlay: one-word buffer, Done/space commit, Escape closes (it claims `aria-modal`, so the modal keyboard contract applies), its own `EssentialRail` copy so help/stop/yes/no stay one tap away while spelling. |
| `components/kid/modeling-help.tsx` | The "What is modelling?" dialog — `role="dialog"` + `aria-modal`, Escape closes, initial focus on the Got-it button. |
| `components/kid/essential-rail.tsx` | The always-available words; the keyboard layer mounts a second copy inside itself. |
| `components/kid/board-app.tsx` | Wiring: the `ABC` chip (passed to `CategoryBar` as `leading`), `keyboardOpen`/`helpOpen` state, `addTypedWord()` emitting `keyboard_input` and appending the `typed:<w>` synthetic card. |
| `lib/ingest.ts` | `keyboard_input` in `TYPES` and `keyboard` in `SOURCES` — the ingest seam pre-dated the UI. |

## Design (from the plan and the manuals)
- **Keyboard**: an on-screen alphabet surface reachable from the board without leaving it; typed text joins the sentence bar exactly like a card selection, is spoken by the same speech path, and is logged with `source: 'keyboard'` / `keyboard_input` events so H2 (`keyboard_use`) counts words typed rather than selected.
- **Message-window patterns** (TouchChat/Proloquo2Go): the sentence bar behaves like those systems' message window — tap to re-speak, per-item delete, clear — so a child transferring from a commercial system finds the same contract.
- **Modeling help**: a help popover for adults inside Modeling Mode; adult demonstrations stay excluded from the child's metrics (the existing 90 s auto-exit and attribution rules are unchanged — this feature adds guidance, not new attribution semantics).
- **Clinical constraints are inherited, not renegotiated**: the keyboard is additive UI; no existing card moves or resizes to make room in a way that breaks a learned motor plan, and logging failures never block speech.

## Dependencies & Connections
- [Communication Board](communication-board.md) — hosts the keyboard and Modeling Mode.
- [Utterance Assembly & Speech Output](utterance-and-speech.md) — typed words must flow through `buildUtterance`/`speak` like any card.
- [Event Logging & Private Mode](event-logging.md) and [Event Ingest](../api/event-ingest.md) — `keyboard_input` events, `keyboard` source.
- Metric H2 `keyboard_use` in `docs/analytics-metrics.md` — the analytics consumer.

## Change Risks
- **Logging typed free text**: only sanitized concepts leave the machine; whether raw spelled strings are stored is consent-tier territory — verify what the shipped code actually logs before describing it here.
- **Emitting `keyboard_input` without the fields ingest requires** silently drops the H2 source.
- **Rearranging the board to fit the keyboard** would violate C4 (cards never move); the keyboard must overlay or dock, never reflow the grid.

> **2026-08-08:** The keyboard layer honours Escape (it claims `aria-modal`, so the
> modal keyboard contract applies — same fix the modelling-help dialog got earlier).
