import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { collectKeymaps } from "../src/keymaps.ts"

let tmpDir: string

beforeAll(async () => {
  tmpDir = await mkdtemp(join(Bun.env.TMPDIR ?? "/tmp", "ai-keymap-test-"))

  const luaContent = `
    vim.keymap.set({ "n", "v" }, "<leader>r", ":source %<CR>")
    vim.keymap.set("i", "jj", "<Esc>", { silent = true })
  `
  const vimContent = `
    nnoremap <leader>f :Files<CR>
    " comment line should be ignored
    xnoremap <leader>p :echo "paste"<CR>
  `

  await Bun.write(join(tmpDir, "init.lua"), luaContent)
  await Bun.write(join(tmpDir, "mappings.vim"), vimContent)
})

afterAll(async () => {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true })
  }
})

describe("collectKeymaps", () => {
  it("extracts Lua and Vimscript keymaps with modes", async () => {
    const keymaps = await collectKeymaps([tmpDir])

    const leaderRNormal = keymaps.find(
      (entry) => entry.mode === "n" && entry.lhs === "<leader>r",
    )
    expect(leaderRNormal).toBeTruthy()

    const leaderRVisual = keymaps.find(
      (entry) => entry.mode === "v" && entry.lhs === "<leader>r",
    )
    expect(leaderRVisual).toBeTruthy()

    const insertJJ = keymaps.find((entry) => entry.mode === "i" && entry.lhs === "jj")
    expect(insertJJ).toBeTruthy()

    const leaderF = keymaps.find((entry) => entry.mode === "n" && entry.lhs === "<leader>f")
    expect(leaderF).toBeTruthy()

    const visualPaste = keymaps.find((entry) => entry.mode === "x" && entry.lhs === "<leader>p")
    expect(visualPaste).toBeTruthy()
  })
})
