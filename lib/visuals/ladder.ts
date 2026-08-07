/**
 * How a card gets its picture.
 *
 * Five steps, cheapest first. Generation is the last resort, not the default —
 * the product claim is that AI fills gaps in a vocabulary, not that it draws
 * every symbol. If most resolutions reach step 5, the ladder is mis-tuned and
 * the dashboard's cost panel will say so.
 *
 *   1  built-in symbol set        $0    instant
 *   2  another card's picture     $0    ~1ms
 *   3  exact concept in cache     $0    ~2ms
 *   4  semantic match in cache    ~$0   ~200ms   (an embedding, not an image)
 *   5  OpenAI Images API          $$    5-15s
 *
 * Every attempt writes a `gap_detected` event recording which step resolved it.
 * Two dashboard panels — "Where her pictures come from" and "Words she reached
 * for that do not exist" — read those events and are empty until this runs.
 */
import { symbolFor } from '../icons/symbols'
import { one } from '../db'
import { ingestEvents } from '../ingest'
import { sanitizeConcept, normalizeConcept, type VisualSpec } from './sanitize'
import { buildPrompt } from './prompt'
import { generate, embed, providerModel, activeProvider, unconfiguredMessage } from './provider'
import { findExact, findSemantic, save, markUsed } from './store'

export type ResolvedBy =
  | 'icon_pack'
  | 'card_library'
  | 'hash_cache'
  | 'semantic'
  | 'generated'
  | 'failed'

export type Resolution = {
  resolvedBy: ResolvedBy
  /** Set when a built-in symbol matched — the key into the symbol set. */
  symbol?: string | null
  /** Set for cached or generated pictures — a data: URL. */
  imageData?: string | null
  /** Several options, only when freshly generated. */
  candidates?: string[]
  visualId?: string | null
  ms: number
  /** Roughly what this cost, for the dashboard. Zero for steps 1–3. */
  costUsd: number
  note: string
}

/** Rough per-image figure for the cost panel — indicative, not billing. */
const IMAGE_COST_USD = 0.02
const EMBED_COST_USD = 0.00002

export type ResolveOptions = {
  spec: VisualSpec
  childId?: string | null
  createdBy?: string | null
  /** Skip steps 1–4 when an adult explicitly asked for something new. */
  forceGenerate?: boolean
  scene?: string
}

export async function resolveVisual(opts: ResolveOptions): Promise<Resolution> {
  const started = Date.now()
  const concept = sanitizeConcept(opts.spec.concept)
  const detail = opts.spec.detail ? sanitizeConcept(opts.spec.detail) : null

  const finish = (r: Omit<Resolution, 'ms'>): Resolution => {
    const res: Resolution = { ...r, ms: Date.now() - started }
    logGap(opts, concept, res)
    return res
  }

  if (!concept) {
    return finish({ resolvedBy: 'failed', costUsd: 0, note: 'Nothing to draw' })
  }

  if (!opts.forceGenerate) {
    // 1 — the built-in set. Free, instant, and consistent with the rest of the board.
    if (symbolFor(concept)) {
      return finish({
        resolvedBy: 'icon_pack',
        symbol: concept,
        costUsd: 0,
        note: 'Already in the built-in symbol set',
      })
    }

    // 2 — a card that already carries this word.
    const existing = one<{ label: string }>(
      `SELECT label FROM cards WHERE lower(label) = ? LIMIT 1`,
      [concept],
    )
    if (existing && symbolFor(existing.label)) {
      return finish({
        resolvedBy: 'card_library',
        symbol: existing.label,
        costUsd: 0,
        note: 'Reused from another card',
      })
    }

    // 3 — exact concept, already drawn.
    const exact = findExact(concept)
    if (exact) {
      markUsed(exact.visual_id)
      return finish({
        resolvedBy: 'hash_cache',
        imageData: exact.image_data,
        visualId: exact.visual_id,
        costUsd: 0,
        note: `Reused a picture made earlier for “${exact.concept}”`,
      })
    }
  }

  // 4 — something close enough already drawn. An embedding costs a fraction of
  // an image, so asking is nearly always cheaper than drawing.
  let embedding: number[] | null = null
  if (!opts.forceGenerate) {
    try {
      embedding = await embed(concept)
      const near = findSemantic(embedding)
      if (near) {
        markUsed(near.visual.visual_id)
        return finish({
          resolvedBy: 'semantic',
          imageData: near.visual.image_data,
          visualId: near.visual.visual_id,
          costUsd: EMBED_COST_USD,
          note: `Close enough to “${near.visual.concept}” (${Math.round(near.score * 100)}%)`,
        })
      }
    } catch {
      // No embedding available: fall through and generate. A cache miss is
      // never a reason to leave a card without a picture.
    }
  }

  // 5 — genuinely new. This is the only step that costs real money.
  if (!activeProvider()) {
    return finish({ resolvedBy: 'failed', costUsd: 0, note: unconfiguredMessage() })
  }
  const prompt = buildPrompt(concept, detail)
  try {
    const images = await generate(prompt, 3)
    const stored = save({
      concept,
      prompt,
      model: providerModel(),
      imageData: images[0].dataUrl,
      embedding,
      createdBy: opts.createdBy ?? null,
    })
    return finish({
      resolvedBy: 'generated',
      imageData: images[0].dataUrl,
      candidates: images.map((i) => i.dataUrl),
      visualId: stored.visual_id,
      costUsd: IMAGE_COST_USD * images.length + (embedding ? EMBED_COST_USD : 0),
      note: 'Newly made — pick the one that reads best',
    })
  } catch (err) {
    return finish({
      resolvedBy: 'failed',
      costUsd: embedding ? EMBED_COST_USD : 0,
      note: (err as Error).message,
    })
  }
}

/**
 * Record how the picture was found.
 *
 * Written for every step, not just for generation, because the useful figure is
 * the *ratio*: what share of pictures cost nothing. Logging only the paid ones
 * would show a column of failures with no denominator.
 *
 * A logging failure never propagates — an adult must not lose a picture because
 * an audit row could not be written.
 */
function logGap(opts: ResolveOptions, concept: string, res: Resolution): void {
  if (!opts.childId) return
  try {
    const now = new Date()
    ingestEvents([
      {
        event_id: crypto.randomUUID(),
        child_id: opts.childId,
        ts: now.getTime(),
        day_local: new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
          .toISOString()
          .slice(0, 10),
        tz_offset_min: -now.getTimezoneOffset(),
        session_id: 'visual-resolve',
        scene: opts.scene ?? 'unknown',
        actor: 'adult',
        type: 'gap_detected',
        label: concept,
        payload: JSON.stringify({
          concept,
          normalizedConcept: normalizeConcept(concept),
          resolvedBy: res.resolvedBy,
          msResolve: res.ms,
          costUsd: res.costUsd || null,
        }),
      },
    ])
  } catch {
    /* auditing must never block the adult */
  }
}
