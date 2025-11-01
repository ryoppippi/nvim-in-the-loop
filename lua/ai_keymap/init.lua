local M = {}

local visualizer = require("ai_keymap.visualizer")
local suggester = require("ai_keymap.suggest")

local defaults = {
  log_path = vim.fn.stdpath("data") .. "/ai_keymap/keystrokes.jsonl",
  max_buffered_events = 200, -- auto flush after this many events
  capture_modes = {
    n = true,
    i = true,
    v = true,
    V = true,
    ["\22"] = true, -- CTRL-V (block visual)
    c = true,
    R = true,
  },
  exclude_keys = {
    [""] = true,
    ["\n"] = false, -- keep explicit <CR>
  },
  include_buffer_metadata = true,
  notification_level = vim.log.levels.INFO,
  visualize_cmd = nil, -- override default bun command if provided
  visualize_args = { "--dotfiles", vim.fn.expand("~/.config/nvim") },
  suggest_args = { "--dotfiles", vim.fn.expand("~/.config/nvim"), "--model", "gpt-5" }, -- default CLI args for AI suggestion run
}

local config = vim.deepcopy(defaults)

local state = {
  active = false,
  ns = vim.api.nvim_create_namespace("ai_keymap"),
  pending = {},
  seq = 0,
}

local function ensure_directory(path)
  local dir = vim.fn.fnamemodify(path, ":h")
  if vim.fn.isdirectory(dir) == 0 then
    vim.fn.mkdir(dir, "p")
  end
end

local function notify(msg, level)
  vim.notify("[ai_keymap] " .. msg, level or config.notification_level)
end

local function encode_event(event)
  local ok, payload = pcall(vim.json.encode, event)
  if not ok then
    notify("failed to encode event: " .. tostring(payload), vim.log.levels.ERROR)
    return nil
  end
  return payload
end

local function flush_pending()
  if #state.pending == 0 then
    return
  end

  ensure_directory(config.log_path)

  local lines = {}
  for _, event in ipairs(state.pending) do
    local encoded = encode_event(event)
    if encoded then
      table.insert(lines, encoded)
    end
  end
  state.pending = {}

  if #lines == 0 then
    return
  end

  local ok, err = pcall(vim.fn.writefile, lines, config.log_path, "a")
  if not ok then
    notify("unable to write log file: " .. tostring(err), vim.log.levels.ERROR)
  end
end

local function record_key(char)
  if not state.active then
    return
  end

  local modeinfo = vim.api.nvim_get_mode()
  if not config.capture_modes[modeinfo.mode] then
    return
  end

  if config.exclude_keys[char] then
    return
  end

  state.seq = state.seq + 1

  local buf = vim.api.nvim_get_current_buf()
  local ft = vim.bo[buf].filetype
  local name = vim.api.nvim_buf_get_name(buf)

  local event = {
    seq = state.seq,
    raw = char,
    key = vim.fn.keytrans(char),
    mode = modeinfo.mode,
    blocking = modeinfo.blocking or false,
    timestamp = vim.loop.hrtime(),
  }

  if config.include_buffer_metadata then
    event.bufnr = buf
    event.filetype = ft
    event.file = name ~= "" and vim.fn.fnamemodify(name, ":~") or ""
  end

  table.insert(state.pending, event)

  if #state.pending >= config.max_buffered_events then
    flush_pending()
  end
end

local function start_capture()
  if state.active then
    notify("keystroke capture already running", vim.log.levels.WARN)
    return
  end

  state.active = true
  vim.on_key(record_key, state.ns)
  notify("keystroke capture started → " .. config.log_path)
end

local function stop_capture()
  if not state.active then
    notify("keystroke capture already stopped", vim.log.levels.WARN)
    return
  end

  state.active = false
  vim.on_key(nil, state.ns)
  flush_pending()
  notify("keystroke capture stopped")
end

local function setup_commands()
  vim.api.nvim_create_user_command("AiKeymapStart", function()
    start_capture()
  end, {})

  vim.api.nvim_create_user_command("AiKeymapStop", function()
    stop_capture()
  end, {})

  vim.api.nvim_create_user_command("AiKeymapFlush", function()
    flush_pending()
    notify("pending keystrokes flushed")
  end, {})

  vim.api.nvim_create_user_command("AiKeymapStatus", function()
    local status = state.active and "ON" or "OFF"
    local pending = #state.pending
    notify(string.format("status=%s pending=%d log=%s", status, pending, config.log_path))
  end, {})

  vim.api.nvim_create_user_command("AiKeymapVisualize", function(params)
    flush_pending()
    local args = {}
    if config.visualize_args then
      vim.list_extend(args, config.visualize_args)
    end
    if params and params.fargs then
      vim.list_extend(args, params.fargs)
    end
    visualizer.run({
      log_path = config.log_path,
      cmd = config.visualize_cmd,
      extra_args = args,
    })
  end, {
    nargs = "*",
    complete = "file",
  })

  vim.api.nvim_create_user_command("AiKeymapSuggest", function(params)
    flush_pending()
    local args = {}
    if config.visualize_args then
      vim.list_extend(args, config.visualize_args)
    end
    if config.suggest_args then
      vim.list_extend(args, config.suggest_args)
    end
    if params and params.fargs then
      vim.list_extend(args, params.fargs)
    end
    suggester.run({
      log_path = config.log_path,
      cmd = config.visualize_cmd,
      extra_args = args,
    })
  end, {
    nargs = "*",
    complete = "file",
  })

  vim.api.nvim_create_user_command("AiKeymapOpenLog", function()
    flush_pending()
    local path = config.log_path
    if vim.fn.filereadable(path) == 0 then
      notify("log file not found: " .. path, vim.log.levels.WARN)
      return
    end
    vim.cmd("edit " .. vim.fn.fnameescape(path))
  end, {})
end

function M.setup(opts)
  config = vim.tbl_deep_extend("force", defaults, opts or {})

  setup_commands()

  vim.api.nvim_create_autocmd("VimLeavePre", {
    group = vim.api.nvim_create_augroup("ai_keymap_flush", { clear = true }),
    callback = function()
      flush_pending()
    end,
  })

  if opts and opts.start_immediately then
    start_capture()
  end
end

function M.start()
  start_capture()
end

function M.stop()
  stop_capture()
end

function M.flush()
  flush_pending()
end

function M.status()
  return {
    active = state.active,
    pending = #state.pending,
    log_path = config.log_path,
  }
end

return M
