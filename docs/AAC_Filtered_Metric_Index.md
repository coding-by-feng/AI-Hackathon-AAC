# AAC Filtered Metric Index

This index contains only the selected metrics from the full AAC Analytics Specification.

**Legend** — `Tier`: P0 build now · P1 if time · P2 later. `Who`: T teacher · P parent · S speech therapist · ALL everyone. `Feeds`: the AI insight that depends on the metric. `Pol`: ↑ higher better · ↓ lower better · **=** neutral. A neutral metric must not be styled as good or bad. `★` marks a metric that carries the main product story.

## A. Effort & speed

| Ref | Metric · `id` | What it tells you | Pol | Tier · Who | min n | Feeds |
|---|---|---|---|---|---|---|
| A1 ★ | Taps per utterance · `taps_per_utterance` | How many buttons the child presses to say one thing. | ↓ | P0 · ALL | 5 | I3 |

## B. Errors & motor

| Ref | Metric · `id` | What it tells you | Pol | Tier · Who | min n | Feeds |
|---|---|---|---|---|---|---|
| B2 | Correction adjacency · `correction_adjacent_rate` | When the child fixes a mistake, how often the replacement is the button right next door. | = | P0 · T S | 10 | I1 |
| B4 | Grid heat map · `cell_heat` | Which grid positions get pressed, and where mistakes cluster. | = | P1 · S | 50 | I1 I3 |

## C. Volume & vocabulary

| Ref | Metric · `id` | What it tells you | Pol | Tier · Who | min n | Feeds |
|---|---|---|---|---|---|---|
| C1 ★ | Silence streak · `silence_streak` | Days since the child last said anything at all. | ↓ | P0 · ALL | 1 | — |
| C2 | Card frequency · `card_frequency` | Which cards the child actually uses, ranked. | = | P0 · ALL | 20 | I3 I4 |
| C3 | New words · `new_words` | Cards used for the very first time during this window. | ↑ | P0 · ALL | 1 | — |
| C7 | Word pairs · `word_pairs` | Which two words the child uses often but never together. | = | P1 · S | 10 | I5 |
| C8 | Core vs fringe mix · `core_fringe_ratio` | How much of the child's output is flexible core vocabulary versus specific nouns. | = | P1 · S | 50 | — |

## D. Layout & context

| Ref | Metric · `id` | What it tells you | Pol | Tier · Who | min n | Feeds |
|---|---|---|---|---|---|---|
| D1 | Path depth · `nav_depth_by_card` | How many screens deep a card is buried. | ↓ | P1 · T S | 10 | I3 |

## E. Whose voice

| Ref | Metric · `id` | What it tells you | Pol | Tier · Who | min n | Feeds |
|---|---|---|---|---|---|---|
| E3 | Adult modelling · `teacher_modeling` | How often the grown-up demonstrates on the device (aided language input). | ↑ | P1 · T S | 1 | I7 |

## G. Communication partner

| Ref | Metric · `id` | What it tells you | Pol | Tier · Who | min n | Feeds |
|---|---|---|---|---|---|---|
| G1 | Partner wait time · `partner_wait_time` | How long the adult waits before speaking again when the child has not yet responded. | ↑ | P2 · T S | 10 | I2 |

## H. Communication style

| Ref | Metric · `id` | What it tells you | Pol | Tier · Who | min n | Feeds |
|---|---|---|---|---|---|---|
| H1 | Repeated pressing (stimming/repeated-tap rate) · `repeat_tap_rate` | How often the child presses the same button several times in a row. | = | P0 · T S | 10 | I4 |
| H2 | Keyboard use · `keyboard_use` | Spelling and alphabet access—words typed rather than selected. | = | P2 · T S | 5 | — |

## Selected metric IDs

```text
taps_per_utterance
correction_adjacent_rate
cell_heat
silence_streak
card_frequency
new_words
word_pairs
core_fringe_ratio
nav_depth_by_card
teacher_modeling
partner_wait_time
repeat_tap_rate
keyboard_use
```
