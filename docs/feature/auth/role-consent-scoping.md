# Role and Consent Scoping

## Function
Resolves the signed-in adult to a `Viewer`, lists the children they may see from the `roster`
table (excluding expired rows), and decides per data tier whether that viewer may see it —
combining per-child consent with a fixed relation-to-tier policy.

## Purpose
This is the project's answer to row-level security. The header comment on `lib/access.ts` states
the rule directly:

> Enforced here, in the query layer — never in a component. A page that forgets to check is a
> bug; a query that cannot return unauthorised rows is a guarantee.
> SQLite has no row-level security, so "RLS" in the older docs means this file.

It implements `docs/analytics-metrics.md` §10 (Roles and permissions) and §11 (Privacy, consent,
retention). §11's tier table — aggregate and card labels ON by default, full utterance text
parent/SLT only and OFF by default, partner speech off entirely — is encoded here as
`TIER_RELATIONS` plus a live query against `consent`. `docs/TECH_STACK.md` pins the same
decision: *"Role and consent scoping live in the query/tool layer (`lib/access.ts`, MCP
handlers), never in a prompt."*

## Source Files
| File | Role |
|------|------|
| `lib/access.ts` | Viewer resolution, roster scoping, consent tier lookup, tier/relation policy table, lock-reason copy |

## Implementation

### Types

```ts
type Relation    = 'teacher' | 'parent' | 'slt'
type ConsentTier = 'aggregate' | 'card_labels' | 'utterance_text' | 'partner_speech'

type Viewer = {
  adult_id: string
  display_name: string
  role: 'teacher' | 'parent' | 'slt' | 'admin'
}

type ChildSummary = {
  child_id: string
  display_name: string
  year_group: string | null
  profile_note: string | null
  class_id: string | null
  relation: Relation
  consent_tiers: ConsentTier[]
}
```

`Viewer.role` comes from `adults.role` and includes `'admin'`; `ChildSummary.relation` comes
from `roster.relation` and does **not**. The two are distinct: policy decisions here key on
`relation` (how this adult relates to *this child*), never on `role`.

### `currentViewer(): Promise<Viewer>`

1. `const sessionId = await currentAdultId()` — see [Adult sign-in](adult-sign-in.md).
2. `const id = sessionId ?? (process.env.NODE_ENV === 'production' ? null : (process.env.AAC_VIEWER ?? null))`
   - The comment is emphatic about the fallback: *"`AAC_VIEWER` remains as a development
     override only — it is ignored whenever a session exists, and ignored entirely in
     production, so it cannot become a way past the login."*
   - A consequence noted in `docs/deploy.md`: auth cannot be meaningfully tested under
     `next dev`, because `AAC_VIEWER` fills in whenever there is no session.
3. No `id` → `throw new Error('NOT_SIGNED_IN')`
4. `SELECT adult_id, display_name, role FROM adults WHERE adult_id = ?`
5. No row → `throw new Error('NOT_SIGNED_IN')` (an `adult_id` that has a credential row but was
   dropped from `adults` reads as signed out)

`NOT_SIGNED_IN` is matched by `error.message.includes('NOT_SIGNED_IN')` in
`app/dashboard/error.tsx`, which renders "You need to sign in" with a link to `/login`.

### `visibleChildren(viewer): ChildSummary[]`

```sql
SELECT c.child_id, c.display_name, c.year_group, c.profile_note, c.class_id,
       r.relation
FROM children c
JOIN roster r ON r.child_id = c.child_id
WHERE r.adult_id = ?
  AND (r.expires_at IS NULL OR r.expires_at > CAST(strftime('%s','now') AS INTEGER) * 1000)
ORDER BY c.display_name
```

- `expires_at` is milliseconds, hence the `* 1000` on the SQLite epoch seconds. `db/schema.sql`
  comments the column as *"NULL = no expiry (parents)"* and the table as *"Access EXPIRES —
  teacher rights end with the term."* §11 says the same: *"teacher access expires at end of term."*
- Every returned row calls `consentTiers(child_id)` — one extra query per child (N+1). For a
  class-sized roster this is deliberate simplicity, not an oversight worth a join.
- Nullable columns are normalised with `?? null` after the cast.

### `requireChild(viewer, childId): ChildSummary`

Finds `childId` inside `visibleChildren(viewer)`; on miss throws
``NOT_AUTHORISED: ${viewer.adult_id} has no active roster row for ${childId}``.

Callers rely on the `NOT_AUTHORISED:` prefix for status mapping:
`app/api/chat/route.ts` and `app/api/reports/route.ts` both do
`msg.startsWith('NOT_AUTHORISED') ? 403 : …`, and `app/dashboard/error.tsx` uses
`error.message.startsWith('NOT_AUTHORISED')` to render "That child is not on your roster".

### `consentTiers(childId): ConsentTier[]`

```sql
SELECT DISTINCT tier FROM consent
WHERE child_id = ? AND revoked_at IS NULL
```

Revoked rows do not count. Because `consent`'s primary key is
`(child_id, tier, granted_at)`, a tier can be granted, revoked and re-granted; `DISTINCT` plus
`revoked_at IS NULL` means one live grant is enough.

### `TIER_RELATIONS` — the policy table

```ts
const TIER_RELATIONS: Record<ConsentTier, Relation[]> = {
  aggregate:      ['teacher', 'parent', 'slt'],
  card_labels:    ['teacher', 'parent', 'slt'],
  utterance_text: ['parent', 'slt'],
  partner_speech: ['slt'],
}
```

This mirrors §11's tier table exactly. The comment records why it is a constant and not a
config row: *"A teacher never sees utterance text or partner speech, however the consent table
is configured. That is a policy decision, recorded here rather than spread across pages."*

### `canSee(child, tier): boolean`

```ts
child.consent_tiers.includes(tier) && TIER_RELATIONS[tier].includes(child.relation)
```

Two independent conditions, both required: consent granted for the child **and** the viewer's
relation permitted the tier at all. Neither one alone unlocks anything.

### `lockReason(child, tier): string` — user-facing copy

```ts
const RELATION_NAME: Record<Relation, string> = {
  teacher: 'teachers',
  parent:  'parents',
  slt:     'speech therapists',
}
```

- Relation not permitted → `` `Available to ${list}. You have ${singular} access.` `` where
  `list` is the permitted relation names joined `", "` with `" and "` before the last, and
  `singular` is `RELATION_NAME[child.relation].replace(/s$/, '')`.
  - Worked example, a teacher opening a `partner_speech` panel:
    `"Available to speech therapists. You have teacher access."`
  - A teacher on `utterance_text`: `"Available to parents and speech therapists. You have teacher access."`
- Relation permitted but consent absent →
  `"Consent for this has not been granted, or has been withdrawn."`

`components/status.tsx` renders this inside `<ConsentLock>` — a locked panel is *shown*, not
hidden, with a 🔒 heading, `lockReason(child, tier)` as the body, and a "You can see" /
"You cannot see" definition list. Its comment: *"Hiding it makes people ask for access they do
not need. Showing the boundary, and what sits either side of it, usually ends the conversation."*

### Consumers (every server-rendered dashboard page and data route)

| Caller | Uses |
|---|---|
| `app/dashboard/header.tsx` | `currentViewer()` — `DashHeader` renders the `UserChip` (`display_name · role`); the class view, settings and student pages render it for the shared header row |
| `app/dashboard/page.tsx` | `currentViewer` + `visibleChildren` |
| `app/dashboard/sessions/page.tsx` | `currentViewer` + `visibleChildren` |
| `app/dashboard/reports/page.tsx` | `currentViewer` + `visibleChildren` |
| `app/dashboard/ask/page.tsx` | `currentViewer` + `visibleChildren` |
| `app/dashboard/settings/page.tsx` | `currentViewer` + an inline role check (`teacher`/`slt`/`admin`) |
| `app/dashboard/student/[id]/page.tsx` | `currentViewer` + `requireChild` |
| `app/dashboard/student/[id]/access/page.tsx` | `currentViewer` + `requireChild` + `canSee(child, 'partner_speech')` |
| `app/dashboard/student/[id]/ask/page.tsx`, `.../report/page.tsx`, `.../ai-impact/page.tsx` | `currentViewer` + `requireChild` |
| `app/dashboard/reports/[id]/page.tsx` | `requireChild(viewer, report.child_id)` |
| `app/dashboard/reports/actions.ts` | `requireChild` — *"so a report cannot be produced for a child the viewer cannot see"* |
| `app/actions.ts` | `requireChild` — *"so a dismissal cannot be forged for a child the viewer cannot see"* |
| `app/api/chat/route.ts` | `currentViewer`, `visibleChildren`, `requireChild` (403 on `NOT_AUTHORISED`) |
| `app/api/reports/route.ts`, `app/api/reports/[id]/print/route.ts`, `app/api/reports/[id]/pdf/route.ts` | same |
| `app/api/dashboard/settings/route.ts` | `currentViewer` inside `gate()` — a throw → 401, a role outside `ALLOWED_ROLES` → 403 |
| `components/status.tsx` | `lockReason` |

### The one role-gated surface

The AI-settings surface is the single place that gates on **role** rather than relation:
`app/api/dashboard/settings/route.ts` allows `teacher`, `slt` and `admin` (`ALLOWED_ROLES`)
and `app/dashboard/settings/page.tsx` repeats the same set as an inline check, turning
parents away. That is defensible — provider selection and API keys are shared infrastructure,
not any child's data, so the relation-and-consent machinery above does not apply — but the
allowed set is written twice and belongs in `lib/access.ts` beside the other policy tables.

## Dependencies & Connections

### Depends On
- [Adult sign-in](adult-sign-in.md) — `currentAdultId()` is the authoritative identity; the
  `AAC_VIEWER` fallback only applies when it returns `null` and `NODE_ENV !== 'production'`.
- [Database schema](../database/schema.md) — `adults`, `children`, `roster`, `consent` in
  `aac.db`.
- [Query layer](../database/connection-layer.md) — `all` / `one` from `lib/db`, read-only handle.

### Depended On By
- [Dashboard shell](../dashboard/dashboard-shell.md) and every page under `/dashboard` — each
  page calls `currentViewer()` itself, and `DashHeader` calls it again where rendered — which
  is why `/login` must live outside `/dashboard`
  (see [Host and surface routing](host-surface-routing.md)).
- [Consent lock](role-consent-scoping.md) — `ConsentLock` in `components/status.tsx` calls
  `lockReason`.
- [Chat / Ask](../dashboard/ask-panel.md) and [Reports](../dashboard/progress-reports.md) — both scope to
  `visibleChildren` / `requireChild` before touching child data.
- [Dashboard error boundary](../dashboard/dashboard-shell.md) — pattern-matches the
  `NOT_SIGNED_IN` and `NOT_AUTHORISED` message strings.

### Shared Resources
- The `roster` expiry predicate is duplicated in `mcp/tools.ts` (`get_children`), which runs the
  same `r.expires_at IS NULL OR r.expires_at > strftime('%s','now') * 1000` join and throws its
  own `NOT_AUTHORISED` `McpError` when no rows come back. Two implementations of one rule — see
  [MCP tool surface](../mcp/tool-surface.md).
- Error message prefixes `NOT_SIGNED_IN` / `NOT_AUTHORISED` are a de-facto contract consumed by
  the error boundary and by two API routes' status-code mapping. `docs/mcp-api.md` lists
  `NOT_AUTHORISED` in its error table with the same meaning: *"this adult has no active roster row"*.

## Change Risks
- **Renaming `NOT_SIGNED_IN` or `NOT_AUTHORISED`** silently degrades three consumers:
  `app/dashboard/error.tsx` falls back to the generic "Something went wrong" card (and starts
  leaking the raw message in its `<details>` block), and `app/api/chat/route.ts` /
  `app/api/reports/route.ts` return 500/400 where they previously returned 403.
- **Adding `'admin'` to `Relation` or to `TIER_RELATIONS`** widens what an admin can read. §10
  says admin *"never sees any individual content"* — today that holds only because `roster.relation`
  has a `CHECK (relation IN ('teacher','parent','slt'))` and admins get no roster rows.
- **Adding `'teacher'` to `TIER_RELATIONS.utterance_text`** would put full utterance text in front
  of teachers regardless of the consent table, directly contradicting §11. The two-condition
  `canSee` is the only thing preventing that; loosening it to an OR breaks the guarantee.
- **Dropping the `expires_at` predicate from `visibleChildren`** re-grants access to teachers
  whose term has ended, and to any other expired roster row, across every page and API route in
  the consumer table above. `mcp/tools.ts` would still filter, producing a dashboard and an MCP
  server that disagree about who is on a caseload.
- **Removing the `NODE_ENV === 'production'` guard on `AAC_VIEWER`** turns an env var into an
  authentication bypass in production. The guard is the only reason the dev override is safe to
  keep.
- **Checking access in a page instead of here** is the failure mode the header comment was
  written against. A new route under `/dashboard` that reads a child by id without calling
  `requireChild` is not protected by anything else — `middleware.ts` only checks that *a* cookie
  exists, not which child it is entitled to.
- **Turning `consentTiers` into a join inside `visibleChildren`** (removing the N+1) is safe for
  correctness but must keep `revoked_at IS NULL`; dropping it resurrects withdrawn consent, which
  is the one failure §11 treats as non-negotiable.
- **The two copies of the AI-settings role set drifting** — `ALLOWED_ROLES` in
  `app/api/dashboard/settings/route.ts` and the inline check in
  `app/dashboard/settings/page.tsx` list `teacher`/`slt`/`admin` independently. A role added
  to one and not the other yields a page that renders a form whose saves 403, or an API that
  accepts a role the page turns away. Hoisting the set into `lib/access.ts` removes the risk.
