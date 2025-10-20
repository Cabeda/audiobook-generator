// Minimal tokenizer inspired by kokoro-web. This is a very small subset usable for demo.

const vocab: { [char: string]: number } = {}
let nextId = 1
for (let i = 32; i < 127; i++) {
  vocab[String.fromCharCode(i)] = nextId++
}

export const tokenize = (text: string): number[] => {
  const fallback = 0
  return [...text].map(c => vocab[c] ?? fallback)
}
