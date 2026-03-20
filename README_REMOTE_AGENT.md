# Z-Cockpit Remote Agent

`remote_agent.py` is a lightweight HTTP server you run on a remote PC (e.g. a Raspberry Pi, a dedicated flashing station, or any Linux/Windows/macOS machine with a device attached). It exposes that machine's serial ports and OpenOCD instance to z-cockpit, enabling remote flashing and script execution from your browser.

---

## Requirements

| Package | Purpose |
|---|---|
| `fastapi` | HTTP framework |
| `uvicorn` | ASGI server |
| `pyserial` | Serial port access |
| `openocd` | Must be in `PATH` on the remote machine |

```bash
pip install fastapi "uvicorn[standard]" pyserial
```

---

## Usage

```bash
# Open access, default port 7777
python remote_agent.py

# Custom port
python remote_agent.py --port 8888

# With an API token (recommended on any non-trusted network)
python remote_agent.py --port 7777 --token mysecrettoken

# Bind to a specific interface instead of all interfaces
python remote_agent.py --host 192.168.1.50 --port 7777
```

### CLI options

| Option | Default | Description |
|---|---|---|
| `--host` | `0.0.0.0` | Network interface to bind to |
| `--port` | `7777` | TCP port to listen on |
| `--token` | *(empty)* | API token — if set, every request must include `X-Token: <token>` |

---

## Connecting from z-cockpit

1. Start the agent on the remote PC.
2. Open z-cockpit in your browser.
3. Go to **Settings → Remote Agents → + Add Agent**.
4. Enter the agent's name, IP address, port, and token (if set).
5. Click **Test** to verify connectivity.
6. In the **OpenOCD → Scripts** tab, select the agent from the **"on:"** dropdown before clicking **▶ Run**.

---

## Running as a background service

### systemd (Linux)

Create `/etc/systemd/system/z-cockpit-agent.service`:

```ini
[Unit]
Description=Z-Cockpit Remote Agent
After=network.target

[Service]
ExecStart=/usr/bin/python3 /opt/z-cockpit/remote_agent.py --port 7777 --token mysecrettoken
WorkingDirectory=/opt/z-cockpit
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now z-cockpit-agent
sudo systemctl status z-cockpit-agent
```

### Auto-start on login (simple alternative)

```bash
# Add to ~/.bashrc or run manually in a tmux/screen session
nohup python3 remote_agent.py --port 7777 --token mysecrettoken &
```

---

## Security

- **On a trusted LAN with no sensitive data:** running without a token is fine.
- **On any other network:** always set `--token`. The token is sent in the `X-Token` request header and is not encrypted in transit — use a VPN or SSH tunnel if the connection crosses an untrusted network.
- The agent binds to `0.0.0.0` by default (all interfaces). Use `--host` to restrict it to a specific interface if needed.

### SSH tunnel example

If you don't want to expose the agent port at all, tunnel it over SSH:

```bash
# On your local machine — forward local port 7777 to the remote's port 7777
ssh -L 7777:localhost:7777 user@remote-pi

# In z-cockpit Settings, add the agent as:
#   Host: 127.0.0.1   Port: 7777
```

---

## API reference

All endpoints (except `GET /`) require the `X-Token` header when a token is configured.

### Status

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Returns service info, auth status, and serial availability |

### Serial

| Method | Path | Body / Params | Description |
|---|---|---|---|
| `GET` | `/api/serial/ports` | — | List available serial ports |
| `GET` | `/api/serial/status` | — | Current connection state |
| `POST` | `/api/serial/connect` | `{port, baud_rate}` | Open a serial port |
| `POST` | `/api/serial/disconnect` | — | Close the serial port |
| `POST` | `/api/serial/send` | `{data, data_type, line_ending}` | Send data (`data_type`: `ascii` or `hex`) |
| `GET` | `/api/serial/buffer` | `?since=N` | Return RX chunks received since offset `N` |
| `WS` | `/ws/serial` | — | Real-time RX data stream |

### OpenOCD

| Method | Path | Body | Description |
|---|---|---|---|
| `POST` | `/api/openocd/start` | `{executable, interface_config, target_config, telnet_port, tcl_port}` | Start OpenOCD process |
| `POST` | `/api/openocd/stop` | — | Stop OpenOCD process |
| `POST` | `/api/openocd/connect` | — | Connect to OpenOCD via telnet |
| `POST` | `/api/openocd/disconnect` | — | Disconnect telnet session |
| `GET` | `/api/openocd/status` | — | Process and connection status |
| `POST` | `/api/openocd/command` | `{cmd}` | Send a raw TCL command |
| `POST` | `/api/openocd/flash/halt` | — | Halt the target CPU |
| `POST` | `/api/openocd/flash/erase_chip` | — | Full chip erase |
| `POST` | `/api/openocd/firmware/upload` | multipart `file` | Upload a `.bin` file to the agent's temp dir |
| `POST` | `/api/openocd/flash/program` | `{filename, address, verify, do_reset}` | Flash a previously uploaded file |
| `WS` | `/ws/openocd` | — | Real-time OpenOCD log stream |

Uploaded firmware is stored in the system temp directory (`/tmp/z-cockpit-agent/` on Linux) and persists until the OS clears it or the agent is restarted.

---

## Troubleshooting

**`openocd not found`**
Ensure `openocd` is installed and in `PATH` for the user running the agent. Test with `which openocd` or `openocd --version`.

**`pyserial not installed`**
Run `pip install pyserial`. Serial endpoints will return empty port lists until it is installed.

**Permission denied on serial port (Linux)**
Add the user to the `dialout` group:
```bash
sudo usermod -aG dialout $USER
# Log out and back in for the change to take effect
```

**Connection refused from z-cockpit**
- Confirm the agent is running: `curl http://<remote-ip>:7777/`
- Check firewall rules: `sudo ufw allow 7777` or equivalent.
- Verify `--host` is not restricting access to a different interface.

**401 Unauthorized**
The token in z-cockpit Settings does not match `--token`. Update one or the other.
