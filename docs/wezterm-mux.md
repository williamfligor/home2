# Wezterm Mux Server Setup

**Run on server**
```bash
wget -O /tmp/step.deb https://github.com/smallstep/cli/releases/download/v0.27.3-rc10/step-cli_amd64.deb
sudo dpkg -i /tmp/step.deb

mkdir -p ~/.local/share/wezterm/pki
pushd ~/.local/share/wezterm/pki
step certificate create --insecure --no-password --profile root-ca --not-after 43800h "Example Root CA" root_ca.crt root_ca.key
step certificate create server.com server.com.crt server.com.key --kty=RSA --profile leaf --ca ./root_ca.crt --ca-key ./root_ca.key --insecure --no-password --not-after 43800h
step certificate create $USER client.com.crt client.com.key --kty=RSA --profile leaf --ca ./root_ca.crt --ca-key ./root_ca.key --insecure --no-password --not-after 43800h
popd

**Run on client**

```bash
mkdir -p ~/.local/share/wezterm/pki
scp <SERVER>:.local/share/wezterm/pki/{client.com.key,client.com.crt,root_ca.crt} .local/share/wezterm/pki/
```

**Run Server**

```bash
wezterm-mux-server --config-file ~/.config/wezterm/wezterm-mux-server.lua
```
