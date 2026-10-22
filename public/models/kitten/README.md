# KittenTTS voice table

`voices-v0.8.bin` is `voices.npz` from
[`KittenML/kitten-tts-nano-0.8-int8`](https://huggingface.co/KittenML/kitten-tts-nano-0.8-int8),
unwrapped into raw little-endian float32 so the browser can read it without a
zip or numpy parser.

Layout: eight voice tables back to back, in the order of
`KITTEN_BUNDLE_ORDER` in `src/lib/kitten/kittenVoices.ts` (which is alphabetical
by internal id). Each table is 400 rows of 256 floats. Row `n` is the style
vector for a chunk of `n` characters, clamped at row 399 — that is upstream's
`ref_id = min(len(text), rows - 1)`.

Regenerate from the upstream archive, from the repository root:

```bash
curl -LO https://huggingface.co/KittenML/kitten-tts-nano-0.8-int8/resolve/main/voices.npz
python3 - <<'PY'
import struct, zipfile
z = zipfile.ZipFile('voices.npz')
out = bytearray()
for name in sorted(n[:-4] for n in z.namelist()):
    data = z.open(f'{name}.npy').read()
    header = 10 + struct.unpack('<H', data[8:10])[0]
    out += data[header:]
open('public/models/kitten/voices-v0.8.bin', 'wb').write(out)
PY
```

The four size variants ship the same file; only the `.onnx` differs.
