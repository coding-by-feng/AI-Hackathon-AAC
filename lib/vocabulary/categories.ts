/**
 * Category folders.
 *
 * The robust grid holds the words a child uses constantly, and it never
 * changes — that is the whole point of it (clinical constraints C2/C3). But 15
 * cells cannot hold a vocabulary, and a child with no way to reach "angry" or
 * "seven" simply cannot say them.
 *
 * So categories are a SECOND surface, not a rearrangement of the first. Opening
 * "Feelings" slides a drawer over the board; the grid underneath is untouched
 * and every button stays exactly where it was learned.
 *
 * Words reached this way are logged with nav_depth 1, which is what lets the
 * dashboard's I3 rule notice a drawer word being used constantly and suggest
 * adding a copy of it to the grid.
 */

/**
 * Category ids are arbitrary now that adults can create folders. The built-in
 * eleven keep their readable keys as the seed; anything added later gets a
 * generated id.
 */
export type CategoryKey = string

export type Category = {
  key: CategoryKey
  name: string
  /** Matched against cards.category for words already in the database. */
  dbCategories: string[]
  /** Vocabulary the seeded catalogue does not contain. */
  extras: { label: string; spoken: string }[]
}

export const CATEGORIES: Category[] = [
  {
    key: 'feelings',
    name: 'Feelings',
    dbCategories: [],
    extras: [
      { label: 'happy', spoken: 'I feel happy.' },
      { label: 'sad', spoken: 'I feel sad.' },
      { label: 'angry', spoken: 'I feel angry.' },
      { label: 'scared', spoken: 'I feel scared.' },
      { label: 'tired', spoken: 'I feel tired.' },
      { label: 'excited', spoken: 'I feel excited!' },
      { label: 'hungry', spoken: "I'm hungry." },
      { label: 'thirsty', spoken: "I'm thirsty." },
    ],
  },
  {
    key: 'food',
    name: 'Food & drink',
    dbCategories: ['food', 'drink'],
    extras: [
      { label: 'apple', spoken: 'I would like an apple.' },
      { label: 'juice', spoken: 'Can I have some juice?' },
      { label: 'sandwich', spoken: 'I would like a sandwich.' },
      { label: 'banana', spoken: 'I would like a banana.' },
    ],
  },
  {
    key: 'activities',
    name: 'Things to do',
    dbCategories: ['play', 'activity'],
    extras: [
      { label: 'play', spoken: 'I want to play.' },
      { label: 'draw', spoken: 'I want to draw.' },
      { label: 'sing', spoken: 'I want to sing.' },
      { label: 'dance', spoken: 'I want to dance.' },
      { label: 'walk', spoken: 'I want to go for a walk.' },
      { label: 'garden', spoken: 'I want to go to the garden.' },
    ],
  },
  {
    key: 'behaviour',
    name: 'Taking turns',
    dbCategories: [],
    extras: [
      { label: 'my turn', spoken: "It's my turn." },
      { label: 'your turn', spoken: "It's your turn." },
      { label: 'wait', spoken: 'Please wait.' },
      { label: 'share', spoken: 'Can we share?' },
      { label: 'break', spoken: 'I need a break.' },
      { label: 'listen', spoken: 'Please listen to me.' },
      { label: 'gentle', spoken: 'Please be gentle.' },
      { label: 'sorry', spoken: "I'm sorry." },
    ],
  },
  {
    key: 'numbers',
    name: 'Numbers',
    dbCategories: [],
    extras: Array.from({ length: 10 }, (_, i) => ({
      label: String(i + 1),
      spoken: String(i + 1),
    })),
  },
  { key: 'people', name: 'People', dbCategories: ['people'], extras: [] },
  { key: 'places', name: 'Places', dbCategories: ['place'], extras: [] },
  { key: 'body', name: 'Body', dbCategories: ['body'], extras: [] },
  {
    key: 'describing',
    name: 'Describing',
    dbCategories: ['vehicle'],
    extras: [
      { label: 'big', spoken: 'big' },
      { label: 'little', spoken: 'little' },
      { label: 'hot', spoken: 'hot' },
      { label: 'cold', spoken: 'cold' },
      { label: 'fast', spoken: 'fast' },
      { label: 'slow', spoken: 'slow' },
    ],
  },
]

export type DrawerWord = {
  /** Present only for words that exist in the `cards` table. */
  card_id: string | null
  label: string
  spoken_text: string
  /** True when the word also sits on the robust grid — shown, but marked. */
  onBoard: boolean
}

export function categoryByKey(key: string): Category | undefined {
  return CATEGORIES.find((c) => c.key === key)
}
