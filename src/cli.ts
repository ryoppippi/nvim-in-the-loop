#!/usr/bin/env node
import { cli } from "gunshi"
import { resolve } from "node:path"
import { stat } from "node:fs/promises"
import { readKeystrokeLog } from "./log.ts"
import { combineOptions, findFrequentSequences } from "./analyzer.ts"
import { collectKeymaps } from "./keymaps.ts"
import { requestSuggestions } from "./ai.ts"
import { SuggestionResponse } from "./types.ts"

type OutputFormat = "human" | "json"

type OutputPayload = {
  logPath: string
  eventCount: number
  sequences: ReturnType<typeof findFrequentSequences>
  keymapCount: number
  dotfilesPaths: string[]
  suggestions: SuggestionResponse | null
  format: OutputFormat
}

const argv = typeof Bun !== "undefined" && Array.isArray(Bun.argv) ? Bun.argv.slice(2) : process.argv.slice(2)

await cli(argv, {
  name: "ai-keymap",
  description: "Generate AI-assisted keymap suggestions backed by keystroke analytics.",
  args: {
    log: {
      type: "string",
      description: "Path to keystroke JSONL log",
      required: true,
    },
    dotfiles: {
      type: "string",
      multiple: true,
      description: "Paths to scan for existing keymaps (repeatable)",
    },
    top: {
      type: "number",
      description: "Number of sequences to analyze",
      default: 6,
    },
    window: {
      type: "number",
      description: "Sequence window size",
      default: 5,
    },
    "min-occurrences": {
      type: "number",
      description: "Minimum repeats before considering a sequence",
      default: 2,
    },
    "skip-ai": {
      type: "boolean",
      description: "Skip GPT suggestions and only print heuristics",
      default: false,
    },
    model: {
      type: "string",
      description: "Model identifier",
      default: "gpt-5",
    },
    temperature: {
      type: "number",
      description: "Model temperature",
      default: 0.1,
    },
    format: {
      type: "string",
      description: "Output format (human|json)",
      default: "human",
    },
  },
  run: async (ctx) => {
    const values = ctx.values
    const logPath = resolvePath(values.log as string)

    const format = normalizeFormat(values.format as string | undefined)
    const windowSize = (values.window as number | undefined) ?? 5
    const top = (values.top as number | undefined) ?? 6
    const minOccurrences = (values["min-occurrences"] as number | undefined) ?? 2

    const events = await readKeystrokeLog(logPath)
    const analyzerOptions = combineOptions({
      windowSize,
      minSequenceLength: 2,
      minOccurrences,
    })
    const sequences = findFrequentSequences(events, analyzerOptions).slice(0, top)

    const dotfilesInput = Array.isArray(values.dotfiles) ? (values.dotfiles as string[]) : []
    const dotfilesPaths = await resolveDotfiles(dotfilesInput)
    const existingKeymaps = dotfilesPaths.length ? await collectKeymaps(dotfilesPaths) : []

    let suggestionResponse: SuggestionResponse | null = null
    const skipAi = Boolean(values["skip-ai"])

    if (!skipAi && process.env.OPENAI_API_KEY) {
      try {
        suggestionResponse = await requestSuggestions({
          sequences,
          existingKeymaps,
          model: (values.model as string | undefined) ?? "gpt-5",
          temperature: (values.temperature as number | undefined) ?? 0.1,
          topN: top,
        })
      } catch (error) {
        console.error(`Failed to request GPT suggestions: ${error}`)
      }
    } else if (!skipAi) {
      console.warn("OPENAI_API_KEY not found. Skipping AI suggestions.")
    }

    emitOutput({
      logPath,
      eventCount: events.length,
      sequences,
      keymapCount: existingKeymaps.length,
      dotfilesPaths,
      suggestions: suggestionResponse,
      format,
    })
  },
}).catch((error) => {
  console.error(error)
  process.exitCode = 1
})

function emitOutput(payload: OutputPayload) {
  if (payload.format === "json") {
    console.log(
      JSON.stringify(
        {
          logPath: payload.logPath,
          events: payload.eventCount,
          sequences: payload.sequences,
          keymapCount: payload.keymapCount,
          dotfilesPaths: payload.dotfilesPaths,
          ai: payload.suggestions,
        },
        null,
        2,
      ),
    )
    return
  }

  console.log("=== AI Keymap Analyzer ===")
  console.log(`Log: ${payload.logPath}`)
  console.log(`Events processed: ${payload.eventCount}`)
  console.log(`Sequences analysed: ${payload.sequences.length}`)
  if (payload.dotfilesPaths.length) {
    console.log(`Dotfiles scanned: ${payload.dotfilesPaths.join(", ")}`)
    console.log(`Existing keymaps found: ${payload.keymapCount}`)
  } else {
    console.log("Dotfiles scanned: none")
  }

  if (payload.sequences.length === 0) {
    console.log("\nNo repeating sequences detected yet.")
  } else {
    console.log("\nTop sequences:")
    payload.sequences.forEach((seq, index) => {
      const gesture = seq.keys.join(" → ")
      const avg = seq.meanDeltaMs.toFixed(2)
      console.log(
        `${index + 1}. mode=${seq.mode} count=${seq.count} avgΔ=${avg}ms ${
          seq.sampleFile ? `sample=${seq.sampleFile}` : ""
        }\n   ${gesture}`,
      )
    })
  }

  if (payload.suggestions?.suggestions?.length) {
    console.log("\nAI Suggestions:")
    payload.suggestions.suggestions.forEach((suggestion, index) => {
      console.log(
        `${index + 1}. [${suggestion.mode}] map ${suggestion.lhs} => sequence ${suggestion.sequence.join(
          " ",
        )}`,
      )
      if (suggestion.recommendedMapping) {
        console.log(`   recommended mapping: ${suggestion.recommendedMapping}`)
      }
      if (suggestion.rationale) {
        console.log(`   rationale: ${suggestion.rationale}`)
      }
    })
  } else if (payload.suggestions) {
    console.log("\nAI Suggestions: none (model returned empty set).")
  } else {
    console.log("\nAI Suggestions: skipped.")
  }
}

async function resolveDotfiles(explicit: string[]): Promise<string[]> {
  const defaults = [
    "/Users/ryoppippi/ghq/github.com/ryoppippi/dotfiles",
    "~/ghq/github.com/ryoppippi/dotfiles",
    "~/dotfiles",
    "~/.config/nvim",
    "~/.vim",
    "~/.config/chezmoi",
  ]
  const targets = explicit.length ? explicit : defaults

  const resolved: string[] = []
  for (const target of targets) {
    const expanded = resolvePath(target)
    if (await pathExists(expanded)) {
      resolved.push(expanded)
    }
  }
  return Array.from(new Set(resolved))
}

function resolvePath(path: string): string {
  if (path.startsWith("~")) {
    const home = process.env.HOME
    if (home) {
      return resolve(path.replace("~", home))
    }
  }
  return resolve(path)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function normalizeFormat(input: string | undefined): OutputFormat {
  if (!input) return "human"
  const value = input.toLowerCase()
  if (value === "human" || value === "json") {
    return value
  }
  throw new Error(`Unknown format '${input}'`)
}
