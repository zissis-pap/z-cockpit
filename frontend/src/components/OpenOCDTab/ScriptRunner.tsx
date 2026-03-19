import { useState, useEffect, useRef, useCallback } from 'react'
import { scripts, type Script, type ScriptMeta } from '../../api/client'
import { useWebSocket } from '../../hooks/useWebSocket'

// ── Cheatsheet ────────────────────────────────────────────────────────────────

const CHEATSHEET = [
  {
    type: '— Variables —',
    fields: '',
    desc: 'Any string field in any step supports {varname} interpolation. Use save_as on any step to store its output into a variable. Variables are scoped to the current run and cleared on completion or failure.',
    example: '{ "type": "exec", "command": "openssl rand -hex 16", "save_as": "enc_key" }\n{ "type": "uart_send", "data": "SETKEY:{enc_key}\\n" }',
  },
  {
    type: 'set_var',
    fields: 'name, value',
    desc: 'Assign a literal value (or interpolated expression) to a script variable.',
    example: '{ "type": "set_var", "name": "address", "value": "0x08040000" }\n{ "type": "set_var", "name": "greeting", "value": "Hello {device_id}" }',
  },
  {
    type: 'openocd_start',
    fields: 'interface, target',
    desc: 'Start OpenOCD and wait for the TCL connection (up to 15 s).',
    example: '{ "type": "openocd_start", "interface": "interface/stlink.cfg", "target": "target/stm32f4x.cfg" }',
  },
  {
    type: 'uart_connect',
    fields: 'port, baud_rate? (default: 115200)',
    desc: 'Open a serial port.',
    example: '{ "type": "uart_connect", "port": "/dev/ttyUSB0", "baud_rate": 115200 }',
  },
  {
    type: 'uart_disconnect',
    fields: '—',
    desc: 'Close the serial port.',
    example: '{ "type": "uart_disconnect" }',
  },
  {
    type: 'halt',
    fields: '—',
    desc: 'Halt the target CPU.',
    example: '{ "type": "halt" }',
  },
  {
    type: 'resume',
    fields: '—',
    desc: 'Resume the target CPU.',
    example: '{ "type": "resume" }',
  },
  {
    type: 'reset',
    fields: '—',
    desc: 'Reset the target.',
    example: '{ "type": "reset" }',
  },
  {
    type: 'erase',
    fields: '—',
    desc: 'Full chip erase (flash erase_device 0).',
    example: '{ "type": "erase" }',
  },
  {
    type: 'flash',
    fields: 'file_path | file_key, address? (0x08000000), verify? (true), do_reset? (true)',
    desc: 'Flash firmware. file_path reads from the filesystem; file_key references an attached .bin file.',
    example: '// From filesystem\n{ "type": "flash", "file_path": "/home/user/firmware.bin", "address": "0x08000000", "verify": true, "do_reset": false }\n\n// From attached .bin\n{ "type": "flash", "file_key": "app.bin", "address": "0x08040000" }',
  },
  {
    type: 'openocd',
    fields: 'cmd',
    desc: 'Send a raw TCL command to OpenOCD and return the response.',
    example: '{ "type": "openocd", "cmd": "flash banks" }\n{ "type": "openocd", "cmd": "reg pc" }',
  },
  {
    type: 'uart_send',
    fields: 'data',
    desc: 'Write a string to UART. Use \\n for newline, \\r\\n for CRLF.',
    example: '{ "type": "uart_send", "data": "ping\\n" }\n{ "type": "uart_send", "data": "AT+RST\\r\\n" }',
  },
  {
    type: 'uart_wait',
    fields: 'pattern, timeout? (10s)',
    desc: 'Poll UART RX every 100 ms for a regex match. Throws if not seen within timeout.',
    example: '{ "type": "uart_wait", "pattern": "boot ok", "timeout": 10 }\n{ "type": "uart_wait", "pattern": "ERROR|FAIL", "timeout": 5 }',
  },
  {
    type: 'uart_extract',
    fields: 'pattern, group? (1), timeout? (10s), save_as?',
    desc: 'Like uart_wait but returns a capture group. Use save_as to store it in a variable.',
    example: '{ "type": "uart_extract", "pattern": "SN=([A-F0-9]+)", "save_as": "serial" }\n{ "type": "uart_send", "data": "ACK:{serial}\\n" }\n\n// Group 2 (current) from "V=3.3 I=0.42"\n{ "type": "uart_extract", "pattern": "V=([\\\\d.]+) I=([\\\\d.]+)", "group": 2, "save_as": "current" }',
  },
  {
    type: 'log',
    fields: 'message',
    desc: 'Print a message to the script log. Supports {varname} interpolation.',
    example: '{ "type": "log", "message": "Flashing complete" }\n{ "type": "log", "message": "Device serial: {serial}" }',
  },
  {
    type: 'delay',
    fields: 'seconds',
    desc: 'Wait N seconds. Checked every 100 ms so Stop cancels it promptly.',
    example: '{ "type": "delay", "seconds": 1 }\n{ "type": "delay", "seconds": 0.5 }',
  },
  {
    type: 'exec',
    fields: 'command, timeout? (30s), save_as?',
    desc: 'Run a shell command on the local machine. stdout is returned as the step result.',
    example: '{ "type": "exec", "command": "openssl rand -hex 16", "save_as": "enc_key" }\n{ "type": "exec", "command": "python3 /home/pi/provision.py --device 0" }',
  },
]

function Cheatsheet({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-[#161b22] border border-[#30363d] rounded-lg p-5 w-[640px] max-w-[95vw] max-h-[80vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-semibold text-zinc-200">Script Step Reference</span>
          <button className="btn-ghost text-xs px-2 py-1 normal-case" onClick={onClose}>✕ Close</button>
        </div>
        <div className="space-y-4">
          {CHEATSHEET.map(entry => {
            const isHeader = entry.type.startsWith('—')
            return (
              <div key={entry.type} className="border-b border-[#21262d] pb-4">
                <div className="flex items-baseline gap-3 mb-1">
                  {isHeader
                    ? <span className="text-xs font-semibold text-zinc-300">{entry.type}</span>
                    : <code className="text-xs text-blue-300 bg-blue-900/30 px-1.5 py-0.5 rounded">{entry.type}</code>
                  }
                  {entry.fields && <span className="text-xs text-zinc-500">{entry.fields}</span>}
                </div>
                <p className="text-xs text-zinc-400 mb-2">{entry.desc}</p>
                <pre className="text-xs text-green-300 bg-[#0d1117] border border-[#21262d] rounded p-2 overflow-x-auto whitespace-pre-wrap">{entry.example}</pre>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Types ─────────────────────────────────────────────────────────────────────

type StepStatus = 'pending' | 'running' | 'done' | 'error'

interface StepState {
  status: StepStatus
  result?: string
  error?: string
}

const STEP_TYPE_COLORS: Record<string, string> = {
  openocd_start: 'text-blue-400',
  openocd:       'text-cyan-400',
  flash:         'text-amber-400',
  erase:         'text-orange-400',
  halt:          'text-purple-300',
  resume:        'text-green-300',
  reset:         'text-pink-400',
  uart_connect:  'text-teal-400',
  uart_disconnect:'text-zinc-400',
  uart_send:     'text-indigo-300',
  uart_wait:     'text-violet-300',
  uart_extract:  'text-violet-400',
  delay:         'text-zinc-500',
  log:           'text-zinc-400',
  set_var:       'text-emerald-400',
  exec:          'text-red-300',
}

const DEFAULT_SRC = JSON.stringify([
  { type: 'openocd_start', interface: 'interface/stlink.cfg', target: 'target/stm32l4x.cfg' },
  { type: 'halt' },
  { type: 'flash', file_key: 'firmware.bin', address: '0x08000000', verify: true, do_reset: true },
  { type: 'log', message: 'Done!' },
], null, 2)

// ── Step dot ──────────────────────────────────────────────────────────────────

function StepDot({ status }: { status: StepStatus }) {
  if (status === 'running') return (
    <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse shrink-0" />
  )
  if (status === 'done')    return <span className="inline-block w-2 h-2 rounded-full bg-green-500 shrink-0" />
  if (status === 'error')   return <span className="inline-block w-2 h-2 rounded-full bg-red-500 shrink-0" />
  return <span className="inline-block w-2 h-2 rounded-full bg-zinc-700 shrink-0" />
}

// ── Step row ──────────────────────────────────────────────────────────────────

function StepRow({ index, step, state }: {
  index: number
  step: Record<string, unknown>
  state: StepState
}) {
  const t = String(step.type ?? '?')
  const typeColor = STEP_TYPE_COLORS[t] ?? 'text-zinc-300'

  const desc = (() => {
    if (t === 'openocd_start') return `${step.interface} + ${step.target}`
    if (t === 'openocd')       return String(step.cmd ?? '')
    if (t === 'flash')         return `${step.file_key ?? step.file_path ?? '?'} @ ${step.address ?? '0x08000000'}`
    if (t === 'uart_connect')  return `${step.port} @ ${step.baud_rate ?? 115200}`
    if (t === 'uart_send')     return String(step.data ?? '')
    if (t === 'uart_wait')     return `/${step.pattern}/ timeout=${step.timeout ?? 10}s`
    if (t === 'uart_extract')  return `/${step.pattern}/ → group ${step.group ?? 1}`
    if (t === 'delay')         return `${step.seconds}s`
    if (t === 'log')           return String(step.message ?? '')
    if (t === 'set_var')       return `${step.name} = ${step.value}`
    if (t === 'exec')          return String(step.command ?? '')
    return ''
  })()

  const rowBg = state.status === 'running' ? 'bg-blue-500/10'
    : state.status === 'error' ? 'bg-red-500/10' : ''

  return (
    <div className={`flex flex-col gap-0.5 px-3 py-2 border-b border-[#21262d] ${rowBg}`}>
      <div className="flex items-center gap-2">
        <StepDot status={state.status} />
        <span className="text-zinc-500 text-xs mono w-4 shrink-0">{index}</span>
        <span className={`text-xs mono font-semibold ${typeColor}`}>{t}</span>
        {desc && <span className="text-xs mono text-zinc-500 truncate">{desc}</span>}
      </div>
      {state.result && (
        <div className="ml-8 text-xs mono text-green-400 truncate">{state.result}</div>
      )}
      {state.error && (
        <div className="ml-8 text-xs mono text-red-400">{state.error}</div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ScriptRunner() {
  const [scriptList, setScriptList]   = useState<ScriptMeta[]>([])
  const [selectedId, setSelectedId]   = useState<number | null>(null)
  const [script, setScript]           = useState<Script | null>(null)
  const [src, setSrc]                 = useState(DEFAULT_SRC)
  const [name, setName]               = useState('new script')
  const [dirty, setDirty]             = useState(false)
  const [view, setView]               = useState<'editor' | 'steps'>('editor')

  const [stepStates, setStepStates]   = useState<StepState[]>([])
  const [parsedSteps, setParsedSteps] = useState<Record<string, unknown>[]>([])
  const [running, setRunning]         = useState(false)
  const [logLines, setLogLines]       = useState<string[]>([])
  const [showCheatsheet, setShowCheatsheet] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const stepsEndRef  = useRef<HTMLDivElement>(null)

  // ── Parse steps preview ────────────────────────────────────────────────────

  useEffect(() => {
    try {
      const parsed = JSON.parse(src)
      if (Array.isArray(parsed)) {
        setParsedSteps(parsed)
        setStepStates(parsed.map(() => ({ status: 'pending' })))
      }
    } catch {
      setParsedSteps([])
    }
  }, [src])

  // ── WebSocket events ───────────────────────────────────────────────────────

  const handleWs = useCallback((data: unknown) => {
    const msg = data as { type: string; [k: string]: unknown }
    if (msg.type === 'init') {
      setRunning(Boolean(msg.running))
      return
    }
    if (msg.type === 'start') {
      const count = Number(msg.step_count ?? 0)
      setStepStates(Array.from({ length: count }, () => ({ status: 'pending' })))
      setLogLines([])
      setRunning(true)
      setView('steps')
      return
    }
    if (msg.type === 'step_start') {
      const idx = Number(msg.index)
      setStepStates(prev => prev.map((s, i) => i === idx ? { status: 'running' } : s))
      setTimeout(() => stepsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
      return
    }
    if (msg.type === 'step_done') {
      const idx = Number(msg.index)
      setStepStates(prev => prev.map((s, i) =>
        i === idx ? { status: 'done', result: String(msg.result ?? '') } : s
      ))
      return
    }
    if (msg.type === 'step_error') {
      const idx = Number(msg.index)
      setStepStates(prev => prev.map((s, i) =>
        i === idx ? { status: 'error', error: String(msg.error ?? '') } : s
      ))
      setRunning(false)
      return
    }
    if (msg.type === 'done' || msg.type === 'stopped') {
      setRunning(false)
      return
    }
    if (msg.type === 'log') {
      setLogLines(prev => [...prev.slice(-200), String(msg.message ?? '')])
      return
    }
  }, [])

  useWebSocket('/ws/scripts', handleWs)

  // ── Load script list ───────────────────────────────────────────────────────

  useEffect(() => {
    scripts.list().then(r => {
      setScriptList(r.scripts)
      if (r.scripts.length > 0 && selectedId === null) {
        loadScript(r.scripts[0].id)
      }
    }).catch(() => {})
  }, [])

  async function loadScript(id: number) {
    const r = await scripts.get(id)
    if (!r.ok || !r.script) return
    setScript(r.script)
    setSelectedId(id)
    setSrc(r.script.src)
    setName(r.script.name)
    setDirty(false)
  }

  async function saveScript() {
    const id = selectedId ?? Date.now()
    const saved = await scripts.upsert({ id, name, src, files: script?.files ?? {} })
    if (saved.ok) {
      setScript(saved.script)
      setSelectedId(saved.script.id)
      setDirty(false)
      const r = await scripts.list()
      setScriptList(r.scripts)
    }
  }

  async function newScript() {
    const id = Date.now()
    const saved = await scripts.upsert({ id, name: 'new script', src: DEFAULT_SRC, files: {} })
    if (saved.ok) {
      const r = await scripts.list()
      setScriptList(r.scripts)
      await loadScript(saved.script.id)
    }
  }

  async function deleteScript() {
    if (!selectedId) return
    if (!confirm('Delete this script?')) return
    await scripts.delete(selectedId)
    const r = await scripts.list()
    setScriptList(r.scripts)
    if (r.scripts.length > 0) {
      await loadScript(r.scripts[0].id)
    } else {
      setScript(null)
      setSelectedId(null)
      setSrc(DEFAULT_SRC)
      setName('new script')
    }
  }

  async function runScript() {
    await saveScript()
    if (selectedId) {
      await scripts.run(selectedId)
    }
  }

  async function stopScript() {
    await scripts.stop()
  }

  // ── File attachments ───────────────────────────────────────────────────────

  function addFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !script) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const bytes = new Uint8Array(ev.target!.result as ArrayBuffer)
      let binary = ''
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      const b64 = btoa(binary)
      const updated = { ...script, files: { ...script.files, [file.name]: b64 } }
      setScript(updated)
      const saved = await scripts.upsert(updated)
      if (saved.ok) {
        setScript(saved.script)
        const r = await scripts.list()
        setScriptList(r.scripts)
      }
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ''
  }

  async function removeFile(key: string) {
    if (!script) return
    const files = { ...script.files }
    delete files[key]
    const updated = { ...script, files }
    setScript(updated)
    const saved = await scripts.upsert(updated)
    if (saved.ok) setScript(saved.script)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const srcError = (() => {
    try { JSON.parse(src); return null } catch (e: unknown) { return String(e) }
  })()

  return (
    <div className="flex flex-col h-full gap-2">

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Script selector */}
        <select
          className="input text-xs flex-1 min-w-0"
          value={selectedId ?? ''}
          onChange={e => loadScript(Number(e.target.value))}
        >
          {scriptList.length === 0 && <option value="">No scripts</option>}
          {scriptList.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>

        <button className="btn-ghost text-xs px-2 py-1 normal-case font-normal" onClick={newScript}>+ New</button>
        <button className="btn-ghost text-xs px-2 py-1 normal-case font-normal text-red-400"
          onClick={deleteScript} disabled={!selectedId}>Delete</button>

        <button
          className="btn-ghost text-xs px-2 py-1 normal-case font-normal text-zinc-500"
          onClick={() => setShowCheatsheet(true)}
          title="Step reference"
        >?</button>

        <div className="w-px h-4 bg-zinc-700 shrink-0" />

        {running ? (
          <button className="btn-ghost text-xs px-3 py-1 normal-case font-normal text-red-400 border border-red-500/30"
            onClick={stopScript}>■ Stop</button>
        ) : (
          <button
            className="btn-success text-xs px-3 py-1 normal-case font-normal"
            onClick={runScript}
            disabled={!selectedId || !!srcError}
          >▶ Run</button>
        )}
      </div>

      {/* ── Script name ── */}
      <div className="flex items-center gap-2 shrink-0">
        <input
          className="input text-xs flex-1"
          placeholder="Script name"
          value={name}
          onChange={e => { setName(e.target.value); setDirty(true) }}
        />
        {dirty && (
          <button className="btn-primary text-xs px-2 py-1 normal-case font-normal" onClick={saveScript}>
            Save
          </button>
        )}
      </div>

      {/* ── View toggle ── */}
      <div className="flex border-b border-[#30363d] shrink-0">
        <button
          onClick={() => setView('editor')}
          className={view === 'editor' ? 'tab-btn-active' : 'tab-btn-inactive'}
        >JSON Editor</button>
        <button
          onClick={() => setView('steps')}
          className={view === 'steps' ? 'tab-btn-active' : 'tab-btn-inactive'}
        >Steps {parsedSteps.length > 0 && `(${parsedSteps.length})`}</button>
      </div>

      {/* ── Editor ── */}
      <div className={`flex flex-col flex-1 min-h-0 gap-2 ${view === 'editor' ? '' : 'hidden'}`}>
        {srcError && (
          <div className="text-red-400 text-xs mono px-2 py-1 bg-red-500/10 rounded">{srcError}</div>
        )}
        <textarea
          className="flex-1 bg-[#0f1117] text-zinc-300 mono text-xs p-3 resize-none focus:outline-none border border-[#30363d] rounded"
          value={src}
          onChange={e => { setSrc(e.target.value); setDirty(true) }}
          spellCheck={false}
        />

        {/* File attachments */}
        <div className="panel shrink-0">
          <div className="panel-header flex items-center justify-between">
            <span>Attached .bin files</span>
            <button className="btn-ghost text-xs px-2 py-0.5 normal-case font-normal"
              onClick={() => fileInputRef.current?.click()}>+ Add .bin</button>
          </div>
          <input ref={fileInputRef} type="file" accept=".bin" className="hidden" onChange={addFile} />
          {Object.keys(script?.files ?? {}).length === 0 ? (
            <div className="px-3 py-2 text-xs text-zinc-600 italic">No attached files. Reference them with file_key in flash steps.</div>
          ) : (
            <div className="divide-y divide-[#21262d]">
              {Object.keys(script?.files ?? {}).map(key => {
                const b64 = script?.files[key] ?? ''
                const sizeKb = Math.round(b64.length * 0.75 / 1024)
                return (
                  <div key={key} className="flex items-center justify-between px-3 py-1.5">
                    <span className="mono text-xs text-zinc-300">{key}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-zinc-500">{sizeKb} KB</span>
                      <button className="text-xs text-red-400 hover:text-red-300"
                        onClick={() => removeFile(key)}>✕</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Cheatsheet modal ── */}
      {showCheatsheet && <Cheatsheet onClose={() => setShowCheatsheet(false)} />}

      {/* ── Steps view ── */}
      <div className={`flex flex-col flex-1 min-h-0 gap-2 ${view === 'steps' ? '' : 'hidden'}`}>
        {/* Log messages */}
        {logLines.length > 0 && (
          <div className="panel shrink-0">
            <div className="panel-header">Script Log</div>
            <div className="px-3 py-2 space-y-0.5 max-h-28 overflow-y-auto">
              {logLines.map((l, i) => (
                <div key={i} className="text-xs mono text-zinc-400">{l}</div>
              ))}
            </div>
          </div>
        )}

        {/* Step list */}
        <div className="panel flex-1 overflow-y-auto min-h-0">
          <div className="panel-header">
            {running ? (
              <span className="text-blue-400">Running…</span>
            ) : stepStates.some(s => s.status === 'error') ? (
              <span className="text-red-400">Failed</span>
            ) : stepStates.every(s => s.status === 'done') && stepStates.length > 0 ? (
              <span className="text-green-400">Done</span>
            ) : (
              'Steps'
            )}
          </div>
          {parsedSteps.length === 0 ? (
            <div className="px-3 py-2 text-xs text-zinc-600 italic">No steps parsed yet.</div>
          ) : (
            parsedSteps.map((step, i) => (
              <StepRow
                key={i}
                index={i}
                step={step}
                state={stepStates[i] ?? { status: 'pending' }}
              />
            ))
          )}
          <div ref={stepsEndRef} />
        </div>
      </div>

    </div>
  )
}
