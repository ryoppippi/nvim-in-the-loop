# AI-Optimised Vim Keybindings

Human-in-the-loop playground for the talk “AI-Optimised Vim Keybindings: HCI-Driven HITL Interfaces”.

## Features

- Capture Neovim keystrokes across modes and persist them as JSONL.
- `:AiKeymapStart`, `:AiKeymapStop`, `:AiKeymapFlush`, `:AiKeymapStatus` commands for runtime control.
- `:AiKeymapVisualize` streams a Bun CLI that crunches the log, inspects your dotfiles (auto-detected at `~/.config/nvim`), andオプションで GPT‑5 による提案も表示します。
- `:AiKeymapSuggest` は Lua のヒューリスティックで移動キーの連打（例: `jjj`）を検知し、代替案やサンプルマッピングを Neovim 上で提示します（`y` でスニペットをコピー）。
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
3. Trigger `:AiKeymapVisualize` to open the floating dashboard（必要なら `--skip-ai` を渡して AI を無効化）。
4. Run `:AiKeymapSuggest` to inspect repeated movements detected heuristically; press `y` to yank the suggested mapping snippet.
5. Stop capture with `:AiKeymapStop` when done.

## CLI Usage

The Bun CLI is shared between the floating window and your terminal:

```bash
bun run src/cli.ts \
  --log ~/.local/share/nvim/ai_keymap/keystrokes.jsonl \
  --dotfiles ~/.config/nvim \
  --top 8
```

- Scans your log for frequent keystroke sequences.
- Reads `vim.keymap.set` / `noremap` style mappings from the dotfiles you provide.
- Calls GPT‑5 (via the Vercel AI SDK) to propose non-conflicting shortcuts. Use `--skip-ai` to disable the model.
- Pass `--format json` for machine-readable output.
- The Neovim picker (`:AiKeymapSuggest`) now relies on Lua heuristics. Analytics-only users can run the CLI separately with `--skip-ai`.

> 💡 `:AiKeymapSuggest --min-repeat 4` のように閾値を変更できます。AI 提案が必要な場合は CLI (`bun run src/cli.ts`) で `--skip-ai` を外してください。

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
