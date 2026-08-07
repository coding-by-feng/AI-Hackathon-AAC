'use client'

/**
 * The Ask panel.
 *
 * The tool strip and the evidence are not debug output — they are the product.
 * A speech therapist will not act on an unattributed claim about a child, and a
 * parent should be able to see exactly which numbers produced the sentence they
 * are reading. Both are visible by default; only the raw payload is collapsed.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

type Notice = { level: string; code: string; detail: string }
type ToolRun = { name: string; ok: boolean; ms: number; rowCount: number }

type Turn = {
  role: 'user' | 'assistant'
  content: string
  tools?: ToolRun[]
  notices?: Notice[]
  forbidden?: string | null
  regenerated?: string | null
  stats?: { ms: number; steps: number; inputTokens: number; outputTokens: number }
  error?: { message: string; retryable: boolean } | null
}

const TOOL_LABELS: Record<string, string> = {
  list_children: 'children',
  get_child_profile: 'profile',
  get_metrics: 'metrics',
  get_metric_timeseries: 'trend',
  get_card_stats: 'cards',
  get_cell_heat: 'grid heat',
  get_word_pairs: 'word pairs',
  get_scene_breakdown: 'by setting',
  get_utterances: 'sentences',
  get_partner_metrics: 'partner',
  get_board_revisions: 'layout changes',
  get_fired_rules: 'findings',
  get_attention_queue: 'attention queue',
}

export function AskPanel({
  childId,
  childName,
  suggestions,
}: {
  childId?: string
  childName?: string
  suggestions: string[]
}) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns])

  const ask = useCallback(
    async (question: string) => {
      if (!question.trim() || busy) return
      setInput('')
      setBusy(true)

      const history = turns
        .filter((t) => !t.error)
        .map((t) => ({ role: t.role, content: t.content }))

      setTurns((prev) => [
        ...prev,
        { role: 'user', content: question },
        { role: 'assistant', content: '', tools: [], notices: [] },
      ])

      const controller = new AbortController()
      abortRef.current = controller

      // Mutating the last turn on every token would re-render the whole
      // transcript per character. Buffer and flush on a frame instead.
      let buffered = ''
      let raf = 0
      const patch = (fn: (t: Turn) => Turn) =>
        setTurns((prev) => {
          const next = [...prev]
          next[next.length - 1] = fn(next[next.length - 1])
          return next
        })
      const flush = () => {
        if (!buffered) return
        const chunk = buffered
        buffered = ''
        patch((t) => ({ ...t, content: t.content + chunk }))
      }

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message: question, childId, history }),
          signal: controller.signal,
        })
        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({ error: 'Request failed.' }))
          patch((t) => ({ ...t, error: { message: err.error ?? 'Request failed.', retryable: false } }))
          return
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.startsWith('data:')) continue
            const payload = line.slice(5).trim()
            if (!payload || payload === '[DONE]') continue
            let ev: any
            try { ev = JSON.parse(payload) } catch { continue }

            switch (ev.type) {
              case 'text':
                buffered += ev.delta
                if (!raf) raf = requestAnimationFrame(() => { raf = 0; flush() })
                break
              case 'tool_call':
                patch((t) => ({
                  ...t,
                  tools: [...(t.tools ?? []), { name: ev.name, ok: true, ms: 0, rowCount: 0 }],
                }))
                break
              case 'tool_result':
                patch((t) => {
                  const tools = [...(t.tools ?? [])]
                  for (let i = tools.length - 1; i >= 0; i--) {
                    if (tools[i].name === ev.name && tools[i].ms === 0) {
                      tools[i] = { name: ev.name, ok: ev.ok, ms: ev.ms, rowCount: ev.rowCount }
                      break
                    }
                  }
                  return { ...t, tools }
                })
                break
              case 'notice':
                patch((t) => ({ ...t, notices: [...(t.notices ?? []), ev] }))
                break
              case 'forbidden':
                patch((t) => ({ ...t, forbidden: ev.label }))
                break
              case 'regenerated':
                // The rewrite replaces the answer, so clear what was streamed.
                buffered = ''
                patch((t) => ({ ...t, regenerated: ev.reason, content: '' }))
                break
              case 'error':
                patch((t) => ({ ...t, error: { message: ev.message, retryable: ev.retryable } }))
                break
              case 'done':
                flush()
                patch((t) => ({ ...t, stats: ev }))
                break
            }
          }
        }
        flush()
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          patch((t) => ({ ...t, error: { message: (err as Error).message, retryable: true } }))
        }
      } finally {
        if (raf) cancelAnimationFrame(raf)
        flush()
        setBusy(false)
        abortRef.current = null
      }
    },
    [busy, childId, turns],
  )

  return (
    <div className="flex min-h-[28rem] flex-col gap-4">
      <div className="flex-1 space-y-5">
        {turns.length === 0 && (
          <div className="rounded-lg border border-dashed border-[var(--color-line)] p-6 text-sm text-[var(--color-ink-muted)]">
            <p className="mb-1 font-medium text-[var(--color-ink)]">
              Ask about {childName ?? 'the children you support'}
            </p>
            <p>
              Answers come from the same data as the rest of the dashboard, and every
              answer shows which numbers it used.
            </p>
          </div>
        )}

        {turns.map((turn, i) =>
          turn.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[85%] rounded-lg bg-[var(--color-accent-soft)] px-3 py-2 text-sm">
                {turn.content}
              </p>
            </div>
          ) : (
            <AssistantTurn key={i} turn={turn} busy={busy && i === turns.length - 1} />
          ),
        )}
        <div ref={endRef} />
      </div>

      {turns.length === 0 && suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => ask(s)}
              className="rounded-full border border-[var(--color-line)] px-3 py-1 text-xs text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunk)]"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); void ask(input) }}
        className="flex gap-2 border-t border-[var(--color-line)] pt-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
          maxLength={2000}
          placeholder={childName ? `Ask about ${childName}…` : 'Ask a question…'}
          className="flex-1 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] disabled:opacity-60"
        />
        {busy ? (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            className="rounded-md border border-[var(--color-line)] px-4 py-2 text-sm"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            Send
          </button>
        )}
      </form>
    </div>
  )
}

function AssistantTurn({ turn, busy }: { turn: Turn; busy: boolean }) {
  const tools = turn.tools ?? []
  const critical = (turn.notices ?? []).filter((n) => n.level === 'critical')
  const other = (turn.notices ?? []).filter((n) => n.level !== 'critical')

  return (
    <div className="space-y-3">
      {tools.length > 0 && (
        <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-sunk)] px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium text-[var(--color-ink-muted)]">looked at</span>
            {tools.map((t, i) => (
              <span key={i} className="inline-flex items-center gap-1">
                {i > 0 && <span className="text-[var(--color-ink-faint)]">→</span>}
                <span
                  className={
                    t.ms === 0 ? 'animate-pulse text-[var(--color-ink-faint)]'
                      : t.ok ? 'text-[var(--color-ink)]'
                      : 'text-[var(--color-alert)] line-through'
                  }
                >
                  {TOOL_LABELS[t.name] ?? t.name}
                </span>
              </span>
            ))}
          </div>
          {turn.stats && (
            <p className="mt-1 text-[var(--color-ink-faint)]">
              {tools.length} {tools.length === 1 ? 'call' : 'calls'} ·{' '}
              {(turn.stats.ms / 1000).toFixed(1)}s ·{' '}
              {(turn.stats.inputTokens + turn.stats.outputTokens).toLocaleString()} tokens
            </p>
          )}
        </div>
      )}

      {critical.map((n, i) => (
        <NoticeRow key={`c${i}`} tone="alert" code={n.code} detail={n.detail} />
      ))}

      {turn.regenerated && (
        <NoticeRow
          tone="warn"
          code="REWRITTEN"
          detail={`${turn.regenerated} It was rewritten to stay within AAC practice.`}
        />
      )}

      {turn.content && (
        <div className="space-y-2 text-sm leading-relaxed">
          {turn.content.split('\n').filter(Boolean).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      )}

      {busy && !turn.content && (
        <p className="text-sm text-[var(--color-ink-faint)]">Reading the data…</p>
      )}

      {other.map((n, i) => (
        <NoticeRow key={`o${i}`} tone="neutral" code={n.code} detail={n.detail} />
      ))}

      {turn.forbidden && (
        <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-sunk)] px-3 py-2 text-xs text-[var(--color-ink-muted)]">
          <span className="font-medium text-[var(--color-ink)]">{turn.forbidden}</span>
          <p className="mt-1">
            These are ruled out by AAC practice for this finding, not by preference.
            Moving a learned button undoes the motor pattern a child has built.
          </p>
        </div>
      )}

      {turn.error && (
        <div className="rounded-md border border-[var(--color-alert)] bg-[var(--color-alert-soft)] px-3 py-2 text-sm">
          {turn.error.message}
        </div>
      )}
    </div>
  )
}

function NoticeRow({
  tone, code, detail,
}: { tone: 'alert' | 'warn' | 'neutral'; code: string; detail: string }) {
  const cls =
    tone === 'alert'
      ? 'border-[var(--color-alert)] bg-[var(--color-alert-soft)]'
      : tone === 'warn'
        ? 'border-[var(--color-warn)] bg-[var(--color-warn-soft)]'
        : 'border-[var(--color-line)] bg-[var(--color-surface-sunk)]'
  return (
    <div className={`rounded-md border px-3 py-2 text-xs ${cls}`}>
      <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-ink-muted)]">
        {code}
      </span>
      <p className="mt-0.5 text-[var(--color-ink)]">{detail}</p>
    </div>
  )
}
