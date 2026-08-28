# AAC Analytics

An AAC (augmentative and alternative communication) system for nonspeaking children with
cerebral palsy: a symbol communication board the child uses to speak, and an analytics
dashboard for the teachers and speech-language therapists supporting them.

Built at the **Aotearoa AI Hackathon**, hosted by Manukau Institute of Technology and Unitec.

| | |
|---|---|
| 🖥 **How it works** | [aac-slides.kason.app](https://aac-slides.kason.app) — architecture walkthrough, press ▶ Play story |
| 📱 **Try the board** | [aac.kason.app](https://aac.kason.app) — the child-facing surface, no login |
| 📊 **Dashboard** | [aac-dashboard.kason.app](https://aac-dashboard.kason.app) — adult login required |

All demo data is synthetic: five generated personas, 44 days, ~27,700 events. No real
child's data exists in this repository or on those hosts.

---

## The part that mattered

The hard problem here was not the model. It was noticing that several metrics we had
specified — reasonable-looking, the kind any analytics dashboard would ship — would have
produced advice that actively harms the children being measured.

**Repeated taps are not errors.** The obvious reading of a child pressing the same button
eleven times is a mistap rate to drive down. But AssistiveWare's guidance is blunt about
this: repetition is how motor automaticity is built, it is how gestalt processors learn,
and for many children it is stimming — self-regulation to be supported, not corrected.
*"Trying to reduce or stop repetitive tapping leads to less overall communication."* So
`mistap_rate` now requires an actual delete before anything counts as an error, and
`repeat_tap_rate` was added with catalogue polarity `neutral`, which the rendering layer
is structurally unable to style as good or bad.

**Never move a learned button.** The obvious fix for an error-prone or unused cell is to
move it, shrink the grid, or promote it to the home screen. Every one of those relocates
buttons a child may have spent months building a motor plan around. The UI offers *mask*
and *add a copy*. It cannot offer *move* or *resize* — those strings live in the
`forbidden_actions` column and are **displayed to the adult**, not merely obeyed in code.

**A refusal is not a problem to fix.** When an insight's `action_kind` is
`informational` — case B of I4 is a child declining something — the card renders no
action button at all. Offering an intervention there teaches a child that their "no" does
not count.

**Say nothing until you know enough.** Nothing is flagged until a child has 14 active days
and 40 utterances of their own. Gated on their actual activity, not the calendar.

These became eight binding constraints, C1–C8, recorded in
[`docs/aac-clinical-constraints.md`](docs/aac-clinical-constraints.md) with the source for
each. They are enforced in the database schema and in code rather than in a style guide,
and `npm run verify` runs 42 checks that fail the build if any of them regress.

> **Honest caveat:** C1–C8 are read from
> [AssistiveWare's published guidance](https://www.assistiveware.com/learn-aac) and cited
> per constraint. **No clinician has reviewed them.** That is reading, not review, and it
> is the first thing this project would need before going anywhere near a real child.

Two more deliberate choices:

- **The rules engine is plain SQL, not a model.** A speech therapist has to be able to
  trace any finding on the dashboard back to a specific number in a specific view. A model
  that cannot show its working is not usable as clinical evidence.
- **The children's actual utterance text lives in a database file the MCP process user
  cannot read.** Not a permission flag or a policy — a filesystem fact. A model asking
  questions about the analytics is structurally unable to read what the children said.

---

## Architecture

Three surfaces, served by **one Next.js process** over **SQLite in WAL mode**:

| Surface | Hostname | What it is |
|---|---|---|
| Communication board | `aac.kason.app` | Child-facing symbol board: sentence bar, speech output, categories, offline-capable PWA. Deliberately unauthenticated — a login between someone and their voice is the wrong trade. |
| Analytics dashboard | `aac-dashboard.kason.app` | Teacher / SLT / parent surface: attention queue, per-student metrics, insight cards, reports, Ask panel. Adult login. |
| MCP analytics server | `aac-mcp.kason.app` | 20 read-mostly MCP tools over the analytics database, for any model that asks about the data. Bearer token. |

All three hostnames resolve to the same `localhost:3000` origin through a Cloudflare
Tunnel; `middleware.ts` reads the `Host` header and 404s routes that do not belong to that
hostname. One process is a constraint, not a shortcut: a SQLite WAL writer and its readers
must share a filesystem, so the surfaces cannot be split across machines without first
replacing SQLite.

Two databases: `aac.db` (analytics — events, utterances, metrics, insights; rebuilt
deterministically by the pipeline) and `aac_app.db` (application state — adult accounts,
card overrides, categories, generated pictures).

## Running it

```bash
./tools/build.sh aac.db     # build + seed the analytics database (Python, deterministic)
npm install
npm run dev                 # board at /, dashboard at /dashboard, MCP at POST /api/mcp
npm run verify              # the 42-check clinical-safety gate
```

Node ≥ 24 — `node:sqlite` is built in, so the MCP server has zero npm dependencies.
Secrets and configuration live in `.env.local` only (see `docs/deploy.md` for the full
variable table). Production runs as a macOS launchd job behind `cloudflared` — the runbook
is [`docs/deploy.md`](docs/deploy.md) and the service definitions are in [`deploy/`](deploy/).

## Directory map

```
app/            the ONE Next.js process (WAL SQLite forces a shared filesystem,
  page.tsx        so kid + dashboard + APIs stay in one deploy)
  who/            kid sign-in
  dashboard/      teacher/SLT surface (own hostname via middleware)
  api/            events · cards · categories · session · auth · visuals · mcp · chat
components/
  kid/            board surface only
  *.tsx           dashboard surface only
lib/
  kid/            speech · sentence · voice · logging (browser-side concerns)
  visuals/        provider chain: vertex | gemini | openai + ladder + cache
  categories/     folder store (aac_app.db)
  chat/           LLM providers (analytics session)
  *.ts            shared: db, sqlite, access, auth, session, metrics, report
db/  tools/  mcp/  analytics pipeline
deploy/           launchd + cloudflared + runbook
public/icons/ai/  generated vocabulary icons
docs/feature/     one md per feature
```

## Where to read next

- [`docs/aac-clinical-constraints.md`](docs/aac-clinical-constraints.md) — the eight
  constraints and what each one invalidated. **Read this before touching metrics,
  insights, or board layout.**
- [`docs/feature/README.md`](docs/feature/README.md) — the feature index: 67 features
  across 10 domains, each with source files, dependency edges and an impact matrix.
- [`docs/analytics-metrics.md`](docs/analytics-metrics.md) and
  [`docs/mcp-api.md`](docs/mcp-api.md) — the metric and MCP tool specifications.
- [`docs/deploy.md`](docs/deploy.md) — the deployment runbook.

`CLAUDE.md` carries the key invariants and an honest list of known gaps — metrics with no
source data, and the ones that render "not recorded yet" rather than pretending to be zero.

## Team

Built by **Kason Zhan**, **Avinash Deenadayalan**, **Thenuja Sinthujan**, **Hao Lin** and
**Henry** at the Aotearoa AI Hackathon.

Reference reading: the TouchChat and Proloquo2Go manuals, and AssistiveWare's Learn AAC
material. Those are the vendors' own documents and are not redistributed here.
