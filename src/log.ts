import { readTextFile } from "./fs.ts"
import { KeystrokeEvent } from "./types.ts"

export async function readKeystrokeLog(path: string): Promise<KeystrokeEvent[]> {
  const text = await readTextFile(path)
  const events: KeystrokeEvent[] = []

  const lines = text.split(/\r?\n/)
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed)
      events.push(parsed as KeystrokeEvent)
    } catch (error) {
      console.warn(`Skipping malformed log line ${index + 1}: ${error}`)
    }
  }

  return events
}
