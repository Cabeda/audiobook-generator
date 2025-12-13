/**
 * SMIL Generator for EPUB3 Media Overlays
 * Generates the synchronized multimedia integration language files
 * that map text elements to audio segments.
 *
 * Follows EPUB 3.3 specification section 9 (Media Overlays) and SMIL 3.0
 * https://www.w3.org/TR/epub/#sec-media-overlays
 */

export interface SmilPar {
  textSrc: string // e.g., "../chapter1.xhtml#seg-0"
  audioSrc: string // e.g., "../audio/chapter1.mp3"
  clipBegin: number // seconds
  clipEnd: number // seconds
}

export interface SmilData {
  id: string
  duration: number // total duration in seconds
  pars: SmilPar[]
}

/**
 * Formats seconds into SMIL clock value
 * EPUB 3.3 supports various clock value formats including:
 * - Full clock: HH:MM:SS.ms (npt=hh:mm:ss.sss)
 * - Partial clock: MM:SS.ms
 * - Timecount: XXs, XXms, XXmin, XXh
 * Using timecount format (seconds) for simplicity and precision
 */
function formatSmilTime(seconds: number): string {
  // Use timecount format (e.g., "23.456s") which is simpler and widely supported
  return `${seconds.toFixed(3)}s`
}

/**
 * Generates a SMIL 3.0 document for EPUB Media Overlays
 */
export function generateSmil(data: SmilData): string {
  // Get the XHTML document path from the first par (without the fragment)
  const xhtmlPath = data.pars[0]?.textSrc.split('#')[0] || ''

  // Generate all par elements
  const parsXml = data.pars
    .map(
      (par, index) => `    <par id="par${index + 1}">
      <text src="${par.textSrc}"/>
      <audio src="${par.audioSrc}" clipBegin="${formatSmilTime(par.clipBegin)}" clipEnd="${formatSmilTime(par.clipEnd)}"/>
    </par>`
    )
    .join('\n')

  // SMIL 3.0 document with body acting as the main seq
  // epub:textref points to the associated XHTML document
  return `<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL" xmlns:epub="http://www.idpf.org/2007/ops" version="3.0">
  <body epub:textref="${xhtmlPath}" epub:type="bodymatter chapter">
${parsXml}
  </body>
</smil>`
}
