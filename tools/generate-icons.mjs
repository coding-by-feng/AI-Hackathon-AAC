/**
 * Generate an AAC icon for every vocabulary word via Vertex AI.
 *
 * Run with:  node tools/generate-icons.mjs
 *
 * Reads concepts from aac.db (cards) and aac_app.db (category_words), dedupes
 * case-insensitively, skips pure numerals, and writes 256px PNGs to
 * public/icons/ai/<slug>.png. Resumable: existing files are skipped, so an
 * interrupted run can simply be re-run. Ends by regenerating
 * lib/icons/ai-manifest.ts from whatever is on disk.
 */
import { DatabaseSync } from 'node:sqlite'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'public', 'icons', 'ai')
const MANIFEST = path.join(ROOT, 'lib', 'icons', 'ai-manifest.ts')

const MODEL = process.env.VERTEX_IMAGE_MODEL ?? 'gemini-2.5-flash-image'
const PROJECT = process.env.VERTEX_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? null

function location() {
  const loc = process.env.VERTEX_LOCATION ?? process.env.GOOGLE_CLOUD_LOCATION ?? ''
  return loc && loc !== 'global' ? loc : 'us-central1'
}

const CONCURRENCY = 3
const STAGGER_MS = 300

/* ---------------------------------------------------------------- prompt --
 * Mirrors lib/visuals/prompt.ts buildPrompt(concept, null) — copied rather
 * than imported so this stays a plain .mjs with no TS toolchain involved.
 */
function buildPrompt(concept) {
  return [
    `A single AAC communication symbol representing: ${concept}.`,
    '',
    'Style: flat vector illustration with clean bold outlines and simple shapes. ' +
      'plain solid off-white background. minimal detail, no shading, no gradients, no texture.',
    'One clear subject, centred, filling most of the frame.',
    'Instantly recognisable at the size of a thumbnail.',
    '',
    'Must not contain: any text, letters, numbers, words or labels;',
    'speech bubbles; logos or watermarks; borders or frames;',
    'more than one main object; background scenery; people unless the concept',
    'itself is a person.',
    '',
    'This is a picture a child who cannot read will use to speak.',
    'It has to be understood without any words at all.',
  ].join('\n')
}

/* ------------------------------------------------------------------ vocab */
function slugify(label) {
  return label
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
}

function readConcepts() {
  const byKey = new Map()
  const add = (label) => {
    const trimmed = String(label ?? '').trim()
    if (!trimmed) return
    if (/^\d+$/.test(trimmed)) return // digits render as digits, no icon needed
    const key = trimmed.toLowerCase()
    if (!byKey.has(key)) byKey.set(key, trimmed)
  }

  const cardsDb = new DatabaseSync(path.join(ROOT, 'aac.db'), { readOnly: true })
  for (const row of cardsDb.prepare('SELECT card_id, label FROM cards').all()) add(row.label)
  cardsDb.close()

  const appDb = new DatabaseSync(path.join(ROOT, 'aac_app.db'), { readOnly: true })
  for (const row of appDb.prepare('SELECT label FROM category_words').all()) add(row.label)
  appDb.close()

  return [...byKey.values()]
}

/* ----------------------------------------------------------------- vertex */
let tokenCache = null

async function accessToken() {
  if (tokenCache && tokenCache.expires > Date.now()) return tokenCache.token
  const { stdout } = await run('gcloud', ['auth', 'print-access-token'], { timeout: 15_000 })
  const token = stdout.trim()
  if (!token) throw new Error('gcloud returned no access token')
  tokenCache = { token, expires: Date.now() + 45 * 60 * 1000 }
  return token
}

async function generateOnce(prompt) {
  const loc = location()
  const token = await accessToken()
  const res = await fetch(
    `https://${loc}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${loc}/publishers/google/models/${MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
    },
  )

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const err = new Error(`Vertex ${res.status}: ${body.slice(0, 200)}`)
    err.status = res.status
    throw err
  }

  const json = await res.json()
  for (const part of json.candidates?.[0]?.content?.parts ?? []) {
    if (part.inlineData?.data) return Buffer.from(part.inlineData.data, 'base64')
  }
  throw new Error('Vertex returned no image data')
}

async function generateWithRetry(prompt) {
  let attempt = 0
  for (;;) {
    try {
      return await generateOnce(prompt)
    } catch (err) {
      if (err.status === 429 && attempt < 2) {
        attempt += 1
        await sleep(15_000)
        continue
      }
      throw err
    }
  }
}

/* ------------------------------------------------------------------ image */
async function writeIcon(slug, pngBytes) {
  const tmp = path.join(OUT_DIR, `.${slug}.1024.tmp.png`)
  const out = path.join(OUT_DIR, `${slug}.png`)
  await writeFile(tmp, pngBytes)
  try {
    await run('sips', ['-Z', '256', '-s', 'format', 'png', tmp, '--out', out], {
      timeout: 30_000,
    })
  } finally {
    await unlink(tmp).catch(() => {})
  }
  const info = await stat(out)
  if (info.size < 1024) throw new Error(`downscaled file suspiciously small (${info.size}B)`)
  return info.size
}

/* --------------------------------------------------------------- manifest */
async function writeManifest() {
  const files = (await readdir(OUT_DIR)).filter((f) => f.endsWith('.png') && !f.startsWith('.'))
  files.sort()
  const entries = files
    .map((f) => {
      const slug = f.replace(/\.png$/, '')
      return `  '${slug}': '/icons/ai/${slug}.png',`
    })
    .join('\n')

  const content = `/**
 * GENERATED by tools/generate-icons.mjs — do not edit by hand.
 * Maps vocabulary slugs to AI-generated icon paths under public/icons/ai/.
 * Regenerate by running:  node tools/generate-icons.mjs
 */

export const AI_ICONS: Record<string, string> = {
${entries}
}

function slugify(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/\\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
}

/** Case-insensitive lookup: the icon path for a label, or null if none exists. */
export function aiIconFor(label: string): string | null {
  return AI_ICONS[slugify(label)] ?? null
}
`
  await writeFile(MANIFEST, content)
  return files.length
}

/* -------------------------------------------------------------------- run */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  if (!PROJECT) {
    console.error('GOOGLE_CLOUD_PROJECT / VERTEX_PROJECT is not set — cannot reach Vertex AI.')
    process.exit(1)
  }

  await mkdir(OUT_DIR, { recursive: true })

  const concepts = readConcepts()
  console.log(`${concepts.length} concepts (project ${PROJECT}, location ${location()}, model ${MODEL})`)

  const counters = { generated: 0, skipped: 0, failed: 0 }
  const failures = []
  let index = 0

  const worker = async (workerId) => {
    await sleep(workerId * STAGGER_MS)
    for (;;) {
      const i = index
      index += 1
      if (i >= concepts.length) return
      const label = concepts[i]
      const slug = slugify(label)
      const out = path.join(OUT_DIR, `${slug}.png`)

      if (existsSync(out)) {
        counters.skipped += 1
        console.log(`[${i + 1}/${concepts.length}] skip   ${label} (exists)`)
        continue
      }

      try {
        const png = await generateWithRetry(buildPrompt(label))
        const size = await writeIcon(slug, png)
        counters.generated += 1
        console.log(`[${i + 1}/${concepts.length}] ok     ${label} -> ${slug}.png (${(size / 1024).toFixed(0)}KB)`)
      } catch (err) {
        counters.failed += 1
        failures.push(label)
        console.log(`[${i + 1}/${concepts.length}] FAIL   ${label}: ${String(err.message).slice(0, 160)}`)
      }
      await sleep(STAGGER_MS)
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, id) => worker(id)))

  const manifestCount = await writeManifest()

  console.log('')
  console.log(`generated ${counters.generated} · skipped ${counters.skipped} · failed ${counters.failed}`)
  console.log(`manifest: ${manifestCount} icons -> lib/icons/ai-manifest.ts`)
  if (failures.length) console.log(`failed concepts: ${failures.join(', ')}`)
}

main().catch((err) => {
  console.error('fatal:', err)
  process.exit(1)
})
