import { useState, useEffect, useRef, useCallback, KeyboardEvent } from 'react'
import { createSerialApi, remotes } from '../../api/client'
import type { RemoteAgent } from '../../api/client'
import { useWebSocket } from '../../hooks/useWebSocket'
import { BAUD_RATES } from '../../data/mcuConfigs'

interface TermLine {
  id: number
  timestamp: string
  direction: 'rx' | 'tx'
  text: string
  hex: string
}

interface SerialStatus {
  connected: boolean
  port: string
  baud: number
}

const LINE_ENDINGS = [
  { label: 'None',    value: 'none' },
  { label: '\\n',     value: '\\n' },
  { label: '\\r',     value: '\\r' },
  { label: '\\r\\n',  value: '\\r\\n' },
  { label: '\\n\\r',  value: '\\n\\r' },
]

const DATA_TYPES    = [{ label: 'ASCII', value: 'ascii' }, { label: 'Hex', value: 'hex' }]
const DISPLAY_MODES = [{ label: 'ASCII', value: 'ascii' }, { label: 'Hex', value: 'hex' }, { label: 'Both', value: 'both' }]

let lineSeq = 0

// ── Hex byte renderer ─────────────────────────────────────────────────────────

function hexByteClass(b: number): string {
  if (b === 0x00) return 'text-zinc-700'
  if (b >= 0x20 && b < 0x7f) return 'text-zinc-200'
  return 'text-zinc-500'
}

function HexDisplay({ hex }: { hex: string }) {
  const tokens = hex.trim().split(/\s+/).filter(Boolean)
  return (
    <>
      {tokens.map((t, i) => {
        const b = parseInt(t, 16)
        return (
          <span key={i} className={`${hexByteClass(isNaN(b) ? -1 : b)} mr-0.5`}>{t}</span>
        )
      })}
    </>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SerialTab() {
  const [ports, setPorts]             = useState<Array<{ device: string; description: string }>>([])
  const [selectedPort, setSelectedPort] = useState('')
  const [baudRate, setBaudRate]       = useState(115200)
  const [bytesize, setBytesize]       = useState(8)
  const [parity, setParity]           = useState('N')
  const [stopbits, setStopbits]       = useState(1)
  const [status, setStatus]           = useState<SerialStatus>({ connected: false, port: '', baud: 115200 })
  const [lines, setLines]             = useState<TermLine[]>([])
  const [input, setInput]             = useState('')
  const [lineEnding, setLineEnding]   = useState('\\r\\n')
  const [dataType, setDataType]       = useState('ascii')
  const [displayMode, setDisplayMode] = useState('ascii')
  const [autoScroll, setAutoScroll]   = useState(true)
  const [showTimestamps, setShowTimestamps] = useState(true)
  const [logFileName, setLogFileName]  = useState('')
  const [logPath, setLogPath]          = useState(() =>
    `~/serial_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.log`
  )
  const [remoteList, setRemoteList]         = useState<RemoteAgent[]>([])
  const [selectedRemoteId, setSelectedRemoteId] = useState<string | undefined>(undefined)
  const [agentReachable, setAgentReachable] = useState<boolean | null>(null)

  const bottomRef    = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Load remote agents once
  useEffect(() => {
    remotes.list().then(r => setRemoteList(r.remotes)).catch(() => {})
  }, [])

  const serialApi = createSerialApi(selectedRemoteId)

  // On target switch: reset state, probe reachability, refresh ports
  useEffect(() => {
    setStatus({ connected: false, port: '', baud: 115200 })
    setPorts([])
    setSelectedPort('')

    if (!selectedRemoteId) {
      setAgentReachable(null)
      serialApi.ports().then(r => {
        setPorts(r.ports)
        if (r.ports.length > 0) setSelectedPort(r.ports[0].device)
      }).catch(() => {})
      return
    }

    setAgentReachable(null)
    Promise.all([
      remotes.test(selectedRemoteId).catch(() => ({ ok: false })),
      serialApi.ports().catch(() => null),
    ]).then(([testResult, portsResult]: [any, any]) => {
      setAgentReachable(testResult.ok)
      if (portsResult?.ports) {
        setPorts(portsResult.ports)
        if (portsResult.ports.length > 0) setSelectedPort(portsResult.ports[0].device)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRemoteId])

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [lines, autoScroll])

  async function refreshPorts() {
    try {
      const res = await serialApi.ports()
      setPorts(res.ports)
      if (res.ports.length > 0 && !selectedPort) setSelectedPort(res.ports[0].device)
    } catch { /* ignore */ }
  }

  const handleWsMessage = useCallback((data: unknown) => {
    const msg = data as { type: string; connected?: boolean; port?: string; baud?: number; text?: string; hex?: string; error?: string }
    if (msg.type === 'status') {
      setStatus({ connected: msg.connected ?? false, port: msg.port ?? '', baud: msg.baud ?? 115200 })
    } else if (msg.type === 'data') {
      const now = new Date()
      const ts = now.toLocaleTimeString('en-US', { hour12: false }) + '.' + String(now.getMilliseconds()).padStart(3, '0')
      setLines(prev => [...prev.slice(-5000), { id: lineSeq++, timestamp: ts, direction: 'rx', text: msg.text ?? '', hex: msg.hex ?? '' }])
    } else if (msg.type === 'error') {
      const ts = new Date().toLocaleTimeString('en-US', { hour12: false })
      setLines(prev => [...prev.slice(-5000), { id: lineSeq++, timestamp: ts, direction: 'rx', text: `[ERROR] ${msg.error}`, hex: '' }])
    }
  }, [])

  const wsUrl = selectedRemoteId ? `/ws/remotes/${selectedRemoteId}/serial` : '/ws/serial'
  useWebSocket(wsUrl, handleWsMessage)

  async function startLog() {
    const res = await serialApi.logStart(logPath)
    if (res.ok) setLogFileName(res.path ?? logPath)
  }

  async function stopLog() {
    await serialApi.logStop()
    setLogFileName('')
  }

  async function connect() {
    await serialApi.connect({ port: selectedPort, baud_rate: baudRate, bytesize, parity, stopbits })
  }
  async function disconnect() { await serialApi.disconnect() }

  async function send() {
    if (!input.trim() || !status.connected) return
    const now = new Date()
    const ts = now.toLocaleTimeString('en-US', { hour12: false }) + '.' + String(now.getMilliseconds()).padStart(3, '0')
    const txHex = dataType === 'hex'
      ? input.trim()
      : Array.from(input).map(c => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')).join(' ')
    const txText = dataType === 'hex'
      ? input.trim().split(/\s+/).map(h => { const b = parseInt(h, 16); return b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.' }).join('')
      : input
    setLines(prev => [...prev.slice(-5000), { id: lineSeq++, timestamp: ts, direction: 'tx', text: txText, hex: txHex }])
    await serialApi.send({ data: input, data_type: dataType, line_ending: lineEnding })
    setInput('')
  }

  const selectedRemote = remoteList.find(r => r.id === selectedRemoteId)

  function handleKey(e: KeyboardEvent<HTMLInputElement>) { if (e.key === 'Enter') send() }

  function saveLog() {
    const text = lines.map(l => `[${l.timestamp}] ${l.direction.toUpperCase()} | ${l.text || l.hex}`).join('\n')
    const blob = new Blob([text], { type: 'text/plain' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'serial.log'; a.click()
  }

  function clearTerminal() {
    setLines([])
  }

  function renderContent(l: TermLine) {
    const isError = l.text?.startsWith('[ERROR]')
    if (isError) return <span className="text-red-400">{l.text}</span>

    if (displayMode === 'hex') {
      return <HexDisplay hex={l.hex || ''} />
    }

    if (displayMode === 'both') {
      return (
        <span className="flex gap-4">
          <span className="shrink-0 w-[22ch]">
            <HexDisplay hex={l.hex || ''} />
          </span>
          <span className="text-yellow-400 break-all whitespace-pre-wrap">{l.text || ''}</span>
        </span>
      )
    }

    return <span className="text-yellow-400">{l.text || ''}</span>
  }

  const dotClass = status.connected ? 'status-dot-green' : 'status-dot-red'

  return (
    <div className="flex flex-col h-full p-2 gap-2 overflow-hidden">

      {/* Target selector */}
      <div className="panel shrink-0">
        <div className="panel-header flex items-center justify-between">
          <span>Target</span>
          {selectedRemoteId && (
            <span className="flex items-center gap-1.5 font-normal normal-case text-xs text-zinc-400">
              <span className={
                agentReachable === null ? 'status-dot-amber' :
                agentReachable ? 'status-dot-green' : 'status-dot-red'
              } />
              {agentReachable === null ? 'checking…' : agentReachable ? 'reachable' : 'unreachable'}
            </span>
          )}
        </div>
        <div className="p-2 flex items-center gap-2">
          <select
            className="select text-xs flex-1"
            value={selectedRemoteId ?? ''}
            onChange={e => setSelectedRemoteId(e.target.value || undefined)}
          >
            <option value="">Local</option>
            {remoteList.map(r => (
              <option key={r.id} value={r.id}>{r.name} ({r.host}:{r.port})</option>
            ))}
          </select>
          {selectedRemote && (
            <span className="text-[10px] text-zinc-500 truncate">
              via {selectedRemote.host}:{selectedRemote.port}
              {selectedRemote.has_token ? ' 🔒' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Connection bar */}
      <div className="panel shrink-0">
        <div className="panel-header flex items-center justify-between">
          <span>Connection</span>
          <span className="flex items-center gap-1.5 normal-case font-normal">
            <span className={dotClass} />
            <span className="text-xs text-zinc-400">
              {status.connected ? `${status.port} @ ${status.baud} baud` : 'Disconnected'}
            </span>
          </span>
        </div>
        <div className="p-3 flex flex-wrap gap-2 items-end">
          <div>
            <label className="text-xs text-zinc-500 block mb-0.5">Port</label>
            <div className="flex gap-1">
              <select className="select w-44" value={selectedPort} onChange={e => setSelectedPort(e.target.value)}>
                {ports.length === 0 && <option value="">No ports found</option>}
                {ports.map(p => <option key={p.device} value={p.device}>{p.device} — {p.description}</option>)}
              </select>
              <button className="btn-ghost text-xs px-2" onClick={refreshPorts} title="Refresh">⟳</button>
            </div>
          </div>
          <div>
            <label className="text-xs text-zinc-500 block mb-0.5">Baud Rate</label>
            <select className="select" value={baudRate} onChange={e => setBaudRate(Number(e.target.value))}>
              {BAUD_RATES.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-zinc-500 block mb-0.5">Data bits</label>
            <select className="select" value={bytesize} onChange={e => setBytesize(Number(e.target.value))}>
              {[5,6,7,8].map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-zinc-500 block mb-0.5">Parity</label>
            <select className="select" value={parity} onChange={e => setParity(e.target.value)}>
              <option value="N">None</option><option value="E">Even</option>
              <option value="O">Odd</option><option value="M">Mark</option><option value="S">Space</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-zinc-500 block mb-0.5">Stop bits</label>
            <select className="select" value={stopbits} onChange={e => setStopbits(Number(e.target.value))}>
              {[1,2].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex gap-2 ml-auto">
            <button className="btn-success" onClick={connect} disabled={status.connected || !selectedPort}>Connect</button>
            <button className="btn-danger"  onClick={disconnect} disabled={!status.connected}>Disconnect</button>
          </div>
        </div>
      </div>

      {/* Terminal */}
      <div className="panel flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className="panel-header shrink-0 flex items-center justify-between">
          <div className="flex gap-3 items-center flex-wrap">
            <span>Terminal</span>
            <label className="flex items-center gap-1.5 text-xs font-normal normal-case text-zinc-400 cursor-pointer">
              <input type="checkbox" checked={showTimestamps} onChange={e => setShowTimestamps(e.target.checked)} className="accent-blue-500" />
              Timestamps
            </label>
            <label className="flex items-center gap-1.5 text-xs font-normal normal-case text-zinc-400 cursor-pointer">
              <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} className="accent-blue-500" />
              Auto-scroll
            </label>
          </div>

          <div className="flex gap-2 items-center normal-case font-normal">
            <select className="select text-xs py-0.5 px-1 h-6" value={displayMode} onChange={e => setDisplayMode(e.target.value)}>
              {DISPLAY_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            {logFileName ? (
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse shrink-0" />
                <span className="text-xs text-zinc-400 max-w-[18ch] truncate" title={logFileName}>{logFileName}</span>
                <button
                  className="btn text-xs px-2 py-0.5 bg-red-700/30 border border-red-600/40 text-red-400 hover:bg-red-700/50"
                  onClick={stopLog}
                >✕</button>
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <input
                  className="input text-xs py-0.5 w-44 mono"
                  value={logPath}
                  onChange={e => setLogPath(e.target.value)}
                  title="Log file path (saved on the server)"
                  placeholder="~/serial.log"
                />
                <button className="btn-ghost text-xs px-2 py-0.5" onClick={startLog}>Log</button>
              </span>
            )}
            <button className="btn-ghost text-xs px-2 py-0.5" onClick={saveLog}>Save</button>
            <button className="btn-ghost text-xs px-2 py-0.5" onClick={clearTerminal}>Clear</button>
          </div>
        </div>

        {/* Terminal body */}
        <div ref={containerRef} className="flex-1 overflow-y-auto p-2 mono text-xs">
          {lines.length === 0 && <div className="text-zinc-600 italic">No data yet…</div>}
          {lines.map(l => (
            <div key={l.id} className="flex gap-2 leading-5 items-baseline">
              {showTimestamps && <span className="text-amber-500 shrink-0">{l.timestamp}</span>}
              <span className={`shrink-0 font-semibold ${l.direction === 'tx' ? 'text-green-400' : 'text-blue-400'}`}>
                {l.direction === 'tx' ? 'TX' : 'RX'}
              </span>
              <span className="break-all whitespace-pre-wrap min-w-0">{renderContent(l)}</span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div className="shrink-0 border-t border-[#30363d] p-2 flex gap-2 items-center">
          <select className="select text-xs py-1 w-20" value={dataType} onChange={e => setDataType(e.target.value)}>
            {DATA_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select className="select text-xs py-1 w-24" value={lineEnding} onChange={e => setLineEnding(e.target.value)}>
            {LINE_ENDINGS.map(le => <option key={le.value} value={le.value}>{le.label}</option>)}
          </select>
          <input
            className="input flex-1 mono text-xs"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={status.connected ? (dataType === 'hex' ? 'DE AD BE EF' : 'Type data to send…') : 'Not connected'}
            disabled={!status.connected}
          />
          <button className="btn-primary" onClick={send} disabled={!status.connected}>Send</button>
        </div>
      </div>
    </div>
  )
}
