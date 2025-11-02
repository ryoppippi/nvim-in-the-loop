import { describe, expect, it, beforeAll, afterAll } from "bun:test"
import { unlink } from "node:fs/promises"
import { readKeystrokeLog } from "../src/log.ts"

const tempFile = `${process.cwd()}/tmp-log.jsonl`

beforeAll(async () => {
  const lines = [
    JSON.stringify({ seq: 1, raw: "j", key: "j", mode: "n", timestamp: 1 }),
    JSON.stringify({ seq: 2, raw: "k", key: "k", mode: "n", timestamp: 2 }),
    "{ this is invalid json",
    JSON.stringify({ seq: 3, raw: "h", key: "h", mode: "n", timestamp: 3 }),
  ]
  await Bun.write(tempFile, lines.join("\n"))
})

afterAll(async () => {
  await unlink(tempFile).catch(() => {})
})

describe("readKeystrokeLog", () => {
  it("ignores malformed lines and returns decoded events", async () => {
    const events = await readKeystrokeLog(tempFile)
    expect(events.length).toBe(3)
    expect(events[0].key).toBe("j")
    expect(events[2].seq).toBe(3)
  })
})
