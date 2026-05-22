// Mock `codex exec`: emits a JSONL stream, writes the -o output file, exits 0.
import { writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const outIdx = args.indexOf('-o')
const outputFile = outIdx >= 0 ? args[outIdx + 1] : null
const finalText = 'A closure is a function bundled with its surrounding state.'

const emit = (obj) => process.stdout.write(JSON.stringify(obj) + '\n')
emit({ type: 'thread.started', thread_id: 't-mock' })
emit({ type: 'turn.started' })
emit({ type: 'item.updated', item: { id: 'i-1', item_type: 'agent_message', text: 'A closure is' } })
emit({ type: 'item.completed', item: { id: 'i-1', item_type: 'agent_message', text: finalText } })
emit({ type: 'turn.completed', usage: { input_tokens: 40, output_tokens: 12 } })

if (outputFile) writeFileSync(outputFile, finalText + '\n')
process.exit(0)
