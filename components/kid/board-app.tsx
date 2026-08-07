'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EventLogger, isPrivate, setPrivate, type Scene } from '@/lib/kid/log'
import { speak, stop, unlock, isSupported } from '@/lib/kid/speech'
import { loadVoiceChoice, DEFAULT_VOICE, type VoiceChoice } from '@/lib/kid/voice'
import { buildUtterance, wordForm, type SpeakableCard } from '@/lib/kid/sentence'
import { VoicePicker } from './voice-picker'
import { CardFace, faceColours } from './card-face'
import { EditSheet, type EditableCard } from './edit-sheet'
import { CategoryBar, CategoryDrawer } from './category-drawer'
import { CategoryEditor } from './category-editor'
import { KeyboardLayer } from './keyboard-layer'
import { ModelingHelp } from './modeling-help'
import { EssentialRail } from './essential-rail'
import { ThemeToggle } from '@/components/theme-toggle'
import type { ChildCategory } from '@/lib/categories/types'
import type { Category, DrawerWord } from '@/lib/vocabulary/categories'

export type BoardCard = {
  card_id: string
  label: string
  spoken_text: string
  is_essential: number
  is_core: number
  grid_row: number
  grid_col: number
  masked: number
  nav_depth: number
  /** What this card contributes to a multi-word sentence. */
  word_form?: string | null
  /** Per-child customisation, applied over the card's own label and picture. */
  symbol?: string | null
  image_data?: string | null
}

export type BoardMode = {
  board_id: string
  name: string
  highlighted: string[]
}

export type BoardData = {
  child_id: string
  child_name: string
  board_id: string
  grid_rows: number
  grid_cols: number
  cards?: BoardCard[]
  essentials?: BoardCard[]
  modes?: BoardMode[]
  /*
   * Optional on purpose.
   *
   * During a hot reload the client component can be swapped in ahead of the
   * server payload that feeds it, so a newly added field is briefly absent —
   * which is exactly how this crashed the board once. On a communication
   * device that is not an acceptable failure: losing the category folders is a
   * inconvenience, losing the board is losing someone's voice.
   *
   * Every consumer defaults rather than assuming.
   */
  categories?: { category: Category; words: DrawerWord[] }[]
  /** Full editable form, used only by the category editor. */
  editableCategories?: ChildCategory[]
}

type Composed = { key: string; card: BoardCard }

const SCENES: { value: Scene; label: string }[] = [
  { value: 'classroom', label: 'Classroom' },
  { value: 'therapy', label: 'Therapy' },
  { value: 'free_play', label: 'Free play' },
  { value: 'home', label: 'Home' },
  { value: 'community', label: 'Out' },
]

/**
 * The communication board.
 *
 * Design rules that are not negotiable, each traceable to a constraint:
 *
 *  - A mode never moves a card. Switching to "Snack time" highlights the
 *    relevant cards and dims the rest; every button stays exactly where the
 *    child learned it (clinical constraint C4).
 *  - The essential rail is always on screen and never reordered. Yes, no, stop,
 *    help, toilet and hurt cannot be ranked away by anything.
 *  - Nothing is ever spoken without a press. There is no auto-speak path.
 *  - Logging never blocks speech: every log call returns immediately and the
 *    network flush happens elsewhere.
 */
export function BoardApp({ data }: { data: BoardData }) {
  const [composed, setComposed] = useState<Composed[]>([])
  const [modeId, setModeId] = useState<string | null>(null)
  const [modeling, setModeling] = useState(false)
  const [scene, setScene] = useState<Scene>('classroom')
  const [priv, setPriv] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  // Resolved after mount: speech support cannot be detected during SSR, and
  // rendering "this browser cannot speak" on the server flashes the warning at
  // every user whose browser is perfectly capable.
  const [speechChecked, setSpeechChecked] = useState(false)
  const [canSpeak, setCanSpeak] = useState(true)
  // Editing is an adult activity. While it is on, pressing a card opens its
  // settings instead of speaking — so it is visually unmistakable and it turns
  // itself off after one edit rather than lingering.
  const [editing, setEditing] = useState(false)
  const [editTarget, setEditTarget] = useState<BoardCard | null>(null)
  const [cards, setCards] = useState(data.cards ?? [])
  const [essentials, setEssentials] = useState(data.essentials ?? [])
  const [openCategory, setOpenCategory] = useState<Category | null>(null)
  const [voice, setVoice] = useState<VoiceChoice>(DEFAULT_VOICE)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [catsOpen, setCatsOpen] = useState(false)
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  // Defaulted once, here, rather than at each use site.
  const categories = data.categories ?? []

  const utteranceId = useRef<string>(crypto.randomUUID())
  const startedAt = useRef<number | null>(null)
  const modelingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const logger = useMemo(
    () => new EventLogger(data.child_id, 'classroom', 'child'),
    [data.child_id],
  )

  useEffect(() => {
    setPriv(isPrivate())
    setCanSpeak(isSupported())
    setSpeechChecked(true)
    setVoice(loadVoiceChoice(data.child_id))
  }, [data.child_id])
  useEffect(() => logger.setScene(scene), [logger, scene])
  useEffect(() => logger.setActor(modeling ? 'adult' : 'child'), [logger, modeling])

  useEffect(() => {
    logger.log({ type: 'session_start' })
    return () => {
      logger.log({ type: 'session_end' })
      void logger.flush()
    }
  }, [logger])

  /**
   * Modeling Mode auto-exits after 90 seconds without an adult press.
   * A toggle left on by accident attributes the child's own sentences to a
   * grown-up, which silently destroys their independence figure.
   */
  const touchModeling = useCallback(() => {
    if (modelingTimer.current) clearTimeout(modelingTimer.current)
    modelingTimer.current = setTimeout(() => setModeling(false), 90_000)
  }, [])

  const activeMode = (data.modes ?? []).find((m) => m.board_id === modeId) ?? null
  const highlighted = useMemo(
    () => new Set(activeMode?.highlighted ?? []),
    [activeMode],
  )

  const tap = (card: BoardCard, source: 'board' | 'essential') => {
    // In edit mode a press configures the card. It must never also speak or be
    // logged as communication — that would put an adult's editing session into
    // the child's own figures.
    if (editing) {
      setEditTarget(card)
      return
    }
    if (startedAt.current === null) startedAt.current = Date.now()
    if (modeling) touchModeling()

    logger.logTap({
      cardId: card.card_id,
      label: card.label,
      boardId: data.board_id,
      row: card.grid_row,
      col: card.grid_col,
      gridRows: data.grid_rows,
      gridCols: data.grid_cols,
      navDepth: card.nav_depth,
      source,
      utteranceId: utteranceId.current,
    })

    setComposed((c) => [...c, { key: `${card.card_id}-${Date.now()}`, card }])
  }

  /**
   * A word chosen from a category folder.
   *
   * Logged with nav_depth 1 and source 'search', because that is what it is:
   * a word that took an extra step to reach. That figure is exactly what the
   * dashboard's buried-word rule looks for, so a folder word being used
   * constantly turns into a prompt to add a copy of it to the grid.
   *
   * card_id stays null for words the catalogue does not contain — events has a
   * foreign key to cards, and the denormalised label carries the meaning.
   */
  const pickFromCategory = (word: DrawerWord) => {
    if (startedAt.current === null) startedAt.current = Date.now()

    logger.log({
      type: 'card_tap',
      utterance_id: utteranceId.current,
      board_id: data.board_id,
      card_id: word.card_id,
      label: word.label,
      nav_depth: 1,
      source: 'search',
      ms_delta: null,
      payload: JSON.stringify({ viaCategory: openCategory?.key ?? null, onBoard: word.onBoard }),
    })

    setComposed((c) => [
      ...c,
      {
        key: `${word.label}-${Date.now()}`,
        card: {
          card_id: word.card_id ?? `extra:${word.label}`,
          label: word.label,
          word_form: word.label,
          spoken_text: word.spoken_text,
          is_essential: 0,
          is_core: 0,
          grid_row: -1,
          grid_col: -1,
          masked: 0,
          nav_depth: 1,
        },
      },
    ])
    setOpenCategory(null)
  }

  /**
   * A word spelled on the keyboard layer (metric H2, clinical gap C8).
   *
   * It joins the sentence composer as a chip exactly like a card selection —
   * the word form IS the typed word, spoken through the same path — and logs a
   * keyboard_input event. The ingest whitelist already accepts the type and the
   * 'keyboard' source; nothing server-side needed changing.
   */
  const addTypedWord = (word: string) => {
    const w = word.trim()
    if (!w) return
    if (startedAt.current === null) startedAt.current = Date.now()
    if (modeling) touchModeling()

    logger.log({
      type: 'keyboard_input',
      utterance_id: utteranceId.current,
      board_id: data.board_id,
      label: w,
      source: 'keyboard',
      payload: JSON.stringify({ word: w, length: w.length }),
    })

    setComposed((c) => [
      ...c,
      {
        key: `typed-${w}-${Date.now()}`,
        card: {
          card_id: `typed:${w}`,
          label: w,
          word_form: w,
          spoken_text: w,
          is_essential: 0,
          is_core: 0,
          grid_row: -1,
          grid_col: -1,
          masked: 0,
          nav_depth: 0,
        },
      },
    ])
  }

  /*
   * One card speaks its whole phrase; several join their word forms.
   *
   * The previous version chained `spoken_text`, which produced
   * "I I want I want water." because those rows hold whole sentences rather
   * than words. See lib/kid/sentence.ts.
   */
  const utterance = buildUtterance(composed.map((c) => c.card as SpeakableCard))
  const sentence = utterance?.text ?? ''

  const doSpeak = () => {
    if (composed.length === 0 || !utterance) return
    unlock()
    const text = utterance.text
    speak(text, voice)
    setSpeaking(true)
    setTimeout(() => setSpeaking(false), Math.min(6000, 800 + text.length * 60))

    logger.log({
      type: 'speak',
      utterance_id: utteranceId.current,
      board_id: data.board_id,
      payload: JSON.stringify({
        cardIds: composed.map((c) => c.card.card_id),
        labels: composed.map((c) => c.card.label),
        symbolCount: composed.length,
        wordCount: text.split(/\s+/).filter(Boolean).length,
        assembly: utterance.mode,
        msCompose: startedAt.current ? Date.now() - startedAt.current : null,
        usedSuggestion: false,
      }),
    })

    utteranceId.current = crypto.randomUUID()
    startedAt.current = null
    logger.resetTapClock()
    setComposed([])
  }

  /**
   * The message window is a first-class object (both manuals): tapping the
   * composed-sentence area speaks the current sentence again — Proloquo2Go's
   * Grid View behaviour — and tapping it WHILE speaking stops the speech,
   * P2G's default "Repeated Tap" setting. Still nothing but explicit presses;
   * the composer is not cleared, so this can never destroy work.
   */
  const respeak = () => {
    if (speaking) {
      stop()
      setSpeaking(false)
      return
    }
    if (composed.length === 0 || !utterance) return
    unlock()
    speak(utterance.text, voice)
    setSpeaking(true)
    setTimeout(() => setSpeaking(false), Math.min(6000, 800 + utterance.text.length * 60))

    // Same utterance_id as the composition on purpose: it is the same
    // sentence, said again, and the payload says so.
    logger.log({
      type: 'speak',
      utterance_id: utteranceId.current,
      board_id: data.board_id,
      payload: JSON.stringify({
        cardIds: composed.map((c) => c.card.card_id),
        labels: composed.map((c) => c.card.label),
        symbolCount: composed.length,
        wordCount: utterance.text.split(/\s+/).filter(Boolean).length,
        assembly: utterance.mode,
        msCompose: startedAt.current ? Date.now() - startedAt.current : null,
        usedSuggestion: false,
        trigger: 'message_window',
      }),
    })
  }

  /**
   * Hold-to-hear (Proloquo2Go's Secondary Trigger, default "hold"): pressing
   * and holding a card speaks its word WITHOUT adding it to the sentence — a
   * preview. A hold is still an explicit press, so the no-auto-speak rule
   * holds; nothing is logged because a preview is not a selection.
   */
  const previewCard = (card: BoardCard) => {
    if (editing) return
    unlock()
    speak(wordForm(card as SpeakableCard), voice)
  }

  const deleteLast = () => {
    const last = composed.at(-1)
    if (!last) return
    logger.log({
      type: 'delete_last',
      utterance_id: utteranceId.current,
      card_id: last.card.card_id,
      label: last.card.label,
      grid_row: last.card.grid_row,
      grid_col: last.card.grid_col,
      grid_rows: data.grid_rows,
      grid_cols: data.grid_cols,
      // ms since the tap being removed — the input to mis-tap detection.
      ms_delta: Date.now() - Number(last.key.split('-').at(-1)),
    })
    setComposed((c) => c.slice(0, -1))
  }

  const clear = () => {
    if (composed.length === 0) return
    logger.log({
      type: 'abandon',
      utterance_id: utteranceId.current,
      payload: JSON.stringify({
        cardIds: composed.map((c) => c.card.card_id),
        msAlive: startedAt.current ? Date.now() - startedAt.current : 0,
        reason: 'cleared',
      }),
    })
    utteranceId.current = crypto.randomUUID()
    startedAt.current = null
    logger.resetTapClock()
    setComposed([])
  }

  const switchMode = (id: string | null) => {
    logger.log({
      type: 'board_switch',
      board_id: id ?? data.board_id,
      payload: JSON.stringify({ from: modeId ?? data.board_id, to: id ?? data.board_id, trigger: 'manual' }),
    })
    setModeId(id)
  }

  const byPos = new Map(cards.map((c) => [`${c.grid_row}:${c.grid_col}`, c]))

  const applyEdit = (next: EditableCard) => {
    const patch = (c: BoardCard): BoardCard =>
      c.card_id === next.card_id
        ? {
            ...c,
            label: next.label,
            word_form: next.word_form ?? next.label,
            spoken_text: next.spoken_text,
            symbol: next.symbol,
            image_data: next.image_data,
          }
        : c
    setCards((cs) => cs.map(patch))
    setEssentials((es) => es.map(patch))
    setEditing(false)
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[var(--color-surface-sunk)]">
      {modeling && (
        <div className="bg-[var(--color-warn)] px-4 py-2 text-center text-sm font-semibold text-white">
          Adult is modelling — these presses are recorded as the grown-up&apos;s, not{' '}
          {data.child_name.split(' ')[0]}&apos;s
        </div>
      )}

      {editing && (
        <div className="bg-[var(--color-accent)] px-4 py-2 text-center text-sm font-semibold text-white">
          Editing — press any card to change its picture or words. Nothing is spoken or recorded.
        </div>
      )}

      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2">
        {/* Who is signed in stays visible, so a device left on the wrong child
            is obvious at a glance rather than discovered in the data a week later. */}
        <button
          type="button"
          onClick={async () => {
            await fetch(`/api/session?child=${data.child_id}`, { method: 'DELETE' })
            window.location.href = '/who'
          }}
          className="flex items-center gap-2 rounded-full border border-[var(--color-line)] py-1 pr-3 pl-1 text-sm"
          title="Not you? Sign in as someone else"
        >
          <span
            aria-hidden
            className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-xs font-bold text-[var(--color-accent)]"
          >
            {data.child_name.charAt(0)}
          </span>
          <span className="font-semibold">{data.child_name.split(' ')[0]}</span>
        </button>

        <div className="flex flex-wrap gap-1">
          <ModeChip active={modeId === null} onClick={() => switchMode(null)}>
            All words
          </ModeChip>
          {(data.modes ?? []).map((m) => (
            <ModeChip key={m.board_id} active={modeId === m.board_id} onClick={() => switchMode(m.board_id)}>
              {m.name}
            </ModeChip>
          ))}
        </div>

        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
          <select
            value={scene}
            onChange={(e) => {
              const next = e.target.value as Scene
              logger.log({ type: 'scene_change', payload: JSON.stringify({ from: scene, to: next, setBy: 'manual' }) })
              setScene(next)
            }}
            className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1 text-sm"
            aria-label="Where are we?"
          >
            {SCENES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>

          {editing && (
            <button
              type="button"
              onClick={() => setCatsOpen(true)}
              className="rounded-md border border-[var(--color-line)] px-3 py-1.5 text-sm font-medium"
            >
              Categories
            </button>
          )}

          <button
            type="button"
            onClick={() => setVoiceOpen(true)}
            className="rounded-md border border-[var(--color-line)] px-3 py-1.5 text-sm font-medium"
          >
            Voice
          </button>

          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            aria-pressed={editing}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              editing ? 'bg-[var(--color-accent)] text-white' : 'border border-[var(--color-line)]'
            }`}
          >
            {editing ? 'Done editing' : 'Edit cards'}
          </button>

          <button
            type="button"
            onClick={() => {
              setModeling((v) => !v)
              touchModeling()
            }}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              modeling
                ? 'bg-[var(--color-warn)] text-white'
                : 'border border-[var(--color-line)]'
            }`}
          >
            {modeling ? 'Stop modelling' : 'I am modelling'}
          </button>

          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            aria-label="What is modelling?"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-line)] text-sm font-bold text-[var(--color-ink-muted)]"
          >
            ?
          </button>

          {/* Private Mode is reachable by the child, not buried in adult settings. */}
          <button
            type="button"
            onClick={() => {
              const next = !priv
              setPrivate(next)
              setPriv(next)
            }}
            aria-pressed={priv}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              priv ? 'bg-[var(--color-ink)] text-[var(--color-surface)]' : 'border border-[var(--color-line)]'
            }`}
            title="Nothing is recorded while this is on"
          >
            {priv ? 'Private — nothing recorded' : 'Private'}
          </button>

          <ThemeToggle compact />
        </div>
      </header>

      {/* Category folders and the ABC keyboard chip. A second surface — the
          grid below never rearranges. The bar renders even with no folders so
          alphabet access never disappears. */}
      <CategoryBar
        categories={categories.map((c) => c.category)}
        onOpen={setOpenCategory}
        firstWords={Object.fromEntries(
          categories.map((c) => [c.category.key, c.words[0]?.label ?? '']),
        )}
        leading={
          <button
            type="button"
            onClick={() => setKeyboardOpen(true)}
            aria-pressed={keyboardOpen}
            className="flex shrink-0 items-center rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-surface)] px-4 py-2 text-sm font-bold tracking-wide"
            style={{ minHeight: 44 }}
            title="Spell a word letter by letter"
          >
            ABC
          </button>
        }
      />

      {/* Sentence bar. Fixed height so the board never jumps as words are added. */}
      <div className="sticky top-0 z-10 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-3">
        {/* The message window is itself a button (P2G): tap to hear the
            sentence again, tap while speaking to stop. Explicit press only. */}
        <button
          type="button"
          onClick={respeak}
          disabled={composed.length === 0}
          aria-label={speaking ? 'Stop speaking' : 'Say the sentence again'}
          className="flex min-h-[4.5rem] w-full items-center gap-2 overflow-x-auto rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-sunk)] p-2 text-left"
        >
          {composed.length === 0 ? (
            <span className="px-2 text-[var(--color-ink-faint)]">Press a word to begin</span>
          ) : (
            composed.map((c) => (
              <span
                key={c.key}
                className="shrink-0 rounded-lg bg-[var(--color-surface)] px-3 py-2 text-lg font-semibold shadow-sm"
              >
                {c.card.label}
              </span>
            ))
          )}
        </button>

        {utterance && (
          <p className="mt-1 px-1 text-sm text-[var(--color-ink-muted)]">
            Will say: “{utterance.text}”
          </p>
        )}

        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={doSpeak}
            disabled={composed.length === 0}
            className="flex-[3] rounded-[var(--radius-card)] bg-[var(--color-accent)] py-4 text-xl font-bold text-white disabled:opacity-40"
            style={{ minHeight: 64 }}
          >
            {speaking ? 'Speaking…' : 'Speak'}
          </button>
          <button
            type="button"
            onClick={deleteLast}
            disabled={composed.length === 0}
            className="flex-1 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] py-4 text-base font-semibold disabled:opacity-40"
            style={{ minHeight: 64 }}
          >
            Undo
          </button>
          <button
            type="button"
            onClick={clear}
            disabled={composed.length === 0}
            className="flex-1 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] py-4 text-base font-semibold disabled:opacity-40"
            style={{ minHeight: 64 }}
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => {
              stop()
              setSpeaking(false)
            }}
            className="flex-1 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] py-4 text-base font-semibold"
            style={{ minHeight: 64 }}
          >
            Stop
          </button>
        </div>
      </div>

      {/* The board. Column count comes from the child's own grid, never from the
          viewport — resizing the grid would relocate every learned button. */}
      <main className="flex-1 p-3">
        <div
          className="grid gap-1.5 sm:gap-2"
          style={{ gridTemplateColumns: `repeat(${data.grid_cols}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: data.grid_rows }).flatMap((_, r) =>
            Array.from({ length: data.grid_cols }).map((__, c) => {
              const card = byPos.get(`${r}:${c}`)
              if (!card) return <div key={`${r}:${c}`} aria-hidden />
              const dimmed = activeMode !== null && !highlighted.has(card.card_id)
              return (
                <CardButton
                  key={card.card_id}
                  card={card}
                  dimmed={dimmed}
                  editing={editing}
                  onTap={() => tap(card, 'board')}
                  onPreview={() => previewCard(card)}
                />
              )
            }),
          )}
        </div>
      </main>

      {/* Essential rail — always present, never reordered, never dimmed by a mode. */}
      <nav
        className="sticky bottom-0 border-t border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2"
        style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
        aria-label="Always available"
      >
        <EssentialRail essentials={essentials} onTap={(card) => tap(card, 'essential')} />
      </nav>

      {keyboardOpen && (
        <KeyboardLayer
          onWord={addTypedWord}
          onClose={() => setKeyboardOpen(false)}
          essentials={essentials}
          onEssential={(card) => {
            // Closing first puts the sentence bar and Speak back on screen, so
            // an urgent word is one more tap from being said aloud.
            setKeyboardOpen(false)
            tap(card, 'essential')
          }}
        />
      )}

      {helpOpen && <ModelingHelp onClose={() => setHelpOpen(false)} />}

      {openCategory && (
        <CategoryDrawer
          category={openCategory}
          words={categories.find((c) => c.category.key === openCategory.key)?.words ?? []}
          onPick={pickFromCategory}
          onClose={() => setOpenCategory(null)}
        />
      )}

      {catsOpen && (
        <CategoryEditor
          childId={data.child_id}
          childName={data.child_name}
          categories={data.editableCategories ?? []}
          onClose={() => setCatsOpen(false)}
          onChanged={() => window.location.reload()}
        />
      )}

      {voiceOpen && (
        <VoicePicker
          childId={data.child_id}
          childName={data.child_name}
          choice={voice}
          onChange={setVoice}
          onClose={() => setVoiceOpen(false)}
        />
      )}

      {editTarget && (
        <EditSheet
          childId={data.child_id}
          card={{
            card_id: editTarget.card_id,
            label: editTarget.label,
            word_form: editTarget.word_form ?? editTarget.label,
            spoken_text: editTarget.spoken_text,
            symbol: editTarget.symbol ?? null,
            image_data: editTarget.image_data ?? null,
          }}
          onClose={() => setEditTarget(null)}
          onSaved={applyEdit}
        />
      )}

      {speechChecked && !canSpeak && (
        <p className="bg-[var(--color-alert-soft)] px-3 py-2 text-center text-sm">
          This browser cannot speak. The sentence bar still shows what{' '}
          {data.child_name.split(' ')[0]} wants to say — hold the screen up to read it.
        </p>
      )}
    </div>
  )
}

/**
 * Hold-to-hear: Proloquo2Go's Secondary Trigger pattern (default: hold). A
 * press-and-hold of ~0.7s speaks the card's word without adding it to the
 * sentence; a normal tap selects as before. The hold flag suppresses the click
 * that follows release so a preview never turns into an accidental selection.
 */
const HOLD_PREVIEW_MS = 700

function CardButton({
  card,
  dimmed,
  editing,
  onTap,
  onPreview,
}: {
  card: BoardCard
  dimmed: boolean
  editing: boolean
  onTap: () => void
  onPreview: () => void
}) {
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const held = useRef(false)
  // A pending timer must not fire into an unmounted board.
  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current)
    },
    [],
  )

  if (card.masked) {
    return (
      <div
        aria-hidden
        className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface-sunk)]"
        style={{ minHeight: 64 }}
      />
    )
  }

  const startHold = () => {
    // In edit mode a press configures; previews would speak during setup.
    if (editing) return
    held.current = false
    holdTimer.current = setTimeout(() => {
      held.current = true
      onPreview()
    }, HOLD_PREVIEW_MS)
  }
  const cancelHold = () => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current)
      holdTimer.current = null
    }
  }

  return (
    <button
      type="button"
      onPointerDown={startHold}
      onPointerUp={cancelHold}
      onPointerLeave={cancelHold}
      onPointerCancel={cancelHold}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        if (held.current) {
          held.current = false
          return
        }
        onTap()
      }}
      className={`relative flex touch-manipulation select-none flex-col items-center justify-center rounded-[var(--radius-card)] border-2 p-1 text-center transition-opacity sm:p-2 ${
        dimmed ? 'opacity-35' : ''
      } ${editing ? 'ring-2 ring-[var(--color-accent)] ring-offset-1' : ''}`}
      style={{ minHeight: 'max(64px, 14vh)', ...faceColours(card.label, card.symbol) }}
    >
      {/* Scales with the card, which is itself 14vh-based. The width cap in
          CardFace keeps it inside narrow phone cards; on laptop/iPad it grows
          to 11vh, capped at 112px. */}
      <CardFace
        label={card.label}
        symbolKey={card.symbol}
        imageData={card.image_data}
        size="clamp(44px, 12vh, 124px)"
      />
      {editing && (
        <span className="absolute top-1 right-1 rounded-full bg-[var(--color-accent)] px-1.5 text-[10px] font-bold text-white">
          edit
        </span>
      )}
    </button>
  )
}

function ModeChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-sm font-medium ${
        active
          ? 'bg-[var(--color-accent)] text-white'
          : 'border border-[var(--color-line)] bg-[var(--color-surface)]'
      }`}
    >
      {children}
    </button>
  )
}
