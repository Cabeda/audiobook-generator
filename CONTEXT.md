# Domain Context

## Glossary

| Term                  | Definition                                                                                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Segment               | A single sentence-level unit of text within a chapter, mapped 1:1 to an audio blob                                                                                      |
| Mismatched Segment    | A segment whose stored `voice` or `model` differs from the chapter's current effective TTS settings. Segments with undefined voice/model are NOT considered mismatched. |
| Effective Voice/Model | The resolved TTS voice and model for a chapter, accounting for chapter overrides, language defaults, and global settings (in that priority order)                       |
| Reprocess             | Delete mismatched segments from storage and trigger normal generation, which auto-skips existing compatible segments and regenerates only the missing ones              |
