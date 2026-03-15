import { useState, useEffect, useRef, useCallback, KeyboardEvent } from 'react'
import { serial } from '../../api/client'
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

// ── ANSI / VT100 parser ────────────────────────────────────────────────────────

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
      // Find terminator (letter)
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
      // All other CSI sequences (cursor movement, erase, etc.) are skipped visually
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

// ── Hex byte renderer (like binary viewer) ────────────────────────────────────

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
  const [vt100, setVt100]             = useState(false)
  const [logFileName, setLogFileName]  = useState('')     // '' = not logging
  const [fallbackName, setFallbackName] = useState(() =>
    `serial_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.log`
  )
  const supportsFilePicker = 'showSaveFilePicker' in window
  const bottomRef    = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const writerRef    = useRef<any>(null)                  // FileSystemWritableFileStream or null
  const bufferRef    = useRef<string[]>([])               // fallback buffer
  const logActiveRef = useRef(false)                      // mirror of logFileName !== '', readable in stale closures

  useEffect(() => { refreshPorts() }, [])

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [lines, autoScroll])

  async function refreshPorts() {
    try {
      const res = await serial.ports()
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
      if (logActiveRef.current) {
        const line = `[${ts}] RX | ${msg.text ?? msg.hex ?? ''}\n`
        writerRef.current ? writerRef.current.write(line) : bufferRef.current.push(line)
      }
      setLines(prev => [...prev.slice(-5000), { id: lineSeq++, timestamp: ts, direction: 'rx', text: msg.text ?? '', hex: msg.hex ?? '' }])
    } else if (msg.type === 'error') {
      const ts = new Date().toLocaleTimeString('en-US', { hour12: false })
      setLines(prev => [...prev.slice(-5000), { id: lineSeq++, timestamp: ts, direction: 'rx', text: `[ERROR] ${msg.error}`, hex: '' }])
    }
  }, [])

  useWebSocket('/ws/serial', handleWsMessage)

  async function selectLogFile() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (supportsFilePicker) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: fallbackName,
          types: [{ description: 'Log file', accept: { 'text/plain': ['.log', '.txt'] } }],
        })
        const file = await handle.getFile()
        const writer = await handle.createWritable({ keepExistingData: true })
        await writer.seek(file.size)
        if (writerRef.current) await writerRef.current.close()
        writerRef.current = writer
        logActiveRef.current = true
        setLogFileName(handle.name)
      } catch { /* user cancelled */ }
    } else {
      // Fallback: buffer in memory, download on stop
      bufferRef.current = []
      logActiveRef.current = true
      setLogFileName(fallbackName)
    }
  }

  async function closeLogFile() {
    logActiveRef.current = false
    const name = logFileName
    setLogFileName('')
    if (writerRef.current) {
      await writerRef.current.close()
      writerRef.current = null
    } else if (bufferRef.current.length > 0) {
      const blob = new Blob([bufferRef.current.join('')], { type: 'text/plain' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = name
      a.click()
      URL.revokeObjectURL(a.href)
      bufferRef.current = []
    }
  }

  async function connect() {
    await serial.connect({ port: selectedPort, baud_rate: baudRate, bytesize, parity, stopbits })
  }
  async function disconnect() { await serial.disconnect() }

  async function send() {
    if (!input.trim() || !status.connected) return
    const now = new Date()
    const ts = now.toLocaleTimeString('en-US', { hour12: false }) + '.' + String(now.getMilliseconds()).padStart(3, '0')
    if (logActiveRef.current) {
      const line = `[${ts}] TX | ${input}\n`
      writerRef.current ? writerRef.current.write(line) : bufferRef.current.push(line)
    }
    const txHex = dataType === 'hex'
      ? input.trim()
      : Array.from(input).map(c => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')).join(' ')
    const txText = dataType === 'hex'
      ? input.trim().split(/\s+/).map(h => { const b = parseInt(h, 16); return b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.' }).join('')
      : input
    setLines(prev => [...prev.slice(-5000), { id: lineSeq++, timestamp: ts, direction: 'tx', text: txText, hex: txHex }])
    await serial.send({ data: input, data_type: dataType, line_ending: lineEnding })
    setInput('')
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) { if (e.key === 'Enter') send() }

  function saveLog() {
    const text = lines.map(l => `[${l.timestamp}] ${l.direction.toUpperCase()} | ${l.text || l.hex}`).join('\n')
    const blob = new Blob([text], { type: 'text/plain' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'serial.log'; a.click()
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

  return (
    <div className="flex flex-col h-full p-2 gap-2 overflow-hidden">

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

            {/* VT100 toggle */}
            <label className="flex items-center gap-1.5 text-xs font-normal normal-case cursor-pointer select-none"
              title="Interpret ANSI/VT100 escape codes for color and formatting">
              <div
                className={`relative w-8 h-4 rounded-full transition-colors duration-150 ${vt100 ? 'bg-blue-600' : 'bg-zinc-700'}`}
                onClick={() => setVt100(v => !v)}
              >
                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all duration-150 ${vt100 ? 'left-4' : 'left-0.5'}`} />
              </div>
              <span className={vt100 ? 'text-blue-400' : 'text-zinc-500'}>VT100</span>
            </label>
          </div>

          <div className="flex gap-2 items-center normal-case font-normal">
            <select className="select text-xs py-0.5 px-1 h-6" value={displayMode} onChange={e => setDisplayMode(e.target.value)}>
              {DISPLAY_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            {logFileName ? (
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse shrink-0" />
                <span className="text-xs text-zinc-400 max-w-[14ch] truncate" title={logFileName}>{logFileName}</span>
                <button
                  className="btn text-xs px-2 py-0.5 bg-red-700/30 border border-red-600/40 text-red-400 hover:bg-red-700/50"
                  onClick={closeLogFile}
                  title={supportsFilePicker ? 'Stop logging' : 'Stop logging and download'}
                >✕</button>
              </span>
            ) : supportsFilePicker ? (
              <button className="btn-ghost text-xs px-2 py-0.5" onClick={selectLogFile}>Log to file</button>
            ) : (
              <span className="flex items-center gap-1">
                <input
                  className="input text-xs py-0.5 w-32 mono"
                  value={fallbackName}
                  onChange={e => setFallbackName(e.target.value)}
                  title="Log filename"
                />
                <button className="btn-ghost text-xs px-2 py-0.5" onClick={selectLogFile}>Log</button>
              </span>
            )}
            <button className="btn-ghost text-xs px-2 py-0.5" onClick={() => setLines([])}>Clear</button>
          </div>
        </div>

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
