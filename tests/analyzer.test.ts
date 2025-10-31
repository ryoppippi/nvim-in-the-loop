import { describe, expect, it } from "bun:test"
import { findFrequentSequences } from "../src/analyzer.ts"
import type { KeystrokeEvent } from "../src/types.ts"

const baseTimestamp = 1_000_000_000

const events: KeystrokeEvent[] = [
  {
    seq: 1,
    raw: "j",
    key: "j",
    mode: "n",
    timestamp: baseTimestamp,
  },
  {
    seq: 2,
    raw: "j",
    key: "j",
    mode: "n",
    timestamp: baseTimestamp + 600_000,
  },
  {
    seq: 3,
    raw: "k",
    key: "k",
    mode: "n",
    timestamp: baseTimestamp + 1_400_000,
  },
  {
    seq: 4,
    raw: "<esc>",
    key: "<esc>",
    mode: "i",
    timestamp: baseTimestamp + 2_000_000,
  },
  {
    seq: 5,
    raw: "<esc>",
    key: "<esc>",
    mode: "i",
    timestamp: baseTimestamp + 2_500_000,
  },
]

describe("findFrequentSequences", () => {
  it("detects recurring sequences above the threshold", () => {
    const sequences = findFrequentSequences(events, {
      windowSize: 4,
      minSequenceLength: 2,
      minOccurrences: 1,
    })

    expect(sequences.length).toBeGreaterThanOrEqual(2)

    const normalSequence = sequences.find(
      (seq) => seq.mode === "n" && seq.keys.join("") === "jj",
    )
    expect(normalSequence).toBeTruthy()
    expect(normalSequence?.count).toBeGreaterThan(0)
    expect(normalSequence?.meanDeltaMs).toBeCloseTo(0.6, 1)

    const insertSequence = sequences.find(
      (seq) => seq.mode === "i" && seq.keys.join("") === "<esc><esc>",
    )
    expect(insertSequence).toBeTruthy()
  })

  it("respects minimum occurrence threshold", () => {
    const filtered = findFrequentSequences(events, {
      windowSize: 4,
      minSequenceLength: 2,
      minOccurrences: 3,
    })

    expect(filtered.length).toBe(0)
  })
})
