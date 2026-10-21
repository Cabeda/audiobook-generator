# Test fixtures

These files are inputs for the Pocket TTS tests. They are not part of the app.

| File                     | Source                                                                                                                                                                          | License                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `tokenizer.model`        | [kyutai/pocket-tts](https://huggingface.co/kyutai/pocket-tts) English SentencePiece tokenizer, mirrored in the [ONNX export](https://huggingface.co/maxime/pocket-tts-18m-onnx) | CC-BY-4.0 (Kyutai)         |
| `bundle.json`            | [maxime/pocket-tts-18m-onnx](https://huggingface.co/maxime/pocket-tts-18m-onnx) `english_18m_refl_2026-10` manifest                                                             | CC-BY-4.0 (Kyutai weights) |
| `tokenizer-vectors.json` | Token ids produced by the reference `sentencepiece` implementation for the strings in the test                                                                                  | —                          |
