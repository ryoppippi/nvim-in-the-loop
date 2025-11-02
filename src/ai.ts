import { generateText } from "ai"
import { openai } from "@ai-sdk/openai"
import { DEFAULT_MODEL } from "./consts.ts"
import { KeymapDefinition, ModelSuggestion, SequenceStat, SuggestionResponse } from "./types.ts"

type SuggestionParams = {
  sequences: SequenceStat[]
  existingKeymaps: KeymapDefinition[]
  model?: string
  temperature?: number
  topN?: number
}

export async function requestSuggestions({
  sequences,
  existingKeymaps,
  model = DEFAULT_MODEL,
  temperature = 0.1,
  topN = 5,
}: SuggestionParams): Promise<SuggestionResponse> {
  if (sequences.length === 0) {
    return { suggestions: [], raw: "No recurring sequences available for suggestion." }
  }

  const trimmedSequences = sequences.slice(0, topN)
  const existingContext = formatExistingKeymaps(existingKeymaps)

  const prompt = buildPrompt(trimmedSequences, existingContext)

  const { text } = await generateText({
    model: openai(model),
    temperature,
    maxOutputTokens: 800,
    system:
      "You are an HCI-focused Neovim mentor who proposes ergonomic keymaps. " +
      "You must output strict JSON. Avoid conflicts with provided keymaps. " +
      "Focus on repetitive motions (like jjjj, wwww) or complex command sequences. " +
      "NEVER suggest mappings for simple insert mode text typing. " +
      "Suggest concise leader mappings that compress repetitive keystroke sequences.",
    prompt,
  })

  const suggestions = parseSuggestions(text)

  return {
    suggestions,
    raw: text,
  }
}

function buildPrompt(sequences: SequenceStat[], existing: string): string {
  const sequenceLines = sequences
    .map((seq, index) => {
      const gesture = seq.keys.join(" → ")
      const mode = mapModeLabel(seq.mode)
      const sample = seq.sampleFile ? ` sample=${seq.sampleFile}` : ""
      return `${index + 1}. mode=${mode} sequence=[${gesture}] count=${seq.count} avg_interval=${seq.meanDeltaMs.toFixed(2)}ms${sample}`
    })
    .join("\n")

  return [
    "Analyse the following Neovim keystroke sequences and produce JSON suggestions for new keybindings.",
    "",
    "Recurring sequences:",
    sequenceLines,
    "",
    "Existing keymaps harvested from the user's dotfiles (avoid conflicts):",
    existing || "(none provided)",
    "",
    "Respond with a JSON array of objects using this shape:",
    `[
  {
    "mode": "n",
    "lhs": "<leader>f",
    "sequence": ["d", "w"],
    "recommendedMapping": ":execute '...'\\n",
    "rationale": "Explain how this reduces cognitive load."
  }
]`,
    "",
    "Constraints:",
    "- Do not reuse any (mode, lhs) combination listed under existing keymaps.",
    "- Prefer SHORTER mappings that are faster to type than the original sequence.",
    "- For 3-key sequences like 'ciw', suggest a 2-key mapping like '<leader>w' (NOT '<leader>ciw' which is longer!).",
    "- ONLY suggest mappings for meaningful patterns: repeated motions (jjj, kkk), text object operations (ciw, di\", va(, gcc), or complex command patterns.",
    "- For Command mode patterns like '%s/\\s+/' or 'g/TODO/d', create shortcuts that execute COMPLETE commands, not partial ones.",
    "  - Example: sequence ['%','s','/','\\','s','+'] could map to '<leader>ws' that executes ':%s/\\\\s\\\\+//g<Left><Left><Left>' (trim whitespace pattern).",
    "  - Example: sequence ['g','/','TODO','/','d'] could map to '<leader>td' that executes ':g/TODO/d<CR>' (delete TODO lines).",
    "- NEVER suggest Insert mode mappings that just type regular text characters.",
    "- For repeated motions like 'jjjj', teach users to use count prefixes like '4j' instead of creating a mapping.",
    "- For text object operations, create SHORTER shortcuts (e.g., 'ciw' → '<leader>w' or just 'Q').",
    "- The 'recommendedMapping' should be the COMPLETE Vim command to execute, ready to use.",
    "- Reference the underlying sequence in your rationale to support HITL review.",
    "- If no safe suggestion exists, return an empty JSON array [].",
  ].join("\n")
}

function formatExistingKeymaps(defs: KeymapDefinition[]): string {
  if (defs.length === 0) return ""

  const grouped = new Map<string, KeymapDefinition[]>()
  for (const def of defs) {
    const key = def.mode
    const list = grouped.get(key) ?? []
    list.push(def)
    grouped.set(key, list)
  }

  const lines: string[] = []
  for (const [mode, mappings] of grouped.entries()) {
    const prefix = `mode=${mapModeLabel(mode)}`
    const entries = mappings
      .slice(0, 40)
      .map((mapping) => `${mapping.lhs} (${mapping.source}:${mapping.line})`)
      .join(", ")
    lines.push(`${prefix}: ${entries}`)
  }

  return lines.join("\n")
}

function mapModeLabel(mode: string): string {
  const table: Record<string, string> = {
    n: "Normal",
    i: "Insert",
    v: "Visual",
    V: "Visual-Line",
    ["\u0016"]: "Visual-Block",
    c: "Command",
    R: "Replace",
    x: "Visual",
    s: "Select",
    o: "Operator-Pending",
    t: "Terminal",
  }
  return table[mode] ?? mode
}

function parseSuggestions(text: string): ModelSuggestion[] {
  const jsonText = extractJsonArray(text)
  if (!jsonText) return []

  try {
    const parsed = JSON.parse(jsonText)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((entry) => sanitizeSuggestion(entry))
      .filter((entry): entry is ModelSuggestion => entry !== null)
  } catch (error) {
    console.warn(`Failed to parse model suggestions: ${error}`)
    return []
  }
}

function extractJsonArray(text: string): string | null {
  const start = text.indexOf("[")
  const end = text.lastIndexOf("]")
  if (start === -1 || end === -1 || end <= start) {
    return null
  }
  return text.slice(start, end + 1)
}

function sanitizeSuggestion(value: unknown): ModelSuggestion | null {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  const mode = typeof record.mode === "string" ? record.mode : null
  const lhs = typeof record.lhs === "string" ? record.lhs : null
  const seq = Array.isArray(record.sequence)
    ? record.sequence.filter((item): item is string => typeof item === "string")
    : null
  const rationale = typeof record.rationale === "string" ? record.rationale : ""
  const recommended = typeof record.recommendedMapping === "string" ? record.recommendedMapping : undefined

  if (!mode || !lhs || !seq || seq.length === 0) return null

  return {
    mode,
    lhs,
    sequence: seq,
    recommendedMapping: recommended,
    rationale,
  }
}
