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

  for (let i = 0; i < events.length; i++) {
    const base = events[i]
    const baseKey = normalizeKey(base)
    if (!baseKey) continue

    const sequence: string[] = [baseKey]
    let previousTimestamp = base.timestamp

    for (let j = i + 1; j < Math.min(events.length, i + windowSize); j++) {
      const current = events[j]
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

  const sequences = Array.from(totals.values()).filter((seq) => seq.count >= minOccurrences)

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
