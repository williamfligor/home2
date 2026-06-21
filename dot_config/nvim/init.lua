-- ── Neovim Configuration ─────────────────────────────────────
-- Modern Lua config with lazy.nvim

-- Set leader before anything else
vim.g.mapleader = " "
vim.g.maplocalleader = " "

-- Load config modules
require("config.options")
require("config.keymaps")
require("config.autocmds")

-- Bootstrap & load plugins
require("config.lazy")
