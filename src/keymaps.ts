import { readdir, stat } from "node:fs/promises"
import { extname, join } from "node:path"
import { readTextFile } from "./fs.ts"
import { KeymapDefinition } from "./types.ts"

const SUPPORTED_EXTENSIONS = new Set([
  ".lua",
  ".vim",
  ".nvim",
  ".vimrc",
  ".gvimrc",
  ".lua.json",
])

const LUA_KEYMAP_PATTERNS = [
  /vim\.keymap\.set\s*\(([\s\S]*?)\)/g,
  /vim\.api\.nvim_set_keymap\s*\(([\s\S]*?)\)/g,
  /vim\.api\.nvim_buf_set_keymap\s*\(([\s\S]*?)\)/g,
]

const COMMAND_MODE_TABLE: Record<string, string[]> = {
  map: ["n", "v", "o"],
  noremap: ["n", "v", "o"],
  "map!": ["i", "c"],
  "noremap!": ["i", "c"],
  nmap: ["n"],
  nnoremap: ["n"],
  xmap: ["x"],
  xnoremap: ["x"],
  vmap: ["v"],
  vnoremap: ["v"],
  imap: ["i"],
  inoremap: ["i"],
  cmap: ["c"],
  cnoremap: ["c"],
  smap: ["s"],
  snoremap: ["s"],
  omap: ["o"],
  onoremap: ["o"],
  tmap: ["t"],
  tnoremap: ["t"],
  "nmap!": ["n"],
  "vmap!": ["v"],
  "imap!": ["i"],
  "cmap!": ["c"],
  "xmap!": ["x"],
}

export async function collectKeymaps(paths: string[]): Promise<KeymapDefinition[]> {
  const definitions: KeymapDefinition[] = []

  for (const target of paths) {
    await traverse(target, definitions)
  }

  return definitions
}

async function traverse(target: string, definitions: KeymapDefinition[]) {
  try {
    const stats = await stat(target)
    if (stats.isDirectory()) {
      const items = await readdir(target)
      for (const item of items) {
        await traverse(join(target, item), definitions)
      }
      return
    }

    if (!stats.isFile()) return

    if (!shouldParseFile(target)) return

    const content = await readTextFile(target)
    if (target.endsWith(".lua") || target.endsWith(".lua.json")) {
      definitions.push(...parseLuaKeymaps(content, target))
    } else {
      definitions.push(...parseVimKeymaps(content, target))
    }
  } catch (error) {
    console.warn(`Unable to process keymap file at ${target}: ${error}`)
  }
}

function shouldParseFile(path: string): boolean {
  const extension = extname(path)
  if (SUPPORTED_EXTENSIONS.has(extension)) return true
  const lower = path.toLowerCase()
  if (lower.endsWith("init.lua") || lower.endsWith("init.vim") || lower.endsWith(".vimrc")) {
    return true
  }
  return false
}

function parseLuaKeymaps(content: string, source: string): KeymapDefinition[] {
  const results: KeymapDefinition[] = []

  for (const pattern of LUA_KEYMAP_PATTERNS) {
    for (const match of content.matchAll(pattern)) {
      const [rawArgs] = match.slice(1)
      if (!rawArgs) continue
      const args = splitArguments(rawArgs.trim(), 4)
      if (args.length < 2) continue

      const [modeExpr, lhsExpr] = args
      const modes = normalizeModes(modeExpr)
      const lhs = extractStringLiteral(lhsExpr)
      if (!lhs || modes.length === 0) continue

      const line = estimateLineNumber(content, match.index ?? 0)

      for (const mode of modes) {
        results.push({
          mode,
          lhs,
          rhs: args[2]?.trim(),
          source,
          line,
        })
      }
    }
  }

  return results
}

function parseVimKeymaps(content: string, source: string): KeymapDefinition[] {
  const results: KeymapDefinition[] = []
  const lines = content.split(/\r?\n/)

  for (let index = 0; index < lines.length; index++) {
    const rawLine = lines[index]
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith('"')) continue

    const [cmdRaw, lhsRaw] = line.split(/\s+/, 3)
    if (!cmdRaw || !lhsRaw) continue
    if (cmdRaw.startsWith('"')) continue

    const command = cmdRaw.toLowerCase()
    const modes = resolveModesFromCommand(command)
    if (modes.length === 0) continue

    const lhs = lhsRaw.trim()
    if (!lhs) continue

    for (const mode of modes) {
      results.push({
        mode,
        lhs,
        source,
        line: index + 1,
      })
    }
  }

  return results
}

function splitArguments(input: string, limit: number): string[] {
  const args: string[] = []
  let current = ""
  let depth = 0
  let inString = false
  let stringChar = ""

  const push = () => {
    if (current.trim()) {
      args.push(current.trim())
    }
    current = ""
  }

  for (let i = 0; i < input.length; i++) {
    const char = input[i]

    if (inString) {
      current += char
      if (char === stringChar && input[i - 1] !== "\\") {
        inString = false
        stringChar = ""
      }
      continue
    }

    if (char === '"' || char === "'" || char === "`") {
      inString = true
      stringChar = char
      current += char
      continue
    }

    if (char === "{" || char === "[" || char === "(") {
      depth++
      current += char
      continue
    }

    if (char === "}" || char === "]" || char === ")") {
      depth = Math.max(depth - 1, 0)
      current += char
      if (depth === 0 && char === ")" && args.length + 1 < limit) {
        push()
        break
      }
      continue
    }

    if (char === "," && depth === 0) {
      push()
      if (args.length >= limit) break
      continue
    }

    if (char === "-" && input[i + 1] === "-" && depth === 0) {
      break
    }

    current += char
  }

  if (current.trim() && args.length < limit) {
    args.push(current.trim())
  }

  return args
}

function normalizeModes(expr: string): string[] {
  const trimmed = expr.trim()

  if (trimmed.startsWith("{")) {
    const matches = trimmed.match(/["'`](.+?)["'`]/g)
    if (!matches) return []
    return matches.map((match) => extractStringLiteral(match)).filter(Boolean) as string[]
  }

  if (/^["'`]/.test(trimmed)) {
    const value = extractStringLiteral(trimmed)
    if (!value) return []
    if (value.length > 1) {
      const expanded = value
        .split("")
        .filter((char) => VALID_MODES.has(char))
      if (expanded.length) return expanded
    }
    return [value]
  }

  if (trimmed === "false" || trimmed === "nil" || trimmed === "0" || trimmed === "{}") {
    return ["n", "v", "o"]
  }

  return []
}

function extractStringLiteral(value: string): string | null {
  const trimmed = value.trim()
  if (!/^["'`]/.test(trimmed)) return null

  const quote = trimmed[0]
  if (!trimmed.endsWith(quote)) {
    return trimmed.slice(1)
  }

  const inner = trimmed.slice(1, -1)
  return inner.replace(/\\(["'`\\])/g, "$1")
}

const VALID_MODES = new Set(["n", "i", "v", "x", "s", "c", "t", "o", "R"])

function resolveModesFromCommand(command: string): string[] {
  if (COMMAND_MODE_TABLE[command]) {
    return COMMAND_MODE_TABLE[command]
  }
  return []
}

function estimateLineNumber(content: string, index: number): number {
  const preceding = content.slice(0, index)
  return preceding.split(/\r?\n/).length
}
