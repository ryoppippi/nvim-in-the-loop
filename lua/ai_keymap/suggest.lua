local M = {}

local default_cmd = { "bun", "run", "src/cli.ts" }

local state = {
  last_suggestion = nil,
}

local skip_flags = {
  ["--no-ai"] = true,
  ["--skip-ai"] = true,
  ["--format"] = true,
  ["--log"] = true,
  ["-l"] = true,
}

local function sanitize_args(args)
  if not args then
    return nil
  end
  local filtered = {}
  local skip_next = false
  for _, arg in ipairs(args) do
    if skip_next then
      skip_next = false
    elseif skip_flags[arg] then
      if arg == "--log" or arg == "-l" or arg == "--format" then
        skip_next = true
      end
    else
      table.insert(filtered, arg)
    end
  end
  return filtered
end

local function join_chunks(chunks)
  if #chunks == 0 then
    return ""
  end
  return table.concat(chunks, "\n")
end

local function open_preview(suggestion)
  local width = math.floor(vim.o.columns * 0.5)
  local height = math.floor(vim.o.lines * 0.4)
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
    title = " AI Keymap Suggestion ",
    title_pos = "center",
  })

  local lines = {
    string.format("Mode: %s", suggestion.mode),
    string.format("Trigger: %s", suggestion.lhs),
    string.format("Sequence: %s", table.concat(suggestion.sequence, " → ")),
    "",
  }

  if suggestion.recommendedMapping and suggestion.recommendedMapping ~= "" then
    table.insert(lines, "Recommended mapping:")
    for line in suggestion.recommendedMapping:gmatch("[^\n]+") do
      table.insert(lines, "  " .. line)
    end
    table.insert(lines, "")
    table.insert(lines, "Press `y` to copy the recommendation to the default register.")
  else
    table.insert(lines, "No explicit mapping provided. Consider crafting one around `<leader>` shortcuts.")
  end

  if suggestion.rationale and suggestion.rationale ~= "" then
    table.insert(lines, "")
    table.insert(lines, "Rationale:")
    for line in suggestion.rationale:gmatch("[^\n]+") do
      table.insert(lines, "  " .. line)
    end
  end

  table.insert(lines, "")
  table.insert(lines, "Press `q` to close.")

  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.api.nvim_buf_set_option(buf, "modifiable", false)

  state.last_suggestion = suggestion

  vim.keymap.set("n", "q", function()
    if vim.api.nvim_win_is_valid(win) then
      vim.api.nvim_win_close(win, true)
    end
  end, { buffer = buf, nowait = true, silent = true })

  if suggestion.recommendedMapping and suggestion.recommendedMapping ~= "" then
    vim.keymap.set("n", "y", function()
      local snippet = state.last_suggestion and state.last_suggestion.recommendedMapping
      if not snippet or snippet == "" then
        return
      end
      vim.fn.setreg('"', snippet)
      if vim.fn.has("clipboard") == 1 then
        pcall(vim.fn.setreg, "+", snippet)
      end
      vim.notify("[ai_keymap] copied mapping to register", vim.log.levels.INFO)
    end, { buffer = buf, nowait = true, silent = true })
  end
end

local function present_suggestions(dataset)
  local ai = dataset.ai or {}
  local suggestions = ai.suggestions or {}

  if vim.tbl_isempty(suggestions) then
    if ai.raw and ai.raw ~= "" then
      vim.notify("[ai_keymap] AI returned no actionable suggestions.", vim.log.levels.INFO)
    else
      vim.notify("[ai_keymap] No suggestions available (check log size and API key).", vim.log.levels.WARN)
    end
    return
  end

  local items = {}
  for index, suggestion in ipairs(suggestions) do
    local label = string.format(
      "%d. [%s] %s → %s",
      index,
      suggestion.mode,
      suggestion.lhs,
      table.concat(suggestion.sequence, " ")
    )
    table.insert(items, { label = label, value = suggestion })
  end

  vim.ui.select(items, {
    prompt = "AI Keymap Suggestions",
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
    vim.notify("[ai_keymap] suggestion requires a log path", vim.log.levels.ERROR)
    return
  end

  local cmd = vim.deepcopy(opts.cmd or default_cmd)
  table.insert(cmd, "--log")
  table.insert(cmd, log_path)
  table.insert(cmd, "--format")
  table.insert(cmd, "json")

  local extra = sanitize_args(opts.extra_args)
  if extra then
    for _, arg in ipairs(extra) do
      table.insert(cmd, arg)
    end
  end

  local stdout_chunks = {}
  local stderr_chunks = {}

  vim.fn.jobstart(cmd, {
    stdout_buffered = true,
    stderr_buffered = true,
    on_stdout = function(_, data)
      if not data then
        return
      end
      for _, line in ipairs(data) do
        if line ~= "" then
          table.insert(stdout_chunks, line)
        end
      end
    end,
    on_stderr = function(_, data)
      if not data then
        return
      end
      for _, line in ipairs(data) do
        if line ~= "" then
          table.insert(stderr_chunks, line)
        end
      end
    end,
    on_exit = function(_, code)
      if code ~= 0 then
        vim.schedule(function()
          vim.notify(
            string.format("[ai_keymap] suggestion CLI exited with code %d\n%s", code, join_chunks(stderr_chunks)),
            vim.log.levels.ERROR
          )
        end)
        return
      end

      local payload = join_chunks(stdout_chunks)
      if payload == "" then
        vim.schedule(function()
          vim.notify("[ai_keymap] suggestion CLI produced empty output", vim.log.levels.ERROR)
        end)
        return
      end

      local ok, decoded = pcall(vim.json.decode, payload)
      if not ok then
        vim.schedule(function()
          vim.notify("[ai_keymap] failed to decode suggestion JSON: " .. tostring(decoded), vim.log.levels.ERROR)
        end)
        return
      end

      vim.schedule(function()
        if #stderr_chunks > 0 then
          vim.notify("[ai_keymap] " .. join_chunks(stderr_chunks), vim.log.levels.WARN)
        end
        present_suggestions(decoded)
      end)
    end,
  })
end

return M
