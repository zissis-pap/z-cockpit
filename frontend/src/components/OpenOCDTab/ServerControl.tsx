import { useState } from 'react'
import { INTERFACES } from '../../data/mcuConfigs'
import type { OpenOCDStatus } from '../../types'
import { openocd } from '../../api/client'

interface Props {
  status: OpenOCDStatus
  targetConfig: string
  onLog: (text: string, level?: string) => void
}

export default function ServerControl({ status, targetConfig, onLog }: Props) {
  const [executable, setExecutable] = useState('openocd')
  const [interfaceIdx, setInterfaceIdx] = useState(0)
  const [customConfig, setCustomConfig] = useState('')
  const [telnetPort, setTelnetPort] = useState(4444)
  const [tclPort, setTclPort] = useState(6666)
  const [busy, setBusy] = useState(false)

  const isRunning = status.server === 'running' || status.server === 'starting'
  const isConnected = status.connected

  async function handleStart() {
    setBusy(true)
    try {
      const res: { ok: boolean; error?: string; cmd?: string } = await openocd.start({
        executable,
        interface_config: INTERFACES[interfaceIdx].config,
        target_config: targetConfig,
        custom_config: customConfig,
        telnet_port: telnetPort,
        tcl_port: tclPort,
      }) as { ok: boolean; error?: string; cmd?: string }
      if (!res.ok) onLog(`Start failed: ${res.error}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function handleStop() {
    setBusy(true)
    try { await openocd.stop() } finally { setBusy(false) }
  }

  async function handleConnect() {
    setBusy(true)
    try {
      const res: { ok: boolean; error?: string } = await openocd.connect() as { ok: boolean; error?: string }
      if (!res.ok) onLog(`Connect failed: ${res.error}`, 'error')
    } finally { setBusy(false) }
  }

  async function handleDisconnect() {
    setBusy(true)
    try { await openocd.disconnect() } finally { setBusy(false) }
  }

  const dotClass =
    status.server === 'running' ? 'status-dot-green' :
    status.server === 'starting' ? 'status-dot-amber' : 'status-dot-red'

  return (
    <div className="panel">
      <div className="panel-header flex items-center justify-between">
        <span>Server Control</span>
        <span className="flex items-center gap-1.5">
          <span className={dotClass} />
          <span className="text-xs normal-case font-normal text-zinc-400">
            {status.server}
            {status.pid ? ` (PID ${status.pid})` : ''}
          </span>
        </span>
      </div>
      <div className="p-3 space-y-2.5">
        {/* Executable */}
        <div>
          <label className="text-xs text-zinc-500 mb-1 block">Executable</label>
          <input className="input w-full mono" value={executable}
            onChange={e => setExecutable(e.target.value)} placeholder="openocd" />
        </div>

        {/* Interface */}
        <div>
          <label className="text-xs text-zinc-500 mb-1 block">Interface</label>
          <select className="select w-full" value={interfaceIdx}
            onChange={e => setInterfaceIdx(Number(e.target.value))}>
            {INTERFACES.map((iface, i) => (
              <option key={iface.id} value={i}>{iface.name}</option>
            ))}
          </select>
        </div>

        {/* Custom config override */}
        <div>
          <label className="text-xs text-zinc-500 mb-1 block">Custom Config (optional)</label>
          <input className="input w-full mono text-xs" value={customConfig}
            onChange={e => setCustomConfig(e.target.value)}
            placeholder="path/to/custom.cfg" />
        </div>

        {/* Ports */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">Telnet Port</label>
            <input className="input w-full mono" type="number" value={telnetPort}
              onChange={e => setTelnetPort(Number(e.target.value))} min={1024} max={65535} />
          </div>
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">TCL Port</label>
            <input className="input w-full mono" type="number" value={tclPort}
              onChange={e => setTclPort(Number(e.target.value))} min={1024} max={65535} />
          </div>
        </div>

        {/* Server buttons */}
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-success w-full" onClick={handleStart}
            disabled={busy || isRunning}>Start</button>
          <button className="btn-danger w-full" onClick={handleStop}
            disabled={busy || !isRunning}>Stop</button>
        </div>

        {/* Telnet connection */}
        <div className="border-t border-[#30363d] pt-2.5">
          <div className="flex items-center gap-2 mb-2">
            <span className={isConnected ? 'status-dot-green' : 'status-dot-red'} />
            <span className="text-xs text-zinc-400">
              Telnet: {isConnected ? `Connected (port ${telnetPort})` : 'Disconnected'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-primary w-full" onClick={handleConnect}
              disabled={busy || isConnected || !isRunning}>Connect</button>
            <button className="btn-ghost w-full" onClick={handleDisconnect}
              disabled={busy || !isConnected}>Disconnect</button>
          </div>
        </div>
      </div>
    </div>
  )
}
