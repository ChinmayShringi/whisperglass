// Mock `whisper-cli`: reads the -f input path, writes `<input>.json` with a
// valid transcription array, prints a result line to stdout, exits 0.
import { writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const fileIdx = args.indexOf('-f')
const inputPath = fileIdx >= 0 ? args[fileIdx + 1] : null

if (inputPath) {
  const json = {
    transcription: [
      { offsets: { from: 0, to: 2000 }, text: ' This is a mock transcription.' }
    ]
  }
  writeFileSync(`${inputPath}.json`, JSON.stringify(json))
}
process.stdout.write('This is a mock transcription.\n')
process.exit(0)
