---
name: verify-features
description: Use after any feature change, before any demo, or when asked to "test everything" — regenerates the feature-verification spec from docs/feature/, runs every check against the production build (playwright + curl + verify gate), records evidence, and loops fix → rebuild → re-verify until zero FAIL.
---

# Verify Features

Full-surface verification for this repo: every feature in `docs/feature/` gets a
concrete **input → expected output** row, and every row gets executed against the
**production build** with recorded evidence. The deliverable is an updated
`docs/feature-verification.md`.

## The process

1. **ENUMERATE** — `docs/feature/README.md` is the checklist: 10 domains, 63 features.
   Every feature appears in the spec; nothing gets tested that isn't listed, nothing
   listed goes untested. If a feature doc was added since the last run, add its rows.

2. **SPECIFY** — each row is `ID | Feature | Input (steps) | Expected | Actual | ✓`.
   The Expected column holds **exact strings, codes, and numbers** ("Will say: “I want
   water.”", `400 + "grid_row"`, `n=500`), never "works correctly". Vague expectations
   are how bugs pass review.

3. **BUILD** — `npx next build && launchctl kickstart -k gui/$(id -u)/app.kason.aac.web`,
   then wait for `curl -sf http://localhost:3000/who`. **Never verify against `next
   dev`**: dev tolerates cookie writes in Server Component renders (and other
   prod-only failures) — a `?child=` 500 shipped this way once already.

4. **EXECUTE** — pick the method per row:
   - **browser** → `playwright-cli` (persistent profile). One session; browser rows run
     serially.
   - **curl** → API, MCP HTTP, SSE chat, hostname routing. `tools/test-api.sh` covers
     the standing 24 cases; add targeted curls for new rows.
   - **sql** → `sqlite3 aac.db` / `aac_app.db` read-only checks for analytics rows.
   - **cli** → `npm run verify` (42-check clinical gate) owns pipeline/database rows;
     `npm run concurrency` for WAL.

5. **RECORD** — fill Actual with what was actually observed (a snapshot line, a curl
   body, a count). A PASS **requires pasted evidence**. An error boundary that renders
   politely is not a passing board — check for the feature's content, not for HTTP 200.

6. **FIX** — any FAIL: fix, return to step 3, re-run that section (not just the row —
   its neighbours share the code you touched).

7. **GATE** — done only at 0 FAIL, or with each remaining FAIL written into the
   "Failures & fixes" table as a documented known gap with a reason.

## Ground rules (each learned from a real bug here)

- **Production build only.** `next dev` masked `cookies().set()` in a page render;
  every `?child=` link 500'd in prod while dev looked fine.
- **Evidence before PASS.** A regression suite once "passed" against the error
  boundary's fallback text. Assert on feature content ("Will say:", a child's name, a
  metric value), never on the absence of an error.
- **Suppressed ≠ zero.** For `suggestion_acceptance`, `vocabulary_gaps`,
  `visual_source_split` the CORRECT expected output is "not recorded yet". A `0`
  rendering there is a FAIL (it fabricates data), and so is inventing numbers.
- **Clinical invariants are test rows, not prose.** Mode never reorders/moves a card
  (compare full card order before/after). Neutral-polarity metrics never render
  good/bad styling. `informational` insights render no action button.
  `forbidden_actions` is visible text.
- **Every metric carries its n.** A number without `n=…` beside it is a FAIL.
- **Mobile is a row, not an afterthought.** At 375px width:
  `document.documentElement.scrollWidth <= 375` on board, dashboard, student page.

## Recipes

```bash
# Adult session cookie (dashboard rows). Credentials live in gitignored
# .env.local (AAC_QA_USER / AAC_QA_PASS) — never write them into this file.
# If the vars are missing, create an account via the /login first-run setup
# and record it in .env.local.
source .env.local
curl -s -c /tmp/ck.txt -H 'content-type: application/json' \
  -d "{\"username\":\"$AAC_QA_USER\",\"password\":\"$AAC_QA_PASS\"}" http://localhost:3000/api/auth

# Child switch (board rows) — via the switch route, never by writing cookies in a page
playwright-cli goto "http://localhost:3000/?child=maya_t"   # 307 → /api/session/switch → /

# Sentence-bar helper: clear, tap words by accessible name, read the bar
say() {  # usage: say I want water
  playwright-cli snapshot --filename=t.yaml >/dev/null
  C=$(grep -oE 'button "Clear" \[ref=e[0-9]+\]' t.yaml | grep -oE 'e[0-9]+' | head -1)
  [ -n "$C" ] && playwright-cli click "$C" >/dev/null && sleep 0.4
  playwright-cli snapshot --filename=t.yaml >/dev/null
  for w in "$@"; do
    R=$(grep -oE "button \"$w\" \[ref=e[0-9]+\]" t.yaml | grep -oE 'e[0-9]+' | head -1)
    playwright-cli click "$R" >/dev/null
  done
  sleep 0.6
  playwright-cli eval "(document.body.innerText.match(/Will say: [^\n]+/)||['(none)'])[0]"
}

# Mode safety: full card order must be byte-identical across mode entry
order() { playwright-cli eval "Array.from(document.querySelectorAll('main button')).map(b=>b.innerText.trim().split('\n').pop()).join(',')"; }

# Horizontal-scroll check at phone width
playwright-cli resize 375 812
playwright-cli eval "document.documentElement.scrollWidth > 375 ? 'HSCROLL FAIL' : 'ok'"

# MCP over HTTP
curl -s -H "authorization: Bearer $AAC_MCP_TOKEN" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' http://localhost:3000/api/mcp | jq '.result.tools | length'   # expect 20

# Ask panel SSE (needs adult cookie)
curl -sN -b /tmp/ck.txt -H 'content-type: application/json' \
  -d '{"childId":"maya_t","message":"How many words per sentence lately?"}' \
  http://localhost:3000/api/chat | head -40   # expect event: lines incl. tool calls + cited numbers
```

## Output

`docs/feature-verification.md` — spec + latest run results + failures table. Append a
run header (date, BUILD_ID) rather than erasing history of what failed last time.
