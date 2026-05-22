// Pure audio conversion helpers for the microphone capture path. The browser
// AudioContext typically runs at 44.1 or 48 kHz, but whisper.cpp requires
// 16 kHz mono. These functions have no DOM dependency and are fully tested.

// Downsamples a Float32 mono block from `sourceRate` to 16 kHz by nearest-
// sample picking. Nearest-sample (decimation) is sufficient here: whisper is
// robust to mild aliasing and this keeps the renderer hot path cheap.
export function downsampleTo16k(input: Float32Array, sourceRate: number): Float32Array {
  const targetRate = 16_000
  if (sourceRate === targetRate) return input
  const ratio = sourceRate / targetRate
  const outLength = Math.floor(input.length / ratio)
  const output = new Float32Array(outLength)
  for (let i = 0; i < outLength; i += 1) {
    output[i] = input[Math.floor(i * ratio)]
  }
  return output
}

// Converts a Float32 block in [-1, 1] to signed 16-bit little-endian PCM.
// Values are clamped, then scaled by 32767 so full-scale audio maps to the
// 16-bit range without overflow.
export function floatToInt16Pcm(input: Float32Array): Buffer {
  const pcm = Buffer.alloc(input.length * 2)
  for (let i = 0; i < input.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, input[i]))
    pcm.writeInt16LE(Math.round(clamped * 32_767), i * 2)
  }
  return pcm
}
