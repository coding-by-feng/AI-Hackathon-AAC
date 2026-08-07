/**
 * Text to speech, via the Web Speech API.
 *
 * Three browser realities shape this:
 *
 *  1. iOS Safari will not speak until speechSynthesis has been touched inside a
 *     real user gesture. The first Speak press unlocks it — but only if we call
 *     speak() synchronously in that handler, which is why `unlock()` exists and
 *     why nothing here is async.
 *  2. getVoices() is empty on first call in most browsers and fills in later
 *     via voiceschanged. Picking a voice eagerly gets you the wrong one.
 *  3. Left to itself the OS hands over whatever voice is first in its list,
 *     which is frequently a novelty voice. lib/kid/voice.ts ranks what is
 *     actually installed; this module only plays what it is given.
 */
import { resolveVoice, DEFAULT_VOICE, type VoiceChoice } from './voice'

let unlocked = false

export function isSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/** Call inside a click handler, once. Silent utterance, purely to satisfy iOS. */
export function unlock(): void {
  if (unlocked || !isSupported()) return
  const u = new SpeechSynthesisUtterance('')
  u.volume = 0
  window.speechSynthesis.speak(u)
  unlocked = true
}

export function speak(text: string, choice: VoiceChoice = DEFAULT_VOICE): void {
  if (!isSupported() || !text.trim()) return
  const synth = window.speechSynthesis

  // Barge-in: a new sentence always replaces the one in progress. Queuing means
  // a mis-press leaves the user waiting for a sentence they did not mean.
  synth.cancel()

  const u = new SpeechSynthesisUtterance(text)
  u.rate = choice.rate
  u.pitch = choice.pitch

  const voice = resolveVoice(choice, synth.getVoices())
  if (voice) {
    u.voice = voice
    u.lang = voice.lang
  } else {
    u.lang = 'en-GB'
  }

  synth.speak(u)
}

export function stop(): void {
  if (isSupported()) window.speechSynthesis.cancel()
}

export function voices(): SpeechSynthesisVoice[] {
  return isSupported() ? window.speechSynthesis.getVoices() : []
}

/** getVoices() is populated asynchronously; this fires again once it is. */
export function onVoicesReady(cb: (v: SpeechSynthesisVoice[]) => void): () => void {
  if (!isSupported()) return () => {}
  const handler = () => cb(window.speechSynthesis.getVoices())
  handler()
  window.speechSynthesis.addEventListener('voiceschanged', handler)
  return () => window.speechSynthesis.removeEventListener('voiceschanged', handler)
}
