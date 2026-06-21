-- ── Autocmds ─────────────────────────────────────────────────

local autocmd = vim.api.nvim_create_autocmd
local augroup = vim.api.nvim_create_augroup

-- ── Restore cursor position ──────────────────────────────────
local cursor_group = augroup("RestoreCursor", { clear = true })

autocmd("BufReadPost", {
  group = cursor_group,
  callback = function()
    local mark = vim.api.nvim_buf_get_mark(0, '"')
    local line_count = vim.api.nvim_buf_line_count(0)
    if mark[1] > 0 and mark[1] <= line_count then
      pcall(vim.api.nvim_win_set_cursor, 0, mark)
    end
  end,
})

-- ── Highlight on yank ────────────────────────────────────────
autocmd("TextYankPost", {
  group = augroup("HighlightYank", { clear = true }),
  callback = function()
    vim.highlight.on_yank({ higroup = "IncSearch", timeout = 200 })
  end,
})

-- ── Remove trailing whitespace on save ───────────────────────
autocmd("BufWritePre", {
  group = augroup("TrimWhitespace", { clear = true }),
  pattern = "*",
  callback = function()
    local save = vim.fn.winsaveview()
    vim.cmd([[%s/\s\+$//e]])
    vim.fn.winrestview(save)
  end,
})

-- ── Window-local settings ────────────────────────────────────
autocmd("FileType", {
  group = augroup("IndentSettings", { clear = true }),
  pattern = { "python", "lua", "ruby", "javascript", "typescript" },
  callback = function()
    vim.bo.tabstop = 4
    vim.bo.shiftwidth = 4
  end,
})

autocmd("FileType", {
  group = augroup("IndentSettings2", { clear = true }),
  pattern = { "html", "css", "json", "yaml", "markdown", "xml" },
  callback = function()
    vim.bo.tabstop = 2
    vim.bo.shiftwidth = 2
  end,
})
