/**
 * SMIL Generator for EPUB3 Media Overlays
 * Generates the synchronized multimedia integration language files
 * that map text elements to audio segments.
 */

export interface SmilPar {
  textSrc: string // e.g., "chapter1.xhtml#p1"
  audioSrc: string // e.g., "audio/chapter1.mp3"
  clipBegin: number // seconds
  clipEnd: number // seconds
}

export interface SmilData {
  id: string
  duration: number // total duration in seconds
  pars: SmilPar[]
}

/**
 * Formats seconds into SMIL clock value (HH:MM:SS.ms)
 */
function formatSmilTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`
}

export function generateSmil(data: SmilData): string {
  const parsXml = data.pars
    .map(
      (par, index) => `
    <par id="par${index + 1}">
      <text src="${par.textSrc}"/>
      <audio src="${par.audioSrc}" clipBegin="${formatSmilTime(par.clipBegin)}" clipEnd="${formatSmilTime(par.clipEnd)}"/>
    </par>`
    )
    .join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL" xmlns:epub="http://www.idpf.org/2007/ops" version="3.0">
  <body>
    <seq id="seq1" epub:textref="${data.pars[0]?.textSrc.split('#')[0] || ''}" epub:type="bodymatter chapter">
      ${parsXml}
    </seq>
  </body>
</smil>`
}
