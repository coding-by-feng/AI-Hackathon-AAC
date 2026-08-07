# Team development plan

**Status:** executing
**How to read this:** the plan that drives the multi-agent build of the current feature wave, and the ownership map that stops parallel agents colliding. Boundaries here are contracts: an agent that edits outside its column has failed its task.

---

## 1. The wave

| # | Work | Why now |
|---|---|---|
| W1 | Vertex image generation (`gemini-2.5-flash-image` + ADC) | The only image model this GCP project can reach — verified with real bytes. Unblocks icons and the edit-sheet "make one" path. **Done before fan-out.** |
| W2 | Metric gaps N3–N5 (core word list, partner gate, keyboard metric) | Data honesty must precede any dashboard that renders it. N1/N2 resolved by building on `lib/report.ts`, which reads dimensional tables correctly. **Done before fan-out.** |
| W3 | Vocabulary icon generation (~90 concepts, one by one) | User-visible faces for every word; the built-in SVG set stays as offline fallback. |
| W4 | Dashboard redesign to the approved dark mockup | The generated design is the spec; the report infrastructure it needs already exists. |
| W5 | Kid app: keyboard + message-window patterns + modeling help | TouchChat/Proloquo2Go patterns from the PDFs in `docs/`; the keyboard closes clinical gap C8 and lights metric H2. |
| W6 | Root structure + this plan | Documented boundaries instead of a physical monorepo split (see §4). |
| W7 | Feature docs update + align | One md per feature; drift removed against real source. |
| W8 | Integration: typecheck, build, tests, redeploy, honest results | Single serial gate after every agent returns. |

## 2. Team topology

```
                        lead (this session)
                        W1 W2 foundation · W8 integration
                              |
        +------------+--------+--------+------------+
        v            v                 v            v
   icons agent   dashboard agent   kid agent    docs agent
      W3             W4               W5          W6 W7
```

Four agents run in parallel. The lead does the foundation first (everything they build depends on it), then integrates serially — merge conflicts are prevented by ownership, not resolved after the fact.

## 3. Ownership map — the collision contract

| Agent | Owns (may create/edit) | Must not touch |
|---|---|---|
| **icons** | `tools/generate-icons.mjs` · `public/icons/ai/**` · `components/kid/card-face.tsx` · `lib/icons/ai-manifest.ts` | `board-app.tsx`, `app/globals.css`, anything in `db/` |
| **dashboard** | `app/dashboard/**` · `components/metric-card.tsx` · `components/charts.tsx` · `components/status.tsx` · `components/ui.tsx` · `app/globals.css` (append a scoped block only) | `components/kid/**`, `lib/kid/**`, `app/page.tsx` |
| **kid** | `components/kid/**` except `card-face.tsx` · `app/page.tsx` · `lib/kid/**` · `app/api/events` validation if the keyboard needs it | `card-face.tsx` (icons owns it), `app/globals.css`, `app/dashboard/**` |
| **docs** | `docs/**` · `README.md` | any code |
| **lead** | `lib/visuals/**` · `lib/report.ts` (surgical) · `db/seed_core_words.sql` (additive) · integration fixes anywhere **after** agents return | — |

Shared files nobody edits in this wave: `package.json`, `tsconfig.json`, `middleware.ts`, `lib/db.ts`, `lib/sqlite.ts`.

The analytics pipeline (`db/schema.sql`, `views_*.sql`, `tools/*.py`, `mcp/`) belongs to a separate session. Additive files only (`db/seed_core_words.sql` is the precedent); never edit theirs.

## 4. Root structure

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
db/  tools/  mcp/  analytics pipeline — other session's territory
deploy/           launchd + cloudflared + runbook
public/icons/ai/  generated vocabulary icons
docs/feature/     one md per feature
```

A physical `apps/dashboard` + `apps/kid` monorepo split is **deliberately deferred**: both surfaces must share one SQLite WAL file and therefore one filesystem and (practically) one server process. Splitting the repo now would buy directory tidiness at the cost of two deploys that cannot actually be separated. Revisit only if SQLite is replaced.

## 5. Integration gate (W8, serial, lead only)

1. `tsc --noEmit` clean
2. `next build` clean
3. `launchctl kickstart` + local smoke of all routes
4. `tools/test-api.sh` — 0 failures (blocked ≠ failed)
5. Playwright pass over the new surfaces (dashboard layout, keyboard, help popover)
6. Public URLs verified over the tunnel
7. `docs/test-results.md` updated honestly — pass / fail / blocked

## 6. Standing rules every agent inherits

- Clinical constraints are code, not copy: no card ever moves; neutral metrics never styled good/bad; no gauges; every number carries `n`; forbidden actions stay forbidden.
- Logging never blocks speech; a failed audit write never surfaces to the child.
- Only sanitized concepts leave the machine; a child's name never reaches an image API.
- `.env.local` is the only home for secrets; nothing lands in a `NEXT_PUBLIC_` var.
- A metric with no real source renders "not recorded", never `0`.
