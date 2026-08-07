# Utterance Assembly & Speech Output

## Function
Turns the selected cards into one sentence (`buildUtterance`), speaks it through the Web Speech API with a ranked, device-local voice, and gives adults a picker for voice, speed and pitch.

## Purpose
Two bugs and one hard rule shaped this feature.

The bug: `cards.spoken_text` is inconsistent — some rows hold a bare word (`'I'`), some a fragment (`'I want'`), some a whole sentence (`'I want water.'`). Chaining them produced **"I I want I want water."** So a card now carries two forms: a *word* form for mid-sentence use and a *phrase* form for when it is pressed alone.

The second bug: calling `new SpeechSynthesisUtterance(text)` with no voice set hands the choice to the OS, which on macOS is often `Albert` or a novelty voice, on Android an eSpeak voice, and sometimes the wrong language entirely.

The rule: **cloud TTS is deliberately absent.** "A board that cannot speak during a wifi outage has failed at the one job it has." The join is also deliberately plain — no conjugation, no rewriting: "I go toilet" is telegraphic and completely understood, and a system that silently improves a child's wording is deciding what they meant.

## Source Files
| File | Role |
|------|------|
| `lib/kid/sentence.ts` | Word/phrase forms, `buildUtterance`, the seeded word-form override table. |
| `lib/kid/speech.ts` | Web Speech API wrapper: `isSupported`, `unlock`, `speak`, `stop`, `voices`, `onVoicesReady`. |
| `lib/kid/voice.ts` | Voice scoring/ranking, `VoiceChoice` persistence, OS help paths. |
| `components/kid/voice-picker.tsx` | The adult-facing voice modal with Try buttons and speed/pitch sliders. |

## Implementation

### Utterance assembly (`lib/kid/sentence.ts`)
```ts
type SpeakableCard = { card_id, label, spoken_text, word_form?, is_essential? }
type Utterance = { text: string; mode: 'phrase' | 'joined' }
```
- `wordForm(card)` → `card.word_form.trim()` if non-empty, else `card.label.trim()`. `spoken_text` is never used here — it is a sentence, and that is exactly what caused the repetition.
- `phraseForm(card)` → `spoken_text.trim()`, else the word form capitalised with a full stop appended.
- `buildUtterance(cards)`:
  - `cards.length === 0` → `null`
  - `cards.length === 1` → `{ text: phraseForm(cards[0]), mode: 'phrase' }`
  - otherwise → word forms joined with a single space, first word capitalised (`needsCapital(i) === (i === 0)`), `'.'` appended, `mode: 'joined'`.
- An essential word pressed **inside** a sentence contributes its word form; the urgent full-phrase reading only wins when it is the only card, which the single-card branch already covers.
- `previewChips(cards)` returns `cards.map(c => c.label)`. (The board renders `c.card.label` directly and does not currently call this helper.)

Typed words join assembly as synthetic cards: the board's `addTypedWord` composes `{card_id: 'typed:<w>', label, word_form, spoken_text}` with all three text fields set to the literal typed word ([Keyboard & Modelling Help](keyboard-and-modeling-help.md)). Mid-sentence the word form joins like any card's; a lone typed word takes the phrase branch, and because its `spoken_text` is non-empty, `phraseForm` returns it as-is — the raw word, with no capitalisation and no full stop applied.

`WORD_FORM_OVERRIDES` — listed explicitly rather than guessed by rule, "because a wrong guess puts words in a child's mouth":
| label | word form |
|---|---|
| `toilet` | `the toilet` |
| `hurt` | `hurts` |
| `all done` | `all done` |
| `thank you` | `thank you` |

`seededWordForm(cardId, label)` → `WORD_FORM_OVERRIDES[label.toLowerCase()] ?? label`. Called by `app/page.tsx` for every card before overrides are applied.

### Speech (`lib/kid/speech.ts`)
Three browser realities are called out in the header comment and each maps to code:
1. **iOS Safari will not speak until `speechSynthesis` has been touched inside a real user gesture.** `unlock()` speaks an empty `SpeechSynthesisUtterance` with `volume = 0`, guarded by a module-level `unlocked` flag. Nothing in this module is `async`, so `speak()` stays inside the click handler.
2. **`getVoices()` is empty on first call** and fills in later via `voiceschanged`. `onVoicesReady(cb)` calls back immediately and again on every `voiceschanged`, returning an unsubscribe function.
3. **The OS default is frequently a novelty voice**, so ranking lives in `lib/kid/voice.ts` and this module only plays what it is given.

`speak(text, choice = DEFAULT_VOICE)`:
- returns early if unsupported or `text.trim()` is empty
- `synth.cancel()` first — **barge-in**: a new sentence always replaces the one in progress, because queueing leaves a mis-press waiting out a sentence nobody meant
- sets `u.rate = choice.rate`, `u.pitch = choice.pitch`
- `resolveVoice(choice, synth.getVoices())`; if a voice is found it also sets `u.lang = voice.lang`, otherwise `u.lang = 'en-GB'`

`stop()` → `speechSynthesis.cancel()`. `isSupported()` → `'speechSynthesis' in window`.

### Voice ranking (`lib/kid/voice.ts`)
```ts
DEFAULT_VOICE = { voiceURI: null, rate: 0.95, pitch: 1 }
```
`rate` is under natural pace on purpose: "a synthetic voice at 1.0 outruns a listening partner, and being understood the first time is the whole point."

`scoreVoice(v, pageLang = 'en-GB')`:
| Condition | Delta |
|---|---|
| `v.localService` | **+100** — a local voice cannot fail offline or add mid-sentence latency; this outweighs everything else |
| name contains a `PREFERRED` entry | +50 |
| name matches `/(natural\|enhanced\|premium\|neural)/` | +30 |
| name contains an `AVOID` entry | **−80** |
| `v.lang === pageLang` | +10 |
| else `v.lang.startsWith('en')` | +5 |

`PREFERRED` (12): `samantha`, `google uk english female`, `google uk english male`, `google us english`, `microsoft aria`, `microsoft libby`, `microsoft sonia`, `daniel`, `karen`, `moira`, `tessa`, `serena`.

`AVOID` (18): `albert`, `bad news`, `bahh`, `bells`, `boing`, `bubbles`, `cellos`, `deranged`, `good news`, `jester`, `organ`, `superstar`, `trinoids`, `whisper`, `wobble`, `zarvox`, `espeak`, `pipe organ`.

`rankVoices` filters to `v.lang.toLowerCase().startsWith('en')`, sorts by score descending then by name. `bestVoice` returns the head or `null`. `resolveVoice(choice, voices)` returns the voice matching `choice.voiceURI` when it is still installed, otherwise falls back to `bestVoice` — "a chosen voice can vanish, and falling back to the best available beats falling back to whatever is first."

**Storage key:** `localStorage['aac.voice.<childId>']` holding `JSON.stringify(VoiceChoice)`. `loadVoiceChoice` merges over `DEFAULT_VOICE` and returns `DEFAULT_VOICE` on any parse error or when `localStorage` is unavailable. Per-child, so two children sharing a tablet do not share a voice.

`BETTER_VOICE_HELP` — where a better voice actually comes from (an OS download, not this app):
| Platform | Path |
|---|---|
| iPad / iPhone | Settings → Accessibility → Spoken Content → Voices |
| Android | Settings → Accessibility → Text-to-speech output |
| Mac | System Settings → Accessibility → Spoken Content → System Voice |
| Windows | Settings → Time & Language → Speech → Manage voices |

### Voice picker (`components/kid/voice-picker.tsx`)
- Modal `role="dialog" aria-modal="true" aria-label="Voice for <FirstName>"`, opened from the board's `Voice` button.
- `SAMPLE = 'I want water, please.'`
- Subscribes with `onVoicesReady(v => setVoices(rankVoices(v)))` and shows **the top 8** (`voices.slice(0, 8)`) as radio rows. Each row shows the voice name, its `lang`, and `· on device` when `v.localService` is true, otherwise `· needs network`. Each row has a `Try` button that speaks the sample with that voice immediately.
- Empty state: *"No voices found on this device yet."*
- **Speed** slider: `min 0.6`, `max 1.4`, `step 0.05`, displayed as `n.nn×`, with the note *"Slower is usually clearer. A synthetic voice at full speed outruns the listener."*
- **Pitch** slider: `min 0.6`, `max 1.6`, `step 0.1`, displayed to one decimal.
- Full-width `Try: "I want water, please."` button.
- A `<details>` disclosure — *"This device may have better voices available"* — lists `BETTER_VOICE_HELP`.
- `Use this voice` → `saveVoiceChoice(childId, draft)`, `onChange(draft)`, `onClose()`. `Cancel` discards the draft; nothing is saved until the primary button is pressed.

## Dependencies & Connections

### Depends On
- Web Speech API `speechSynthesis` — the only TTS path; there is no server or cloud fallback.
- `localStorage` for the per-child voice choice.

### Depended On By
- [Communication Board](communication-board.md) — calls `buildUtterance` for the sentence-bar preview and the `speak` event's `assembly` field, `unlock`/`speak`/`stop`/`isSupported` for output, and `wordForm` for hold-to-hear: `previewCard` speaks a held card's word form without adding it to the sentence — the only path that speaks a word form outside `buildUtterance`.
- [Card Customisation](card-customisation.md) — the edit sheet's "In a sentence, this word is" and "On its own, it says" fields set exactly the `word_form` and `spoken_text` that this module consumes.
- ../analytics/metric-readers.md — `speak.payload.assembly` (`phrase` | `joined`) and `wordCount` come from `buildUtterance`'s output.

### Shared Resources
- `localStorage` key prefix `aac.voice.`
- The module-level `unlocked` flag in `lib/kid/speech.ts` (per page load).
- `WORD_FORM_OVERRIDES`, shared between the seeder in `app/page.tsx` and any future authoring tool.

## Change Risks
- **Adding a cloud TTS provider** breaks the pinned decision that "communication never blocks on AI" — the board would go silent in a school wifi outage.
- **Making `speak()` async, or awaiting anything before it**, breaks the iOS unlock: the call must stay synchronous inside the click handler or Safari never speaks at all.
- **Removing `synth.cancel()`** turns barge-in into queueing, so a mis-press forces the user to wait out a sentence they did not mean.
- **Chaining `spoken_text` instead of `word_form`** in `buildUtterance` re-creates "I I want I want water."
- **Adding conjugation or LLM rewriting to the join** crosses the line the header comment draws: the system would be deciding what the child meant, and speech would start depending on a network.
- **Changing the `aac.voice.<childId>` key format** silently resets every child to `DEFAULT_VOICE` (no migration exists) — recoverable but disorienting for a child who knows their voice.
- **Dropping the `localService` +100 weight** lets a network voice win the ranking, which reintroduces mid-sentence latency and offline failure.
