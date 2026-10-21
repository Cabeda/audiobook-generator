# Generation runs two passes: fast at the cheapest tier, then upgraded in the background

A chapter is first generated with the cheapest quality tier available for its language, so the reader can start listening almost immediately. While the user listens, an upgrade pass re-generates upcoming segments at higher tiers and swaps them in ahead of playback. The device tier decides the ceiling of that climb; the starting rung is always tier 0.

The alternative — generate once at the best quality the device can handle — makes the first listen as slow as the worst case on every book, which is where users give up. The cost is that a segment can be generated twice, that playback has to tolerate audio being replaced underneath it, and that the tier ladder has to be resolved per language.

## Considered Options

- **Best quality first** — rejected: nothing plays until the whole chapter is done, and slow devices wait longest.
- **Let the user pick the tier up front** — rejected: it is a question the app can answer better than the user can, and it does not stop the wait.

## Consequences

- A segment records the tier it was generated at, so progress can tell what is still below the target.
- The upgrade pass climbs one rung at a time, so on a device whose ceiling is tier 2 a segment is generated up to three times.
