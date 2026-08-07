import type { HeatGrid as HeatGridData } from '@/lib/metrics'
import { Pill } from './ui'

/**
 * The two heat maps, always rendered as a pair.
 *
 * Either map alone is misleading. Together they separate the two things that
 * look identical in a totals table: a word the child does not know, and a
 * button the child cannot physically reach. A cold cell surrounded by errors is
 * the second, and the intervention for the second is completely different.
 *
 * Keyed to the robust board only. Modes hold no coordinates of their own
 * (clinical constraint C4), and merging two grid sizes would make the same
 * coordinate mean two different buttons.
 */
export function HeatGridPair({ grid }: { grid: HeatGridData }) {
  const maxTaps = Math.max(1, ...grid.cells.map((c) => c.taps))
  const maxMis = Math.max(1, ...grid.cells.map((c) => c.mistaps))

  const dead = grid.cells.filter((c) => c.taps === 0 && !c.masked)
  const errorHot = grid.cells.filter((c) => c.mistaps >= Math.max(2, maxMis * 0.6))

  // A dead cell that neighbours a high-error cell is the reach signature.
  const reachSuspects = dead.filter((d) =>
    errorHot.some(
      (e) => Math.abs(e.grid_row - d.grid_row) <= 1 && Math.abs(e.grid_col - d.grid_col) <= 1,
    ),
  )

  return (
    <div className="space-y-5">
      {grid.resizedInWindow && (
        <p className="rounded-md border-l-2 border-[var(--color-alert)] bg-[var(--color-alert-soft)] px-3 py-2 text-sm">
          The grid was resized inside this window. Cell positions before and after mean different
          buttons, so these two maps are not comparable across that date.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Grid
          title="Where she presses"
          caption="Successful presses per cell"
          grid={grid}
          value={(c) => c.taps}
          max={maxTaps}
          hue="accent"
        />
        <Grid
          title="Where presses go wrong"
          caption="Pressed, then undone within 1.5 s"
          grid={grid}
          value={(c) => c.mistaps}
          max={maxMis}
          hue="alert"
        />
      </div>

      {reachSuspects.length > 0 && (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-warn)] bg-[var(--color-warn-soft)] p-4">
          <p className="font-medium">Read the two maps together</p>
          <p className="mt-1 max-w-prose text-sm">
            {reachSuspects.length === 1 ? 'One cell has' : `${reachSuspects.length} cells have`} no
            successful presses at all, with errors clustered right beside{' '}
            {reachSuspects.length === 1 ? 'it' : 'them'}. That pattern usually means she is reaching
            for those buttons and missing — not that she does not know the words.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-sm"
            >
              Mask the cells beside the errors
            </button>
            <button
              type="button"
              className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-sm"
            >
              Add a copy somewhere easier to reach
            </button>
          </div>
          {/*
            There is deliberately no "make the grid smaller" and no "move the
            card" here. Both are in forbidden_actions: resizing relocates every
            button at once and destroys the motor plan the child has built.
            Masking and adding a copy both leave every learned position intact.
          */}
          <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
            Resizing the grid and moving a learned button are not offered — both would relocate
            buttons she has already learned.
          </p>
        </div>
      )}
    </div>
  )
}

function Grid({
  title,
  caption,
  grid,
  value,
  max,
  hue,
}: {
  title: string
  caption: string
  grid: HeatGridData
  value: (c: HeatGridData['cells'][number]) => number
  max: number
  hue: 'accent' | 'alert'
}) {
  const byPos = new Map(grid.cells.map((c) => [`${c.grid_row}:${c.grid_col}`, c]))
  const base = hue === 'accent' ? '47, 95, 208' : '179, 38, 30'

  return (
    <figure>
      <figcaption className="mb-2">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-[var(--color-ink-muted)]">{caption}</p>
      </figcaption>
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${grid.grid_cols}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: grid.grid_rows }).flatMap((_, r) =>
          Array.from({ length: grid.grid_cols }).map((__, c) => {
            const cell = byPos.get(`${r}:${c}`)
            const v = cell ? value(cell) : 0
            const alpha = max > 0 ? Math.min(0.92, v / max) : 0
            return (
              <div
                key={`${r}:${c}`}
                title={`${cell?.label ?? 'empty'} — ${v}`}
                className="flex aspect-square flex-col items-center justify-center rounded border border-[var(--color-line)] p-1 text-center"
                style={{ background: v > 0 ? `rgba(${base}, ${alpha})` : 'var(--color-surface-sunk)' }}
              >
                <span
                  className="text-[10px] leading-tight break-words opacity-80"
                  style={{ color: alpha > 0.55 ? 'white' : 'var(--color-ink-muted)' }}
                >
                  {cell?.masked ? '—' : (cell?.label ?? '')}
                </span>
                {v > 0 && (
                  <span
                    className="text-xs font-semibold tabular-nums"
                    style={{ color: alpha > 0.55 ? 'white' : 'var(--color-ink)' }}
                  >
                    {v}
                  </span>
                )}
              </div>
            )
          }),
        )}
      </div>
      <p className="mt-2 text-xs text-[var(--color-ink-faint)]">
        {grid.grid_rows}×{grid.grid_cols} · <Pill>{grid.board_name}</Pill>
      </p>
    </figure>
  )
}
