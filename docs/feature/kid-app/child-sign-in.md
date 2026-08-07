# Child Sign-In (Who Is Using The Board)

## Function
A picture-based sign-in at `/who` that puts the current child in an httpOnly cookie, with an optional three-symbol picture passcode per child, so events are attributed to the person who actually spoke.

## Purpose
This is **a data-integrity fix, not a security feature** (`lib/session.ts` header). `?child=` in the URL used to *be* the identity, so a shared classroom iPad credited every press to whoever last opened the tab — three children's presses landing under one id. The dashboard then described a child who talks 200 times a day, "whose mis-tap rate is three children's motor abilities averaged together, and whose silence streak can never fire because someone else keeps using 'their' device."

Nothing in the schema changed: `events` already had `child_id` and `session_id`; the application simply never knew which child to write.

The sign-in surface itself is designed around the person it is for: "a password field excludes the person the board is for. So does a list of names they must read. A photo is the name, and the tap target is large enough for someone with limited fine motor control."

## Source Files
| File | Role |
|------|------|
| `lib/session.ts` | Cookie read/write/clear, `signInRoster`, `childProfile`, and the picture-passcode store (`child_passcodes` in `aac_app.db`). |
| `app/who/page.tsx` | Server component for `/who`; maps the roster to `{child_id, display_name, year_group, hasPasscode}`. |
| `components/kid/who-picker.tsx` | The client picker: face grid, passcode pad, retry handling. |

## Implementation

### Cookie
| Name | Value |
|---|---|
| `COOKIE` | `'aac_child'` |
| `MAX_AGE` | `60 * 60 * 12` = 43200 s ("a school day") |
| flags | `httpOnly: true`, `sameSite: 'lax'`, `path: '/'` |

- `currentChildId(): Promise<string | null>` — reads the cookie.
- `setCurrentChild(childId)` — writes it with the flags above.
- `clearCurrentChild()` — deletes it.

### Roster
`signInRoster()` runs `SELECT child_id, display_name, year_group FROM children ORDER BY display_name` against `aac.db` and attaches `passcode: passcodeFor(child_id)`. `childProfile(childId)` is the single-row form. `app/who/page.tsx` is `dynamic = 'force-dynamic'` and exposes only `hasPasscode: c.passcode !== null` to the client — the symbol sequence itself never crosses to the browser.

### Picture passcodes
Stored in **`aac_app.db`** (path from `process.env.AAC_APP_DB`, default `<cwd>/aac_app.db`), not in the analytics database:

```sql
CREATE TABLE IF NOT EXISTS child_passcodes (
  child_id  TEXT PRIMARY KEY,
  symbols   TEXT NOT NULL,   -- JSON array of symbol keys, in order
  set_at    INTEGER NOT NULL
) STRICT
```
Opened with `PRAGMA journal_mode = WAL` and `PRAGMA busy_timeout = 5000`, cached on `globalThis.__aacSession`.

- `passcodeFor(childId)` → `string[] | null` (null on missing row, empty array, or malformed JSON).
- `setPasscode(childId, symbols)` — `null`/empty deletes the row; otherwise upserts with `set_at = Date.now()`.
- `checkPasscode(childId, attempt)` — **returns `true` when no passcode is set**, then compares length and every element in order.

Passcodes are **off by default and opt-in per child**: "for many AAC users any barrier between them and speech is the wrong trade. It exists for the cases where attribution genuinely matters — a device several children share unsupervised."

There is deliberately **no lockout, no attempt counter and no error state that reads as failure** — "it is not protecting anything from someone determined."

### The picker (`components/kid/who-picker.tsx`)
- `PIN_SYMBOLS = ['ball', 'book', 'home', 'music', 'water', 'apple', 'play', 'garden']` — eight recognisable symbols, "nothing abstract", each resolving to a real entry in `lib/icons/symbols.tsx`.
- Passcode length: the attempt is submitted as soon as `next.length >= 3`.
- Face grid: `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`, each tile `minHeight: 160` with a 20×20 (`h-20 w-20`) initial circle and the child's first name. A real photo belongs there; "until one is uploaded, initials are at least stable and recognisable — never a generic avatar that looks the same for every child." A child with a passcode shows the hint `pictures needed`.
- Passcode screen: heading *"Hello <FirstName>. Tap your three pictures."*, three 14×14 slots (`aria-label="pictures chosen so far"`), an 8-button `grid-cols-4` pad at `minHeight: 96`, and a `Someone else` escape button.
- Retry copy on a wrong sequence is *"Let's try that again."* — the attempt is cleared and nothing is phrased as failure.
- Root list copy: *"Signing in keeps each person's words in their own record, so the reports describe the right child."*

### Sign-in flow
1. `pick(child)` → no passcode: sign in immediately. With a passcode: show the pad.
2. `signIn(child, passcode)` → `POST /api/session` with `{ childId, passcode }`.
3. `{ ok: true }` → `router.push('/')` then `router.refresh()`.
4. `{ ok: false, reason: 'passcode' }` (HTTP 200, deliberately not 401) → clear the attempt, set `retry`.

`POST /api/session` sets the cookie and writes a `session_start` event with `payload {via: 'sign_in'}` server-side — "this is the moment the identity is actually resolved; logging it client-side would record whatever the page thought before the sign-in completed." A failure to write that audit event is swallowed: *"A missing audit event must never block a child from reaching their board."*

### Sign-out flow
The board header's signed-in chip calls `DELETE /api/session?child=<id>` and then `window.location.href = '/who'`. The route writes a `session_end` event with `payload {endReason: 'normal', via: 'sign_out'}` before clearing the cookie, so a device switch is visible in the data.

### Redirect behaviour on `/`
`app/page.tsx` redirects to `/who` when there is no cookie **and** when the cookie names a child no longer in `children` — "a stale cookie (a child removed from the roster) must not dead-end."

## Dependencies & Connections

### Depends On
- ../database/schema.md — the `children` table (read through `lib/db.ts`).
- ../api/sign-in-endpoints.md — `POST /api/session`, `DELETE /api/session?child=`.
- [Symbol Set & Card Faces](symbol-set.md) — `CardFace` renders both the passcode pad and the chosen-symbol slots.
- `aac_app.db` — the app-owned SQLite file that also holds card overrides and categories.

### Depended On By
- [Communication Board](communication-board.md) — `/` reads `currentChildId()` and redirects here when it is missing; `?child=` sets the session and redirects.
- ../dashboard/attention-queue.md — every per-child figure is only correct if attribution here is correct.
- [Event Logging](event-logging.md) — the `child_id` on every logged event comes from this cookie via the server-rendered `BoardData`.

### Shared Resources
- Cookie `aac_child`.
- `aac_app.db` table `child_passcodes` (shared file with `card_overrides`, `categories`, `category_words`, `child_categories`).
- `globalThis.__aacSession` — the cached `DatabaseSync` handle for the passcode store.

## Change Risks
- **Restoring `?child=` as identity** re-creates the original attribution bug: a shared tablet writes several children's presses under one id, and every per-child metric becomes an average of strangers.
- **Treating the passcode as a security boundary** (adding lockouts, attempt counters, or a failure-styled error) puts a barrier between an AAC user and their voice — the header explicitly rejects this.
- **Returning 401 instead of `{ok:false, reason:'passcode'}` with HTTP 200** would make `WhoPicker`'s `res.json()` path throw and leave the child on a spinner.
- **Extending `MAX_AGE` past a school day** leaves the wrong child signed in overnight, which is exactly the failure mode the cookie length was chosen to bound.
- **Removing the stale-cookie check in `app/page.tsx`** dead-ends a child on a board query that returns nothing after they are removed from the roster.
- **Adding a symbol to `PIN_SYMBOLS` that has no entry in `SYMBOLS`** renders the letter-tile fallback on the pad, so two pad buttons can look alike and a stored passcode becomes hard to enter.
- **Note:** `lib/session.ts` opens its own `DatabaseSync` on `globalThis.__aacSession` rather than going through `lib/sqlite.ts`'s inode-checking `connect()`. If `aac_app.db` were ever replaced on disk, this handle would keep reading the deleted inode — unlike `lib/categories/store.ts`, which does use `connect()`.
