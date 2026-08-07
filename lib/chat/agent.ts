/**
 * The agent loop.
 *
 * Question -> model -> tool calls -> results -> answer, bounded at MAX_STEPS.
 * Emits events as it goes so the UI can show the tools running rather than a
 * spinner: a teacher will not act on an unattributed claim about a child, and
 * should not be asked to.
 */
import { resolveProvider, ProviderError, type ChatMessage, type ToolCall } from './provider'
import { invokeTool, metricNamesBlock, toolsForScope, type ChatScope, type ToolInvocation } from './tools'
import { checkForbidden, correctionPrompt, explainForbidden } from './guard'

// Matches what an MCP-connected desktop agent (Claude Code, ChatGPT) gets in
// practice: enough iterations to explore, compare windows, and self-correct a
// rejected argument without hitting the ceiling on honest multi-part questions.
const MAX_STEPS = 8

export type AgentEvent =
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; ok: boolean; ms: number; rowCount: number }
  | { type: 'notice'; level: string; code: string; detail: string }
  | { type: 'text'; delta: string }
  | { type: 'forbidden'; label: string }
  | { type: 'regenerated'; reason: string }
  | { type: 'done'; ms: number; steps: number; inputTokens: number; outputTokens: number }
  | { type: 'error'; message: string; retryable: boolean }

/**
 * Condensed from docs/aac-clinical-constraints.md. The full document is served
 * as an MCP resource to external clients; here it is inlined because it must be
 * in context for every single turn, and 3,600 tokens per question to say the
 * same eight things is not a good trade.
 */
const CLINICAL_RULES = `
NON-NEGOTIABLE, from AAC clinical practice. These override anything the data seems to suggest.

1. REPETITION IS COMMUNICATION, NOT ERROR. Repeated pressing has four normal causes:
   saying something there is no word for, learning where a button is, gestalt language
   processing, and self-regulation. Never suggest reducing it. If repetition is high
   where vocabulary is thin, that is a MISSING WORD, not a mistake.
2. NEVER MOVE OR RESIZE. Motor plans depend on buttons staying where they are. To surface
   a buried word, ADD A COPY. To simplify a page, MASK neighbours. Never relocate, never
   shrink the grid.
3. A REFUSAL IS SUCCESSFUL COMMUNICATION. A child who never requests something while
   actively saying "no" has a preference, not a gap. Never route that to retraining.
4. CORE WORDS ARE NEVER DEAD WEIGHT. An unused core word is a modelling target. Only
   fringe vocabulary is ever a candidate for replacement.
5. SLOW MAY BE THE ADULT. AAC output runs about 15 words per minute. Before calling a
   child slow or unresponsive, check partner wait time.
6. MODEL WITHOUT EXPECTATION. Never recommend testing the child, demanding output, or
   requiring imitation.
7. MOST FINDINGS POINT AT AN ADULT. Phrase actions for the grown-up. I8 points at us —
   if our own layout advice preceded a decline, say so plainly.
8. NEVER SAY A CHILD REGRESSED when a layout change or an absence explains the numbers.
   Name what changed and when.

READING THE DATA
- A null value with n>0 means below min_n: measured, too few to report. NOT zero.
- A null value with n=0 means never measured. Draw no conclusion from it.
- direction "not_applicable" means the metric is neutral. Never call it good or bad.
- Read the "guidance" array in every tool result BEFORE the numbers.
- Thresholds are given to you, not applied for you. A rule that fired just over its line
  deserves hedging, not confidence.
`.trim()

function systemPrompt(scope: ChatScope): string {
  const isParent = scope.viewer.role === 'parent'
  const names = scope.children.map((c) => `${c.display_name} (${c.child_id})`).join(', ')
  const focus = scope.focusChildId
    ? scope.children.find((c) => c.child_id === scope.focusChildId)
    : undefined

  const register = isParent
    ? `You are talking to a PARENT about their own child.
- Plain language. No clinical shorthand: say "presses she did not mean" rather than
  "unintended activations", "how many buttons it takes to say something" rather than
  "taps per utterance".
- Growth framing. Lead with what is working before what needs attention.
- Never imply their child is behind. Compare the child only to their own past.
- The same numbers and the same caveats as anyone else gets. Warmth is in the wording,
  never in withholding or softening a fact.`
    : `You are talking to a TEACHER or SPEECH THERAPIST.
- Clinical terms are fine; they know them.
- Be direct about what the evidence supports and where it is thin.
- Actions are for the adult, not for the child to perform.`

  // Local date, not toISOString(): the rollups bucket by server-local day, and
  // UTC is yesterday for half of every day in this timezone (NZ, UTC+12).
  const today = new Date().toLocaleDateString('en-CA')

  return [
    `You answer questions about AAC (augmentative and alternative communication) use by
children with communication difficulties, using only the tools provided.`,
    '',
    `TODAY is ${today}. Recorded data ends at or near today and begins a few weeks
earlier — never query years in the past. Prefer the tools' named windows
(last_7d, last_14d, last_28d) over guessed custom dates; when a custom range is
unavoidable, anchor it to today.`,
    '',
    register,
    '',
    `SCOPE. You can see: ${names || 'no children'}.` +
      (focus ? ` This conversation is about ${focus.display_name}.` : '') +
      ` You cannot see any other child, and you must not speculate about one.`,
    '',
    CLINICAL_RULES,
    '',
    `METRIC NAMES — how each metric is written for a reader. Machine ids are for TOOL
CALLS ONLY; a raw snake_case id in an answer is a defect.
${metricNamesBlock()}`,
    '',
    `HOW TO ANSWER
- Call tools before answering. Never state a number you did not retrieve.
- Cite dates and values inline. "5.8% before 30 July, 14.3% after" beats "worse lately".
- Plain names, never ids: write "Where corrections land", not correction_adjacent_rate.
  In a table or list where exactness matters, the id may follow the name in
  parentheses — never the other way round, and never an id alone.
- If a question uses vague words ("speed", "progress", "errors"), silently map them to
  the named metrics above and answer with those — no extra questions, no jargon back.
- If no rule fired and the numbers are unremarkable, say so. Inventing a concern is worse
  than a boring answer.
- If a tool returns an error, read it and try a corrected call.
- Keep it short. Three or four sentences plus the evidence, unless asked for more.`,
  ].join('\n')
}

export async function* runAgent(
  scope: ChatScope,
  history: { role: 'user' | 'assistant'; content: string }[],
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const started = performance.now()
  let inputTokens = 0
  let outputTokens = 0
  let steps = 0

  const forbiddenSeen = new Set<string>()
  const noticesSeen = new Set<string>()

  try {
    const provider = await resolveProvider()
    const tools = toolsForScope(scope)

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt(scope) },
      ...history.map((h) => ({ role: h.role, content: h.content }) as ChatMessage),
    ]

    let answer = ''

    for (steps = 1; steps <= MAX_STEPS; steps++) {
      let text = ''
      let calls: ToolCall[] = []

      for await (const chunk of provider.send(messages, tools, signal)) {
        if (chunk.type === 'text') {
          text += chunk.delta
          yield { type: 'text', delta: chunk.delta }
        } else if (chunk.type === 'tool_calls') {
          calls = chunk.calls
        } else if (chunk.type === 'usage') {
          inputTokens += chunk.inputTokens
          outputTokens += chunk.outputTokens
        }
      }

      if (!calls.length) {
        answer = text
        break
      }

      // The model asked for tools. Record the turn, run them, feed results back.
      messages.push({ role: 'assistant', content: text || null, toolCalls: calls })

      for (const call of calls) {
        yield { type: 'tool_call', name: call.name, args: call.args }
        const result: ToolInvocation = invokeTool(scope, call.name, call.args)
        yield {
          type: 'tool_result',
          name: call.name, ok: result.ok,
          ms: Math.round(result.ms), rowCount: result.rowCount,
        }
        for (const g of result.guidance) {
          const key = `${g.code}:${g.detail.slice(0, 40)}`
          if (!noticesSeen.has(key)) {
            noticesSeen.add(key)
            yield { type: 'notice', level: g.level, code: g.code, detail: g.detail }
          }
        }
        for (const a of result.forbiddenActions) forbiddenSeen.add(a)
        messages.push({
          role: 'tool', toolCallId: call.id, name: call.name, content: result.resultJson,
        })
      }

      if (steps === MAX_STEPS) {
        // Out of iterations with tools still pending. Ask for a summary of what
        // was found rather than returning nothing.
        messages.push({
          role: 'user',
          content:
            'You have used all available tool calls. Answer now from what you have, ' +
            'and say plainly which part of the question you could not check.',
        })
        for await (const chunk of provider.send(messages, [], signal)) {
          if (chunk.type === 'text') {
            answer += chunk.delta
            yield { type: 'text', delta: chunk.delta }
          } else if (chunk.type === 'usage') {
            inputTokens += chunk.inputTokens
            outputTokens += chunk.outputTokens
          }
        }
      }
    }

    // ---- the guard. A prompt instruction is a request; this is a check. -----
    const forbidden = [...forbiddenSeen]
    const hits = checkForbidden(answer, forbidden)
    if (hits.length) {
      yield {
        type: 'regenerated',
        reason: `The first answer recommended ${hits.map((h) => h.action).join(', ')}.`,
      }
      messages.push({ role: 'assistant', content: answer })
      messages.push({ role: 'user', content: correctionPrompt(hits) })

      let rewritten = ''
      for await (const chunk of provider.send(messages, [], signal)) {
        if (chunk.type === 'text') {
          rewritten += chunk.delta
          yield { type: 'text', delta: chunk.delta }
        } else if (chunk.type === 'usage') {
          inputTokens += chunk.inputTokens
          outputTokens += chunk.outputTokens
        }
      }
      // Still violating after one correction: stop rather than ship it.
      if (checkForbidden(rewritten, forbidden).length) {
        yield {
          type: 'error',
          message:
            'The answer kept recommending something AAC practice rules out, so it has ' +
            'been withheld. The evidence above stands; the recommendation does not.',
          retryable: true,
        }
      }
    }

    const label = explainForbidden(forbidden)
    if (label) yield { type: 'forbidden', label }

    yield {
      type: 'done',
      ms: Math.round(performance.now() - started),
      steps, inputTokens, outputTokens,
    }
  } catch (err) {
    const e = err as ProviderError
    yield {
      type: 'error',
      message: e.message ?? 'The assistant failed.',
      retryable: e.retryable ?? false,
    }
  }
}
