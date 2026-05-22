export interface HttpResponse {
  /** Total content length in bytes, or null when the server omits it. */
  totalBytes: number | null
  /** The response body as an async iterable of chunks. */
  body: AsyncIterable<Buffer>
}

export interface DownloadModelDeps {
  /** Absolute path the model is written to. */
  modelPath: string
  /** The model download URL. */
  url: string
  /** Expected final byte size of a complete model file. */
  expectedBytes: number
  /** True when a file exists at the given absolute path. */
  fileExists: (path: string) => boolean
  /** Byte size of the file at the given path. */
  fileSize: (path: string) => number
  /** Performs the HTTP GET and returns the streaming response. */
  fetchHttp: (url: string) => Promise<HttpResponse>
  /** Writes all chunks to the model path. */
  writeStream: (path: string, chunks: Buffer[]) => Promise<void>
  /** Progress callback, fraction in [0, 1]. */
  onProgress: (fraction: number) => void
}

export interface DownloadModelResult {
  ok: boolean
  alreadyPresent: boolean
  error: string
}

// Downloads the whisper model on first run. Pure orchestration: HTTP and
// filesystem are dependency-injected so the whole flow is unit-tested. A file
// already present at the exact expected size is treated as complete; any
// other size triggers a re-download.
export async function downloadModel(deps: DownloadModelDeps): Promise<DownloadModelResult> {
  if (deps.fileExists(deps.modelPath) && deps.fileSize(deps.modelPath) === deps.expectedBytes) {
    deps.onProgress(1)
    return { ok: true, alreadyPresent: true, error: '' }
  }
  try {
    const response = await deps.fetchHttp(deps.url)
    const total = response.totalBytes ?? deps.expectedBytes
    const chunks: Buffer[] = []
    let received = 0
    for await (const chunk of response.body) {
      chunks.push(chunk)
      received += chunk.length
      const fraction = total > 0 ? Math.min(received / total, 1) : 0
      deps.onProgress(fraction)
    }
    await deps.writeStream(deps.modelPath, chunks)
    deps.onProgress(1)
    return { ok: true, alreadyPresent: false, error: '' }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown download error.'
    return { ok: false, alreadyPresent: false, error: `Model download failed: ${message}` }
  }
}
