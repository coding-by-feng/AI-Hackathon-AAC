/**
 * Argument validation for tool calls.
 *
 * This exists because of a specific failure: `get_metrics(group_by: "scene")`
 * and `get_metric_timeseries(granularity: "week")` were both accepted and
 * silently dropped. The caller asked for a breakdown, got one blended number,
 * and had no way to know. A model does not retry an answer it believes it got.
 *
 * So: an argument the schema does not describe is an ERROR, never a shrug.
 *
 * Shared by the stdio server and the in-process chat path, so both enforce the
 * same contract — a tool cannot be strict in one entry point and lax in the other.
 */

export type Schema = Record<string, any>
export type ValidationError = { path: string; message: string }
export type ValidationResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; errors: ValidationError[] }

export function validateArgs(schema: Schema, args: Record<string, unknown>): ValidationResult {
  const errors: ValidationError[] = []
  const out: Record<string, unknown> = {}
  const props: Schema = schema?.properties ?? {}
  const required: string[] = schema?.required ?? []
  const known = Object.keys(props)

  // THE FIX. Naming the near-miss matters: a model that gets
  // "unknown parameter 'groupby'" and a list of real ones self-corrects in one
  // retry; "invalid arguments" makes it guess again.
  for (const key of Object.keys(args)) {
    if (key in props) continue
    const hint = nearest(key, known)
    errors.push({
      path: key,
      message:
        `unknown parameter '${key}'` +
        (hint ? `. Did you mean '${hint}'?` : `. Accepted: ${known.join(', ') || 'none'}`),
    })
  }

  for (const key of required) {
    if (args[key] === undefined || args[key] === null) {
      errors.push({ path: key, message: `missing required parameter '${key}'` })
    }
  }

  for (const [key, spec] of Object.entries(props)) {
    const raw = args[key]
    if (raw === undefined || raw === null) continue
    const s = spec as Schema
    let v: unknown = raw

    if (s.type === 'integer' || s.type === 'number') {
      const n = typeof v === 'string' ? Number(v) : v
      if (typeof n !== 'number' || Number.isNaN(n)) {
        errors.push({ path: key, message: `expected a number, got ${JSON.stringify(raw)}` })
        continue
      }
      if (s.type === 'integer' && !Number.isInteger(n)) {
        errors.push({ path: key, message: `expected a whole number, got ${n}` })
        continue
      }
      // Clamp rather than reject. A caller asking for limit=500 against a max
      // of 100 means "as much as you can"; failing that call helps nobody.
      let clamped = n
      if (typeof s.minimum === 'number') clamped = Math.max(clamped, s.minimum)
      if (typeof s.maximum === 'number') clamped = Math.min(clamped, s.maximum)
      v = clamped
    } else if (s.type === 'boolean') {
      if (typeof v === 'string') v = v === 'true'
      if (typeof v !== 'boolean') {
        errors.push({ path: key, message: `expected true or false, got ${JSON.stringify(raw)}` })
        continue
      }
    } else if (s.type === 'array') {
      if (!Array.isArray(v)) {
        errors.push({ path: key, message: `expected an array, got ${JSON.stringify(raw)}` })
        continue
      }
      if (typeof s.maxItems === 'number' && v.length > s.maxItems) v = v.slice(0, s.maxItems)
      const itemEnum: string[] | undefined = s.items?.enum
      if (itemEnum) {
        const bad = (v as unknown[]).filter((x) => !itemEnum.includes(String(x)))
        if (bad.length) {
          errors.push({
            path: key,
            message: `${JSON.stringify(bad)} not allowed. Allowed: ${itemEnum.join(', ')}`,
          })
          continue
        }
      }
    } else if (s.type === 'object') {
      // Nested objects (compare_windows' window_a/window_b) pass through and
      // recurse. An earlier version fell into the string branch below and
      // stringified them to "[object Object]", which SQLite then refused to bind.
      if (typeof v !== 'object' || Array.isArray(v)) {
        errors.push({ path: key, message: `expected an object, got ${JSON.stringify(raw)}` })
        continue
      }
      if (s.properties) {
        const nested = validateArgs(s, v as Record<string, unknown>)
        if (!nested.ok) {
          errors.push(...nested.errors.map((e) => ({ path: `${key}.${e.path}`, message: e.message })))
          continue
        }
        v = nested.value
      }
    } else {
      if (typeof v !== 'string') v = String(v)
      if (Array.isArray(s.enum) && !s.enum.includes(v)) {
        errors.push({
          path: key,
          message: `'${v}' is not allowed. Allowed: ${s.enum.join(', ')}`,
        })
        continue
      }
    }
    out[key] = v
  }

  return errors.length ? { ok: false, errors } : { ok: true, value: out }
}

/** Cheap edit distance, only to suggest a near-miss parameter name. */
function nearest(input: string, options: string[]): string | null {
  let best: string | null = null
  let bestScore = Infinity
  const a = input.toLowerCase().replace(/[_-]/g, '')
  for (const opt of options) {
    const b = opt.toLowerCase().replace(/[_-]/g, '')
    const d = distance(a, b)
    if (d < bestScore) { bestScore = d; best = opt }
  }
  // Only suggest when it is plausibly a typo rather than a different word.
  return bestScore <= Math.max(2, Math.floor(a.length / 3)) ? best : null
}

function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        last + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      last = tmp
    }
  }
  return prev[b.length]
}
