'use client'

import { useState } from 'react'
import { CardFace } from './card-face'
import type { ChildCategory, CategoryWord } from '@/lib/categories/types'

/**
 * Editing the category folders.
 *
 * Opens from Edit mode on the board, because the adult setting a board up is
 * sitting with the child — the tools belong next to each other rather than on
 * a separate device.
 *
 * Two levels of change, and the difference is stated in the UI rather than
 * left to be discovered:
 *   the tick        this child only
 *   name and words  every child using the folder
 */
export function CategoryEditor({
  childId,
  childName,
  categories,
  onClose,
  onChanged,
}: {
  childId: string
  childName: string
  categories: ChildCategory[]
  onClose: () => void
  onChanged: () => void
}) {
  const [items, setItems] = useState(categories)
  const [openId, setOpenId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const call = async (body: Record<string, unknown>) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'That did not work')
        return false
      }
      const fresh = await fetch(`/api/categories?child=${childId}`).then((r) => r.json())
      setItems(fresh.categories)
      onChanged()
      return true
    } catch {
      setError('Could not reach the server')
      return false
    } finally {
      setBusy(false)
    }
  }

  const firstName = childName.split(' ')[0]
  const open = items.find((c) => c.category_id === openId) ?? null

  if (open) {
    return (
      <WordList
        category={open}
        busy={busy}
        error={error}
        onBack={() => setOpenId(null)}
        onCall={call}
      />
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Categories"
    >
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-[var(--color-surface)] p-5 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Categories for {firstName}</h2>
            <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">
              Tick what {firstName} sees. Editing the words changes them for everyone.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--color-line)] px-3 py-1.5 text-sm"
          >
            Close
          </button>
        </div>

        <ul className="mt-4 divide-y divide-[var(--color-line)]">
          {items.map((c, i) => (
            <li key={c.category_id} className="flex items-center gap-3 py-2">
              <input
                type="checkbox"
                checked={c.shown}
                disabled={busy}
                onChange={(e) =>
                  void call({
                    action: 'show',
                    childId,
                    categoryId: c.category_id,
                    shown: e.target.checked,
                  })
                }
                aria-label={`Show ${c.name} for ${firstName}`}
                className="h-6 w-6 shrink-0"
              />

              <button
                type="button"
                onClick={() => setOpenId(c.category_id)}
                className="flex-1 text-left"
              >
                <span className={`font-medium ${c.shown ? '' : 'text-[var(--color-ink-faint)]'}`}>
                  {c.name}
                </span>
                <span className="ml-2 text-xs text-[var(--color-ink-faint)]">
                  {c.words.length} {c.words.length === 1 ? 'word' : 'words'}
                </span>
              </button>

              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  disabled={busy || i === 0}
                  onClick={() =>
                    void call({
                      action: 'reorder',
                      childId,
                      order: move(items.map((x) => x.category_id), i, i - 1),
                    })
                  }
                  className="rounded border border-[var(--color-line)] px-2 py-1 text-sm disabled:opacity-30"
                  aria-label={`Move ${c.name} up`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={busy || i === items.length - 1}
                  onClick={() =>
                    void call({
                      action: 'reorder',
                      childId,
                      order: move(items.map((x) => x.category_id), i, i + 1),
                    })
                  }
                  className="rounded border border-[var(--color-line)] px-2 py-1 text-sm disabled:opacity-30"
                  aria-label={`Move ${c.name} down`}
                >
                  ↓
                </button>
              </div>
            </li>
          ))}
        </ul>

        <p className="mt-2 text-xs text-[var(--color-ink-faint)]">
          Unticking hides a folder from {firstName} and keeps its words. Nothing is lost, and
          ticking it again brings back exactly what was there.
        </p>

        <form
          className="mt-5 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!newName.trim()) return
            if (await call({ action: 'create', name: newName })) setNewName('')
          }}
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New category — e.g. Swimming club"
            className="flex-1 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-base"
          />
          <button
            type="submit"
            disabled={busy || !newName.trim()}
            className="rounded-md bg-[var(--color-accent)] px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            Add
          </button>
        </form>

        {error && (
          <p className="mt-3 rounded-md bg-[var(--color-alert-soft)] px-3 py-2 text-sm text-[var(--color-alert)]">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}

function WordList({
  category,
  busy,
  error,
  onBack,
  onCall,
}: {
  category: ChildCategory
  busy: boolean
  error: string | null
  onBack: () => void
  onCall: (body: Record<string, unknown>) => Promise<boolean>
}) {
  const [name, setName] = useState(category.name)
  const [label, setLabel] = useState('')
  const [spoken, setSpoken] = useState('')

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={category.name}
    >
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-[var(--color-surface)] p-5 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4">
          <button
            type="button"
            onClick={onBack}
            className="rounded-md border border-[var(--color-line)] px-3 py-1.5 text-sm"
          >
            ← All categories
          </button>
          {category.built_in === 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (await onCall({ action: 'delete', categoryId: category.category_id })) onBack()
              }}
              className="rounded-md border border-[var(--color-alert)] px-3 py-1.5 text-sm text-[var(--color-alert)]"
            >
              Delete
            </button>
          )}
        </div>

        <label className="mt-4 block">
          <span className="text-sm font-medium">Category name</span>
          <div className="mt-1 flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-base"
            />
            <button
              type="button"
              disabled={busy || name === category.name || !name.trim()}
              onClick={() =>
                void onCall({ action: 'rename', categoryId: category.category_id, name })
              }
              className="rounded-md border border-[var(--color-line)] px-3 py-2 text-sm disabled:opacity-40"
            >
              Rename
            </button>
          </div>
        </label>

        <p className="mt-5 text-sm font-medium">
          Words ({category.words.length})
        </p>
        <ul className="mt-2 divide-y divide-[var(--color-line)]">
          {category.words.map((w: CategoryWord) => (
            <li key={w.word_id} className="flex items-center gap-3 py-2">
              <CardFace label={w.symbol ?? w.label} size={26} showLabel={false} />
              <span className="flex-1">
                <span className="font-medium">{w.label}</span>
                <span className="block text-xs text-[var(--color-ink-muted)]">{w.spoken_text}</span>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onCall({ action: 'remove-word', wordId: w.word_id })}
                className="shrink-0 rounded border border-[var(--color-line)] px-2 py-1 text-sm"
                aria-label={`Remove ${w.label}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>

        <form
          className="mt-4 space-y-2 rounded-md border border-[var(--color-line)] p-3"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!label.trim()) return
            if (
              await onCall({
                action: 'add-word',
                categoryId: category.category_id,
                label,
                spokenText: spoken || undefined,
              })
            ) {
              setLabel('')
              setSpoken('')
            }
          }}
        >
          <p className="text-sm font-medium">Add a word</p>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Word on the card — e.g. goggles"
            className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-base"
          />
          <input
            value={spoken}
            onChange={(e) => setSpoken(e.target.value)}
            placeholder="What it says out loud (optional)"
            className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-base"
          />
          <button
            type="submit"
            disabled={busy || !label.trim()}
            className="w-full rounded-md bg-[var(--color-accent)] px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            Add
          </button>
          <p className="text-xs text-[var(--color-ink-faint)]">
            A picture is found automatically — the built-in set first, and only made if nothing
            matches.
          </p>
        </form>

        {error && (
          <p className="mt-3 rounded-md bg-[var(--color-alert-soft)] px-3 py-2 text-sm text-[var(--color-alert)]">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}

function move(ids: string[], from: number, to: number): string[] {
  const next = [...ids]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}
