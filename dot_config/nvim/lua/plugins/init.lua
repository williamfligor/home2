-- ── Plugin Specifications ────────────────────────────────────
-- All plugins managed by lazy.nvim, downloaded by mise http: backend.
-- lazy.nvim itself is the only git-based plugin (plugin manager).

-- mise_dir resolves through mise's version symlink so consumers
-- never need their version updated when the pin in mise.toml bumps.
-- Handles 'latest' (default), 'rel_latest' (rel-prefixed), 'vlatest' (legacy v-prefixed).
local function mise_dir(name)
  local base = vim.fn.expand("$HOME/.local/share/mise/installs/http-" .. name)
  for _, symlink in ipairs({ "latest", "rel_latest", "vlatest" }) do
    local path = base .. "/" .. symlink
    if vim.fn.isdirectory(path) == 1 then return path end
  end
  vim.notify("mise_dir(" .. name .. "): no version symlink found (latest/rel_latest/vlatest), using base", vim.log.levels.WARN)
  return base
end

-- Links the mise-installed blink.cmp prebuilt binary to where
-- blink.cmp expects it, so cargo build / auto-download are unnecessary.
-- The github backend places exactly one binary file in the mise install
-- directory; we auto-discover it rather than guessing the platform name.
local function link_blink_binary()
  vim.notify("blink.cmp: asdf", vim.log.levels.WARN)
  local mise_bin = vim.fn.system("mise where github:saghen/blink.cmp 2>/dev/null"):gsub("%s+", "")
  local mise_src = vim.fn.system("mise where http:blink-cmp 2>/dev/null"):gsub("%s+", "")
  if mise_bin == "" or mise_src == "" then
    vim.notify("blink.cmp: mise where returned empty (mise installed? run mise install?)", vim.log.levels.WARN)
    return
  end

  -- Discover the one prebuilt binary in the github install directory
  local handle = vim.loop.fs_scandir(mise_bin)
  if not handle then
    vim.notify("blink.cmp: cannot list " .. mise_bin, vim.log.levels.WARN)
    return
  end

  local source
  while true do
    local name, type = vim.loop.fs_scandir_next(handle)
    if not name then break end
    -- Skip directories (e.g. mise's .mise-<version> internal dir)
    if type == "file" then
      source = mise_bin .. "/" .. name
      break
    end
  end

  if not source then
    vim.notify("blink.cmp: no binary file found in " .. mise_bin, vim.log.levels.WARN)
    return
  end

  local ext = (jit.os:lower() == "mac" or jit.os:lower() == "osx") and ".dylib"
    or (jit.os:lower() == "windows") and ".dll"
    or ".so"

  local target_dir = mise_src .. "/target/release"
  local target = target_dir .. "/libblink_cmp_fuzzy" .. ext

  vim.fn.mkdir(target_dir, "p")
  -- Always re-link to pick up mise version upgrades (ln -sf is atomic)
  vim.fn.system({ "ln", "-sf", source, target })
end

return {
  -- ── Colorscheme ────────────────────────────────────────────
  {
    name = "solarized.nvim",
    dir = mise_dir("solarized-nvim"),
    lazy = false,
    priority = 1000,
    config = function()
      require("solarized").setup({
        theme = "neo",
      })
      vim.cmd.colorscheme("solarized")
    end,
  },

  -- ── Statusline ─────────────────────────────────────────────
  {
    name = "lualine.nvim",
    dir = mise_dir("lualine-nvim"),
    dependencies = { { name = "nvim-web-devicons", dir = mise_dir("nvim-web-devicons") } },
    event = "VeryLazy",
    opts = {
      options = {
        theme = "solarized_light",
        section_separators = { left = "", right = "" },
        component_separators = { left = "", right = "" },
      },
    },
  },

  -- ── Which-key ──────────────────────────────────────────────
  {
    name = "which-key.nvim",
    dir = mise_dir("which-key-nvim"),
    event = "VeryLazy",
    opts = {
      plugins = { spelling = { enabled = true } },
    },
    config = function(_, opts)
      local wk = require("which-key")
      wk.setup(opts)
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
    end,
  },

  -- ── Fuzzy finder ───────────────────────────────────────────
  {
    name = "fzf",
    dir = mise_dir("fzf"),
    build = ":call fzf#install()",
    lazy = false,
  },
  {
    name = "fzf.vim",
    dir = mise_dir("fzf-vim"),
    lazy = false,
    dependencies = { { name = "fzf", dir = mise_dir("fzf") } },
    keys = {
      { "<leader>?",  "<cmd>Maps<CR>",                        desc = "Key maps" },
      { "<leader>bb", "<cmd>Buffers<CR>",                     desc = "Buffers" },
      { "<leader>ff", "<cmd>Files<CR>",                       desc = "Find files" },
      { "<leader>pf", "<cmd>GFiles<CR>",                      desc = "Git files" },
      { "<leader>fr", "<cmd>History<CR>",                     desc = "Recent files" },
      { "<leader>gs", "<cmd>GFiles?<CR>",                     desc = "Git modified files" },
      { "<leader>s*", function()
          local search = vim.fn.getreg("/")
          search = search:gsub("^\\<", ""):gsub("\\>$", "")
          if search ~= "" then vim.cmd("Rg " .. search) end
        end,                                                  desc = "Rg from search register" },
      { "<leader>sp", "<cmd>Rg<SPACE>",                       desc = "Ripgrep search" },
    },
  },

  -- ── Git signs ──────────────────────────────────────────────
  {
    name = "gitsigns.nvim",
    dir = mise_dir("gitsigns-nvim"),
    event = "BufReadPre",
    opts = {
      signs = {
        add = { text = "│" },
        change = { text = "│" },
        delete = { text = "_" },
        topdelete = { text = "‾" },
        changedelete = { text = "~" },
      },
      on_attach = function(bufnr)
        local gs = package.loaded.gitsigns
        local map = function(mode, l, r, desc)
          vim.keymap.set(mode, l, r, { buffer = bufnr, desc = desc })
        end

        map("n", "]c", function() gs.nav_hunk("next") end, "Next git hunk")
        map("n", "[c", function() gs.nav_hunk("prev") end, "Previous git hunk")
        map("n", "<leader>gp", gs.preview_hunk, "Preview git hunk")
        map("n", "<leader>gr", gs.reset_hunk, "Reset git hunk")
        map("n", "<leader>gR", gs.reset_buffer, "Reset git buffer")
        map("n", "<leader>ga", gs.stage_hunk, "Stage git hunk")
        map("n", "<leader>gA", gs.stage_buffer, "Stage git buffer")
      end,
    },
  },

  -- ── Commenting ─────────────────────────────────────────────
  {
    name = "Comment.nvim",
    dir = mise_dir("comment-nvim"),
    event = { "BufReadPost", "BufNewFile" },
    opts = {},
  },

  -- ── Undotree ───────────────────────────────────────────────
  {
    name = "undotree",
    dir = mise_dir("undotree"),
    cmd = "UndotreeToggle",
    keys = {
      { "<leader>au", "<cmd>UndotreeToggle<cr>", desc = "Toggle undo tree" },
    },
  },

  -- ── Indent guides ──────────────────────────────────────────
  {
    name = "indent-blankline.nvim",
    dir = mise_dir("indent-blankline-nvim"),
    event = { "BufReadPost", "BufNewFile" },
    main = "ibl",
    opts = {
      indent = { char = "│" },
      scope = { enabled = true },
    },
  },

  -- ── Tmux integration ──────────────────────────────────────
  {
    name = "vim-tmux-navigator",
    dir = mise_dir("vim-tmux-navigator"),
    event = "VeryLazy",
  },

  -- ── LSP ────────────────────────────────────────────────────
  {
    name = "nvim-lspconfig",
    dir = mise_dir("nvim-lspconfig"),
    event = { "BufReadPre", "BufNewFile" },
    config = function()
      if vim.fn.executable("pylsp") == 1 then
        vim.lsp.enable("pylsp")
      end
      if vim.fn.executable("clangd") == 1 then
        vim.lsp.enable("clangd")
      end
      if vim.fn.executable("bitbake-language-server") == 1 then
        vim.lsp.config["bitbake_language_server"] = {
          cmd = { "bitbake-language-server" },
          filetypes = { "bitbake" },
          root_markers = { ".git" },
        }
        vim.lsp.enable("bitbake_language_server")
      end
      if vim.fn.executable("tclint") == 1 then
        vim.lsp.config["tclsp"] = {
          cmd = { "tclint", "--lsp" },
          filetypes = { "tcl" },
          root_markers = { ".git" },
        }
        vim.lsp.enable("tclsp")
      end
    end,
  },

  -- ── Completion ─────────────────────────────────────────────
  {
    name = "blink.cmp",
    dir = mise_dir("blink-cmp"),
    event = "InsertEnter",
    init = link_blink_binary,
    opts = {
      keymap = {
        preset = "enter",
        ["<Tab>"] = { "select_next", "fallback" },
        ["<S-Tab>"] = { "select_prev", "fallback" },
      },
      appearance = {
        nerd_font_variant = "Nerd Font Mono",
      },
      completion = {
        menu = {
          border = nil,
        },
        documentation = {
          auto_show = true,
          window = { border = "single" },
        },
      },
      sources = {
        default = { "lsp", "path", "snippets", "buffer" },
      },
      signature = {
        enabled = true,
        window = {
          border = "single",
          scrollbar = true,
        },
      },
      fuzzy = {
        implementation = "rust",
        prebuilt_binaries = { download = false },
      },
    },
  },

  -- ── EditorConfig ───────────────────────────────────────────
  {
    name = "editorconfig.nvim",
    dir = mise_dir("editorconfig-nvim"),
    event = "VeryLazy",
  },

  -- ── Git fugitive ───────────────────────────────────────────
  {
    name = "vim-fugitive",
    dir = mise_dir("vim-fugitive"),
    cmd = { "Git", "G" },
    keys = {
      { "<leader>gS", "<cmd>Git<cr>", desc = "Git status" },
    },
  },

  -- ── Sidekick (AI assistant) ────────────────────────────────
  {
    name = "sidekick.nvim",
    dir = mise_dir("sidekick-nvim"),
    lazy = false,
    config = function()
      require("sidekick").setup({
        nes = { enabled = false },
        cli = {
          mux = {
            backend = "zellij",
            enabled = false,
          },
        },
      })
    end,
    keys = {
      { "<C-.>", function() require("sidekick.cli").focus() end, mode = { "n", "t" }, desc = "Sidekick focus" },
      { "<C-.>", function() require("sidekick.cli").focus() end, mode = "i",          desc = "Sidekick focus" },
      { "<C-.>", function() require("sidekick.cli").focus() end, mode = "x",          desc = "Sidekick focus" },
      { "<leader>aa", function() require("sidekick.cli").toggle({ name = "pi" }) end, desc = "Sidekick toggle" },
      { "<leader>an", function() require("sidekick.cli").new({ name = "pi" }) end,    desc = "Sidekick new CLI" },
      { "<leader>as", function() require("sidekick.cli").select() end,                desc = "Sidekick select CLI" },
      { "<leader>ad", function() require("sidekick.cli").close() end,                 desc = "Sidekick detach" },
      { "<leader>at", function() require("sidekick.cli").send({ msg = "{this}" }) end, desc = "Sidekick send this", mode = { "n", "x" } },
      { "<leader>af", function() require("sidekick.cli").send({ msg = "{file}" }) end, desc = "Sidekick send file" },
      { "<leader>av", ":Sidekick cli send<CR>",                                        desc = "Sidekick send selection", mode = "x" },
      { "<leader>ap", function() require("sidekick.cli").prompt() end,                 desc = "Sidekick prompt", mode = { "n", "x" } },
    },
  },

  -- ── Snacks (dashboard, etc.) ───────────────────────────────
  {
    name = "snacks.nvim",
    dir = mise_dir("snacks-nvim"),
    lazy = false,
  },
}

