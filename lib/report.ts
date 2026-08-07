/**
 * The eight-metric report set, per proposed_metrics.docx.
 *
 * Four traditional metrics and four AI-generated ones. The generated report may
 * cite these and nothing else — the docx is explicit — and `report_set` in
 * metrics_catalog is what makes that checkable rather than merely requested.
 *
 * Five of the eight compute from real events. Only the AI three needed new
 * instrumentation, so nothing here is mocked.
 *
 * Two of the eight are NOT scalars. Words-not-yet-paired is a list and
 * words-not-used-lately is a per-day series; neither can be a KPI tile, which
 * is why each card declares its own chart type and reads its own shape.
 */
import { all, one, type Window } from './db'

export type ChartKind =
  | 'line' | 'bar' | 'table' | 'calendar' | 'donut' | 'scatter'
  | 'split_bar' | 'grid' | 'ranked_bar' | 'none'

export type ReportMetric = {
  metric_id: string
  rank: number
  name: string
  plain: string
  caveat: string | null
  chart: ChartKind
  /** The one number that goes above the chart. Already formatted. */
  headline: string
  /** Optional second line — a delta, a denominator, a ceiling. */
  sub?: string
  /** Chart payload; shape depends on `chart`. */
  series?: { label: string; value: number | null }[]
  pairs?: { word_a: string; word_b: string; solo_a: number; solo_b: number }[]
  calendar?: { day: string; value: number }[]
  slices?: { label: string; value: number; color: string }[]
  scatter?: { x: number; y: number; label: string }[]
  split?: { left: { label: string; value: number }; right: { label: string; value: number } }
  grid?: { rows: number; cols: number; cells: { row: number; col: number; taps: number; mistaps: number }[] }
  ranked?: { label: string; value: number; muted?: boolean }[]
  /** A / B / C / D / E / G / H, from the filtered index. */
  group: string
  suppressed?: string
}

type CatalogRow = {
  metric_id: string; name: string; plain_explanation: string
  caveat: string | null; chart: string; report_rank: number; min_n: number
  group_code: string
}

export function reportMetrics(childId: string, w: Window): ReportMetric[] {
  const catalog = all<CatalogRow>(
    `SELECT metric_id, name, plain_explanation, caveat, chart, report_rank, min_n, group_code
     FROM metrics_catalog WHERE report_set = 1 ORDER BY report_rank`)

  return catalog.map((c) => build(c, childId, w)).filter(Boolean) as ReportMetric[]
}

function monthly(childId: string, metricId: string, months = 6) {
  return all<{ label: string; value: number | null }>(
    `SELECT strftime('%m', day_local) AS label, ROUND(AVG(value), 3) AS value
     FROM agg_daily_metric
     WHERE child_id = ? AND metric_id = ?
     GROUP BY strftime('%Y-%m', day_local)
     ORDER BY MIN(day_local) DESC LIMIT ?`, [childId, metricId, months]).reverse()
}

function weekly(childId: string, metricId: string, weeks = 8) {
  return all<{ label: string; value: number | null }>(
    `SELECT 'w' || strftime('%W', day_local) AS label, ROUND(AVG(value), 3) AS value
     FROM agg_daily_metric
     WHERE child_id = ? AND metric_id = ?
     GROUP BY strftime('%Y-W%W', day_local)
     ORDER BY MIN(day_local) DESC LIMIT ?`, [childId, metricId, weeks]).reverse()
}

function windowValue(childId: string, metricId: string, w: Window) {
  return one<{ value: number | null; n: number }>(
    `SELECT ROUND(AVG(value), 4) AS value, COALESCE(SUM(n), 0) AS n
     FROM agg_daily_metric
     WHERE child_id = ? AND metric_id = ? AND day_local BETWEEN ? AND ?`,
    [childId, metricId, w.start, w.end])
}

function build(c: CatalogRow, childId: string, w: Window): ReportMetric | null {
  const base = {
    metric_id: c.metric_id, rank: c.report_rank, name: c.name,
    plain: c.plain_explanation, caveat: c.caveat, chart: c.chart as ChartKind,
    group: c.group_code,
  }

  switch (c.metric_id) {
    // ---- A1 buttons to say one thing ---------------------------------------
    case 'taps_per_utterance': {
      const v = windowValue(childId, 'taps_per_utterance', w)
      return { ...base,
        headline: v?.value ? v.value.toFixed(1) : '—',
        sub: 'buttons per sentence, typical',
        series: weekly(childId, 'taps_per_utterance') }
    }

    // ---- B2 where corrections land — a classifier, so a split, not a score --
    case 'correction_adjacent_rate': {
      const v = windowValue(childId, 'correction_adjacent_rate', w)
      if (!v?.value) return { ...base, headline: '—', suppressed: 'too few corrections to tell' }
      const near = Math.round(v.value * 100)
      return { ...base,
        headline: `${near}% next door`,
        // The whole diagnostic value is in which way it leans, and the two
        // readings need opposite responses — so the card says both.
        sub: near >= 60 ? 'looks like reach, not confusion'
           : near <= 35 ? 'looks like changing her mind, not her hand'
           : 'mixed — not enough to call it either way',
        split: { left: { label: 'next door', value: near },
                 right: { label: 'somewhere else', value: 100 - near } } }
    }

    // ---- B4 which buttons get reached --------------------------------------
    case 'cell_heat': {
      const board = one<{ board_id: string; grid_rows: number; grid_cols: number }>(
        `SELECT board_id, grid_rows, grid_cols FROM boards
         WHERE child_id = ? AND kind = 'robust' LIMIT 1`, [childId])
      if (!board) return { ...base, headline: '—', suppressed: 'no board recorded' }
      const cells = all<{ row: number; col: number; taps: number; mistaps: number }>(
        `SELECT grid_row AS row, grid_col AS col, SUM(taps) AS taps, SUM(mistaps) AS mistaps
         FROM agg_cell_heat WHERE child_id = ? AND board_id = ?
         GROUP BY grid_row, grid_col`, [childId, board.board_id])
      const dead = cells.filter((c) => c.taps === 0).length
      return { ...base,
        headline: `${board.grid_rows}×${board.grid_cols}`,
        sub: dead ? `${dead} cell${dead === 1 ? '' : 's'} never reached` : 'all cells in use',
        grid: { rows: board.grid_rows, cols: board.grid_cols, cells } }
    }

    // ---- C1 silence streak --------------------------------------------------
    case 'silence_streak': {
      const gap = one<{ d: number }>(
        `SELECT CAST(julianday((SELECT MAX(day_local) FROM events))
                     - julianday(MAX(day_local)) AS INTEGER) AS d
         FROM utterances WHERE child_id = ? AND spoken = 1`, [childId])
      const calendar = all<{ day: string; value: number }>(
        `SELECT day_local AS day, COUNT(*) AS value FROM utterances
         WHERE child_id = ? AND spoken = 1 GROUP BY day_local ORDER BY day_local`, [childId])
      const d = gap?.d ?? 0
      return { ...base,
        headline: d === 0 ? 'spoke today' : `${d} day${d === 1 ? '' : 's'}`,
        sub: d >= 2 ? 'worth checking in' : 'communicating regularly',
        calendar }
    }

    // ---- C2 her go-to words -------------------------------------------------
    case 'card_frequency': {
      const cards = all<{ label: string; taps: number; is_core: number }>(
        `SELECT c.label, s.taps, c.is_core FROM agg_card_stats s
         JOIN cards c ON c.card_id = s.card_id
         WHERE s.child_id = ? AND s.taps > 0 ORDER BY s.taps DESC LIMIT 6`, [childId])
      return { ...base,
        headline: cards[0] ? `"${cards[0].label}"` : '—',
        sub: cards[0] ? `used ${cards[0].taps} times` : undefined,
        ranked: cards.map((c) => ({ label: c.label, value: c.taps, muted: !c.is_core })) }
    }

    // ---- C3 new words — a COUNT, per the filtered index ---------------------
    case 'new_words': {
      const count = one<{ n: number }>(
        `SELECT COUNT(*) AS n FROM v_first_uses
         WHERE child_id = ? AND first_day BETWEEN ? AND ?`, [childId, w.start, w.end])
      const before = one<{ n: number }>(
        `SELECT COUNT(*) AS n FROM v_first_uses WHERE child_id = ? AND first_day < ?`,
        [childId, w.start])
      const pct = before?.n ? Math.round(((count?.n ?? 0) / before.n) * 100) : null
      return { ...base,
        headline: String(count?.n ?? 0),
        sub: pct === null ? 'first period' : `+${pct}% on the ${before!.n} she had`,
        series: weekly(childId, 'new_words') }
    }

    // ---- C7 words not yet paired -------------------------------------------
    case 'word_pairs': {
      // Only pairs that are teachable: ranking on frequency alone surfaced
      // "I + you", which is true and useless. The parts of speech have to form
      // a structure we recognise.
      const pairs = all<{ word_a: string; word_b: string; solo_a: number; solo_b: number }>(
        `SELECT p.word_a, p.word_b, p.solo_a, p.solo_b FROM agg_word_pairs p
         JOIN cards ca ON ca.label = p.word_a
         JOIN cards cb ON cb.label = p.word_b
         WHERE p.child_id = ? AND p.together = 0 AND p.solo_a >= 10 AND p.solo_b >= 10
           AND EXISTS (SELECT 1 FROM syntax_patterns sp
                       WHERE sp.pos_sequence = ca.part_of_speech || ' ' || cb.part_of_speech
                          OR sp.pos_sequence = cb.part_of_speech || ' ' || ca.part_of_speech)
         ORDER BY MIN(p.solo_a, p.solo_b) DESC LIMIT 8`, [childId])
      return { ...base,
        headline: `${pairs.length} pair${pairs.length === 1 ? '' : 's'}`,
        sub: pairs.length ? 'she uses both, never together' : undefined,
        pairs }
    }

    // ---- C8 flexible words vs naming ---------------------------------------
    case 'core_fringe_ratio': {
      const v = windowValue(childId, 'core_fringe_ratio', w)
      if (v?.value == null) return { ...base, headline: '—', suppressed: 'not enough presses yet' }
      const core = Math.round(v.value * 100)
      return { ...base,
        headline: `${core}% flexible`,
        sub: 'about 200 core words carry most of everyday talk',
        slices: [
          { label: 'flexible words', value: core, color: 'var(--color-accent)' },
          { label: 'naming things', value: 100 - core, color: 'var(--color-neutral)' },
        ] }
    }

    // ---- D1 how deep words are buried ---------------------------------------
    case 'nav_depth_by_card': {
      const rows = all<{ label: string; depth: number; taps: number }>(
        `SELECT c.label, cv.nav_depth AS depth, COALESCE(s.taps, 0) AS taps
         FROM child_vocabulary cv
         JOIN cards c ON c.card_id = cv.card_id
         LEFT JOIN agg_card_stats s ON s.child_id = cv.child_id AND s.card_id = cv.card_id
         WHERE cv.child_id = ? AND COALESCE(s.taps,0) > 0`, [childId])
      // Frequent AND deep is the finding. Never "move it" — add a copy.
      const buried = rows.filter((r) => r.depth >= 3).sort((a, b) => b.taps - a.taps)
      return { ...base,
        headline: buried[0] ? `"${buried[0].label}"` : 'none buried',
        sub: buried[0]
          ? `used ${buried[0].taps}×, ${buried[0].depth} screens deep`
          : 'her most-used words are within reach',
        scatter: rows.map((r) => ({ x: r.depth, y: r.taps, label: r.label })) }
    }

    // ---- E3 adult demonstrating ---------------------------------------------
    case 'teacher_modeling': {
      const v = windowValue(childId, 'teacher_modeling', w)
      const days = one<{ d: number }>(
        `SELECT COUNT(DISTINCT day_local) AS d FROM events
         WHERE child_id = ? AND actor = 'adult'`, [childId])
      return { ...base,
        headline: v?.value ? `${Math.round(v.value)}/day` : '—',
        // A zero can mean "nobody modelled" OR "nobody switched the mode on",
        // and those need very different conversations.
        sub: days?.d ? `on ${days.d} days` : 'Modeling Mode never switched on',
        series: weekly(childId, 'teacher_modeling') }
    }

    // ---- G1 how long the adult waits ----------------------------------------
    case 'partner_wait_time': {
      // The board has no Listen feature yet, so every partner_turns row is
      // fixture data. A real-looking number computed from nobody is worse than
      // an honest gap — suppress until a genuine source exists.
      const real = one<{ c: number }>(
        `SELECT COUNT(*) c FROM (SELECT 1 FROM events WHERE type = 'listen' LIMIT 1)`)
      if (!real?.c) {
        return { ...base, headline: 'not recorded',
          suppressed: 'The board does not listen to conversations yet, so how long the adult waits is not measured. Shown as unavailable rather than as a number that describes nobody.' }
      }
      const v = windowValue(childId, 'partner_wait_time', w)
      if (v?.value == null) return { ...base, headline: '—', suppressed: 'not enough recorded' }
      const secs = v.value / 1000
      return { ...base,
        headline: `${secs.toFixed(1)}s`,
        sub: secs < 2 ? 'under two seconds — she may need longer'
                      : 'giving her time to answer',
        series: weekly(childId, 'partner_wait_time') }
    }

    // ---- H1 repeated pressing — NEVER an error ------------------------------
    case 'repeat_tap_rate': {
      const v = windowValue(childId, 'repeat_tap_rate', w)
      return { ...base,
        headline: v?.value != null ? `${Math.round(v.value * 100)}%` : '—',
        sub: 'of sentences include a repeat — this is normal',
        series: weekly(childId, 'repeat_tap_rate') }
    }

    // ---- H2 spelling and the alphabet ---------------------------------------
    case 'keyboard_use': {
      const typed = one<{ n: number; words: number }>(
        `SELECT COUNT(*) AS n,
                COUNT(DISTINCT json_extract(payload,'$.word')) AS words
         FROM events
         WHERE child_id = ? AND type = 'keyboard_input'
           AND day_local BETWEEN ? AND ?`, [childId, w.start, w.end])
      if (!typed?.n) {
        return { ...base,
          headline: 'not used yet',
          suppressed: 'The keyboard exists but has not been used in this window. ' +
            'Alphabet access is one of the four things a robust AAC system needs.' }
      }
      return { ...base,
        headline: String(typed.n),
        sub: `${typed.words} different ${typed.words === 1 ? 'word' : 'words'} spelled`,
        series: weekly(childId, 'keyboard_use') }
    }
  }
  return null
}

/**
 * The prose summary.
 *
 * Written from the eight values and nothing else — the docx requires the model
 * not to expand beyond them, and the same rule applies to this deterministic
 * fallback. A local model can replace the wording later; the constraint on what
 * it may cite does not change.
 */
export function plainSummary(child: string, metrics: ReportMetric[]): {
  summary: string; guidance: string
} {
  const by = Object.fromEntries(metrics.map((m) => [m.metric_id, m]))
  const bits: string[] = []
  const guidance: string[] = []

  if (by.silence_streak) {
    bits.push(by.silence_streak.headline === 'spoke today'
      ? `${child} has been communicating regularly.`
      : `${child} has not said anything for ${by.silence_streak.headline}.`)
  }
  if (by.new_words?.headline && by.new_words.headline !== '0') {
    bits.push(`She used ${by.new_words.headline} new words this period${
      by.new_words.sub ? `, ${by.new_words.sub}` : ''}.`)
  }
  if (by.card_frequency?.headline && by.card_frequency.headline !== '—') {
    bits.push(`Her most-used word is ${by.card_frequency.headline}, ${by.card_frequency.sub}.`)
  }
  if (by.taps_per_utterance?.headline !== '—') {
    bits.push(`It takes her about ${by.taps_per_utterance.headline} presses to say one thing.`)
  }

  // Reach before vocabulary. A child missing a target is not a child who does
  // not know the word, and the two need opposite responses.
  const adj = by.correction_adjacent_rate
  if (adj?.split && adj.split.left.value >= 60) {
    guidance.push(
      `When she corrects herself, ${adj.split.left.value}% of the time she moves to the button ` +
      `right next door. That points at reach rather than confusion — mask the neighbours of the ` +
      `hardest targets or change how the device is mounted. Do not move buttons she has learned.`)
  }
  const buried = by.nav_depth_by_card
  if (buried && buried.headline !== 'none buried') {
    guidance.push(
      `${buried.headline} is ${buried.sub}. Add a copy of it somewhere easy to reach — ` +
      `adding one costs nothing, and moving the original would undo the motor pattern she has built.`)
  }
  const pairs = by.word_pairs?.pairs ?? []
  if (pairs.length) {
    guidance.push(
      `She uses "${pairs[0].word_a}" and "${pairs[0].word_b}" often but never together. ` +
      `That pair is worth modelling in moments where the two words naturally belong.`)
  }
  const wait = by.partner_wait_time
  if (wait?.sub?.startsWith('under two seconds')) {
    guidance.push(
      `Adults are waiting under two seconds before speaking again. AAC output runs around ` +
      `fifteen words a minute, so more silence would give her room to answer.`)
  }
  const model = by.teacher_modeling
  if (model?.sub === 'Modeling Mode never switched on') {
    guidance.push(
      `No adult demonstrations are recorded. That may mean nobody modelled, or that ` +
      `Modeling Mode was never switched on — worth checking which.`)
  }

  return {
    summary: bits.join(' ') || 'Not enough recorded this period to summarise.',
    guidance: guidance.join(' ') || 'Nothing in these numbers points at a specific next step.',
  }
}
