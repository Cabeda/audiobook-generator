import { describe, it, expect } from 'vitest'
import { piperClient } from './piperClient'

/**
 * Integration test for Piper TTS using real model (no mocks).
 * These tests require the Piper model to be available and internet/downloads working.
 * Run with: pnpm test piperClient.integration.test.ts
 *
 * Note: These tests may be slow and require ~1GB+ download on first run.
 */
describe.skip('piperClient (real integration)', () => {
  const ptVoiceId = 'pt_PT-tugão-medium'

  // Portuguese article excerpt from Expresso
  const portugueseArticleShort =
    'Portugal é a "economia do ano" para a "The Economist". A revista britânica também escolheu "The Illegals", do jornalista britânico Shaun Walker, para a sua lista de melhores livros do ano.'

  const portugueseArticleLong =
    'Portugal é a "economia do ano" para a "The Economist". A revista britânica também escolheu "The Illegals", do jornalista britânico Shaun Walker, "Adolescence", da Netflix, e "Foi Só Um Acidente", do iraniano Jafar Panahi, para a sua lista de melhores livros, séries e filmes do ano, respetivamente. Mas na cultura como na economia as escolhas dependem dos critérios e nem sempre são consensuais. "Portugal surge como a "economia do ano" sobretudo porque estamos no fim do ano e, no final do ano, fazem-se listas. O artigo é leve e deve ser lido assim. É uma boa notícia e confirma que a economia está num momento favorável, mas não devemos atribuir mais significado do que isso", diz ao Expresso Gonçalo Pina, professor de Economia Internacional na ESCP Business School, em Berlim.'

  it('generates audio for short Portuguese article excerpt', async () => {
    const blob = await piperClient.generate(portugueseArticleShort, {
      voiceId: ptVoiceId,
    })

    expect(blob).toBeDefined()
    expect(blob.type).toBe('audio/wav')
    expect(blob.size).toBeGreaterThan(100)
  })

  it('generates audio for longer Portuguese article text', async () => {
    const blob = await piperClient.generate(portugueseArticleLong, {
      voiceId: ptVoiceId,
    })

    expect(blob).toBeDefined()
    expect(blob.type).toBe('audio/wav')
    expect(blob.size).toBeGreaterThan(100)
  })

  it('generates decodable audio with browser AudioContext', async () => {
    if (typeof window === 'undefined' || !('AudioContext' in window)) {
      expect.assertions(0)
      return
    }

    const blob = await piperClient.generate(portugueseArticleShort, {
      voiceId: ptVoiceId,
    })

    const arrayBuffer = await blob.arrayBuffer()
    const ctx = new AudioContext()
    const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0))

    expect(decoded.duration).toBeGreaterThan(0)
    expect(decoded.numberOfChannels).toBeGreaterThanOrEqual(1)
    ctx.close()
  })
})
