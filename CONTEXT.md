# Domain Context

## Glossary

| Term                  | Definition                                                                                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Segment               | A single sentence-level unit of text within a chapter, mapped 1:1 to an audio blob                                                                                      |
| Mismatched Segment    | A segment whose stored `voice` or `model` differs from the chapter's current effective TTS settings. Segments with undefined voice/model are NOT considered mismatched. |
| Effective Voice/Model | The resolved TTS voice and model for a chapter, accounting for chapter overrides, language defaults, and global settings (in that priority order)                       |
| Reprocess             | Make a mismatched segment again with the chapter's current plan; the new audio replaces the stored one, and everything played from then on uses the new voice           |
