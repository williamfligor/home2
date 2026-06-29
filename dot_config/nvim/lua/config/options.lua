-- ── Options ──────────────────────────────────────────────────

local opt = vim.opt

-- ── General ──────────────────────────────────────────────────
opt.mouse = "a"
opt.clipboard = "unnamedplus"
opt.completeopt = { "menuone", "noselect", "noinsert" }
opt.shortmess:append("c")
opt.belloff:append("ctrlg")
opt.modeline = true
opt.modelines = 15

-- ── UI ───────────────────────────────────────────────────────
opt.number = true
opt.relativenumber = true
opt.cursorline = true
opt.showcmd = true
opt.showmode = false -- lualine shows mode
opt.ruler = true
opt.laststatus = 2
opt.visualbell = true
opt.termguicolors = true
opt.background = "light"
opt.signcolumn = "yes"
opt.scrolloff = 8
opt.sidescrolloff = 8

-- ── Search ───────────────────────────────────────────────────
opt.incsearch = true
opt.hlsearch = true
opt.showmatch = true
opt.ignorecase = true
opt.smartcase = true

-- ── Indentation ──────────────────────────────────────────────
opt.tabstop = 4
opt.shiftwidth = 4
opt.softtabstop = 4
opt.expandtab = true
opt.smartindent = true
opt.cinoptions:append("l1")

-- ── Files & Undo ─────────────────────────────────────────────
opt.undofile = true
opt.undodir = vim.fn.expand("~/.vim/nundo")
opt.backupdir = vim.fn.expand("~/.vim/nbackup")
opt.directory = vim.fn.expand("~/.vim/nswap")
opt.backup = true
opt.writebackup = true
opt.swapfile = true

-- Custom shada location (avoids macOS sandbox/permission issues)
opt.shadafile = vim.fn.expand("~/.vim/nshada")

-- Ensure swap/undo/backup dirs exist
for _, dir in ipairs({ vim.fn.expand("~/.vim/nundo"), vim.fn.expand("~/.vim/nbackup"), vim.fn.expand("~/.vim/nswap"), vim.fn.expand("~/.vim/nshada") }) do
  if vim.fn.isdirectory(dir) == 0 then
    vim.fn.mkdir(dir, "p")
  end
end

-- ── Wildmenu ─────────────────────────────────────────────────
opt.wildmode = { "longest:full", "full" }
opt.wildmenu = true

-- ── Splits ───────────────────────────────────────────────────
opt.splitbelow = true
opt.splitright = true

-- ── Wrapping ─────────────────────────────────────────────────
opt.wrap = false
opt.linebreak = true

-- ── Performance ──────────────────────────────────────────────
opt.updatetime = 250
opt.timeoutlen = 300
opt.ttimeoutlen = 10

-- ── Python host (Neovim) ─────────────────────────────────────
vim.g.python3_host_prog = vim.fn.expand("~/pyenvs/py3nvim/bin/python")

-- ── Plugin settings ──────────────────────────────────────────
vim.g.vim_markdown_folding_disabled = 1
vim.g.EditorConfig_exclude_patterns = { "fugitive://.*", "scp://.*" }
