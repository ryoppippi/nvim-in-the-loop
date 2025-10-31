if vim.g.loaded_ai_keymap then
  return
end
vim.g.loaded_ai_keymap = true

local ok, ai_keymap = pcall(require, "ai_keymap")
if not ok then
  vim.notify("[ai_keymap] failed to load core module", vim.log.levels.ERROR)
  return
end

ai_keymap.setup()
