import { downsampleTo16k, floatToInt16Pcm } from './downsample'
import { PCM_WORKLET_NAME, PCM_WORKLET_SOURCE } from './pcm-worklet'

// 16 kHz mono 16-bit PCM: 32000 bytes is one second of audio.
const FRAME_BYTES = 32_000

export interface MicCaptureHandle {
  /** Stops capture and releases the microphone tracks and audio graph. */
  stopCapture: () => Promise<void>
}

export interface MicCaptureCallbacks {
  /** Called with one ~1-second base64-encoded 16 kHz PCM frame. */
  onFrame: (pcmBase64: string) => void
  /** Called with a user-facing message when capture cannot start. */
  onError: (message: string) => void
}

// Starts microphone capture and delivers 16 kHz mono 16-bit PCM frames. This
// is the explicit start/stop audio-source seam and the STOPGAP capture path:
// Phase 4 replaces it with the Swift sidecar, so this module is the entire
// seam to swap.
//
// getUserMedia is called only inside this function, so the macOS microphone
// permission prompt fires only on a deliberate user action (the ListenToggle),
// never on import or app mount. The returned handle's stopCapture releases the
// MediaStream tracks, which turns the macOS microphone indicator off.
export async function startCapture(
  callbacks: MicCaptureCallbacks
): Promise<MicCaptureHandle> {
  let pending = Buffer.alloc(0)

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const context = new AudioContext()
    const blob = new Blob([PCM_WORKLET_SOURCE], { type: 'application/javascript' })
    const workletUrl = URL.createObjectURL(blob)
    await context.audioWorklet.addModule(workletUrl)
    URL.revokeObjectURL(workletUrl)

    const source = context.createMediaStreamSource(stream)
    const worklet = new AudioWorkletNode(context, PCM_WORKLET_NAME)

    worklet.port.onmessage = (event: MessageEvent<Float32Array>): void => {
      const downsampled = downsampleTo16k(event.data, context.sampleRate)
      const pcm = floatToInt16Pcm(downsampled)
      pending = Buffer.concat([pending, pcm])
      while (pending.length >= FRAME_BYTES) {
        const frame = pending.subarray(0, FRAME_BYTES)
        pending = Buffer.from(pending.subarray(FRAME_BYTES))
        callbacks.onFrame(Buffer.from(frame).toString('base64'))
      }
    }

    source.connect(worklet)
    // The worklet has no audio output; connecting it to the destination keeps
    // the graph alive without producing sound (it returns silence).
    worklet.connect(context.destination)

    const stopCapture = async (): Promise<void> => {
      worklet.port.onmessage = null
      worklet.disconnect()
      source.disconnect()
      // Stopping every track releases the microphone so the macOS mic
      // indicator turns off.
      stream.getTracks().forEach((track) => track.stop())
      await context.close()
    }
    return { stopCapture }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Microphone capture failed.'
    callbacks.onError(`Could not start microphone capture: ${message}`)
    return { stopCapture: async () => {} }
  }
}
