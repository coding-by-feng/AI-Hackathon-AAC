/**
 * Six chart types, hand-rolled as inline SVG.
 *
 * No charting library. These are simple shapes — a line is a polyline, a donut
 * is two circles with stroke-dasharray, a calendar is a grid of rects — and
 * Recharts would add ~500KB of d3 internals to a dashboard that may be opened
 * on school wifi. The existing Sparkline in ui.tsx already works this way.
 *
 * No tooltips, deliberately. Every card states its number in text above the
 * chart, which is better for this audience than hiding it behind a hover: a
 * therapist reading "3.2 words" should not have to point at a bar to learn it.
 */

type Pt = { label: string; value: number | null }

const AXIS = 'var(--color-line)'
const INK = 'var(--color-ink-faint)'

/** Shared: turn values into y-coordinates with a little headroom. */
function scale(values: number[], h: number, pad = 4) {
  const nums = values.filter((v) => Number.isFinite(v))
  const max = nums.length ? Math.max(...nums) : 1
  const min = Math.min(0, ...nums)
  const span = max - min || 1
  return (v: number) => h - pad - ((v - min) / span) * (h - pad * 2)
}

// ---------------------------------------------------------------------------
// 线形图 — line
// ---------------------------------------------------------------------------

export function LineChart({ points, height = 64, color = 'var(--color-accent)' }: {
  points: Pt[]; height?: number; color?: string
}) {
  if (points.length < 2) return <Empty height={height} />
  const w = 100
  const y = scale(points.map((p) => p.value ?? 0), height)
  const step = w / (points.length - 1)
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${y(p.value ?? 0).toFixed(1)}`)
    .join(' ')
  const area = `${d} L${w},${height} L0,${height} Z`
  const last = points[points.length - 1]

  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" preserveAspectRatio="none"
         role="img" aria-label={`Trend ending at ${last.value ?? 'no data'}`}>
      <path d={area} fill={color} opacity={0.12} />
      <path d={d} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      <circle cx={w} cy={y(last.value ?? 0)} r={2.5} fill={color} />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// 条形图 — bar
// ---------------------------------------------------------------------------

export function BarChart({ points, height = 64, color = 'var(--color-accent)' }: {
  points: Pt[]; height?: number; color?: string
}) {
  if (!points.length) return <Empty height={height} />
  const w = 100
  const y = scale(points.map((p) => p.value ?? 0), height)
  const gap = 2
  const bw = Math.max(1, w / points.length - gap)

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full" preserveAspectRatio="none" role="img">
        {points.map((p, i) => {
          const top = y(p.value ?? 0)
          return (
            <rect key={i} x={i * (bw + gap)} y={top} width={bw} height={Math.max(1, height - top)}
                  fill={color} opacity={p.value === null ? 0.15 : 0.85} rx={1} />
          )
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[9px]" style={{ color: INK }}>
        {points.length > 1 && <span>{points[0].label}</span>}
        <span>{points[points.length - 1].label}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 环形图 — donut
// ---------------------------------------------------------------------------

export function DonutChart({ slices, size = 88 }: {
  slices: { label: string; value: number; color: string }[]
  size?: number
}) {
  const total = slices.reduce((s, x) => s + x.value, 0)
  if (!total) return <Empty height={size} />
  const r = 32
  const c = 2 * Math.PI * r
  let offset = 0

  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 80 80" width={size} height={size} role="img"
           aria-label={slices.map((s) => `${s.label} ${Math.round((s.value / total) * 100)}%`).join(', ')}>
        <g transform="rotate(-90 40 40)">
          {slices.map((s, i) => {
            const frac = s.value / total
            const el = (
              <circle key={i} cx={40} cy={40} r={r} fill="none" stroke={s.color} strokeWidth={12}
                      strokeDasharray={`${(frac * c).toFixed(2)} ${c.toFixed(2)}`}
                      strokeDashoffset={-offset} />
            )
            offset += frac * c
            return el
          })}
        </g>
      </svg>
      <ul className="space-y-0.5 text-xs">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
            <span className="tabular-nums">{Math.round((s.value / total) * 100)}%</span>
            <span className="text-[var(--color-ink-muted)]">{s.label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Split bar — deliberately NOT a gauge.
//
// A gauge has a good end. "Answers vs starts a topic" does not: starting a
// topic is a higher-order skill, but a child who answers well is communicating
// too. Rendering it as a gauge would silently restore the judgement that
// renaming the metric removed.
// ---------------------------------------------------------------------------

export function SplitBar({ left, right, color = 'var(--color-accent)' }: {
  left: { label: string; value: number }
  right: { label: string; value: number }
  /** ONE colour for BOTH sides — two colours would quietly rank them. */
  color?: string
}) {
  const total = left.value + right.value
  if (!total) return <Empty height={34} />
  const pct = Math.round((left.value / total) * 100)

  const row = (label: string, value: number) => (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-24 shrink-0 truncate text-[var(--color-ink-muted)]" title={label}>
        {label}
      </span>
      <span className="h-3 flex-1 overflow-hidden rounded-sm bg-[var(--color-surface-sunk)]">
        <span
          className="block h-full rounded-sm"
          style={{ width: `${Math.max(2, value)}%`, background: color, opacity: 0.85 }}
        />
      </span>
      <span className="w-9 shrink-0 text-right font-medium tabular-nums">{value}%</span>
    </div>
  )

  return (
    <div className="space-y-1.5">
      {row(left.label, pct)}
      {row(right.label, 100 - pct)}
      <p className="text-[10px] text-[var(--color-ink-faint)]">Neither one is better.</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 热力图 — calendar, GitHub-contributions style
//
// Day x intensity across the whole period. NOT the same as heat-grid.tsx, which
// is rows x columns of the AAC board — both are heatmaps, different subjects.
// ---------------------------------------------------------------------------

export function CalendarHeat({ days, weeks = 7 }: {
  days: { day: string; value: number }[]; weeks?: number
}) {
  if (!days.length) return <Empty height={70} />
  const max = Math.max(...days.map((d) => d.value), 1)

  // Pad to a whole week so columns line up with weekdays.
  const first = new Date(days[0].day + 'T00:00:00Z').getUTCDay()
  const cells: ({ day: string; value: number } | null)[] = [
    ...Array(first).fill(null), ...days,
  ]
  const cols = Math.min(weeks, Math.ceil(cells.length / 7))
  const size = 11
  const gap = 3

  const shade = (v: number) => {
    if (v <= 0) return 'var(--color-surface-sunk)'
    const t = Math.min(1, v / max)
    return `color-mix(in oklab, var(--color-accent) ${Math.round(18 + t * 82)}%, transparent)`
  }

  return (
    <div>
      <svg width={cols * (size + gap)} height={7 * (size + gap)} role="img"
           aria-label={`Daily use over ${days.length} days`} className="max-w-full">
        {cells.slice(0, cols * 7).map((c, i) => {
          const col = Math.floor(i / 7)
          const rw = i % 7
          return (
            <rect key={i} x={col * (size + gap)} y={rw * (size + gap)}
                  width={size} height={size} rx={2}
                  fill={c ? shade(c.value) : 'transparent'} />
          )
        })}
      </svg>
      <div className="mt-1 flex items-center gap-1 text-[9px]" style={{ color: INK }}>
        <span>quiet</span>
        {[0, 0.3, 0.6, 1].map((t) => (
          <span key={t} className="inline-block h-2 w-2 rounded-[2px]"
                style={{ background: shade(t * max) }} />
        ))}
        <span>busy</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 散点图 — scatter, used for sentence shapes
//
// x = developmental stage, y = how often it appeared. Structures that are
// PRESENT are plotted; nothing is drawn for what is absent, because a structure
// the board cannot express is not a fact about the child.
// ---------------------------------------------------------------------------

export function ScatterChart({ points, height = 72 }: {
  points: { x: number; y: number; label: string }[]; height?: number
}) {
  if (!points.length) return <Empty height={height} />
  const w = 100
  const maxX = Math.max(...points.map((p) => p.x), 3)
  const maxY = Math.max(...points.map((p) => p.y), 1)

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full" preserveAspectRatio="none" role="img">
        <line x1={0} y1={height - 1} x2={w} y2={height - 1} stroke={AXIS} strokeWidth={1}
              vectorEffect="non-scaling-stroke" />
        {points.map((p, i) => (
          <circle key={i}
                  cx={8 + (p.x / (maxX + 1)) * (w - 16)}
                  cy={height - 6 - (p.y / maxY) * (height - 16)}
                  r={Math.max(2.5, Math.min(6, 2 + (p.y / maxY) * 4))}
                  fill="var(--color-accent)" opacity={0.75} />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[9px]" style={{ color: INK }}>
        <span>simpler</span><span>more complex</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Table — for word pairs
// ---------------------------------------------------------------------------

export function PairTable({ rows }: {
  rows: { word_a: string; word_b: string; solo_a: number; solo_b: number }[]
}) {
  if (!rows.length) {
    return <p className="text-xs text-[var(--color-ink-muted)]">
      No pairs like this right now — she is combining the words she uses most.
    </p>
  }
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--color-ink-faint)]">
          <th className="pb-1 font-medium">Pair</th>
          <th className="pb-1 text-right font-medium">Used apart</th>
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, 4).map((r) => (
          <tr key={`${r.word_a}-${r.word_b}`} className="border-t border-[var(--color-line)]">
            <td className="py-1">{r.word_a} <span className="text-[var(--color-ink-faint)]">+</span> {r.word_b}</td>
            <td className="py-1 text-right tabular-nums text-[var(--color-ink-muted)]">
              {r.solo_a} · {r.solo_b}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ---------------------------------------------------------------------------
// Board grid heat — rows x columns of the AAC board itself.
//
// NOT the calendar above. Both are heatmaps; this one is about WHERE on the
// board, and the two must never be compared across different grid sizes
// because the coordinates mean different things.
//
// A reach problem shows as a GRADIENT down the rows, not as one hot cell, so
// the row summary on the right is the part worth reading.
// ---------------------------------------------------------------------------

export function GridHeat({ rows, cols, cells }: {
  rows: number; cols: number
  cells: { row: number; col: number; taps: number; mistaps: number; label?: string }[]
}) {
  if (!cells.length) return <Empty height={70} />
  const maxTaps = Math.max(...cells.map((c) => c.taps), 1)
  const at = new Map(cells.map((c) => [`${c.row},${c.col}`, c]))

  const byRow = Array.from({ length: rows }, (_, r) => {
    const rc = cells.filter((c) => c.row === r)
    const taps = rc.reduce((s, c) => s + c.taps, 0)
    const mis = rc.reduce((s, c) => s + c.mistaps, 0)
    return { r, taps, err: mis / Math.max(taps + mis, 1) }
  })
  const worst = Math.max(...byRow.map((b) => b.err), 0)

  const size = 15
  const gap = 3

  // Where presses land is a NEUTRAL metric: accent shades and greys only.
  // The row with the most misses is emphasised by weight, never by a warning
  // colour — a red row would read as the child doing something wrong.
  return (
    <div className="flex items-start gap-3">
      <svg width={cols * (size + gap)} height={rows * (size + gap)} role="img"
           aria-label={`${rows} by ${cols} board, shaded by use`} className="shrink-0">
        {Array.from({ length: rows * cols }, (_, i) => {
          const r = Math.floor(i / cols)
          const col = i % cols
          const c = at.get(`${r},${col}`)
          const t = c ? c.taps / maxTaps : 0
          return (
            <rect key={i} x={col * (size + gap)} y={r * (size + gap)}
                  width={size} height={size} rx={2}
                  fill={c
                    ? `color-mix(in oklab, var(--color-accent) ${Math.round(12 + t * 88)}%, transparent)`
                    : 'var(--color-surface-sunk)'} />
          )
        })}
      </svg>
      <ul className="space-y-0.5 text-[10px]">
        {byRow.map((b) => (
          <li key={b.r} className="flex items-center gap-1.5 tabular-nums">
            <span className="text-[var(--color-ink-faint)]">row {b.r + 1}</span>
            <span className={b.err === worst && worst > 0.12
              ? 'font-medium text-[var(--color-ink)]' : 'text-[var(--color-ink-muted)]'}>
              {Math.round(b.err * 100)}% missed
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ranked bar list — top cards. Horizontal, because the labels are words and a
// vertical bar chart would turn them sideways.
// ---------------------------------------------------------------------------

export function RankedBars({ items }: {
  items: { label: string; value: number; muted?: boolean }[]
}) {
  if (!items.length) return <Empty height={70} />
  const max = Math.max(...items.map((i) => i.value), 1)
  return (
    <ul className="space-y-1">
      {items.slice(0, 6).map((i) => (
        <li key={i.label} className="flex items-center gap-2 text-xs">
          <span className="w-16 shrink-0 truncate" title={i.label}>{i.label}</span>
          <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-sunk)]">
            <span className="block h-full rounded-full"
                  style={{
                    width: `${Math.max(3, (i.value / max) * 100)}%`,
                    background: i.muted ? 'var(--color-neutral)' : 'var(--color-accent)',
                  }} />
          </span>
          <span className="w-8 shrink-0 text-right tabular-nums text-[var(--color-ink-muted)]">
            {i.value}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Empty({ height }: { height: number }) {
  return (
    <div className="flex items-center justify-center text-[10px] text-[var(--color-ink-faint)]"
         style={{ height }}>
      not enough yet
    </div>
  )
}
