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

const DATA_TYPES   = [{ label: 'ASCII', value: 'ascii' }, { label: 'Hex', value: 'hex' }]
const DISPLAY_MODES = [{ label: 'ASCII', value: 'ascii' }, { label: 'Hex', value: 'hex' }, { label: 'Both', value: 'both' }]

let lineSeq = 0

// ── ANSI / VT100 color parser (used in scroll mode) ───────────────────────────

interface AnsiSpan { text: string; cls: string }

const ANSI_FG: Record<number, string> = {
  30: 'text-zinc-800',   31: 'text-red-400',     32: 'text-green-400',
  33: 'text-yellow-400', 34: 'text-blue-400',    35: 'text-purple-400',
  36: 'text-cyan-400',   37: 'text-zinc-200',
  90: 'text-zinc-500',   91: 'text-red-300',     92: 'text-green-300',
  93: 'text-yellow-300', 94: 'text-blue-300',    95: 'text-purple-300',
  96: 'text-cyan-300',   97: 'text-white',
}
const ANSI_BG: Record<number, string> = {
  40: 'bg-zinc-900',   41: 'bg-red-900/60',    42: 'bg-green-900/60',
  43: 'bg-yellow-900/60', 44: 'bg-blue-900/60', 45: 'bg-purple-900/60',
  46: 'bg-cyan-900/60', 47: 'bg-zinc-700',
}

function parseAnsi(text: string): AnsiSpan[] {
  const spans: AnsiSpan[] = []
  let pos = 0
  let fg = '', bg = '', bold = false, dim = false, underline = false

  function classes() {
    return [fg, bg, bold ? 'font-bold' : '', dim ? 'opacity-50' : '', underline ? 'underline' : ''].filter(Boolean).join(' ')
  }

  while (pos < text.length) {
    const esc = text.indexOf('\x1b', pos)
    if (esc === -1) { spans.push({ text: text.slice(pos), cls: classes() }); break }
    if (esc > pos) spans.push({ text: text.slice(pos, esc), cls: classes() })

    if (text[esc + 1] === '[') {
      let end = esc + 2
      while (end < text.length && !/[A-Za-z]/.test(text[end])) end++
      const cmd = text[end]
      const params = text.slice(esc + 2, end)

      if (cmd === 'm') {
        const codes = params ? params.split(';').map(Number) : [0]
        for (const code of codes) {
          if (code === 0)  { fg = ''; bg = ''; bold = false; dim = false; underline = false }
          else if (code === 1)  bold = true
          else if (code === 2)  dim = true
          else if (code === 4)  underline = true
          else if (code === 22) { bold = false; dim = false }
          else if (code === 24) underline = false
          else if (code === 39) fg = ''
          else if (code === 49) bg = ''
          else if (ANSI_FG[code]) fg = ANSI_FG[code]
          else if (ANSI_BG[code]) bg = ANSI_BG[code]
        }
      }
      pos = end + 1
    } else {
      pos = esc + 1
    }
  }
  return spans
}

function AnsiLine({ text }: { text: string }) {
  const spans = parseAnsi(text)
  return (
    <>
      {spans.map((s, i) => (
        <span key={i} className={s.cls || undefined}>{s.text}</span>
      ))}
    </>
  )
}

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

// ── VT100 terminal emulator ───────────────────────────────────────────────────

const VT_ROWS = 24
const VT_COLS = 80

interface VtCell { ch: string; cls: string }

const EMPTY_CELL: VtCell = { ch: ' ', cls: '' }

function makeScreen(): VtCell[][] {
  return Array.from({ length: VT_ROWS }, () =>
    Array.from({ length: VT_COLS }, () => ({ ...EMPTY_CELL }))
  )
}

interface VtState {
  cells: VtCell[][]
  row: number
  col: number
  fg: string
  bg: string
  bold: boolean
  underline: boolean
  escState: 'normal' | 'esc' | 'csi'
  escBuf: string
}

function makeVtState(): VtState {
  return {
    cells: makeScreen(),
    row: 0, col: 0,
    fg: '', bg: '', bold: false, underline: false,
    escState: 'normal', escBuf: '',
  }
}

function processVt100(state: VtState, text: string): VtState {
  const cells = state.cells.map(row => row.map(cell => ({ ...cell })))
  let { row, col, fg, bg, bold, underline, escState, escBuf } = state

  function currentCls() {
    return [fg, bg, bold ? 'font-bold' : '', underline ? 'underline' : ''].filter(Boolean).join(' ')
  }

  function clampRow(r: number) { return Math.max(0, Math.min(VT_ROWS - 1, r)) }
  function clampCol(c: number) { return Math.max(0, Math.min(VT_COLS - 1, c)) }

  function scrollUp() {
    cells.shift()
    cells.push(Array.from({ length: VT_COLS }, () => ({ ...EMPTY_CELL })))
  }

  function putChar(ch: string) {
    row = clampRow(row); col = clampCol(col)
    cells[row][col] = { ch, cls: currentCls() }
    col++
    if (col >= VT_COLS) {
      col = 0
      row++
      if (row >= VT_ROWS) { scrollUp(); row = VT_ROWS - 1 }
    }
  }

  function clearRange(r: number, c1: number, c2: number) {
    for (let c = c1; c <= c2; c++) cells[r][c] = { ...EMPTY_CELL }
  }

  function handleSGR(params: string) {
    const codes = params ? params.split(';').map(Number) : [0]
    for (const code of codes) {
      if (code === 0)  { fg = ''; bg = ''; bold = false; underline = false }
      else if (code === 1)  bold = true
      else if (code === 4)  underline = true
      else if (code === 22) bold = false
      else if (code === 24) underline = false
      else if (code === 39) fg = ''
      else if (code === 49) bg = ''
      else if (ANSI_FG[code]) fg = ANSI_FG[code]
      else if (ANSI_BG[code]) bg = ANSI_BG[code]
    }
  }

  function handleCSI(cmd: string, params: string) {
    const parts = params.split(';').map(s => parseInt(s) || 0)
    const p0 = parts[0]
    const n = p0 || 1

    switch (cmd) {
      case 'A': row = clampRow(row - n); break
      case 'B': row = clampRow(row + n); break
      case 'C': col = clampCol(col + n); break
      case 'D': col = clampCol(col - n); break
      case 'E': row = clampRow(row + n); col = 0; break
      case 'F': row = clampRow(row - n); col = 0; break
      case 'G': col = clampCol((p0 || 1) - 1); break
      case 'H': case 'f': {
        row = clampRow((parts[0] || 1) - 1)
        col = clampCol((parts[1] || 1) - 1)
        break
      }
      case 'J': {
        if (p0 === 2 || p0 === 3) {
          for (let r = 0; r < VT_ROWS; r++) clearRange(r, 0, VT_COLS - 1)
          row = 0; col = 0
        } else if (p0 === 1) {
          for (let r = 0; r < row; r++) clearRange(r, 0, VT_COLS - 1)
          clearRange(row, 0, col)
        } else {
          clearRange(row, col, VT_COLS - 1)
          for (let r = row + 1; r < VT_ROWS; r++) clearRange(r, 0, VT_COLS - 1)
        }
        break
      }
      case 'K': {
        if (p0 === 2) clearRange(row, 0, VT_COLS - 1)
        else if (p0 === 1) clearRange(row, 0, col)
        else clearRange(row, col, VT_COLS - 1)
        break
      }
      case 'L': {
        // Insert n lines at cursor
        for (let i = 0; i < n; i++) {
          cells.splice(row, 0, Array.from({ length: VT_COLS }, () => ({ ...EMPTY_CELL })))
          if (cells.length > VT_ROWS) cells.pop()
        }
        break
      }
      case 'M': {
        // Delete n lines at cursor
        for (let i = 0; i < n; i++) {
          cells.splice(row, 1)
          cells.push(Array.from({ length: VT_COLS }, () => ({ ...EMPTY_CELL })))
        }
        break
      }
      case 'P': {
        // Delete n chars at cursor
        const r = cells[row]
        r.splice(col, n)
        while (r.length < VT_COLS) r.push({ ...EMPTY_CELL })
        break
      }
      case 'm': handleSGR(params); break
      // h/l (mode set/reset) — ignore (includes ?25h cursor visibility etc.)
    }
  }

  for (const ch of text) {
    if (escState === 'normal') {
      if (ch === '\x1b') {
        escState = 'esc'
        escBuf = ''
      } else if (ch === '\r') {
        col = 0
      } else if (ch === '\n') {
        row++
        if (row >= VT_ROWS) { scrollUp(); row = VT_ROWS - 1 }
      } else if (ch === '\x08') {
        col = Math.max(0, col - 1)
      } else if (ch === '\x07') {
        // bell — ignore
      } else if (ch === '\t') {
        col = Math.min(VT_COLS - 1, Math.ceil((col + 1) / 8) * 8)
      } else if (ch >= ' ') {
        putChar(ch)
      }
    } else if (escState === 'esc') {
      if (ch === '[') {
        escState = 'csi'
        escBuf = ''
      } else if (ch === 'c') {
        // Full reset
        const fresh = makeVtState()
        cells.splice(0, VT_ROWS, ...fresh.cells)
        row = 0; col = 0; fg = ''; bg = ''; bold = false; underline = false
        escState = 'normal'; escBuf = ''
      } else if (ch === 'M') {
        // Reverse index (scroll down)
        if (row === 0) {
          cells.unshift(Array.from({ length: VT_COLS }, () => ({ ...EMPTY_CELL })))
          if (cells.length > VT_ROWS) cells.pop()
        } else {
          row--
        }
        escState = 'normal'
      } else {
        escState = 'normal'
      }
    } else if (escState === 'csi') {
      if (/[A-Za-z]/.test(ch)) {
        handleCSI(ch, escBuf)
        escState = 'normal'
        escBuf = ''
      } else {
        escBuf += ch
      }
    }
  }

  return { cells, row, col, fg, bg, bold, underline, escState, escBuf }
}

// ── VT100 screen renderer ─────────────────────────────────────────────────────

function renderVtRow(cells: VtCell[], cursorCol: number): React.ReactNode {
  const nodes: React.ReactNode[] = []
  let i = 0
  while (i < cells.length) {
    if (i === cursorCol) {
      const ch = cells[i].ch === ' ' ? '\u00a0' : cells[i].ch
      nodes.push(
        <span key={i} className={`${cells[i].cls} bg-zinc-300 text-zinc-900`}>{ch}</span>
      )
      i++
      continue
    }
    const cls = cells[i].cls
    let j = i + 1
    while (j < cells.length && j !== cursorCol && cells[j].cls === cls) j++
    const text = cells.slice(i, j).map(c => c.ch === ' ' ? '\u00a0' : c.ch).join('')
    nodes.push(<span key={i} className={cls || undefined}>{text}</span>)
    i = j
  }
  return nodes
}

function VtScreenView({ stateRef }: { stateRef: React.MutableRefObject<VtState> }) {
  const s = stateRef.current
  return (
    <div className="flex-1 overflow-auto p-2">
      <div className="mono text-xs" style={{ lineHeight: '1.4', whiteSpace: 'pre' }}>
        {s.cells.map((row, r) => (
          <div key={r}>{renderVtRow(row, r === s.row ? s.col : -1)}</div>
        ))}
      </div>
    </div>
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
  const [vt100, setVt100]             = useState(false)
  const [logFileName, setLogFileName]  = useState('')
  const [logPath, setLogPath]          = useState(() =>
    `~/serial_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.log`
  )
  const [remoteList, setRemoteList]         = useState<RemoteAgent[]>([])
  const [selectedRemoteId, setSelectedRemoteId] = useState<string | undefined>(undefined)
  const [agentReachable, setAgentReachable] = useState<boolean | null>(null)

  // VT100 screen buffer — kept in a ref to avoid re-render per character,
  // with a tick counter to trigger repaints.
  const vtStateRef = useRef<VtState>(makeVtState())
  const [vtTick, setVtTick] = useState(0)
  const vt100Ref = useRef(vt100)
  useEffect(() => { vt100Ref.current = vt100 }, [vt100])

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
    if (autoScroll && !vt100) bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [lines, autoScroll, vt100])

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
      if (vt100Ref.current) {
        vtStateRef.current = processVt100(vtStateRef.current, msg.text ?? '')
        setVtTick(t => t + 1)
      } else {
        const now = new Date()
        const ts = now.toLocaleTimeString('en-US', { hour12: false }) + '.' + String(now.getMilliseconds()).padStart(3, '0')
        setLines(prev => [...prev.slice(-5000), { id: lineSeq++, timestamp: ts, direction: 'rx', text: msg.text ?? '', hex: msg.hex ?? '' }])
      }
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
    if (!vt100) {
      setLines(prev => [...prev.slice(-5000), { id: lineSeq++, timestamp: ts, direction: 'tx', text: txText, hex: txHex }])
    }
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
    vtStateRef.current = makeVtState()
    setVtTick(t => t + 1)
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
          <span className="text-yellow-400 break-all whitespace-pre-wrap">
            {vt100 && l.direction === 'rx'
              ? <AnsiLine text={l.text || ''} />
              : l.text || ''}
          </span>
        </span>
      )
    }

    // ASCII mode
    if (vt100 && l.direction === 'rx') return <AnsiLine text={l.text || ''} />
    return <span className="text-yellow-400">{l.text || ''}</span>
  }

  const dotClass = status.connected ? 'status-dot-green' : 'status-dot-red'

  // Force VtScreenView to re-read ref when vtTick changes
  void vtTick

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
            {!vt100 && (
              <>
                <label className="flex items-center gap-1.5 text-xs font-normal normal-case text-zinc-400 cursor-pointer">
                  <input type="checkbox" checked={showTimestamps} onChange={e => setShowTimestamps(e.target.checked)} className="accent-blue-500" />
                  Timestamps
                </label>
                <label className="flex items-center gap-1.5 text-xs font-normal normal-case text-zinc-400 cursor-pointer">
                  <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} className="accent-blue-500" />
                  Auto-scroll
                </label>
              </>
            )}

            {/* VT100 toggle */}
            <label className="flex items-center gap-1.5 text-xs font-normal normal-case cursor-pointer select-none"
              title="VT100: fixed 24×80 screen updated in-place via escape sequences">
              <div
                className={`relative w-8 h-4 rounded-full transition-colors duration-150 ${vt100 ? 'bg-blue-600' : 'bg-zinc-700'}`}
                onClick={() => setVt100(v => !v)}
              >
                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all duration-150 ${vt100 ? 'left-4' : 'left-0.5'}`} />
              </div>
              <span className={vt100 ? 'text-blue-400' : 'text-zinc-500'}>VT100</span>
            </label>

            {vt100 && (
              <span className="text-xs text-zinc-600 font-normal normal-case">{VT_ROWS}×{VT_COLS}</span>
            )}
          </div>

          <div className="flex gap-2 items-center normal-case font-normal">
            {!vt100 && (
              <select className="select text-xs py-0.5 px-1 h-6" value={displayMode} onChange={e => setDisplayMode(e.target.value)}>
                {DISPLAY_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            )}
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
            {!vt100 && (
              <button className="btn-ghost text-xs px-2 py-0.5" onClick={saveLog}>Save</button>
            )}
            <button className="btn-ghost text-xs px-2 py-0.5" onClick={clearTerminal}>Clear</button>
          </div>
        </div>

        {/* Terminal body */}
        {vt100 ? (
          <VtScreenView stateRef={vtStateRef} />
        ) : (
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
        )}

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
