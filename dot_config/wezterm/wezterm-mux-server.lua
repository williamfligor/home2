local wezterm = require("wezterm")
local config = wezterm.config_builder and wezterm.config_builder() or {}
config.tls_servers = {{
    bind_address = '0.0.0.0:47777',
    pem_private_key = wezterm.home_dir .. '/.local/share/wezterm/pki/server.com.key',
    pem_cert = wezterm.home_dir .. '/.local/share/wezterm/pki/server.com.crt',
    pem_ca = wezterm.home_dir .. '/.local/share/wezterm/pki/root_ca.crt',
    pem_root_certs = {wezterm.home_dir .. '/.local/share/wezterm/pki/root_ca.crt'},
}}
return config
