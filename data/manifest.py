def vim_package(source):
    parts = source.split("/")
    dest = "/".join(["~", ".vim", "pack", parts[3], "start", parts[4]])
    return {
        "sources": source,
        "cmds": [
            f"rm -rf {dest} || true",
            f"mkdir -p {dest}",
            f"mv */* {dest}",
        ],
    }


def go_install(package):
    return {
        "cmds": [
            f"~/.local/bin/go/bin/go install {package}",
        ]
    }


def zsh_plugin(source):
    parts = source.split("/")
    dest = "/".join(["~", ".zsh", "custom", "plugins", parts[4]])
    return {
        "sources": source,
        "cmds": [
            f"rm -rf {dest} || true",
            f"mkdir -p {dest}",
            f"mv */* {dest}",
        ],
    }


def zsh_theme(source):
    parts = source.split("/")
    dest = "/".join(["~", ".zsh", "custom", "themes", parts[4]])
    return {
        "sources": source,
        "cmds": [
            f"rm -rf {dest} || true",
            f"mkdir -p {dest}",
            f"mv */* {dest}",
        ],
    }


def tmux_plugin(source):
    parts = source.split("/")
    dest = "/".join(["~", ".tmux", "pack", parts[4]])
    return {
        "sources": source,
        "cmds": [
            f"rm -rf {dest} || true",
            f"mkdir -p {dest}",
            f"mv */* {dest}",
        ],
    }


def dmg_install(source, app_name):
    parts = source.split("/")

    return {
        "sources": {
            "darwin": source,
        },
        "cmds": [
            "mkdir -p ~/Applications",
            f'rm -rf "~/Applications/{app_name}/"',
            f'rsync -a "{app_name}/" ~/Applications/',
        ],
    }


data = {
    "ghostty.dmg": dmg_install(
        "https://release.files.ghostty.org/1.0.1/Ghostty.dmg", "Ghostty.app"
    ),
    "stats": dmg_install(
        "https://github.com/exelban/stats/releases/download/v2.11.9/Stats.dmg",
        "Stats.app",
    ),
    "ice": {
        "sources": {
            "darwin": "https://github.com/jordanbaird/Ice/releases/download/0.11.0-beta.2/Ice.zip",
        },
        "cmds": [
            "mkdir -p ~/Applications",
            "rm -rf ~/Applications/Ice.app",
            "rsync -a Ice.app ~/Applications/",
        ],
    },
    "ripgrep": {
        "sources": {
            "darwin": "https://github.com/BurntSushi/ripgrep/releases/download/14.0.3/ripgrep-14.0.3-aarch64-apple-darwin.tar.gz",
        },
        "cmds": [
            "mv ripgrep*/rg ~/.local/bin/rg",
        ],
    },
    "xbar": {
        "sources": {
            "darwin": "https://github.com/matryer/xbar/releases/download/v2.1.7-beta/xbar.v2.1.7-beta.zip",
        },
        "cmds": [
            "mkdir -p ~/Applications",
            "rm -rf ~/Applications/xbar.app",
            "rsync -a xbar.app ~/Applications/",
        ],
    },
    "neovim": {
        "sources": {
            "windows": "https://github.com/neovim/neovim/releases/download/v0.10.1/nvim-win64.zip",
            "darwin": "https://github.com/neovim/neovim/releases/download/v0.10.1/nvim-macos-arm64.tar.gz",
        },
        "cmds": [],
    },
    "uv": {
        "sources": {
            "linux": "https://github.com/astral-sh/uv/releases/download/0.5.21/uv-x86_64-unknown-linux-musl.tar.gz",
            "windows": "https://github.com/astral-sh/uv/releases/download/0.5.21/uv-x86_64-pc-windows-msvc.zip",
            "darwin": "https://github.com/astral-sh/uv/releases/download/0.5.21/uv-aarch64-apple-darwin.tar.gz",
        },
        "cmds": [
            "mv */uvx ~/.local/bin/uvx",
            "mv */uv ~/.local/bin/uv",
        ],
    },
    "eget": {
        "sources": {
            "darwin": "https://github.com/zyedidia/eget/releases/download/v1.3.4/eget-1.3.4-darwin_arm64.tar.gz",
            "linux": "https://github.com/zyedidia/eget/releases/download/v1.3.4/eget-1.3.4-linux_amd64.tar.gz",
            "windows": "https://github.com/zyedidia/eget/releases/download/v1.3.4/eget-1.3.4-windows_amd64.zip",
        },
        "cmds": [
            "mv eget*/eget ~/.local/bin/eget",
            "chmod +x ~/.local/bin/eget",
        ],
        "labels": ["eget", "bins"],
    },
    "golang": {
        "sources": {
            "windows": "https://go.dev/dl/go1.22.1.windows-amd64.zip",
            "linux": "https://go.dev/dl/go1.22.1.linux-amd64.tar.gz",
            "darwin": "https://go.dev/dl/go1.22.1.darwin-arm64.tar.gz",
        },
        "cmds": ["rm -rf ~/.local/bin/go", "mv go ~/.local/bin/go"],
        "labels": ["golang"],
    },
    "fzf": {
        "sources": {
            "linux": "https://github.com/junegunn/fzf/releases/download/0.42.0/fzf-0.42.0-linux_amd64.tar.gz",
            "darwin": "https://github.com/junegunn/fzf/releases/download/0.42.0/fzf-0.42.0-darwin_arm64.zip",
        },
        "cmds": ["mv fzf ~/.local/bin/fzf", "chmod +x ~/.local/bin/fzf"],
        "labels": [],
    },
    "yq": {
        "sources": {
            "windows": "https://github.com/mikefarah/yq/releases/download/v4.40.5/yq_windows_amd64.exe",
            "linux": "https://github.com/mikefarah/yq/releases/download/v4.40.5/yq_linux_amd64",
            "darwin": "https://github.com/mikefarah/yq/releases/download/v4.40.5/yq_darwin_arm64",
        },
        "cmds": ["mv yq* ~/.local/bin/yq", "chmod +x ~/.local/bin/yq"],
    },
    "delta": {
        "sources": {
            "windows": "https://github.com/dandavison/delta/releases/download/0.17.0/delta-0.17.0-x86_64-pc-windows-msvc.zip",
            "linux": "https://github.com/dandavison/delta/releases/download/0.17.0/delta-0.17.0-x86_64-unknown-linux-musl.tar.gz",
            "darwin": "https://github.com/dandavison/delta/releases/download/0.17.0/delta-0.17.0-aarch64-apple-darwin.tar.gz",
        },
        "cmds": [
            "mv delta-*/delta ~/.local/bin/delta",
            "chmod +x ~/.local/bin/delta",
        ],
    },
    "eza": {
        "sources": {
            "windows": "https://github.com/eza-community/eza/releases/download/v0.18.22/eza.exe_x86_64-pc-windows-gnu.tar.gz",
            "linux": "https://github.com/eza-community/eza/releases/download/v0.18.22/eza_x86_64-unknown-linux-musl.tar.gz",
        },
        "cmds": ["mv ./eza ~/.local/bin/eza", "chmod +x ~/.local/bin/eza"],
    },
    "bat": {
        "sources": {
            "windows": "https://github.com/sharkdp/bat/releases/download/v0.24.0/bat-v0.24.0-x86_64-pc-windows-msvc.zip",
            "linux": "https://github.com/sharkdp/bat/releases/download/v0.24.0/bat-v0.24.0-x86_64-unknown-linux-musl.tar.gz",
            "darwin": "https://github.com/sharkdp/bat/releases/download/v0.24.0/bat-v0.24.0-x86_64-apple-darwin.tar.gz",
        },
        "cmds": [
            "mv bat-*/bat ~/.local/bin/bat",
            "chmod +x ~/.local/bin/bat",
        ],
    },
    "zellij": {
        "sources": {
            "linux": "https://github.com/zellij-org/zellij/releases/download/v0.40.0/zellij-x86_64-unknown-linux-musl.tar.gz",
            "darwin": "https://github.com/zellij-org/zellij/releases/download/v0.40.0/zellij-aarch64-apple-darwin.tar.gz",
        },
        "cmds": [
            "mv zellij ~/.local/bin/zellij",
            "chmod +x ~/.local/bin/zellij",
        ],
    },
    "vim": [
        vim_package("https://github.com/junegunn/fzf/archive/refs/tags/0.42.0.tar.gz"),
        vim_package(
            "https://github.com/junegunn/fzf.vim/archive/f3b82091a651a643ef18b220cd3e154d76a54462.tar.gz"
        ),
        vim_package(
            "https://github.com/liuchengxu/vim-which-key/archive/c0eb7a63e80ed0dc2c91eb8c879b7396a795f775.tar.gz"
        ),
        vim_package(
            "https://github.com/kergoth/vim-bitbake/archive/6d4148c3d200265293040a18c2f772340566554b.tar.gz"
        ),
        vim_package(
            "https://github.com/altercation/vim-colors-solarized/archive/528a59f26d12278698bb946f8fb82a63711eec21.tar.gz"
        ),
        vim_package(
            "https://github.com/heavenshell/vim-pydocstring/archive/bc710d75262dfbaa820e5564391bf62f6c9b25fd.tar.gz"
        ),
        vim_package(
            "https://github.com/vim-scripts/DoxygenToolkit.vim/archive/eb7d2b44c52aa6c9695019aeb474e54d606d9854.tar.gz"
        ),
        vim_package(
            "https://github.com/ervandew/supertab/archive/d80e8e2c1fa08607fa34c0ca5f1b66d8a906c5ef.tar.gz"
        ),
        vim_package(
            "https://github.com/mbbill/undotree/archive/485f01efde4e22cb1ce547b9e8c9238f36566f21.tar.gz"
        ),
        vim_package(
            "https://github.com/vim-airline/vim-airline/archive/038e3a6ca59f11b3bb6a94087c1792322d1a1d5c.tar.gz"
        ),
        vim_package(
            "https://github.com/vim-airline/vim-airline-themes/archive/dd81554c2231e438f6d0e8056ea38fd0e80ac02a.tar.gz"
        ),
        vim_package(
            "https://github.com/tpope/vim-commentary/archive/3654775824337f466109f00eaf6759760f65be34.tar.gz"
        ),
        vim_package(
            "https://github.com/airblade/vim-gitgutter/archive/edb607cc4b329099da825c028c53b1264dbd2350.tar.gz"
        ),
        vim_package(
            "https://github.com/pangloss/vim-javascript/archive/cf8872405b059428ffbabe0d5f624b496d92e338.tar.gz"
        ),
        vim_package(
            "https://github.com/peitalin/vim-jsx-typescript/archive/b099549ffd1810eb6f7979202202406939abb77e.tar.gz"
        ),
        vim_package(
            "https://github.com/preservim/vim-markdown/archive/5d3d1b6cbdc4be0b4c6105c1ab1f769d76d3c68f.tar.gz"
        ),
        vim_package(
            "https://github.com/christoomey/vim-tmux-navigator/archive/cdd66d6a37d991bba7997d593586fc51a5b37aa8.tar.gz"
        ),
    ],
    "zsh": [
        {
            "sources": "https://github.com/ohmyzsh/ohmyzsh/archive/32d4389aa6e896b27d9786d142a5c44163104056.tar.gz",
            "cmds": [
                "rm -rf ~/.oh-my-zsh || true",
                "mkdir -p ~/.oh-my-zsh",
                "mv */* ~/.oh-my-zsh",
            ],
        },
        zsh_plugin(
            "https://github.com/zsh-users/zsh-syntax-highlighting/archive/754cefe0181a7acd42fdcb357a67d0217291ac47.tar.gz"
        ),
        zsh_plugin(
            "https://github.com/sineto/vi-mode/archive/2f84dd922cdcceff62ef40ea1a5495c30dcbb280.tar.gz"
        ),
        zsh_plugin(
            "https://github.com/MichaelAquilina/zsh-you-should-use/archive/refs/tags/1.8.0.tar.gz"
        ),
        zsh_theme(
            "https://github.com/romkatv/powerlevel10k/archive/2aa16c54314f175e4f34fdd7fa1bdb03f1797c6a.tar.gz"
        ),
    ],
    "tmux": [
        tmux_plugin(
            "https://github.com/jimeh/tmux-themepack/archive/7c59902f64dcd7ea356e891274b21144d1ea5948.tar.gz"
        ),
        tmux_plugin(
            "https://github.com/tmux-plugins/tmux-pain-control/archive/32b760f6652f2305dfef0acd444afc311cf5c077.tar.gz"
        ),
        tmux_plugin(
            "https://github.com/tmux-plugins/tmux-yank/archive/1b1a436e19f095ae8f825243dbe29800a8acd25c.tar.gz"
        ),
        tmux_plugin(
            "https://github.com/tmux-plugins/tmux-copycat/archive/77ca3aab2aed8ede3e2b941079b1c92dd221cf5f.tar.gz"
        ),
        tmux_plugin(
            "https://github.com/tmux-plugins/tmux-sensible/archive/25cb91f42d020f675bb0a2ce3fbd3a5d96119efa.tar.gz"
        ),
        tmux_plugin(
            "https://github.com/christoomey/vim-tmux-navigator/archive/cdd66d6a37d991bba7997d593586fc51a5b37aa8.tar.gz"
        ),
    ],
    "lazygit": go_install("github.com/jesseduffield/lazygit@latest"),
    "lazydocker": go_install("github.com/jesseduffield/lazydocker@latest"),
    "dive": go_install("github.com/wagoodman/dive@latest"),
    "glab": go_install("gitlab.com/gitlab-org/cli/cmd/glab@main"),
}
