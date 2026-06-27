-- ── Bootstrap lazy.nvim ──────────────────────────────────────
-- Loaded from mise http: backend install; no git clone needed.

local lazypath = vim.fn.expand("$HOME/.local/share/mise/installs/http-lazy-nvim/latest")
vim.opt.rtp:prepend(lazypath)

-- ── Load plugins ─────────────────────────────────────────────
require("lazy").setup("plugins", {
  change_detection = { notify = false },
})
