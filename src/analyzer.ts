import { AnalyzerOptions, KeystrokeEvent, SequenceStat } from "./types.ts"

const DEFAULT_OPTIONS: Required<AnalyzerOptions> = {
  windowSize: 5,
  minSequenceLength: 2,
  minOccurrences: 2,
}

export function combineOptions(options?: AnalyzerOptions): Required<AnalyzerOptions> {
  return {
    windowSize: options?.windowSize ?? DEFAULT_OPTIONS.windowSize,
    minSequenceLength: options?.minSequenceLength ?? DEFAULT_OPTIONS.minSequenceLength,
    minOccurrences: options?.minOccurrences ?? DEFAULT_OPTIONS.minOccurrences,
  }
}

export function findFrequentSequences(
  events: KeystrokeEvent[],
  options?: AnalyzerOptions,
): SequenceStat[] {
  const { windowSize, minSequenceLength, minOccurrences } = combineOptions(options)

  if (events.length === 0) return []

  const totals = new Map<string, SequenceStat>()

  // Handle command mode events separately (they are complete commands)
  const commandEvents = events.filter((e) => e.mode === "command")
  const commandCounts = new Map<string, { count: number; file?: string }>()

  for (const event of commandEvents) {
    const cmd = event.key
    const existing = commandCounts.get(cmd)
    if (existing) {
      existing.count++
    } else {
      commandCounts.set(cmd, { count: 1, file: event.file })
    }
  }

  // Add frequent commands to results
  for (const [cmd, data] of commandCounts.entries()) {
    if (data.count >= minOccurrences) {
      totals.set(`command:${cmd}`, {
        mode: "command",
        keys: [cmd],
        count: data.count,
        meanDeltaMs: 0, // Commands don't have meaningful delta time
        sampleFile: data.file,
      })
    }
  }

  // Filter out command mode events from regular sequence analysis
  const regularEvents = events.filter((e) => e.mode !== "command")

  for (let i = 0; i < regularEvents.length; i++) {
    const base = regularEvents[i]
    const baseKey = normalizeKey(base)
    if (!baseKey) continue

    const sequence: string[] = [baseKey]
    let previousTimestamp = base.timestamp

    for (let j = i + 1; j < Math.min(regularEvents.length, i + windowSize); j++) {
      const current = regularEvents[j]
      if (current.mode !== base.mode) break

      const key = normalizeKey(current)
      if (!key) continue
      sequence.push(key)

      if (sequence.length < minSequenceLength) {
        previousTimestamp = current.timestamp
        continue
      }

      const signature = `${base.mode}:${sequence.join(" ")}`
      const deltaMs = computeDelta(base.timestamp, current.timestamp)

      const existing = totals.get(signature)
      if (existing) {
        const nextCount = existing.count + 1
        const mean = existing.meanDeltaMs
        existing.meanDeltaMs = (mean * existing.count + deltaMs) / nextCount
        existing.count = nextCount
      } else {
        totals.set(signature, {
          mode: base.mode,
          keys: sequence.slice(),
          count: 1,
          meanDeltaMs: deltaMs,
          sampleFile: base.file,
        })
      }

      previousTimestamp = current.timestamp
    }
  }

  const sequences = Array.from(totals.values())
    .filter((seq) => seq.count >= minOccurrences)
    .filter((seq) => isInterestingSequence(seq))

  sequences.sort((a, b) => {
    if (b.count === a.count) {
      return a.meanDeltaMs - b.meanDeltaMs
    }
    return b.count - a.count
  })

  return sequences
}

function normalizeKey(event: KeystrokeEvent): string | null {
  const key = (event.key || event.raw || "").trim()
  if (!key) return null
  return key
}

function computeDelta(start: number, finish: number): number {
  if (!start || !finish) {
    return 0
  }
  return (finish - start) / 1_000_000
}

function isInterestingSequence(seq: SequenceStat): boolean {
  // Filter out insert mode sequences that are just regular typing
  if (seq.mode === "i" || seq.mode === "R") {
    // Check if all keys are single printable characters (likely just typing text)
    const allSingleChars = seq.keys.every((key) => key.length === 1 && /^[a-zA-Z0-9]$/.test(key))
    if (allSingleChars) {
      return false // This is just regular typing, not a pattern worth mapping
    }
  }

  // In normal mode, check for interesting patterns
  if (seq.mode === "n") {
    // Repeated motions: jjjj, kkkk, wwww
    const isRepeatedMotion = seq.keys.every((key) => key === seq.keys[0]) && seq.keys.length >= 3
    if (isRepeatedMotion) {
      return true
    }

    // Text object operations: ciw, diw, yiw, ci", da", vi(, etc.
    const firstKey = seq.keys[0]
    const secondKey = seq.keys[1]
    const operators = ["c", "d", "y", "v", "g"]
    const textObjModifiers = ["i", "a"]

    if (seq.keys.length === 3 && operators.includes(firstKey) && textObjModifiers.includes(secondKey)) {
      return true // Text object operation like ciw, diw, da"
    }

    // gcc pattern (comment line)
    if (seq.keys.length === 3 && seq.keys[0] === "g" && seq.keys[1] === "c" && seq.keys[2] === "c") {
      return true
    }
  }

  // Keep command mode sequences (usually intentional commands)
  if (seq.mode === "c" || seq.mode === "command") {
    return true
  }

  // Keep visual mode sequences
  if (seq.mode === "v" || seq.mode === "V") {
    return true
  }

  // Keep sequences with special keys like <CR>, <Esc>, arrow keys, etc.
  const hasSpecialKeys = seq.keys.some((key) => key.startsWith("<"))

  return hasSpecialKeys
}
