-- ── Keymaps ──────────────────────────────────────────────────

local map = vim.keymap.set
local opts = { noremap = true, silent = true }

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

-- ── Format ───────────────────────────────────────────────────
map("n", "<leader>j=", "mzgg=G`z", { desc = "Format entire file" })

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


-- ── FZF ──────────────────────────────────────────────────────
map("n", "<leader>?", ":Maps<CR>", { desc = "Key maps" })
map("n", "<leader>bb", ":Buffers<CR>", { desc = "Buffers" })
map("n", "<leader>ff", ":Files<CR>", { desc = "Find files" })
map("n", "<leader>pf", ":GFiles<CR>", { desc = "Git files" })
map("n", "<leader>fr", ":History<CR>", { desc = "Recent files" })
map("n", "<leader>gs", ":GFiles?<CR>", { desc = "Git modified files" })
map("n", "<leader>s*", function()
  local search = vim.fn.getreg("/")
  -- Strip Vim word-boundary markers (\<, \>) added by * and # commands
  search = search:gsub("^\\<", ""):gsub("\\>$", "")
  if search ~= "" then
    vim.cmd("Rg " .. search)
  end
end, { desc = "Rg from search register" })
map("n", "<leader>sp", ":Rg<SPACE>", { desc = "Ripgrep search" })

-- ── Undotree ─────────────────────────────────────────────────
map("n", "<leader>au", ":UndotreeToggle<CR>", { desc = "Toggle undo tree" })

-- ── Sidekick ─────────────────────────────────────────────────
-- Focus (normal, terminal, insert, visual)
map({ "n", "t" }, "<C-.>", function() require("sidekick.cli").focus() end, { desc = "Sidekick focus" })
map("i", "<C-.>", function() require("sidekick.cli").focus() end, { desc = "Sidekick focus" })
map("x", "<C-.>", function() require("sidekick.cli").focus() end, { desc = "Sidekick focus" })

-- CLI management
map("n", "<leader>aa", function() require("sidekick.cli").toggle({ name = "pi" }) end, { desc = "Sidekick toggle" })
map("n", "<leader>an", function() require("sidekick.cli").new({ name = "pi" }) end, { desc = "Sidekick new CLI" })
map("n", "<leader>as", function() require("sidekick.cli").select() end, { desc = "Sidekick select CLI" })
map("n", "<leader>ad", function() require("sidekick.cli").close() end, { desc = "Sidekick detach" })

-- Send to CLI
map("n", "<leader>at", function() require("sidekick.cli").send({ msg = "{this}" }) end, { desc = "Sidekick send this" })
map("x", "<leader>at", function() require("sidekick.cli").send({ msg = "{this}" }) end, { desc = "Sidekick send this" })
map("n", "<leader>af", function() require("sidekick.cli").send({ msg = "{file}" }) end, { desc = "Sidekick send file" })
map("x", "<leader>av", ":Sidekick cli send<CR>", { desc = "Sidekick send selection" })

-- Prompt
map("n", "<leader>ap", function() require("sidekick.cli").prompt() end, { desc = "Sidekick prompt" })
map("x", "<leader>ap", function() require("sidekick.cli").prompt() end, { desc = "Sidekick prompt" })
