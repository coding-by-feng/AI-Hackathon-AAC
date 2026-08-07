'use client'

import { useEffect, useState } from 'react'
import { onVoicesReady, speak } from '@/lib/kid/speech'
import {
  rankVoices,
  saveVoiceChoice,
  BETTER_VOICE_HELP,
  type VoiceChoice,
} from '@/lib/kid/voice'

const SAMPLE = 'I want water, please.'

/**
 * Choosing the voice.
 *
 * Only voices already installed on the device are offered. Cloud TTS sounds
 * better and is deliberately absent: a board that goes quiet during a wifi
 * outage has failed at its only job.
 */
export function VoicePicker({
  childId,
  childName,
  choice,
  onChange,
  onClose,
}: {
  childId: string
  childName: string
  choice: VoiceChoice
  onChange: (c: VoiceChoice) => void
  onClose: () => void
}) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [draft, setDraft] = useState<VoiceChoice>(choice)

  useEffect(() => onVoicesReady((v) => setVoices(rankVoices(v))), [])

  const firstName = childName.split(' ')[0]

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={`Voice for ${firstName}`}
    >
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-[var(--color-surface)] p-5 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold">Voice for {firstName}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--color-line)] px-3 py-1.5 text-sm"
          >
            Close
          </button>
        </div>

        {voices.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--color-ink-muted)]">
            No voices found on this device yet.
          </p>
        ) : (
          <ul className="mt-4 space-y-1">
            {voices.slice(0, 8).map((v) => (
              <li key={v.voiceURI}>
                <label className="flex items-center gap-3 rounded-md border border-[var(--color-line)] p-3">
                  <input
                    type="radio"
                    name="voice"
                    checked={draft.voiceURI === v.voiceURI}
                    onChange={() => setDraft({ ...draft, voiceURI: v.voiceURI })}
                    className="h-5 w-5"
                  />
                  <span className="flex flex-1 flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{v.name}</span>
                    <span className="text-xs text-[var(--color-ink-faint)]">
                      {v.lang}
                      {v.localService ? ' · on device' : ' · needs network'}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => speak(SAMPLE, { ...draft, voiceURI: v.voiceURI })}
                    className="rounded-md border border-[var(--color-line)] px-3 py-1.5 text-sm"
                  >
                    Try
                  </button>
                </label>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="flex justify-between text-sm font-medium">
              <span>Speed</span>
              <span className="tabular-nums text-[var(--color-ink-muted)]">
                {draft.rate.toFixed(2)}×
              </span>
            </span>
            <input
              type="range"
              min={0.6}
              max={1.4}
              step={0.05}
              value={draft.rate}
              onChange={(e) => setDraft({ ...draft, rate: Number(e.target.value) })}
              className="mt-1 w-full"
            />
            <span className="text-xs text-[var(--color-ink-muted)]">
              Slower is usually clearer. A synthetic voice at full speed outruns the listener.
            </span>
          </label>

          <label className="block">
            <span className="flex justify-between text-sm font-medium">
              <span>Pitch</span>
              <span className="tabular-nums text-[var(--color-ink-muted)]">
                {draft.pitch.toFixed(1)}
              </span>
            </span>
            <input
              type="range"
              min={0.6}
              max={1.6}
              step={0.1}
              value={draft.pitch}
              onChange={(e) => setDraft({ ...draft, pitch: Number(e.target.value) })}
              className="mt-1 w-full"
            />
          </label>
        </div>

        <button
          type="button"
          onClick={() => speak(SAMPLE, draft)}
          className="mt-4 w-full rounded-md border border-[var(--color-line)] px-4 py-3 font-medium"
        >
          Try: “{SAMPLE}”
        </button>

        <details className="mt-5 text-sm">
          <summary className="cursor-pointer font-medium">
            This device may have better voices available
          </summary>
          <ul className="mt-2 space-y-1 text-[var(--color-ink-muted)]">
            {BETTER_VOICE_HELP.map((h) => (
              <li key={h.platform}>
                <strong>{h.platform}</strong> — {h.path}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[var(--color-ink-faint)]">
            Higher-quality voices are installed through the operating system, then appear here.
          </p>
        </details>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={() => {
              saveVoiceChoice(childId, draft)
              onChange(draft)
              onClose()
            }}
            className="flex-1 rounded-md bg-[var(--color-accent)] px-4 py-3 font-semibold text-white"
          >
            Use this voice
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--color-line)] px-4 py-3"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
