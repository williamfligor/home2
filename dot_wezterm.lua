local wezterm = require 'wezterm'

local config = {}
if wezterm.config_builder then
    config = wezterm.config_builder()
end

config.window_close_confirmation = 'NeverPrompt'
config.color_scheme = 'Builtin Solarized Light'
config.font_size = 10.0
config.check_for_updates = false

mod_key1 = 'CMD'
mod_key2 = 'CMD'

launch_menu = {}
if wezterm.target_triple == 'x86_64-pc-windows-msvc' then
    mod_key1 = 'CTRL|SHIFT'
    mod_key2 = 'ALT'

    config.default_prog = { 'C:/Users/will/AppData/Local/Programs/Git/bin/bash.exe', '-i',  '-l' }
    config.set_environment_variables = { HOMEDRIVE = "C:", HOMEPATH = "\\Users\\will\\" },
    table.insert(launch_menu, {
        label = "Bash",
        args = { 'C:/Users/will/AppData/Local/Programs/Git/bin/bash.exe', '-i',  '-l' },
        set_environment_variables = { HOME = "/c/Users/will/" },
    })

    table.insert(launch_menu, {
        label = 'PowerShell',
        args = { 'powershell.exe', '-NoLogo', '-NoExit', '-Command', 'Remove-Item Env:\\HOMESHARE' },
        set_environment_variables = { HOMEDRIVE = "C:", HOMEPATH = "\\Users\\will\\" },
    })
end

keys = {
    { key = 'L', mods = 'CTRL', action = wezterm.action.ShowDebugOverlay },
    {
        key = 't',
        mods = mod_key1,
        action = wezterm.action.ShowLauncher,
    },
    {
        key = 'w',
        mods = mod_key1,
        action = wezterm.action.CloseCurrentTab { confirm = false },
    },
    {
        key = 'c',
        mods = mod_key1,
        action = wezterm.action.CopyTo 'ClipboardAndPrimarySelection',
    },
    {
        key = 'c',
        mods = 'SHIFT|CTRL',
        action = wezterm.action.CopyTo 'ClipboardAndPrimarySelection',
    },
    {
        key = 'v',
        mods = mod_key1,
        action = wezterm.action.PasteFrom 'Clipboard'
    },
    {
        key = 'v',
        mods = 'SHIFT|CTRL',
        action = wezterm.action.PasteFrom 'Clipboard'
    },
}

for i = 1, 9 do
    table.insert(keys, {
        key = tostring(i),
        mods = mod_key2,
        action = wezterm.action.ActivateTab(i - 1),
    })
end

config.keys = keys
config.launch_menu = launch_menu
return config
