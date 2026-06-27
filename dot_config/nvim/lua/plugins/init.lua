-- ── Plugin Specifications ────────────────────────────────────
-- All plugins managed by lazy.nvim, downloaded by mise http: backend.
-- lazy.nvim itself is the only git-based plugin (plugin manager).

-- mise_dir resolves through mise's latest symlink so consumers
-- never need their version updated when the pin in mise.toml bumps.
local function mise_dir(name)
  return vim.fn.expand("$HOME/.local/share/mise/installs/http-" .. name .. "/latest")
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
      require("which-key").setup(opts)
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
    build = "cargo build --release",
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
      fuzzy = { implementation = "prefer_rust_with_warning" },
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
