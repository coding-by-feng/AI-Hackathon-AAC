'use client'

import { useRef, useState } from 'react'
import { CardFace } from './card-face'
import { allSymbolNames, CLASS_STYLE, symbolFor } from '@/lib/icons/symbols'

export type EditableCard = {
  card_id: string
  label: string
  word_form?: string | null
  spoken_text: string
  symbol: string | null
  image_data: string | null
}

/**
 * Downscale a photo in the browser before it is ever sent.
 *
 * A phone photo is 3–8 MB; on the board it is displayed at about 40 px. Sending
 * the original would put megabytes into the database for something rendered
 * postage-stamp size — and on a school connection the upload would be the
 * slowest thing in the app.
 */
async function downscale(file: File, max = 256): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  return canvas.toDataURL('image/jpeg', 0.82)
}

export function EditSheet({
  childId,
  card,
  onClose,
  onSaved,
}: {
  childId: string
  card: EditableCard
  onClose: () => void
  onSaved: (next: EditableCard) => void
}) {
  const [label, setLabel] = useState(card.label)
  const [spoken, setSpoken] = useState(card.spoken_text)
  const [word, setWord] = useState(card.word_form ?? card.label)
  const [symbol, setSymbol] = useState<string | null>(card.symbol)
  const [image, setImage] = useState<string | null>(card.image_data)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/cards', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          childId,
          cardId: card.card_id,
          label,
          wordForm: word,
          spokenText: spoken,
          symbol,
          imageData: image,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Could not save')
      onSaved({ ...card, label, word_form: word, spoken_text: spoken, symbol, image_data: image })
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const reset = async () => {
    setBusy(true)
    try {
      await fetch(`/api/cards?child=${childId}&card=${card.card_id}`, { method: 'DELETE' })
      onSaved({ ...card, label: card.label, symbol: null, image_data: null })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${card.label}`}
    >
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-[var(--color-surface)] p-5 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold">Change this card</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--color-line)] px-3 py-1.5 text-sm"
          >
            Close
          </button>
        </div>

        <div className="mt-4 flex items-center gap-4 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-sunk)] p-4">
          <CardFace label={label} symbolKey={symbol} imageData={image} size={56} />
          <p className="text-sm text-[var(--color-ink-muted)]">
            This is how it will look on the board. Its position never changes.
          </p>
        </div>

        <label className="mt-4 block">
          <span className="text-sm font-medium">Word on the card</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-base"
          />
        </label>

        <label className="mt-3 block">
          <span className="text-sm font-medium">In a sentence, this word is</span>
          <input
            value={word}
            onChange={(e) => setWord(e.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-base"
          />
          <span className="mt-1 block text-xs text-[var(--color-ink-muted)]">
            What this card contributes when joined with others — “water” gives “I want water”.
            Usually the same as the word on the card.
          </span>
        </label>

        <label className="mt-3 block">
          <span className="text-sm font-medium">On its own, it says</span>
          <input
            value={spoken}
            onChange={(e) => setSpoken(e.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-base"
          />
          <span className="mt-1 block text-xs text-[var(--color-ink-muted)]">
            The whole sentence, used when this is the only card pressed.
          </span>
        </label>

        <div className="mt-5">
          <p className="text-sm font-medium">Photo</p>
          <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
            For anything that belongs to them — their cup, their chair, a person — a real photo
            works better than a drawing.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-md border border-[var(--color-line)] px-3 py-2 text-sm"
            >
              {image ? 'Change photo' : 'Take or choose a photo'}
            </button>
            {image && (
              <button
                type="button"
                onClick={() => setImage(null)}
                className="rounded-md border border-[var(--color-line)] px-3 py-2 text-sm"
              >
                Remove photo
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (!f) return
                setError(null)
                try {
                  setImage(await downscale(f))
                } catch {
                  setError('That image could not be read.')
                }
              }}
            />
          </div>
        </div>

        <div className="mt-5">
          <p className="text-sm font-medium">Or pick a picture</p>
          {image && (
            <p className="mt-1 text-xs text-[var(--color-warn)]">
              The photo is used instead. Remove it to use a drawing.
            </p>
          )}
          <div className="mt-2 grid max-h-52 grid-cols-5 gap-2 overflow-y-auto rounded-md border border-[var(--color-line)] p-2 sm:grid-cols-7">
            <button
              type="button"
              onClick={() => setSymbol(null)}
              className={`flex aspect-square items-center justify-center rounded-md border text-xs ${
                symbol === null ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]' : 'border-[var(--color-line)]'
              }`}
              title="Use the built-in picture for this word"
            >
              auto
            </button>
            {allSymbolNames().map((name) => {
              const cls = symbolFor(name)!.wordClass
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => setSymbol(name)}
                  title={name}
                  className={`flex aspect-square items-center justify-center rounded-md border ${
                    symbol === name ? 'border-[var(--color-accent)] ring-2 ring-[var(--color-accent)]' : 'border-[var(--color-line)]'
                  }`}
                  style={{ background: CLASS_STYLE[cls].bg, color: CLASS_STYLE[cls].fg }}
                >
                  <CardFace label={name} size={26} showLabel={false} />
                </button>
              )
            })}
          </div>
        </div>

        {error && (
          <p className="mt-3 rounded-md bg-[var(--color-alert-soft)] px-3 py-2 text-sm text-[var(--color-alert)]">
            {error}
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={save}
            disabled={busy || label.trim().length === 0}
            className="flex-1 rounded-md bg-[var(--color-accent)] px-4 py-3 font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={busy}
            className="rounded-md border border-[var(--color-line)] px-4 py-3 text-sm"
          >
            Reset to default
          </button>
        </div>
      </div>
    </div>
  )
}
