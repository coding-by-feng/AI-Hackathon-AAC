/**
 * Choosing a voice worth listening to.
 *
 * The board previously called `new SpeechSynthesisUtterance(text)` with no
 * voice set, which hands the choice to the OS. On macOS that is often 'Albert'
 * or a novelty voice; on Android an eSpeak voice; sometimes the wrong language
 * entirely. The device usually already has something much better installed.
 *
 * Cloud TTS is deliberately not an option here. A board that cannot speak
 * during a wifi outage has failed at the one job it has, so speech never
 * depends on a network.
 */

export type VoiceChoice = {
  voiceURI: string | null
  rate: number
  pitch: number
}

export const DEFAULT_VOICE: VoiceChoice = {
  voiceURI: null,
  // Under natural pace on purpose: a synthetic voice at 1.0 outruns a listening
  // partner, and being understood the first time is the whole point.
  rate: 0.95,
  pitch: 1,
}

/** Voices that are consistently good and widely installed. */
const PREFERRED = [
  'samantha',
  'google uk english female',
  'google uk english male',
  'google us english',
  'microsoft aria',
  'microsoft libby',
  'microsoft sonia',
  'daniel',
  'karen',
  'moira',
  'tessa',
  'serena',
]

/** Novelty and robotic voices. Never a sensible default for a person's voice. */
const AVOID = [
  'albert',
  'bad news',
  'bahh',
  'bells',
  'boing',
  'bubbles',
  'cellos',
  'deranged',
  'good news',
  'jester',
  'organ',
  'superstar',
  'trinoids',
  'whisper',
  'wobble',
  'zarvox',
  'espeak',
  'pipe organ',
]

export function scoreVoice(v: SpeechSynthesisVoice, pageLang = 'en-GB'): number {
  const name = v.name.toLowerCase()
  let score = 0

  // A local voice never makes a network round-trip, so it cannot fail offline
  // or introduce latency mid-sentence. This outweighs everything else.
  if (v.localService) score += 100

  if (PREFERRED.some((p) => name.includes(p))) score += 50
  if (/(natural|enhanced|premium|neural)/.test(name)) score += 30
  if (AVOID.some((bad) => name.includes(bad))) score -= 80

  if (v.lang === pageLang) score += 10
  else if (v.lang.startsWith('en')) score += 5

  return score
}

export function rankVoices(
  voices: SpeechSynthesisVoice[],
  pageLang = 'en-GB',
): SpeechSynthesisVoice[] {
  return voices
    .filter((v) => v.lang.toLowerCase().startsWith('en'))
    .map((v) => ({ v, s: scoreVoice(v, pageLang) }))
    .sort((a, b) => b.s - a.s || a.v.name.localeCompare(b.v.name))
    .map((x) => x.v)
}

export function bestVoice(
  voices: SpeechSynthesisVoice[],
  pageLang = 'en-GB',
): SpeechSynthesisVoice | null {
  return rankVoices(voices, pageLang)[0] ?? null
}

export function resolveVoice(
  choice: VoiceChoice,
  voices: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | null {
  if (choice.voiceURI) {
    const picked = voices.find((v) => v.voiceURI === choice.voiceURI)
    // A chosen voice can vanish — a different device, or the OS removing it.
    // Falling back to the best available beats falling back to whatever is first.
    if (picked) return picked
  }
  return bestVoice(voices)
}

const KEY = 'aac.voice'

export function loadVoiceChoice(childId: string): VoiceChoice {
  if (typeof localStorage === 'undefined') return DEFAULT_VOICE
  try {
    const raw = localStorage.getItem(`${KEY}.${childId}`)
    if (!raw) return DEFAULT_VOICE
    return { ...DEFAULT_VOICE, ...(JSON.parse(raw) as Partial<VoiceChoice>) }
  } catch {
    return DEFAULT_VOICE
  }
}

export function saveVoiceChoice(childId: string, choice: VoiceChoice): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(`${KEY}.${childId}`, JSON.stringify(choice))
}

/** Where a better voice actually comes from — an OS download, not our app. */
export const BETTER_VOICE_HELP: { platform: string; path: string }[] = [
  { platform: 'iPad / iPhone', path: 'Settings → Accessibility → Spoken Content → Voices' },
  { platform: 'Android', path: 'Settings → Accessibility → Text-to-speech output' },
  { platform: 'Mac', path: 'System Settings → Accessibility → Spoken Content → System Voice' },
  { platform: 'Windows', path: 'Settings → Time & Language → Speech → Manage voices' },
]
