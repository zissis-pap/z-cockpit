import { useState, useRef, useEffect, KeyboardEvent } from 'react'
import type { OcdApi } from '../../api/client'

interface ConsoleLine {
  id: number
  type: 'cmd' | 'out' | 'err'
  text: string
}

interface Props {
  connected: boolean
  ocd: OcdApi
}

let lineId = 0

export default function ScriptConsole({ connected, ocd }: Props) {
  const [lines, setLines] = useState<ConsoleLine[]>([])
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [histIdx, setHistIdx] = useState(-1)
  const [script, setScript] = useState('# TCL script\n# halt\n# mdw 0x08000000 16\n')
  const [scriptRunning, setScriptRunning] = useState(false)
  const outputRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [lines])

  function appendLine(type: ConsoleLine['type'], text: string) {
    setLines(prev => [...prev.slice(-500), { id: lineId++, type, text }])
  }

  async function sendCmd(cmd: string) {
    if (!cmd.trim() || !connected) return
    appendLine('cmd', `>> ${cmd}`)
    setHistory(h => [cmd, ...h.slice(0, 99)])
    setHistIdx(-1)
    setInput('')
    const res = await ocd.command(cmd)
    if (res.result) {
      for (const line of res.result.split('\n')) {
        appendLine('out', line)
      }
    }
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { sendCmd(input); return }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      const newIdx = Math.min(histIdx + 1, history.length - 1)
      setHistIdx(newIdx)
      setInput(history[newIdx] ?? '')
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const newIdx = Math.max(histIdx - 1, -1)
      setHistIdx(newIdx)
      setInput(newIdx < 0 ? '' : history[newIdx] ?? '')
    }
  }

  async function runScript() {
    if (!connected) return
    setScriptRunning(true)
    const cmds = script.split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
    for (const cmd of cmds) {
      await sendCmd(cmd)
    }
    setScriptRunning(false)
  }

  async function loadScript() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.tcl,.txt'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const text = await file.text()
      setScript(text)
    }
    input.click()
  }

  function saveScript() {
    const blob = new Blob([script], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'script.tcl'
    a.click()
  }

  const lineColor = (type: ConsoleLine['type']) =>
    type === 'cmd' ? 'text-blue-400' : type === 'err' ? 'text-red-400' : 'text-zinc-300'

  return (
    <div className="space-y-3 flex flex-col h-full">
      {/* Interactive console */}
      <div className="panel flex flex-col" style={{ minHeight: 200 }}>
        <div className="panel-header">Interactive Console</div>
        <div ref={outputRef} className="flex-1 overflow-y-auto p-2 mono text-xs space-y-0.5"
          style={{ minHeight: 120, maxHeight: 240 }}>
          {lines.length === 0 && (
            <div className="text-zinc-600 italic">No output yet. Type a command below.</div>
          )}
          {lines.map(l => (
            <div key={l.id} className={lineColor(l.type)}>{l.text}</div>
          ))}
        </div>
        <div className="flex gap-1.5 p-2 border-t border-[#30363d]">
          <span className="mono text-blue-400 text-sm self-center">&gt;</span>
          <input
            className="input flex-1 mono text-xs"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={connected ? 'TCL command…' : 'Not connected'}
            disabled={!connected}
          />
          <button className="btn-primary text-xs px-2"
            onClick={() => sendCmd(input)} disabled={!connected}>Send</button>
          <button className="btn-ghost text-xs px-2"
            onClick={() => setLines([])}>Clear</button>
        </div>
      </div>

      {/* Script editor */}
      <div className="panel flex flex-col flex-1">
        <div className="panel-header flex items-center justify-between">
          <span>Script Editor</span>
          <div className="flex gap-1.5">
            <button className="btn-ghost text-xs px-2 py-1 normal-case font-normal" onClick={loadScript}>Load</button>
            <button className="btn-ghost text-xs px-2 py-1 normal-case font-normal" onClick={saveScript}>Save</button>
            <button className="btn-success text-xs px-2 py-1 normal-case font-normal"
              onClick={runScript} disabled={!connected || scriptRunning}>
              {scriptRunning ? 'Running…' : '▶ Run'}
            </button>
          </div>
        </div>
        <textarea
          className="flex-1 bg-[#0f1117] text-zinc-300 mono text-xs p-3 resize-none focus:outline-none border-0"
          style={{ minHeight: 160 }}
          value={script}
          onChange={e => setScript(e.target.value)}
          spellCheck={false}
        />
      </div>
    </div>
  )
}
