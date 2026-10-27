// Dev tool: dump a PDF's text items with their geometry, to see what structure
// the layout reconstruction has to work from. `node scripts/inspect-pdf.mjs x.pdf`
import { readFile } from 'node:fs/promises'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

const path = process.argv[2]
const data = new Uint8Array(await readFile(path))
const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise
console.log('pages:', doc.numPages)
const meta = await doc.getMetadata()
console.log('meta:', JSON.stringify(meta.info))

for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p)
  const tc = await page.getTextContent()
  const ops = await page.getOperatorList()
  const imgOps = ops.fnArray.filter(
    (fn) => fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject
  ).length
  console.log(
    `\n=== page ${p} viewport ${JSON.stringify(page.view)} items=${tc.items.length} imageOps=${imgOps}`
  )
  for (const it of tc.items) {
    if (!('str' in it)) continue
    const [, , , , x, y] = it.transform
    console.log(
      `y=${y.toFixed(1)} x=${x.toFixed(1)} h=${it.height.toFixed(1)} font=${it.fontName} eol=${it.hasEOL ? 1 : 0} w=${(it.width ?? 0).toFixed(1)} :: ${JSON.stringify(it.str)}`
    )
  }
}
