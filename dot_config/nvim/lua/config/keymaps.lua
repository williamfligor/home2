-- ── Keymaps ──────────────────────────────────────────────────

local map = vim.keymap.set
local opts = { noremap = true, silent = true }

-- ── Which-key group labels ──────────────────────────────────
local wk = require("which-key")
wk.add({
  { "<leader>b", group = "buffer" },
  { "<leader>f", group = "file" },
  { "<leader>g", group = "git" },
  { "<leader>p", group = "project" },
  { "<leader>w", group = "window" },
  { "<leader>t", group = "toggle" },
  { "<leader>a", group = "sidekick" },
  { "<leader>e", group = "location" },
  { "<leader>q", group = "quit" },
  { "<leader>s", group = "search" },
  { "<leader>d", group = "docstring" },
  { "<leader>m", group = "doxygen" },
})

-- ── Better defaults ──────────────────────────────────────────
-- Reselect after indent
map("v", "<", "<gv", opts)
map("v", ">", ">gv", opts)

-- Clear search highlight
map("n", "<leader>sc", ":noh<CR>", { desc = "Clear search highlight" })

-- Remove trailing whitespace
map("n", "<leader>W", ":%s/\\s\\+$//<cr>:let @/='' <CR>", { desc = "Remove trailing whitespace" })

-- %% expands to buffer directory in command mode
vim.cmd([[cnoremap <expr> %% getcmdtype() == ':' ? expand('%:h').'/' : '%%']])

-- ── Buffer navigation ────────────────────────────────────────
map("n", "<leader>bd", ":bdelete<CR>", { desc = "Delete buffer" })
map("n", "<leader>bn", ":bn<CR>", { desc = "Next buffer" })
map("n", "<leader>bp", ":bp<CR>", { desc = "Previous buffer" })

-- ── File operations ──────────────────────────────────────────
map("n", "<leader>fs", ":w<CR>", { desc = "Save file" })
map("n", "<leader>fS", ":wa<CR>", { desc = "Save all files" })
map("n", "<leader>fed", ":e $MYVIMRC<CR>", { desc = "Edit config" })
map("n", "<leader>feR", ":source $MYVIMRC<CR>", { desc = "Reload config" })

-- ── Quit ─────────────────────────────────────────────────────
map("n", "<leader>qq", ":qa<CR>", { desc = "Quit all" })
map("n", "<leader>qQ", ":qa!<CR>", { desc = "Force quit all" })
map("n", "<leader>qs", ":xa<CR>", { desc = "Save and quit" })

-- ── Toggles ──────────────────────────────────────────────────
map("n", "<leader>tn", ":set number! relativenumber!<CR>", { desc = "Toggle line numbers" })
map("n", "<leader>tl", ":set wrap!<CR>", { desc = "Toggle line wrap" })

-- ── Window management ────────────────────────────────────────
map("n", "<leader>w-", ":sp<CR>", { desc = "Horizontal split" })
map("n", "<leader>w/", ":vsp<CR>", { desc = "Vertical split" })
map("n", "<leader>w=", "<C-W>=", { desc = "Equalize splits" })
map("n", "<leader>wd", ":q<CR>", { desc = "Close window" })
map("n", "<leader>wh", "<C-W>h", { desc = "Focus left" })
map("n", "<leader>wj", "<C-W>j", { desc = "Focus down" })
map("n", "<leader>wk", "<C-W>k", { desc = "Focus up" })
map("n", "<leader>wl", "<C-W>l", { desc = "Focus right" })
map("n", "<leader>ws", "<C-W>s", { desc = "Split horizontally" })
map("n", "<leader>wv", "<C-W>v", { desc = "Split vertically" })
map("n", "<leader>ww", "<C-W><C-W>", { desc = "Focus next window" })

-- ── Location list ────────────────────────────────────────────
map("n", "<leader>en", ":lnext<CR>", { desc = "Next location" })
map("n", "<leader>ep", ":lprev<CR>", { desc = "Previous location" })

-- ── Diagnostics ──────────────────────────────────────────────
map("n", "<leader>se", vim.diagnostic.open_float, { desc = "Show diagnostic" })
map("n", "[d", vim.diagnostic.goto_prev, { desc = "Previous diagnostic" })
map("n", "]d", vim.diagnostic.goto_next, { desc = "Next diagnostic" })
