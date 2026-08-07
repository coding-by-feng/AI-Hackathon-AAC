/**
 * JSON Schema -> provider dialect.
 *
 * Not cosmetic. Our tool schemas in mcp/tools.ts use keywords Gemini rejects
 * outright, so a pass-through adapter fails on the first call:
 *
 *   keyword            OpenAI   Gemini
 *   ---------------    ------   -----------------------------
 *   enum (string)      ok       ok
 *   minimum/maximum    ok       rejected
 *   maxItems/minItems  ok       rejected
 *   additionalProps    ok       rejected
 *   missing `type`     tolerated  rejected
 *
 * Stripping a constraint does not mean abandoning it — `validateArgs` below
 * re-checks every one of them server-side before a tool runs. Neither provider
 * guarantees schema compliance anyway, so that check has to exist regardless;
 * Gemini just makes it load-bearing.
 */
import type { ToolDef } from './provider'

type Schema = Record<string, any>

// Everything Gemini's function-declaration schema accepts. Anything else is
// dropped from what the model sees and enforced by validateArgs instead.
const GEMINI_ALLOWED = new Set([
  'type', 'description', 'properties', 'required', 'items', 'enum', 'nullable', 'format',
])

const GEMINI_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object'])

export function toOpenAITools(tools: ToolDef[]) {
  return tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))
}

export function toGeminiTools(tools: ToolDef[]) {
  return [{
    functionDeclarations: tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: geminiSchema(t.parameters),
    })),
  }]
}

function geminiSchema(schema: Schema): Schema {
  const out: Schema = {}
  for (const [key, value] of Object.entries(schema)) {
    if (!GEMINI_ALLOWED.has(key)) continue
    if (key === 'properties' && value && typeof value === 'object') {
      out.properties = Object.fromEntries(
        Object.entries(value as Schema).map(([k, v]) => [k, geminiSchema(v as Schema)]),
      )
    } else if (key === 'items' && value && typeof value === 'object') {
      out.items = geminiSchema(value as Schema)
    } else {
      out[key] = value
    }
  }
  // Gemini rejects a property with no declared type. Ours all have one, but a
  // future tool author will forget, and a 400 from the API is a much worse
  // place to discover it than here.
  if (!out.type) out.type = out.properties ? 'object' : 'string'
  if (!GEMINI_TYPES.has(out.type)) out.type = 'string'
  return out
}

// Validation lives in mcp/validate.ts so the stdio server and the chat path
// enforce one contract. A tool that is strict in one entry point and lax in the
// other is worse than a tool with no validation at all.
export { validateArgs, type ValidationError } from '../../mcp/validate.ts'
