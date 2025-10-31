import { access, readFile } from "node:fs/promises"
import { constants } from "node:fs"

export async function readTextFile(path: string): Promise<string> {
  if (typeof Bun !== "undefined" && typeof Bun.file === "function") {
    const file = Bun.file(path)
    if (!(await file.exists())) {
      throw new Error(`File not found: ${path}`)
    }
    return await file.text()
  }

  await access(path, constants.F_OK)
  return await readFile(path, "utf8")
}
