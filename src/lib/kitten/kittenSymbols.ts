/**
 * The character table the KittenTTS 0.8 ONNX graph was trained with: index =
 * token id, so this string is copied verbatim from upstream, in upstream order
 * — pad, punctuation (including the space), ASCII letters, then the IPA letters
 * espeak-ng emits. Source: `TextCleaner` in
 * kittenml/kittentts_legacy/onnx_model.py, KittenML/KittenTTS.
 *
 * 0 = pad, 1-16 = punctuation, 17-68 = letters, 69-177 = IPA.
 *
 * Unknown characters are dropped rather than substituted: upstream's `__call__`
 * skips them, and a stand-in would change what the model says.
 */
const SYMBOLS =
  '$;:,.!?¡¿—…"«»"" ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟʄɡɠɢʛɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒʔʡʕʢǀǁǂǃˈˌːˑʼʴʰʱʲʷˠˤ˞↓↑→↗↘\'̩\'ᵻ'

const IDS = new Map(Array.from(SYMBOLS).map((char, index) => [char, index]))

/** Token id for one character, or undefined when the model has no token for it. */
export function symbolId(char: string): number | undefined {
  return IDS.get(char)
}

/** The whole table, for tests and for asserting the upstream length. */
export const KITTEN_SYMBOLS = SYMBOLS
