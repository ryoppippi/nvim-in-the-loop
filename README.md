# AI-Optimised Vim Keybindings

Human-in-the-loop playground for the talk “AI-Optimised Vim Keybindings: HCI-Driven HITL Interfaces”.

## Features

- Capture Neovim keystrokes across modes and persist them as JSONL.
- `:AiKeymapStart`, `:AiKeymapStop`, `:AiKeymapFlush`, `:AiKeymapStatus` commands for runtime control.
- `:AiKeymapVisualize` streams a Bun CLI that crunches the log, inspects your dotfiles (auto-detected at `~/.config/nvim`), and optionally augments the report with GPT‑5 proposals.
- `:AiKeymapSuggest` uses Lua heuristics to flag repeated movement keys (e.g. `jjj`) and surfaces alternative mappings directly inside Neovim (`y` copies the snippet).
- Optional `:AiKeymapOpenLog` helper to inspect the raw dataset before sending it to an LLM.

## Setup

1. Ensure [Bun](https://bun.sh) is installed (`bun --version`).
2. Add this repo to your `runtimepath`, or package it with your Neovim config.
3. (Optional) Configure the plugin during setup:

```lua
require("ai_keymap").setup({
  log_path = vim.fn.stdpath("data") .. "/ai_keymap/keystrokes.jsonl",
  visualize_cmd = { "bun", "run", "src/cli.ts" },
  visualize_args = { "--dotfiles", vim.fn.expand("~/.config/nvim") },
  suggest_options = { min_repeat = 3, min_occurrence = 2 },
  start_immediately = true,
})
```

4. Export an OpenAI-compatible API key before requesting AI suggestions:

```bash
export OPENAI_API_KEY=sk-your-key
```

## Demo Flow

1. Launch Neovim and run `:AiKeymapStart`.
2. Perform editing tasks representative of your audience persona.
3. Trigger `:AiKeymapVisualize` to open the floating dashboard (add `--skip-ai` to disable GPT calls).
4. Run `:AiKeymapSuggest` to inspect repeated movements detected heuristically; press `y` to yank the suggested mapping snippet.
5. Stop capture with `:AiKeymapStop` when done.

## CLI Usage

The Bun CLI is shared between the floating window and your terminal:

```bash
bun run src/cli.ts \
  --log ~/.local/share/nvim/ai_keymap/keystrokes.jsonl \
  --dotfiles ~/.config/nvim \
  --top 8

# suggestions only
bun run src/cli.ts --suggestions-only
```

- Scans your log for frequent keystroke sequences.
- Reads `vim.keymap.set` / `noremap` style mappings from the dotfiles you provide.
- Calls GPT‑5 (via the Vercel AI SDK) to propose non-conflicting shortcuts. Use `--skip-ai` to disable the model.
- Pass `--format json` for machine-readable output.
- Use `--suggestions-only` to print only the AI suggestion block while hiding the rest of the report.
- The Neovim picker (`:AiKeymapSuggest`) now relies on Lua heuristics. Analytics-only users can run the CLI separately with `--skip-ai`.

> 💡 Adjust thresholds via `:AiKeymapSuggest --min-repeat 4`. If you need GPT-powered suggestions, run the CLI (`bun run src/cli.ts`) without `--skip-ai`.

## Build & Distribute

```bash
# produce dist/cli.js with a Node shebang
bun run build

# (after packaging/publishing) invoke via bunx
bunx ai-keymap --log ~/.local/share/nvim/ai_keymap/keystrokes.jsonl --skip-ai
```

`package.json` exposes the CLI as `ai-keymap`, so once the package is published you can call it directly through `bunx`, or run it locally from `dist/cli.js`.

## Logs

The capture log contains JSONL objects like:

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

Extend `src/cli.ts` or `scripts/visualize.ts` with custom heuristics, or swap in a different model endpoint as needed for the live demo.
