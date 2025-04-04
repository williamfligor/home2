set runtimepath^=~/.vim runtimepath+=~/.vim/after
let &packpath=&runtimepath

source ~/.vimrc

" LSP configuration (equivalent to the config function)
lua << EOF
vim.g.coq_settings = {
    auto_start = true,
}

require'lspconfig'.pylsp.setup{}
EOF

set notermguicolors
