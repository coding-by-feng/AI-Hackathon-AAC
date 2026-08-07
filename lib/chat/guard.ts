/**
 * The forbidden-action guard.
 *
 * A system-prompt instruction is a request. This is a check.
 *
 * `insights_catalog.forbidden_actions` lists advice that AAC practice says
 * causes harm — resizing a grid, relocating a learned card, reducing
 * repetition, retraining a refusal. Those are not stylistic preferences; each
 * one takes something away from a child. See docs/aac-clinical-constraints.md.
 *
 * Two layers:
 *   1. the phrase index below, matched against the generated answer
 *   2. the same list rendered in the UI, so a teacher sees the boundary even
 *      when the model stayed inside it
 */

/**
 * Surface forms for each forbidden action. Deliberately generous — a false
 * positive costs one regeneration; a false negative puts harmful advice about
 * a disabled child in front of the adult who will act on it.
 */
const PHRASES: Record<string, RegExp[]> = {
  resize_grid: [
    /\b(shrink|reduce|resize|smaller|decrease)\b[^.]{0,40}\b(grid|board|layout)\b/i,
    /\b(grid|board)\b[^.]{0,30}\b(4x4|3x3|2x2)\b[^.]{0,30}\b(instead|reduce|smaller)\b/i,
    /\bfewer (rows|columns|cells)\b/i,
  ],
  move_card: [
    /\b(move|relocate|reposition|shift|swap)\b[^.]{0,30}\b(card|button|symbol|cell)\b/i,
    /\bmove\b[^.]{0,20}\bto the (home|top|first) (grid|page|row)\b/i,
    /\brearrange\b[^.]{0,30}\b(board|grid|layout)\b/i,
  ],
  remove_original: [/\bremove\b[^.]{0,25}\boriginal\b/i],
  reduce_repetition: [
    /\b(reduce|discourage|stop|limit|prevent|extinguish|redirect)\b[^.]{0,40}\brepeat/i,
    /\brepetitive\b[^.]{0,30}\b(behaviou?r|problem|issue|habit)\b/i,
    /\b(discourage|stop)\b[^.]{0,20}\b(stimming|stim)\b/i,
  ],
  retrain_preference: [
    /\b(retrain|re-?teach|encourage|prompt)\b[^.]{0,40}\b(to (request|choose|accept|try))\b/i,
  ],
  reintroduce_refused_item: [/\bkeep (offering|presenting|trying)\b/i],
  treat_refusal_as_deficit: [
    /\b(refus\w+|saying no|rejects?)\b[^.]{0,30}\b(problem|concern|deficit|non-?compliance)\b/i,
  ],
  demand_output: [
    /\b(require|demand|insist|expect)\b[^.]{0,30}\b(the child|they|she|he)\b[^.]{0,20}\b(respond|answer|use|produce)\b/i,
  ],
  test_the_child: [
    /\b(test|quiz|assess|check)\b[^.]{0,25}\b(the child|whether (she|he|they) knows?)\b/i,
  ],
  demand_imitation: [/\b(have|make|get)\b[^.]{0,20}\b(the child|them)\b[^.]{0,20}\bcopy\b/i],
  blame_the_child: [
    /\bthe child (is|has) (regress|declin|deteriorat|getting worse)/i,
    /\b(she|he|they) (regressed|declined|got worse)\b/i,
  ],
  frame_as_regression: [/\bregress(ion|ing|ed)\b/i],
  demand_transfer: [/\b(insist|require)\b[^.]{0,30}\bgeneralis/i],
  drill_in_therapy: [/\bdrill\b/i, /\bmassed practice\b/i],
}

export type GuardHit = { action: string; matched: string }

export function checkForbidden(text: string, forbidden: string[]): GuardHit[] {
  const hits: GuardHit[] = []
  for (const action of forbidden) {
    for (const re of PHRASES[action] ?? []) {
      const m = text.match(re)
      if (m) {
        hits.push({ action, matched: m[0].slice(0, 90) })
        break
      }
    }
  }
  return hits
}

/**
 * Correction fed back to the model. Names what it said and what to do instead,
 * because "you violated a rule" produces a hedge, not a better answer.
 */
export function correctionPrompt(hits: GuardHit[]): string {
  const lines = hits.map((h) => `- "${h.matched}" reads as ${h.action}`)
  return [
    'Your answer contains advice that is forbidden for this finding:',
    ...lines,
    '',
    'Rewrite it. Keep every number and every citation exactly as they are — only',
    'the recommendation changes. Specifically:',
    '- Never move, swap or relocate a card the child has already learned. Motor',
    '  plans depend on buttons staying where they are. Add a COPY at a reachable',
    '  position instead, or unmask one that is already there.',
    '- Never shrink or resize the grid. Mask the neighbours of a hard-to-hit',
    '  target, or change the physical setup (keyguard, mount angle, dwell).',
    '- Never suggest reducing repetition. Repeated pressing is exploration,',
    '  motor learning, gestalt processing or self-regulation. If it clusters',
    '  where vocabulary is thin, treat it as a MISSING WORD.',
    '- Never treat a refusal as a deficit. Saying no is successful communication.',
    '- Never describe the child as regressing when a layout change preceded the',
    '  numbers. Say what changed and when.',
  ].join('\n')
}

/** Shown in the UI even when nothing was violated, so the boundary is visible. */
export function explainForbidden(actions: string[]): string | null {
  if (!actions.length) return null
  const human: Record<string, string> = {
    resize_grid: 'resizing the grid',
    move_card: 'moving a learned card',
    remove_original: 'removing the original card',
    reduce_repetition: 'reducing repetition',
    retrain_preference: 'retraining a preference',
    reintroduce_refused_item: 'reintroducing a refused item',
    treat_refusal_as_deficit: 'treating a refusal as a deficit',
    demand_output: 'demanding output',
    test_the_child: 'testing the child',
    demand_imitation: 'demanding imitation',
    blame_the_child: 'blaming the child',
    frame_as_regression: 'framing it as regression',
    recommend_further_layout_change: 'recommending another layout change',
    retrain_without_access_check: 'retraining before checking physical access',
    test_generalisation: 'testing generalisation',
    demand_transfer: 'demanding transfer',
    drill_in_therapy: 'drilling in therapy',
  }
  const names = actions.map((a) => human[a] ?? a.replace(/_/g, ' '))
  return `Cannot recommend: ${names.join(' · ')}`
}
