// The AudioWorklet processor runs on the dedicated audio thread. It cannot be
// imported normally because it executes in the AudioWorkletGlobalScope, so its
// source is exported as a string and registered via a Blob URL by mic-capture.
// The processor forwards every 128-sample render quantum of channel 0 to the
// main thread as a Float32Array; mic-capture downsamples and batches it.
export const PCM_WORKLET_NAME = 'customcluely-pcm-worklet'

export const PCM_WORKLET_SOURCE = `
class CustomcluelyPcmWorklet extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]
    if (input && input[0]) {
      this.port.postMessage(input[0].slice(0))
    }
    return true
  }
}
registerProcessor('${PCM_WORKLET_NAME}', CustomcluelyPcmWorklet)
`
