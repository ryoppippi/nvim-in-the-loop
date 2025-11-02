local M = {}

local default_cmd = { "bun", "run", "src/cli.ts" }

local function create_float()
	local width = math.floor(vim.o.columns * 0.6)
	local height = math.floor(vim.o.lines * 0.6)
	local row = math.floor((vim.o.lines - height) / 2 - 1)
	local col = math.floor((vim.o.columns - width) / 2)

	local buf = vim.api.nvim_create_buf(false, true)
	vim.api.nvim_buf_set_option(buf, "buftype", "nofile")
	vim.api.nvim_buf_set_option(buf, "modifiable", true)
	vim.api.nvim_buf_set_option(buf, "filetype", "ai-keymap-report")

	local win = vim.api.nvim_open_win(buf, true, {
		relative = "editor",
		width = width,
		height = height,
		row = row,
		col = col,
		style = "minimal",
		border = "rounded",
		title = " AI Keymap Visualize ",
		title_pos = "center",
	})

	return buf, win
end

local function start_job(cmd, on_chunk, on_exit)
	return vim.fn.jobstart(cmd, {
		stdout_buffered = true,
		stderr_buffered = true,
		on_stdout = function(_, data)
			if data then
				on_chunk(data)
			end
		end,
		on_stderr = function(_, data)
			if data then
				on_chunk(data)
			end
		end,
		on_exit = function(_, code)
			if on_exit then
				on_exit(code)
			end
		end,
	})
end

function M.run(opts)
	opts = opts or {}
	local log_path = opts.log_path
	if not log_path or log_path == "" then
		return vim.notify("[ai_keymap] visualize requires a log path", vim.log.levels.ERROR)
	end

	local buf, win = create_float()
	vim.api.nvim_buf_set_lines(buf, 0, -1, false, { "Running visualization..." })

	local cmd = vim.deepcopy(opts.cmd or default_cmd)
	table.insert(cmd, "--log")
	table.insert(cmd, log_path)

	if opts.extra_args then
		for _, arg in ipairs(opts.extra_args) do
			table.insert(cmd, arg)
		end
	end

	local first_chunk = true

	start_job(cmd, function(chunk)
		if not vim.api.nvim_buf_is_valid(buf) then
			return
		end
		vim.api.nvim_buf_set_option(buf, "modifiable", true)
		if first_chunk then
			vim.api.nvim_buf_set_lines(buf, 0, -1, false, chunk)
			first_chunk = false
		else
			vim.api.nvim_buf_set_lines(buf, -1, -1, false, chunk)
		end
		vim.api.nvim_buf_set_option(buf, "modifiable", false)
	end, function(code)
		if not vim.api.nvim_win_is_valid(win) then
			return
		end
		vim.api.nvim_buf_set_option(buf, "modifiable", true)
		vim.api.nvim_buf_set_lines(buf, -1, -1, false, { "", string.format("Process exited with code %d", code) })
		vim.api.nvim_buf_set_option(buf, "modifiable", false)
	end)
end

return M
