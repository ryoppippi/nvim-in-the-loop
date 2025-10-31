# AI-Optimised Vim Keybindings

Human-in-the-loop playground for the talk “AI-Optimised Vim Keybindings: HCI-Driven HITL Interfaces”.

## Features

- Capture Neovim keystrokes across modes and persist them as JSONL.
- `:AiKeymapStart`, `:AiKeymapStop`, `:AiKeymapFlush`, `:AiKeymapStatus` commands for runtime control.
- `:AiKeymapVisualize` streams a Bun CLI that crunches the log, inspects your dotfiles (auto-detected at `~/ghq/github.com/ryoppippi/dotfiles`), and asks GPT‑5 for conflict‑free keymap proposals.
- `:AiKeymapSuggest` fetches AI proposals via the same CLI and renders selectable suggestions inside Neovim (press `y` to copy a recommended mapping). It reuses the dotfiles root detected above so collisions are filtered automatically.
- Optional `:AiKeymapOpenLog` helper to inspect the raw dataset before sending it to an LLM.

## Setup

1. Ensure [Bun](https://bun.sh) is installed (`bun --version`).
2. Add this repo to your `runtimepath`, or package it with your Neovim config.
3. (Optional) Configure the plugin during setup:

```lua
require("ai_keymap").setup({
  log_path = vim.fn.stdpath("data") .. "/ai_keymap/keystrokes.jsonl",
  visualize_cmd = { "bun", "run", "src/cli.ts" },
  visualize_args = { "--dotfiles", vim.fn.expand("~/ghq/github.com/ryoppippi/dotfiles") },
  suggest_args = {
    "--dotfiles",
    vim.fn.expand("~/ghq/github.com/ryoppippi/dotfiles"),
    "--model",
    "gpt-5",
  },
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
3. Trigger `:AiKeymapVisualize` to open the floating dashboard with aggregated insights.
4. Run `:AiKeymapSuggest` to pick from GPT‑powered proposals; press `y` to yank the highlighted mapping and iterate live.
5. Stop capture with `:AiKeymapStop` when done.

## CLI Usage

The Bun CLI is shared between the floating window and your terminal:

```bash
bun run src/cli.ts \
  --log ~/.local/share/nvim/ai_keymap/keystrokes.jsonl \
  --dotfiles ~/ghq/github.com/ryoppippi/dotfiles \
  --top 8
```

- Scans your log for frequent keystroke sequences.
- Reads `vim.keymap.set` / `noremap` style mappings from the dotfiles you provide.
- Calls GPT‑5 (via the Vercel AI SDK) to propose non-conflicting shortcuts. Use `--skip-ai` to disable the model.
- Pass `--format json` for machine-readable output.
- The Neovim picker (`:AiKeymapSuggest`) runs the CLI with `--format json` under the hood so you can stay in editor.

> 💡 Swap to another model by tweaking `suggest_args` (e.g. `--model gpt-4.1`). The CLI forwards all arguments to the Vercel AI SDK.

## Build & Distribute

```bash
# produce dist/cli.js with a Node shebang
bun run build

# (after packaging/publishing) invoke via npx
npx ai-keymap --log ~/.local/share/nvim/ai_keymap/keystrokes.jsonl --skip-ai
```

`package.json` exposes the CLI as `ai-keymap`, so once the package is published you can call it directly through `npx`, or run it locally from `dist/cli.js`.

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
