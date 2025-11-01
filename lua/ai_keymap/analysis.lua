local M = {}

local function normalize_key(key)
  if type(key) ~= "string" then
    return ""
  end
  return key
end

function M.load_events(path)
  local ok, lines = pcall(vim.fn.readfile, path)
  if not ok then
    return nil, lines
  end

  local events = {}
  for _, line in ipairs(lines) do
    if line ~= "" then
      local ok_line, decoded = pcall(vim.json.decode, line)
      if ok_line and type(decoded) == "table" then
        table.insert(events, decoded)
      end
    end
  end

  table.sort(events, function(a, b)
    local sa = a.seq or math.huge
    local sb = b.seq or math.huge
    if sa == sb then
      return (a.timestamp or 0) < (b.timestamp or 0)
    end
    return sa < sb
  end)

  return events
end

local function build_mapping(mode, lhs, rhs, direction, count)
  local desc = string.format("Move %d lines %s", count, direction)
  return string.format("vim.keymap.set('%s', '%s', '%s', { desc = '%s' })", mode, lhs, rhs, desc)
end

local default_movement_info = {
  n = {
    j = { direction = "down", lhs = "<leader>J", min_count = 3 },
    k = { direction = "up", lhs = "<leader>K", min_count = 3 },
    h = { direction = "left", lhs = "<leader>H", min_count = 5 },
    l = { direction = "right", lhs = "<leader>L", min_count = 5 },
  },
}

local function mode_label(mode)
  local labels = {
    n = "Normal",
    i = "Insert",
    v = "Visual",
    V = "Visual Line",
    ["\22"] = "Visual Block",
    c = "Command",
    R = "Replace",
  }
  return labels[mode] or mode
end

function M.detect_repeated_movements(events, opts)
  opts = opts or {}
  local min_repeat = opts.min_repeat or 3
  local min_occurrence = opts.min_occurrence or 2
  local movement_info = opts.movement_info or default_movement_info

  local stats = {}
  local i = 1
  while i <= #events do
    local event = events[i]
    local mode = event.mode or ""
    local key = normalize_key(event.key or event.raw)
    local info_mode = movement_info[mode]
    if info_mode and info_mode[key] then
      local repeat_len = 1
      local j = i + 1
      while j <= #events do
        local next_event = events[j]
        if (next_event.mode or "") ~= mode then
          break
        end
        local next_key = normalize_key(next_event.key or next_event.raw)
        if next_key ~= key then
          break
        end
        local prev = events[j - 1]
        if prev.seq and next_event.seq and next_event.seq ~= prev.seq + 1 then
          break
        end
        repeat_len = repeat_len + 1
        j = j + 1
      end

      if repeat_len >= min_repeat then
        stats[mode] = stats[mode] or {}
        local entry = stats[mode][key]
        if not entry then
          entry = { occurrences = 0, total_len = 0, max_len = 0 }
          stats[mode][key] = entry
        end
        entry.occurrences = entry.occurrences + 1
        entry.total_len = entry.total_len + repeat_len
        entry.max_len = math.max(entry.max_len, repeat_len)
      end
      i = j
    else
      i = i + 1
    end
  end

  local suggestions = {}

  for mode, keys in pairs(stats) do
    for key, entry in pairs(keys) do
      if entry.occurrences >= min_occurrence then
        local info = movement_info[mode][key]
        local average = entry.total_len / entry.occurrences
        local suggested_count = math.max(info.min_count or min_repeat, math.floor(average + 0.5))
        local lhs = info.lhs or string.format("<leader>%s", string.upper(key))
        local rhs = string.format("%d%s", suggested_count, key)
        local snippet = build_mapping(mode, lhs, rhs, info.direction, suggested_count)

        table.insert(suggestions, {
          mode = mode,
          mode_label = mode_label(mode),
          key = key,
          occurrences = entry.occurrences,
          average = average,
          max_len = entry.max_len,
          mapping_lhs = lhs,
          mapping_rhs = rhs,
          mapping_snippet = snippet,
          direction = info.direction,
          min_repeat = min_repeat,
          title = string.format("%s: repeated '%s' presses (avg %.1f)", mode_label(mode), key, average),
          rationale = string.format(
            "Detected %d occurrences in %s of pressing '%s' consecutively at least %d times (max %d). Consider using a count prefix or mapping to compress the movement.",
            entry.occurrences,
            mode_label(mode),
            key,
            min_repeat,
            entry.max_len
          ),
        })
      end
    end
  end

  table.sort(suggestions, function(a, b)
    if a.occurrences == b.occurrences then
      return a.average > b.average
    end
    return a.occurrences > b.occurrences
  end)

  return suggestions
end

return M
