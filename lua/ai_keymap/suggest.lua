local analysis = require("ai_keymap.analysis")

local M = {}

local state = {
  last_suggestion = nil,
}

local function parse_args(fargs)
  local opts = {}
  local i = 1
  while i <= #fargs do
    local arg = fargs[i]
    if arg == "--min-repeat" then
      local value = tonumber(fargs[i + 1])
      if value then
        opts.min_repeat = value
      end
      i = i + 2
    elseif arg == "--min-occurrence" then
      local value = tonumber(fargs[i + 1])
      if value then
        opts.min_occurrence = value
      end
      i = i + 2
    else
      i = i + 1
    end
  end
  return opts
end

local function open_preview(suggestion)
  local width = math.floor(vim.o.columns * 0.5)
  local height = math.floor(vim.o.lines * 0.35)
  local row = math.floor((vim.o.lines - height) / 2 - 1)
  local col = math.floor((vim.o.columns - width) / 2)

  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_option(buf, "buftype", "nofile")
  vim.api.nvim_buf_set_option(buf, "modifiable", true)
  vim.api.nvim_buf_set_option(buf, "filetype", "ai-keymap-suggest")

  local win = vim.api.nvim_open_win(buf, true, {
    relative = "editor",
    width = width,
    height = height,
    row = row,
    col = col,
    style = "minimal",
    border = "rounded",
    title = " AI Keymap Heuristics ",
    title_pos = "center",
  })

  local lines = {
    string.format("モード: %s", suggestion.mode_label),
    string.format("キー: '%s' (観測回数: %d, 平均: %.1f 回, 最大: %d 回)", suggestion.key, suggestion.occurrences, suggestion.average, suggestion.max_len),
    "",
    "推奨アクション:",
    "  - 数字カウントを活用して移動を短縮",
    "  - 下記マッピングを検討",
    "",
    suggestion.mapping_snippet,
    "",
    "理由:",
  }

  for line in suggestion.rationale:gmatch("[^\n]+") do
    table.insert(lines, "  " .. line)
  end

  table.insert(lines, "")
  table.insert(lines, "操作: `y` でマッピングをコピー / `q` で閉じる")

  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.api.nvim_buf_set_option(buf, "modifiable", false)

  state.last_suggestion = suggestion

  vim.keymap.set("n", "q", function()
    if vim.api.nvim_win_is_valid(win) then
      vim.api.nvim_win_close(win, true)
    end
  end, { buffer = buf, nowait = true, silent = true })

  vim.keymap.set("n", "y", function()
    local snippet = state.last_suggestion and state.last_suggestion.mapping_snippet
    if not snippet or snippet == "" then
      return
    end
    vim.fn.setreg('"', snippet)
    if vim.fn.has("clipboard") == 1 then
      pcall(vim.fn.setreg, "+", snippet)
    end
    vim.notify("[ai_keymap] マッピングをレジスタへコピーしました", vim.log.levels.INFO)
  end, { buffer = buf, nowait = true, silent = true })
end

local function present_suggestions(suggestions)
  local items = {}
  for index, suggestion in ipairs(suggestions) do
    local label = string.format(
      "%d. %sモード '%s' 連打 (平均 %.1f 回, %d 回出現)",
      index,
      suggestion.mode_label,
      suggestion.key,
      suggestion.average,
      suggestion.occurrences
    )
    table.insert(items, { label = label, value = suggestion })
  end

  vim.ui.select(items, {
    prompt = "検出された繰り返し操作",
    format_item = function(item)
      return item.label
    end,
  }, function(choice)
    if not choice then
      return
    end
    open_preview(choice.value)
  end)
end

function M.run(opts)
  opts = opts or {}

  local log_path = opts.log_path
  if not log_path or log_path == "" then
    vim.notify("[ai_keymap] サジェストにはログパスが必要です", vim.log.levels.ERROR)
    return
  end

  local events, err = analysis.load_events(log_path)
  if not events then
    vim.notify("[ai_keymap] ログ読み込みに失敗: " .. tostring(err), vim.log.levels.ERROR)
    return
  end

  if vim.tbl_isempty(events) then
    vim.notify("[ai_keymap] ログが空のため提案がありません。まずは `:AiKeymapStart` で入力を収集してください。", vim.log.levels.INFO)
    return
  end

  local options = opts.options or {}
  local suggestions = analysis.detect_repeated_movements(events, options)

  if vim.tbl_isempty(suggestions) then
    vim.notify("[ai_keymap] 連続した移動操作は検出されませんでした。", vim.log.levels.INFO)
    return
  end

  present_suggestions(suggestions)
end

M.parse_args = parse_args

return M
