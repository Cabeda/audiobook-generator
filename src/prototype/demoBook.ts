// PROTOTYPE (throwaway): deterministic demo books so the prototype is testable
// even when the real library is empty. Not real prose, just plausible filler.
import type { Book, Chapter } from '../lib/types/book'

const SENTENCES = [
  'The road climbed through the pines until the town was a smudge of smoke below.',
  'She kept the letter in her coat pocket, folded into eighths, unread since Tuesday.',
  'Nobody in the village remembered the last time the mill had turned.',
  'He said it plainly, the way you report weather, and that made it worse.',
  'Rain found the gaps in the roof and made its own quiet arguments with the floor.',
  'The lamp threw their shadows long against the wall, and neither of them moved.',
  'There is a kind of silence that arrives only after a decision has been made.',
  'By morning the river had taken the bridge and half the fence with it.',
  'She counted the coins twice, then a third time, as if the number might improve.',
  'The dog waited at the gate every evening for a man who was not coming back.',
  'Everything he owned fit into one case, which he set down and did not pick up again.',
  'Wind came off the water carrying salt, coal smoke, and the sound of a far bell.',
  'They spoke of the old days the way sailors speak of a storm survived.',
  'The candle guttered, recovered, and gave the room back its shape.',
  'It was the sort of promise that costs nothing to make and everything to keep.',
  'Somewhere below, a door closed, and the whole house seemed to settle.',
]

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeChapter(bookSeed: number, index: number, title: string): Chapter {
  const rand = mulberry32(bookSeed * 1000 + index)
  const paras: string[] = []
  const paraCount = 8 + Math.floor(rand() * 8)
  for (let p = 0; p < paraCount; p++) {
    const sentences: string[] = []
    const count = 3 + Math.floor(rand() * 5)
    for (let s = 0; s < count; s++) {
      sentences.push(SENTENCES[Math.floor(rand() * SENTENCES.length)])
    }
    paras.push(`<p>${sentences.join(' ')}</p>`)
  }
  return {
    id: `demo-${bookSeed}-${index}`,
    title,
    content: paras.join('\n'),
  }
}

export function makeDemoBooks(): Book[] {
  const specs: Array<{ title: string; author: string; chapters: string[] }> = [
    {
      title: 'The Quiet Mill',
      author: 'Demo Author',
      chapters: [
        'I. Smoke Below',
        'II. The Letter',
        'III. What the River Took',
        'IV. Salt and Coal',
        'V. The Gate at Evening',
        'VI. A Far Bell',
        'VII. The House Settles',
        'VIII. Plainly Said',
      ],
    },
    {
      title: 'Weather Reports',
      author: 'Demo Author',
      chapters: ['First Front', 'Second Front', 'The Long Dry', 'Flood Year', 'After the Storm'],
    },
  ]

  return specs.map((spec, i) => ({
    title: spec.title,
    author: spec.author,
    format: 'demo',
    chapters: spec.chapters.map((c, ci) => makeChapter(i + 1, ci, c)),
  }))
}
