# Forbidden-Action Guard

## Function
A regex phrase index that scans the generated answer for advice AAC practice rules out — resizing a grid, relocating a learned card, reducing repetition, retraining a refusal — and returns hits so the agent can force one rewrite, plus a human-readable label the UI shows even when nothing was violated.

## Purpose
Stated in one line at the top of the file: **a system-prompt instruction is a request; this is a check.**

`insights_catalog.forbidden_actions` lists advice that AAC practice says causes harm. Those are not stylistic preferences — each one takes something away from a child (see [`docs/aac-clinical-constraints.md`](../../aac-clinical-constraints.md), where the copy rules are stored as fields on `insights_catalog` "not left to whoever writes the UI string"). The guard is two layers:

1. the phrase index, matched against the generated answer
2. the same list rendered in the UI, so a teacher sees the boundary even when the model stayed inside it

## Source Files
| File | Role |
|------|------|
| `lib/chat/guard.ts` | `PHRASES` index, `checkForbidden()`, `correctionPrompt()`, `explainForbidden()`, `GuardHit` |

## Implementation

### `PHRASES: Record<string, RegExp[]>`
Keyed by the `forbidden_actions` string emitted by MCP tool envelopes. Deliberately generous: *a false positive costs one regeneration; a false negative puts harmful advice about a disabled child in front of the adult who will act on it.*

| Action key | Patterns (all case-insensitive) |
|---|---|
| `resize_grid` | `\b(shrink\|reduce\|resize\|smaller\|decrease)\b[^.]{0,40}\b(grid\|board\|layout)\b` · `\b(grid\|board)\b[^.]{0,30}\b(4x4\|3x3\|2x2)\b[^.]{0,30}\b(instead\|reduce\|smaller)\b` · `\bfewer (rows\|columns\|cells)\b` |
| `move_card` | `\b(move\|relocate\|reposition\|shift\|swap)\b[^.]{0,30}\b(card\|button\|symbol\|cell)\b` · `\bmove\b[^.]{0,20}\bto the (home\|top\|first) (grid\|page\|row)\b` · `\brearrange\b[^.]{0,30}\b(board\|grid\|layout)\b` |
| `remove_original` | `\bremove\b[^.]{0,25}\boriginal\b` |
| `reduce_repetition` | `\b(reduce\|discourage\|stop\|limit\|prevent\|extinguish\|redirect)\b[^.]{0,40}\brepeat` · `\brepetitive\b[^.]{0,30}\b(behaviou?r\|problem\|issue\|habit)\b` · `\b(discourage\|stop)\b[^.]{0,20}\b(stimming\|stim)\b` |
| `retrain_preference` | `\b(retrain\|re-?teach\|encourage\|prompt)\b[^.]{0,40}\b(to (request\|choose\|accept\|try))\b` |
| `reintroduce_refused_item` | `\bkeep (offering\|presenting\|trying)\b` |
| `treat_refusal_as_deficit` | `\b(refus\w+\|saying no\|rejects?)\b[^.]{0,30}\b(problem\|concern\|deficit\|non-?compliance)\b` |
| `demand_output` | `\b(require\|demand\|insist\|expect)\b[^.]{0,30}\b(the child\|they\|she\|he)\b[^.]{0,20}\b(respond\|answer\|use\|produce)\b` |
| `test_the_child` | `\b(test\|quiz\|assess\|check)\b[^.]{0,25}\b(the child\|whether (she\|he\|they) knows?)\b` |
| `demand_imitation` | `\b(have\|make\|get)\b[^.]{0,20}\b(the child\|them)\b[^.]{0,20}\bcopy\b` |
| `blame_the_child` | `\bthe child (is\|has) (regress\|declin\|deteriorat\|getting worse)` · `\b(she\|he\|they) (regressed\|declined\|got worse)\b` |
| `frame_as_regression` | `\bregress(ion\|ing\|ed)\b` |
| `demand_transfer` | `\b(insist\|require)\b[^.]{0,30}\bgeneralis` |
| `drill_in_therapy` | `\bdrill\b` · `\bmassed practice\b` |

### `checkForbidden(text, forbidden): GuardHit[]`
Iterates only the actions in `forbidden` (i.e. the actions the *tools actually returned* for this answer), tries each regex, and on first match pushes `{ action, matched: m[0].slice(0, 90) }` then `break`s to the next action — **at most one hit per action**. An action with no entry in `PHRASES` (`?? []`) is a silent no-op.

### `correctionPrompt(hits): string`
Names what the model said and what to do instead, "because 'you violated a rule' produces a hedge, not a better answer". Opens with `Your answer contains advice that is forbidden for this finding:` followed by one `- "<matched>" reads as <action>` line per hit, then `Rewrite it. Keep every number and every citation exactly as they are — only the recommendation changes.` and five explicit substitutions:

- Never move, swap or relocate a learned card — motor plans depend on buttons staying where they are. **Add a COPY** at a reachable position, or **unmask** one that is already there. (C2/C3)
- Never shrink or resize the grid — **mask the neighbours** of a hard-to-hit target, or change the physical setup (keyguard, mount angle, dwell). (C2)
- Never suggest reducing repetition — it is exploration, motor learning, gestalt processing or self-regulation; where it clusters with thin vocabulary, treat it as a **MISSING WORD**. (C1)
- Never treat a refusal as a deficit — saying no is successful communication.
- Never describe the child as regressing when a layout change preceded the numbers — say what changed and when. (C2 / I8)

### `explainForbidden(actions): string | null`
Returns `null` for an empty list, otherwise `` `Cannot recommend: ${names.join(' · ')}` ``. Mapping table (`human`), including three keys that have **no `PHRASES` entry** — they are labelled in the UI but never text-matched:

| Key | Label |
|---|---|
| `resize_grid` | resizing the grid |
| `move_card` | moving a learned card |
| `remove_original` | removing the original card |
| `reduce_repetition` | reducing repetition |
| `retrain_preference` | retraining a preference |
| `reintroduce_refused_item` | reintroducing a refused item |
| `treat_refusal_as_deficit` | treating a refusal as a deficit |
| `demand_output` | demanding output |
| `test_the_child` | testing the child |
| `demand_imitation` | demanding imitation |
| `blame_the_child` | blaming the child |
| `frame_as_regression` | framing it as regression |
| `recommend_further_layout_change` *(label only)* | recommending another layout change |
| `retrain_without_access_check` *(label only)* | retraining before checking physical access |
| `test_generalisation` *(label only)* | testing generalisation |
| `demand_transfer` | demanding transfer |
| `drill_in_therapy` | drilling in therapy |

Unknown keys fall back to `a.replace(/_/g, ' ')`.

### Where the action list comes from
`mcp/tools.ts` attaches `forbidden_actions` to specific envelopes, e.g. `get_cell_heat` → `['resize_grid', 'move_card']`, `get_scene_breakdown` → `['demand_imitation', 'test_the_child']`, `get_board_revisions` → `['blame_the_child', 'frame_as_regression', 'recommend_further_layout_change']`, and `get_fired_rules` unions `insights_catalog.forbidden_actions` across the rules that fired. `runAgent` accumulates them into `forbiddenSeen` across the whole turn.

### Enforcement loop (in `lib/chat/agent.ts`)
1. `checkForbidden(answer, [...forbiddenSeen])`
2. hits → `regenerated` event, push the answer + `correctionPrompt(hits)`, stream a toolless rewrite
3. `checkForbidden(rewritten, forbidden)` still hits → `error` event, `retryable: true`, message: *"The answer kept recommending something AAC practice rules out, so it has been withheld. The evidence above stands; the recommendation does not."* — **exactly one correction attempt, then stop rather than ship it**
4. `explainForbidden(forbidden)` yields the `forbidden` label regardless of whether anything matched

## Dependencies & Connections

### Depends On
- [../mcp/tool-surface.md](../mcp/tool-surface.md) — the `forbidden_actions` array on tool envelopes; the guard only checks actions that were actually returned
- [../analytics/fired-rules-and-evidence.md](../analytics/fired-rules-and-evidence.md) — `insights_catalog.forbidden_actions` is the authoritative list these keys mirror

### Depended On By
- [ask-agent](ask-agent.md) — the only caller; runs the check, the correction and the label

### Shared Resources
- The action-key vocabulary is shared with `db/seed_catalogues.sql` (`insights_catalog.forbidden_actions`) and `mcp/tools.ts`. A key added in either place without a `PHRASES` entry is labelled but unenforced.

## Change Risks
- **Adding a `forbidden_actions` key in `insights_catalog` or `mcp/tools.ts` without a `PHRASES` entry** produces a UI label with no text check — `checkForbidden` silently returns nothing for it. Three such keys already exist (`recommend_further_layout_change`, `retrain_without_access_check`, `test_generalisation`).
- **Tightening the regexes to reduce false positives** inverts the file's stated trade-off. The comment is explicit that a false negative is far more costly than a wasted regeneration.
- **The guard only inspects the final `answer`.** Text streamed during a turn that also made tool calls reaches the user unchecked (see [ask-agent](ask-agent.md)).
- **`frame_as_regression`'s `\bregress(ion|ing|ed)\b`** matches any use of the word, including a legitimate quotation or a denial such as "this is not regression". That is intentional over-matching, but it means any answer discussing the concept while `frame_as_regression` is active will trigger a rewrite.
- **Allowing more than one correction round** would change the failure behaviour from "withhold" to "keep trying"; the current single attempt is what makes the withheld-answer error reachable.
- **Renaming a key in `human`** changes what the teacher sees under the answer; the label is the only visible evidence of the boundary when the model behaved.
