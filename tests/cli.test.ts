import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"

let tempDir: string
let logPath: string

beforeAll(async () => {
  tempDir = await mkdtemp(join(Bun.env.TMPDIR ?? "/tmp", "ai-keymap-cli-"))

  const luaContent = `
    vim.keymap.set("n", "<leader>d", ":lua vim.diagnostic.open_float()<CR>")
  `
  await Bun.write(join(tempDir, "keymaps.lua"), luaContent)

  const logLines = [
    JSON.stringify({ seq: 1, raw: "d", key: "d", mode: "n", timestamp: 1 }),
    JSON.stringify({ seq: 2, raw: "d", key: "d", mode: "n", timestamp: 1_500_000 }),
    JSON.stringify({ seq: 3, raw: "p", key: "p", mode: "n", timestamp: 3_000_000 }),
    JSON.stringify({ seq: 4, raw: "d", key: "d", mode: "n", timestamp: 4_500_000 }),
    JSON.stringify({ seq: 5, raw: "d", key: "d", mode: "n", timestamp: 5_000_000 }),
  ]

  logPath = join(tempDir, "keystrokes.jsonl")
  await Bun.write(logPath, logLines.join("\n"))
})

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe("CLI integration", () => {
  it("runs with skip-ai and outputs JSON payload", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "run",
        "src/cli.ts",
        "--log",
        logPath,
        "--dotfiles",
        tempDir,
        "--skip-ai",
        "--format",
        "json",
        "--top",
        "4",
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    )

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    if (stderr.trim().length > 0) {
      console.error("CLI stderr:", stderr)
    }

    expect(exitCode).toBe(0)

    const payload = JSON.parse(stdout)
    expect(payload.logPath).toBe(logPath)
    expect(Array.isArray(payload.sequences)).toBeTrue()
    expect(payload.sequences.length).toBeGreaterThan(0)
    expect(payload.keymapCount).toBeGreaterThanOrEqual(1)
  })
})
