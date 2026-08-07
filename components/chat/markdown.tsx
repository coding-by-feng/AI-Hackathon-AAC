/**
 * Markdown for chat answers — hand-rolled on purpose.
 *
 * The model's output is untrusted input. This renderer builds React elements
 * only — there is no dangerouslySetInnerHTML and no HTML pass-through, so a
 * prompt-injected <script> renders as the literal text "<script>". That
 * property is structural, not a sanitiser to keep patched.
 *
 * Covers what a data chatbot actually emits: GFM tables, bold/italic, inline
 * code, fenced code, ordered/unordered lists, headings, blockquotes, rules,
 * and http(s) links. Everything else stays literal text. Re-parsing the
 * accumulated answer on each streamed frame is fine at chat sizes; a table
 * renders as plain lines until its separator row arrives, then snaps into
 * shape.
 */
import { Fragment, type ReactNode } from 'react'

export function Markdown({ text }: { text: string }) {
  return <div className="space-y-2 text-sm leading-relaxed">{blocks(text)}</div>
}

const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/
const HR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/
const HEADING = /^(#{1,4})\s+(.*)$/
const UL_ITEM = /^\s{0,3}[-*•]\s+(.*)$/
const OL_ITEM = /^\s{0,3}\d{1,3}[.)]\s+(.*)$/

function blocks(text: string): ReactNode[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const out: ReactNode[] = []
  let i = 0
  let key = 0

  const paragraph: string[] = []
  const flushParagraph = () => {
    if (!paragraph.length) return
    out.push(<p key={key++}>{inline(paragraph.join(' '))}</p>)
    paragraph.length = 0
  }

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) {
      flushParagraph()
      i++
      continue
    }

    // ``` fenced code — taken verbatim until the closing fence (or the end,
    // which is what a fence looks like mid-stream).
    if (line.trim().startsWith('```')) {
      flushParagraph()
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) body.push(lines[i++])
      i++ // past the closing fence
      out.push(
        <pre
          key={key++}
          className="overflow-x-auto rounded-md bg-[var(--color-surface-sunk)] p-3 font-mono text-xs leading-relaxed"
        >
          <code>{body.join('\n')}</code>
        </pre>,
      )
      continue
    }

    // GFM table: a pipe row whose NEXT line is the separator row.
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      flushParagraph()
      const header = cells(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(cells(lines[i]))
        i++
      }
      out.push(
        <div key={key++} className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {header.map((h, c) => (
                  <th
                    key={c}
                    className="border-b border-[var(--color-line)] bg-[var(--color-surface-sunk)] px-3 py-1.5 text-left text-xs font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase"
                  >
                    {inline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {header.map((_, c) => (
                    <td
                      key={c}
                      className="border-b border-[var(--color-line)] px-3 py-1.5 align-top tabular-nums"
                    >
                      {inline(r[c] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    const h = HEADING.exec(line)
    if (h) {
      flushParagraph()
      const cls =
        h[1].length <= 2 ? 'text-base font-semibold mt-2' : 'text-sm font-semibold mt-2'
      out.push(
        <p key={key++} className={cls}>
          {inline(h[2])}
        </p>,
      )
      i++
      continue
    }

    if (HR.test(line)) {
      flushParagraph()
      out.push(<hr key={key++} className="border-[var(--color-line)]" />)
      i++
      continue
    }

    if (UL_ITEM.test(line) || OL_ITEM.test(line)) {
      flushParagraph()
      const ordered = OL_ITEM.test(line)
      const re = ordered ? OL_ITEM : UL_ITEM
      const items: string[] = []
      while (i < lines.length) {
        const m = re.exec(lines[i])
        if (!m) break
        items.push(m[1])
        i++
      }
      const cls = `${ordered ? 'list-decimal' : 'list-disc'} space-y-1 pl-5`
      out.push(
        ordered ? (
          <ol key={key++} className={cls}>
            {items.map((it, n) => (
              <li key={n}>{inline(it)}</li>
            ))}
          </ol>
        ) : (
          <ul key={key++} className={cls}>
            {items.map((it, n) => (
              <li key={n}>{inline(it)}</li>
            ))}
          </ul>
        ),
      )
      continue
    }

    if (line.startsWith('>')) {
      flushParagraph()
      const quoted: string[] = []
      while (i < lines.length && lines[i].startsWith('>')) {
        quoted.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      out.push(
        <blockquote
          key={key++}
          className="border-l-2 border-[var(--color-line)] pl-3 text-[var(--color-ink-muted)]"
        >
          {inline(quoted.join(' '))}
        </blockquote>,
      )
      continue
    }

    paragraph.push(line.trim())
    i++
  }
  flushParagraph()
  return out
}

/** Split a pipe row into trimmed cells, dropping the outer empties. */
function cells(row: string): string[] {
  const parts = row.split('|').map((c) => c.trim())
  if (parts.length && parts[0] === '') parts.shift()
  if (parts.length && parts[parts.length - 1] === '') parts.pop()
  return parts
}

const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\b_[^_\n]+_\b)|(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g

/**
 * A code span that is a snake_case machine id ("taps_per_utterance").
 *
 * The system prompt tells the model to write human names, but a display layer
 * that depends on obedience is not a display layer. When one slips through,
 * render the words a person would say — "taps per utterance" — and keep the
 * raw id in the tooltip for anyone who needs the exact term.
 */
const SNAKE_ID = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/

function humanizeId(id: string): string {
  const words = id.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function inline(text: string): ReactNode {
  const out: ReactNode[] = []
  let last = 0
  let key = 0
  for (const m of text.matchAll(INLINE)) {
    const idx = m.index ?? 0
    if (idx > last) out.push(<Fragment key={key++}>{text.slice(last, idx)}</Fragment>)
    const tok = m[0]
    if (m[1]) {
      const body = tok.slice(1, -1)
      if (SNAKE_ID.test(body)) {
        out.push(
          <span key={key++} title={body} className="underline decoration-dotted decoration-[var(--color-ink-faint)] underline-offset-2">
            {humanizeId(body)}
          </span>,
        )
      } else {
        out.push(
          <code
            key={key++}
            className="rounded bg-[var(--color-surface-sunk)] px-1 py-0.5 font-mono text-[0.85em]"
          >
            {body}
          </code>,
        )
      }
    } else if (m[2]) {
      out.push(<strong key={key++}>{inline(tok.slice(2, -2))}</strong>)
    } else if (m[3] || m[4]) {
      out.push(<em key={key++}>{tok.slice(1, -1)}</em>)
    } else {
      const label = tok.slice(1, tok.indexOf(']'))
      const href = tok.slice(tok.indexOf('](') + 2, -1)
      out.push(
        <a
          key={key++}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--color-accent)] underline underline-offset-2"
        >
          {label}
        </a>,
      )
    }
    last = idx + tok.length
  }
  if (last < text.length) out.push(<Fragment key={key++}>{text.slice(last)}</Fragment>)
  return out.length === 1 ? out[0] : out
}
