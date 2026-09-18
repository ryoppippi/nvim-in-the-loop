# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

nvim-in-the-loop is a human-in-the-loop research tool for AI-optimized Vim keybindings. It captures Neovim keystrokes across modes, analyzes repeated sequences, and uses GPT to suggest ergonomic keybindings that don't conflict with existing mappings.

## Architecture

### Dual-Language Design
- **Lua (Neovim plugin)**: Captures keystrokes via `vim.on_key()`, manages state, provides commands
- **TypeScript (Bun CLI)**: Analyzes JSONL logs, parses dotfiles for existing keymaps, requests AI suggestions via Vercel AI SDK

### Data Flow
1. Lua plugin captures keystrokes → buffered events → JSONL log file (`~/.local/share/nvim/ai_keymap/keystrokes.jsonl`)
2. CLI reads JSONL → finds frequent sequences (sliding window algorithm in `analyzer.ts`)
3. CLI scans dotfiles → extracts existing keymaps to avoid conflicts (`keymaps.ts`)
4. CLI sends sequences + existing keymaps → GPT-5 → JSON suggestions (`ai.ts`)
5. Results displayed in floating window (Lua `visualizer.lua`) or CLI output

### Key Components

**Lua Side** (`lua/ai_keymap/`):
- `init.lua`: Main module, keystroke capture loop, event buffering, commands setup
- `visualizer.lua`: Spawns Bun CLI in floating terminal window
- `suggest.lua`: Heuristic-based detection (no AI), picker UI for repeated movements
- `analysis.lua`: Lua-side log parsing for heuristics

**TypeScript Side** (`src/`):
- `cli.ts`: Entry point using gunshi for argument parsing, orchestrates analysis pipeline
- `analyzer.ts`: Sliding window sequence detector (configurable window size, min occurrences, min length)
- `keymaps.ts`: Parses `vim.keymap.set`, `noremap`, and related patterns from dotfiles
- `ai.ts`: Formats prompt with sequences + existing keymaps, calls OpenAI API, parses JSON response
- `types.ts`: Shared types between modules

## Development Commands

### Running CLI
```bash
# Dev mode (runs from source)
bun run dev -- --log ~/.local/share/nvim/ai_keymap/keystrokes.jsonl --dotfiles ~/.config/nvim

# With AI suggestions (requires OPENAI_API_KEY)
export OPENAI_API_KEY=sk-your-key
bun run dev

# Skip AI (heuristics only)
bun run dev -- --skip-ai

# JSON output for programmatic use
bun run dev -- --format json

# Suggestions-only mode (no analytics)
bun run dev -- --suggestions-only
```

### Building
```bash
# Produces dist/cli.js with Node shebang for distribution
bun run build
```

### Testing
```bash
bun test
```

### Type Checking
```bash
bun run typecheck
```

## Neovim Commands

- `:AiKeymapStart` - Begin capturing keystrokes
- `:AiKeymapStop` - Stop capture and flush buffer
- `:AiKeymapFlush` - Write pending events to log
- `:AiKeymapStatus` - Show capture state
- `:AiKeymapVisualize [args]` - Open floating terminal with CLI analysis (forwards args to Bun CLI)
- `:AiKeymapSuggest [--min-repeat N] [--min-occurrence N]` - Lua heuristics picker (no AI)
- `:AiKeymapOpenLog` - Open raw JSONL in buffer

## Configuration

Plugin setup in `init.lua` or anywhere after Neovim loads the plugin:

```lua
require("ai_keymap").setup({
  log_path = vim.fn.stdpath("data") .. "/ai_keymap/keystrokes.jsonl",
  max_buffered_events = 200,
  capture_modes = { n = true, i = true, v = true },
  visualize_cmd = nil, -- override Bun command if needed
  visualize_args = { "--dotfiles", vim.fn.expand("~/.config/nvim") },
  suggest_options = { min_repeat = 3, min_occurrence = 2 },
  start_immediately = true, -- auto-start capture on setup
})
```

## Important Implementation Details

### Keystroke Log Format (JSONL)
Each line is a JSON object:
```json
{
  "seq": 1,
  "raw": "j",
  "key": "j",
  "mode": "n",
  "timestamp": 1234567890,
  "filetype": "lua",
  "file": "/path/to/file.lua"
}
```
Timestamps are `vim.loop.hrtime()` (nanoseconds since epoch).

### Analyzer Algorithm (`analyzer.ts:findFrequentSequences`)
- Sliding window (default size 5) over keystroke events
- Groups sequences by `mode:keys` signature
- Tracks occurrence count and rolling mean of inter-keystroke delta (ms)
- Filters by min occurrences, sorts by count (descending) then avg speed (ascending)
- Breaks sequence on mode change

### Keymap Conflict Detection (`keymaps.ts`)
Recursively scans dotfiles for:
- `vim.keymap.set("mode", "lhs", ...)`
- `[nvx]noremap lhs ...`
- `map lhs ...`

Extracts mode + lhs, sends to GPT as context to avoid conflicts.

### AI Prompting Strategy (`ai.ts`)
- System: "HCI-focused Neovim mentor... must output strict JSON"
- Prompt includes:
  - Top N sequences with mode, count, avg interval, sample file
  - Existing keymaps grouped by mode (limited to first 40 per mode)
  - JSON schema example with `mode`, `lhs`, `sequence`, `recommendedMapping`, `rationale`
- Temperature: 0.1 (low variance)
- Max tokens: 800
- Parses response by extracting `[...]` substring and validating structure

### CLI Argument Parsing
Uses `gunshi` library with kebab-case flags:
- `--log` (default: XDG_DATA_HOME or `~/.local/share/nvim/ai_keymap/keystrokes.jsonl`)
- `--dotfiles` (repeatable, defaults to `~/.config/nvim`, `~/dotfiles`, `~/.vim`, `~/.config/chezmoi`)
- `--top N` (sequences to analyze, default 6)
- `--window N` (sequence window, default 5)
- `--min-occurrences N` (default 2)
- `--skip-ai` (skip GPT, heuristics only)
- `--model` (default from `consts.ts`)
- `--temperature` (default 0.1)
- `--format` (human|json)
- `--suggestions-only` (only print AI suggestions in human format)

## Testing Notes

- No test files exist in repo yet (only node_modules tests detected)
- When adding tests, place in `tests/` directory (already in tsconfig include)
- Use Bun's built-in test runner (`bun test`)

## Common Patterns

### Adding a New CLI Flag
1. Add to `args` object in `cli.ts` command definition
2. Extract from `ctx.values` in `run` function
3. Pass to relevant function (analyzer, AI, output)

### Modifying Sequence Detection Logic
Edit `analyzer.ts:findFrequentSequences`. Key tuning parameters:
- `windowSize`: max sequence length to consider
- `minSequenceLength`: filter out single keypresses
- `minOccurrences`: threshold for "frequent"

### Changing AI Model
Set `DEFAULT_MODEL` in `src/consts.ts` or pass `--model` flag. Must be OpenAI-compatible (uses `@ai-sdk/openai`).

### Extending Captured Metadata
Add fields to event object in `lua/ai_keymap/init.lua:record_key()`, update `KeystrokeEvent` type in `src/types.ts`.
