#!/usr/bin/env bun
/// <reference types="bun-types" />
/**
 * Analyze ai_keymap keystroke logs and propose keybinding suggestions.
 *
 * Usage:
 *   bun run scripts/visualize.ts --log ~/.local/share/nvim/ai_keymap/keystrokes.jsonl
 *
 * This script reads JSONL events emitted by the Neovim plugin, aggregates them,
 * and prints a small report that can be consumed in the floating window UI or
 * the terminal. It is designed for demo purposes and intentionally avoids
 * external dependencies to keep the setup simple.
 */

type Event = {
  seq: number
  raw: string
  key: string
  mode: string
  blocking?: boolean
  timestamp: number
  bufnr?: number
  filetype?: string
  file?: string
}

type CliArgs = {
  logPath: string
  top?: number
  window?: number
  filterMode?: string
}

const MODES: Record<string, string> = {
  n: "Normal",
  i: "Insert",
  v: "Visual",
  V: "Visual-Line",
  "\u0016": "Visual-Block",
  c: "Command",
  R: "Replace",
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2)
  const args: CliArgs = {
    logPath: "",
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--log" || arg === "-l") {
      args.logPath = argv[++i] ?? ""
    } else if (arg === "--top") {
      args.top = Number(argv[++i] ?? "0")
    } else if (arg === "--window" || arg === "-w") {
      args.window = Number(argv[++i] ?? "0")
    } else if (arg === "--mode" || arg === "-m") {
      args.filterMode = argv[++i]
    } else if (arg === "--help" || arg === "-h") {
      printHelp()
      process.exit(0)
    }
  }

  if (!args.logPath) {
    console.error("Missing required --log path")
    printHelp()
    process.exit(1)
  }

  args.top ||= 5
  args.window ||= 5

  return args
}

function printHelp() {
  console.log(`AI Keymap Visualizer

Usage: bun run scripts/visualize.ts --log /path/to/keystrokes.jsonl [options]

Options:
  --log, -l <path>      Path to JSONL keystroke log (required)
  --top <n>             Number of top sequences to show (default: 5)
  --window, -w <n>      Sequence window size (default: 5)
  --mode, -m <mode>     Filter events by mode (e.g., n, i, v)
  --help                Show this help message
`)
}

async function readLog(path: string): Promise<Event[]> {
  try {
    const file = Bun.file(path)
    if (!(await file.exists())) {
      console.error(`Log file not found: ${path}`)
      process.exit(1)
    }
    const text = await file.text()
    const events: Event[] = []
    const lines = text.split(/\r?\n/)
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line) as Event
        events.push(parsed)
      } catch (error) {
        console.warn(`Skipping malformed line: ${line}`)
      }
    }
    return events
  } catch (error) {
    console.error(`Failed to read log: ${error}`)
    process.exit(1)
  }
}

type Sequence = {
  keys: string[]
  mode: string
  count: number
  meanDelta: number
  firstFile?: string
}

function analyse(events: Event[], args: CliArgs) {
  if (events.length === 0) {
    console.log("No keystrokes recorded yet. Start typing to build a dataset!")
    return
  }

  const filtered = args.filterMode
    ? events.filter((event) => event.mode === args.filterMode)
    : events.slice()

  if (filtered.length === 0) {
    console.log(`No keystrokes recorded for mode '${args.filterMode}'.`)
    return
  }

  console.log(`Total events: ${events.length}`)
  if (filtered.length !== events.length) {
    console.log(`Filtered events (${args.filterMode ?? "all"}): ${filtered.length}`)
  }

  const byMode = aggregateByMode(events)
  printModeSummary(byMode)

  const windowSize = Math.max(2, args.window ?? 5)
  const top = Math.max(3, args.top ?? 5)
  const sequences = topSequences(filtered, windowSize, top)

  if (sequences.length === 0) {
    console.log("\nNo repeating sequences found yet.")
    return
  }

  console.log("\nTop interacting sequences:")
  sequences.forEach((seq, index) => {
    const keys = seq.keys.join(" → ")
    const modeName = MODES[seq.mode] ?? seq.mode
    const density = seq.meanDelta.toFixed(2)
    console.log(
      `${index + 1}. [${modeName}] ${keys}  (count=${seq.count}, avg Δ=${density}ms${
        seq.firstFile ? `, sample=${seq.firstFile}` : ""
      })`,
    )
  })

  console.log("\nSuggestion prompts:")
  sequences.slice(0, 3).forEach((seq, index) => {
    const suggestion = proposeMapping(seq, index)
    console.log(`- ${suggestion}`)
  })
}

function aggregateByMode(events: Event[]) {
  const counts = new Map<string, number>()
  for (const event of events) {
    counts.set(event.mode, (counts.get(event.mode) ?? 0) + 1)
  }
  return counts
}

function printModeSummary(counts: Map<string, number>) {
  console.log("\nMode distribution:")
  const total = Array.from(counts.values()).reduce((acc, value) => acc + value, 0)
  counts.forEach((count, mode) => {
    const name = MODES[mode] ?? mode
    const ratio = ((count / total) * 100).toFixed(1)
    console.log(`- ${name.padEnd(12)} ${count.toString().padStart(6)} (${ratio}%)`)
  })
}

function topSequences(events: Event[], windowSize: number, top: number): Sequence[] {
  const totals = new Map<string, Sequence>()

  for (let i = 0; i < events.length; i++) {
    const base = events[i]
    const sequence: string[] = []
    const key = base.key || base.raw
    if (!key || key.length === 0) continue
    sequence.push(key)

    for (let j = i + 1; j < Math.min(events.length, i + windowSize); j++) {
      const current = events[j]
      if (current.mode !== base.mode) break
      sequence.push(current.key || current.raw)

      if (sequence.length < 2) continue

      const signature = `${base.mode}:${sequence.join(" ")}`
      const delta =
        (current.timestamp - base.timestamp) / 1_000_000 // convert to ms using hrtime

      const existing = totals.get(signature)
      if (existing) {
        const nextCount = existing.count + 1
        existing.meanDelta = (existing.meanDelta * existing.count + delta) / nextCount
        existing.count = nextCount
      } else {
        totals.set(signature, {
          keys: sequence.slice(),
          mode: base.mode,
          count: 1,
          meanDelta: delta,
          firstFile: base.file,
        })
      }
    }
  }

  const sorted = Array.from(totals.values())
    .filter((seq) => seq.count > 1)
    .sort((a, b) => {
      if (b.count === a.count) {
        return a.meanDelta - b.meanDelta
      }
      return b.count - a.count
    })

  return sorted.slice(0, top)
}

function proposeMapping(sequence: Sequence, index: number): string {
  const keys = sequence.keys.join("")
  const primary = sequence.keys[0]
  const suggested = `<leader>${index + 1}`
  const modeName = MODES[sequence.mode] ?? sequence.mode
  return `Consider mapping '${keys}' in ${modeName} mode to '${suggested}' to compress a ${sequence.keys.length}-step gesture (seen ${sequence.count}×).`
}

async function main() {
  const args = parseArgs()
  const events = await readLog(args.logPath)
  analyse(events, args)
}

await main()
