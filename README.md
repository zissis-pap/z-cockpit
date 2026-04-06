# Z-Cockpit

A modern, web-based embedded development toolkit that brings essential embedded systems tools into a unified, browser-accessible interface. Built with FastAPI and React, Z-Cockpit provides remote access to OpenOCD, serial terminals, MQTT brokers, and more.

![Z-Cockpit Screenshot](https://raw.githubusercontent.com/anomalyco/z-cockpit/main/docs/screenshot.png)

## Features

### 🎯 Core Functionality

- **OpenOCD Integration** - Flash, erase, read, and debug microcontrollers via OpenOCD
- **Serial Terminal** - Terminal with hex/ASCII display and timestamped logging
- **MQTT Client** - Connect to multiple brokers, subscribe to topics, view JSON payloads
- **Git Projects** - Manage GitHub/Bitbucket repositories, clone, pull, commit, push
- **Format Converter** - Instant conversion between ASCII, Hex, Binary, Decimal, Base64
- **Binary Editor** - Hex editor with virtual scrolling, undo/redo, compare mode
- **Network Tools** - Interface info and network scanner
- **Script Runner** - JSON-based step-by-step automation for flashing, serial, and OpenOCD operations

### 🌐 Remote Access

- **Remote Agent** - Run Z-Cockpit on a remote machine (Raspberry Pi, flashing station) and control it from anywhere
- **WebSocket Proxying** - Seamless proxying of OpenOCD and serial connections through remote agents
- **Token Authentication** - Secure API token support for remote agents

### 💻 User Experience

- **Dark Theme** - Modern, eye-friendly dark UI
- **Responsive Layout** - Collapsible sidebar, resizable panels
- **Real-time Updates** - WebSocket-based streaming for logs, serial data, packets
- **Keyboard Shortcuts** - Full keyboard navigation in editor and terminal

## Project Structure

```
z-cockpit/
├── backend/               # FastAPI backend server
│   ├── main.py           # Application entry point
│   ├── routers/          # API route handlers
│   │   ├── openocd.py    # OpenOCD server & flash operations
│   │   ├── serial_port.py # Serial terminal API
│   │   ├── mqtt.py       # MQTT broker management
│   │   ├── projects.py   # Git repository operations
│   │   ├── tools.py      # Network tools (scan, capture)
│   │   ├── scripts.py    # Script runner
│   │   ├── remotes.py    # Remote agent management
│   │   ├── settings.py   # Application settings
│   │   └── __init__.py
│   ├── services/         # Business logic layer
│   │   ├── openocd_manager.py
│   │   ├── serial_manager.py
│   │   ├── mqtt_manager.py
│   │   ├── repos_manager.py
│   │   ├── script_runner.py
│   │   ├── remotes_manager.py
│   │   ├── github_manager.py
│   │   ├── bitbucket_manager.py
│   │   └── network_tools.py
│   └── static/           # Production frontend (built)
├── frontend/             # React frontend application
│   ├── src/
│   │   ├── components/   # React components
│   │   │   ├── ProjectsTab/
│   │   │   ├── OpenOCDTab/
│   │   │   ├── SerialTab/
│   │   │   ├── MQTTTab/
│   │   │   ├── ToolsTab/
│   │   │   ├── ConverterTab/
│   │   │   ├── BinaryEditorTab/
│   │   │   ├── SettingsTab/
│   │   │   └── AboutTab/
│   │   ├── api/          # API client
│   │   ├── hooks/        # Custom React hooks
│   │   ├── data/         # Static data (MCU configs)
│   │   ├── types/        # TypeScript definitions
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   └── index.css
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
├── config/               # Configuration files
│   ├── remotes.json
│   └── scripts.json
├── remote_agent.py       # Standalone remote agent
├── requirements.txt      # Python dependencies
├── version.json          # Version info
├── Dockerfile            # Multi-stage container build
├── docker-compose.yml    # Container orchestration
├── start.sh              # Startup script
├── setup.sh              # Setup script
└── README.md
```

## Installation

### Prerequisites

- Python 3.9+
- Node.js 24 LTS (for frontend)
- OpenOCD (for flash operations)
- pip (Python package manager)

**Optional dependencies:**
- `aiomqtt` - For MQTT client functionality (pip install aiomqtt)

### Quick Start

```bash
# Clone the repository
git clone https://github.com/anomalyco/z-cockpit.git
cd z-cockpit

# Install Python dependencies
pip install -r requirements.txt

# Install Node dependencies
cd frontend
npm install
cd ..

# Start the application
./start.sh
```

The application will be available at `http://localhost:8000`

### Running as a Service (systemd)

To run Z-Cockpit automatically on system startup:

```bash
# Copy the service file
sudo cp z-cockpit.service /etc/systemd/system/

# Reload systemd daemon
sudo systemctl daemon-reload

# Enable and start the service
sudo systemctl enable --now z-cockpit.service

# Check status
sudo systemctl status z-cockpit.service
```

**Service file location**: `z-cockpit.service` (in project root)

**Logs**: Check `/home/zissis/Projects/Personal/z-cockpit/start.log` or use `journalctl -u z-cockpit.service -f`

**To stop/disable**:
```bash
sudo systemctl stop z-cockpit.service
sudo systemctl disable z-cockpit.service
```

### Running with Docker

The easiest way to run Z-Cockpit is via Docker. A multi-stage `Dockerfile` and `docker-compose.yml` are included.

**Requirements:** Docker Engine + Docker Compose plugin.

**Build and start:**

```bash
docker compose up --build
```

The app will be available at `http://localhost:8000`.

**Subsequent starts (no rebuild needed):**

```bash
docker compose up
```

**Stop:**

```bash
docker compose down
```

#### Persistent data

Two mounts keep your configuration across container rebuilds:

| Path in container | What is stored |
|---|---|
| `/app/config` | `remotes.json`, `scripts.json` (bind-mounted from `./config/`) |
| `/root/.config/z-cockpit` | Account settings (named Docker volume `z-cockpit-settings`) |

#### Hardware access (serial ports & OpenOCD / ST-Link)

The compose file runs the container with `privileged: true`, which exposes all host devices. If you prefer tighter control, replace that flag with explicit device entries in `docker-compose.yml`:

```yaml
    devices:
      - /dev/ttyACM0:/dev/ttyACM0   # serial port
      - /dev/bus/usb:/dev/bus/usb   # USB bus for ST-Link / OpenOCD
```

### Development Mode

```bash
# Terminal 1 - Backend
./dev.sh  # or: python -m uvicorn backend.main:app --reload

# Terminal 2 - Frontend (new terminal)
cd frontend
npm run dev
```

Frontend will run on `http://localhost:5173` and proxy API requests to the backend.

## Usage

### 1. Projects Tab - Git Repository Management

Manage GitHub and Bitbucket repositories directly from the browser.

**Features:**
- View all repositories from configured accounts
- Clone repositories to local storage
- Pull latest changes
- View file changes and diff status
- Commit and push changes
- Browse repository files in browser

**Setup:**
1. Go to **Settings → Accounts**
2. Click **+ Add Account**
3. Enter your GitHub/Bitbucket credentials
4. Specify the base path for cloning repositories

**Operations:**
- **Clone**: Download repository to local storage
- **Pull**: Update repository with remote changes
- **Fetch**: Check for remote updates without merging
- **Commit**: Stage and commit changes with message
- **Browse**: View files, edit in binary editor

### 2. OpenOCD Tab - Flash & Debug

Control OpenOCD server and flash microcontrollers.

**Server Control:**
- Start/Stop OpenOCD server
- Configure interface and target configs
- Set telnet/TCL ports
- Monitor server logs

**MCU Selector:**
- Pre-configured MCU profiles (STM32, ESP32, etc.)
- Custom configuration support
- Load configs from file system

**Flash Operations:**
- Halt CPU
- Erase chip or specific addresses
- Program firmware from uploaded file
- Verify programmed firmware
- Read flash memory
- Reset target

**Memory Viewer:**
- Read memory at specific addresses
- Edit memory contents
- Hex dump display
- Live updates via telnet

**TCL Console:**
- Send raw TCL commands to OpenOCD
- Execute custom OpenOCD scripts
- Debug and diagnostics

**Remote Agents:**
- Select remote agent for operations
- Proxy all OpenOCD commands through agent
- Flash remote devices from central server

### 3. Serial Terminal

Full-featured serial communication terminal.

**Connection Settings:**
- Port selection (auto-refresh)
- Baud rate (50 to 3M)
- Data bits (5-8)
- Parity (None/Even/Odd/Mark/Space)
- Stop bits (1-2)

**Display Modes:**
- **ASCII Mode**: Standard terminal display
- **Hex Mode**: Raw hex dump
- **Both Mode**: Side-by-side hex and ASCII

**Features:**
- Timestamped logging (per line)
- Real-time auto-scroll
- Save to file (server-side)
- Line ending options (\n, \r, \r\n, \n\r)
- Data type selection (ASCII/Hex)
- Log file management

**Usage:**
1. Select serial port
2. Configure baud rate and settings
3. Click **Connect**
4. Send data in the input box
5. View received data in terminal

### 4. MQTT Tab - IoT Messaging

Connect to MQTT brokers and subscribe to topics.

**Broker Management:**
- Add multiple brokers
- Connect/disconnect brokers
- Store credentials securely
- Auto-reconnect on startup
- Save configuration to localStorage

**Topic Subscription:**
- Subscribe to topics (supports wildcards)
- Unsubscribe from topics
- View QoS levels
- See retain flags

**Message Display:**
- Timestamp and broker source
- Topic name display
- Payload preview (first 8 fields)
- JSON tree viewer
- Raw payload view
- Copy to clipboard

**JSON Parsing:**
- Automatic JSON detection
- Collapsible tree view
- Color-coded data types
- Pretty-printed output

### 5. Converter Tab - Data Format转换

Instant conversion between multiple data formats.

**Supported Formats:**
- ASCII/UTF-8 text
- Hexadecimal (space-separated)
- Binary (space-separated)
- Decimal (space-separated bytes)
- Base64

**Features:**
- Live conversion (edit any field)
- Byte count indicator
- Copy individual fields
- Quick insert common bytes (NULL, CR+LF, ESC, DEL)
- All bytes table (0-255)

**Page Calculator:**
- Flash page address calculator
- Convert address to page number
- Calculate page boundaries
- Offset within page

### 6. Binary Editor Tab - Hex Editor

Professional-grade binary file editor with virtual scrolling.

**File Operations:**
- Open binary files (any format)
- Save modified files
- Drag and drop support
- Compare two files

**Editing:**
- Click to select byte
- Type hex to edit (e.g., "FF")
- Arrow keys navigation
- Tab/Enter to advance
- Home/End for row navigation
- Undo/redo (Ctrl+Z)

**Compare Mode:**
- Side-by-side comparison
- Color-coded differences (red/blue)
- Diff-only view (show only changed rows)
- Byte count and size diff
- Jump to differences

**Navigation:**
- Jump to offset (hex or decimal)
- Virtual scrolling for large files
- Status bar with position info
- Hex/dec/oct/bin views

**Visual Indicators:**
- Modified bytes (amber)
- Cursor position (blue)
- Selection highlighting
- ASCII column (green)

### 7. Tools Tab - Network Utilities

Network diagnostic tools for embedded development.

**Network Info:**
- List all network interfaces
- IP address and prefix
- Broadcast address
- Client IP detection

**Network Scanner:**
- Subnet scanning (CIDR notation)
- ARP discovery
- Hostname resolution
- MAC address detection

### 8. Settings Tab

Application configuration.

**Remote Agents:**
- Add remote Z-Cockpit agents
- Configure host, port, token
- Test connection
- Proxy all operations through agents

**Accounts:**
- GitHub personal access tokens
- Bitbucket app passwords
- Clone path configuration
- Connection testing

### 9. Script Runner Tab - Automation

JSON-based step-by-step scripting engine for automated workflows.

**Supported Steps:**
- `openocd_start` - Start OpenOCD server and wait for connection
- `halt/resume/reset` - CPU control commands
- `erase` - Full chip erase
- `flash` - Program firmware (from file or attached .bin)
- `openocd` - Send raw TCL commands
- `uart_connect/disconnect` - Serial port management
- `uart_send` - Send data to UART
- `uart_wait` - Wait for pattern in UART output
- `uart_extract` - Extract capture groups from UART output
- `delay` - Wait for specified seconds
- `log` - Write to script log
- `set_var` - Assign variables
- `exec` - Run shell commands

**Features:**
- Variable interpolation (e.g., `{enc_key}`)
- Save step results as variables
- Attach .bin files to scripts
- Run scripts locally or on remote agents
- Step-by-step execution with real-time status
- JSON editor with syntax validation
- Step preview mode
- Script history and management
- Cheatsheet with examples

**Use Cases:**
- Automated firmware flashing
- Device provisioning
- Serial communication automation
- Multi-step testing workflows

## Running as Background Process (without systemd)

To run Z-Cockpit in the background and keep it running after terminal exit:

```bash
./start-detached.sh
```

This script uses `nohup` to detach the process and logs output to `start.log`.

## Remote Agent

Z-Cockpit includes a standalone remote agent that can be deployed on Raspberry Pi or other Linux machines.

### Running the Agent

```bash
# Basic usage
python remote_agent.py

# With custom port
python remote_agent.py --port 8888

# With authentication
python remote_agent.py --port 7777 --token mysecrettoken

# Bind to specific interface
python remote_agent.py --host 192.168.1.50 --port 7777
```

### Agent CLI Options

| Option | Default | Description |
|--------|---------|-------------|
| `--host` | `0.0.0.0` | Network interface to bind to |
| `--port` | `7777` | TCP port to listen on |
| `--token` | (empty) | API token for authentication |

### Installing as Service (systemd)

```bash
sudo nano /etc/systemd/system/z-cockpit-agent.service
```

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
```

### Connecting from Z-Cockpit

1. Start the agent on the remote machine
2. In Z-Cockpit, go to **Settings → Remote Agents**
3. Click **+ Add Agent**
4. Enter name, IP, port, and token
5. Click **Test** to verify
6. Use agent in OpenOCD or Serial tabs

## API Documentation

The backend exposes a REST API at `/api/` and WebSocket endpoints at `/ws/`.

### REST Endpoints

- `GET /api/version` - Application version
- `GET /api/projects/repos` - List repositories
- `POST /api/projects/repos/{account}/{repo}/clone` - Clone repository
- `POST /api/projects/repos/{account}/{repo}/pull` - Pull updates
- `POST /api/projects/repos/{account}/{repo}/commit` - Commit changes
- `GET /api/projects/repos/{account}/{repo}/files` - List files
- `GET /api/projects/repos/{account}/{repo}/file` - Read file
- `PUT /api/projects/repos/{account}/{repo}/file` - Write file
- `GET /api/serial/ports` - List serial ports
- `POST /api/serial/connect` - Connect to serial port
- `POST /api/serial/send` - Send data
- `GET /api/mqtt/brokers` - List brokers
- `POST /api/mqtt/brokers` - Add broker
- `POST /api/mqtt/brokers/{id}/connect` - Connect broker
- `POST /api/mqtt/brokers/{id}/subscribe` - Subscribe to topic
- `POST /api/mqtt/brokers/{id}/publish` - Publish message
- `GET /api/openocd/status` - OpenOCD status
- `POST /api/openocd/start` - Start OpenOCD
- `POST /api/openocd/flash/halt` - Halt CPU
- `POST /api/openocd/flash/program` - Flash firmware
- `POST /api/openocd/memory/read` - Read memory
- `GET /api/tools/network/interfaces` - Network info
- `POST /api/tools/network/scan` - Scan subnet
- `POST /api/remotes` - Manage remote agents

### WebSocket Endpoints

- `/ws/projects` - Git operation logs
- `/ws/serial` - Serial data streaming
- `/ws/mqtt` - MQTT messages and broker updates
- `/ws/openocd` - OpenOCD logs and status
- `/ws/scripts` - Script execution logs
- `/ws/remotes/{id}/openocd` - Proxy to remote OpenOCD

## Configuration

### Config Files

- `config/remotes.json` - Remote agent configuration
- `config/scripts.json` - Predefined scripts

### Settings Storage

- Application settings stored in backend
- MQTT brokers stored in browser localStorage
- Git credentials (tokens) stored in backend

## Building for Production

```bash
# Build frontend
cd frontend
npm run build

# Backend serves built frontend from static/ directory
# Run backend:
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

## Requirements

### Backend

- Python 3.9+
- fastapi >= 0.104.0
- uvicorn[standard] >= 0.24.0
- pyserial >= 3.5
- pyserial-asyncio >= 0.6
- python-multipart >= 0.0.6
- aiofiles >= 23.2.1
- websockets >= 12.0
- httpx >= 0.27.0

### Frontend

- Node.js 24 LTS
- React 18.2+
- TypeScript 5.3+
- Vite 5.0+
- Tailwind CSS 3.4+

### System Dependencies

- OpenOCD (for flash operations)
- nmap (optional, for faster network scanning)

## Troubleshooting

### OpenOCD Issues

**"openocd not found"**
- Ensure OpenOCD is installed and in PATH
- Test: `openocd --version`

**"Permission denied on serial port" (Linux)**
```bash
sudo usermod -aG dialout $USER
# Log out and back in
```

**Connection timeout**
- Verify OpenOCD is running: `telnet localhost 4444`
- Check interface config file exists
- Verify hardware connection

### Serial Port Issues

**No ports found**
- Check permissions: `ls -l /dev/tty*`
- On Linux: add user to `dialout` group
- On Windows: install correct USB drivers

### Remote Agent Issues

**401 Unauthorized**
- Token mismatch between agent and Z-Cockpit
- Ensure token matches in both configurations

**Connection refused**
- Verify agent is running: `curl http://<ip>:7777/`
- Check firewall rules
- Verify host binding (`--host` flag)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- OpenOCD team for the amazing debugging tool
- All contributors and users of Z-Cockpit

## Support

- GitHub Issues: https://github.com/anomalyco/z-cockpit/issues
- Documentation: https://github.com/anomalyco/z-cockpit/wiki

---

**Happy Embedding!** 🚀
