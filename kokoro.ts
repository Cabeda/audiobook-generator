import { KokoroTTS } from "npm:kokoro-js";

const tts = await KokoroTTS.from_pretrained(
  "onnx-community/Kokoro-82M-ONNX",
  { dtype: "q8" } // fp32, fp16, q8, q4, q4f16
);

const text =
  "Life is like a box of chocolates. You never know what you're gonna get.";
const audio = await tts.generate(
  text,
  { voice: "af_sky" } // See `tts.list_voices()`
);
audio.save("audio.wav");
