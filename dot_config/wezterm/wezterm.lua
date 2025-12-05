local wezterm = require 'wezterm'

local config = {}
if wezterm.config_builder then
    config = wezterm.config_builder()
end

config.window_close_confirmation = 'NeverPrompt'
config.color_scheme = 'Builtin Solarized Light'
config.font_size = 11.0
config.check_for_updates = false

---------------------------------------------------------------------------------
---------------------------------- Launch Menu ----------------------------------
---------------------------------------------------------------------------------

launch_menu = {}
if wezterm.target_triple == 'x86_64-pc-windows-msvc' then
    mod_key1 = 'CTRL|SHIFT'
    mod_key2 = 'ALT'

    config.default_prog = { wezterm.home_dir .. '/AppData/Local/Programs/Git/bin/bash.exe', '-i',  '-l' }
    config.set_environment_variables = { HOMEDRIVE = "C:", HOMEPATH = "\\Users\\will\\" },
    table.insert(launch_menu, {
        label = "Bash",
        args = { wezterm.home_dir .. '/AppData/Local/Programs/Git/bin/bash.exe', '-i',  '-l' },
        set_environment_variables = { HOME = "/c/Users/will/" },
    })

    table.insert(launch_menu, {
        label = 'PowerShell',
        args = { 'powershell.exe', '-NoLogo', '-NoExit', '-Command', 'Remove-Item Env:\\HOMESHARE' },
        set_environment_variables = { HOMEDRIVE = "C:", HOMEPATH = "\\Users\\will\\" },
    })
end

config.launch_menu = launch_menu

---------------------------------------------------------------------------------
------------------------------------- Keys --------------------------------------
---------------------------------------------------------------------------------
config.leader = { key = 'Space', mods = 'CTRL', timeout_milliseconds = 2000 }
config.keys = {
    -- Utility
    { key = ':', mods = 'LEADER', action = wezterm.action.ActivateCommandPalette },

    -- Tab open / close
    { key = 't', mods = 'SUPER', action = wezterm.action.ShowLauncher, },
    { key = 'w', mods = 'SUPER', action = wezterm.action.CloseCurrentTab { confirm = false }, },

    -- Pane Control
    { key = 'h', mods = 'SUPER', action = wezterm.action.ActivatePaneDirection 'Left' },
    { key = 'j', mods = 'SUPER', action = wezterm.action.ActivatePaneDirection 'Down' },
    { key = 'k', mods = 'SUPER', action = wezterm.action.ActivatePaneDirection 'Up' },
    { key = 'l', mods = 'SUPER', action = wezterm.action.ActivatePaneDirection 'Right' },
    { key = 'z', mods = 'LEADER', action = wezterm.action.TogglePaneZoomState },
    { key = 'v', mods = 'LEADER', action = wezterm.action.SplitVertical { domain = 'CurrentPaneDomain' }, },
    { key = '"', mods = 'LEADER', action = wezterm.action.SplitHorizontal { domain = 'CurrentPaneDomain' }, },
    -- TODO look for something like PREFIX+Space in tmux that goes between pane
    -- organizations of the current tab
    { key = 'Space', mods = 'LEADER', action = wezterm.action.RotatePanes 'Clockwise' },

}

---------------------------------------------------------------------------------
-------------------------------- Key Tables -------------------------------------
---------------------------------------------------------------------------------
local search_mode = nil
if wezterm.gui then
    search_mode = wezterm.gui.default_key_tables().search_mode

    -- fzf-like C+k C+j match selection
    table.insert( search_mode, { key = 'k', mods = 'CTRL', action = wezterm.action.CopyMode 'PriorMatch' })
    table.insert( search_mode, { key = 'j', mods = 'CTRL', action = wezterm.action.CopyMode 'NextMatch' })
end

config.key_tables = {
    search_mode = search_mode,
}

---------------------------------------------------------------------------------
-------------------------------- Scrollbar --------------------------------------
---------------------------------------------------------------------------------

-- Hide the scrollbar when there is no scrollback or alternate screen is active
wezterm.on("update-status", function(window, pane)
    local overrides = window:get_config_overrides() or {}
    local dimensions = pane:get_dimensions()

    overrides.enable_scroll_bar = dimensions.scrollback_rows > dimensions.viewport_rows and not pane:is_alt_screen_active()

    window:set_config_overrides(overrides)
end)

---------------------------------------------------------------------------------
-------------------------------- TLS Clients ------------------------------------
---------------------------------------------------------------------------------

-- Example --

-- config.tls_clients = {
--     {
--         name = 'server',
--         remote_address = 'server:47777',
--         accept_invalid_hostnames = true,
--         pem_private_key = wezterm.home_dir .. '/.local/share/wezterm/pki/client.com.key',
--         pem_cert = wezterm.home_dir .. '/.local/share/wezterm/pki/client.com.crt',
--         pem_ca = wezterm.home_dir .. '/.local/share/wezterm/pki/root_ca.crt',
--         pem_root_certs = { wezterm.home_dir .. '/.local/share/wezterm/pki/root_ca.crt' },
--         local_echo_threshold_ms = 1000,
--     },
-- }

---------------------------------------------------------------------------------
----------------------------------- End -----------------------------------------
---------------------------------------------------------------------------------
return config
