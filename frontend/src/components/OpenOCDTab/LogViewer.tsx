import { useRef, useEffect } from 'react'
import type { LogEntry } from '../../types'

interface Props {
  logs: LogEntry[]
  onClear: () => void
}

export default function LogViewer({ logs, onClear }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    if (isAtBottom) bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [logs])

  function saveLogs() {
    const text = logs.map(l => `[${l.timestamp}] [${l.level}] ${l.text}`).join('\n')
    const blob = new Blob([text], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'openocd.log'
    a.click()
  }

  const levelColor = (level: string) => {
    if (level === 'error') return 'text-red-400'
    if (level === 'warn')  return 'text-amber-400'
    if (level === 'info')  return 'text-sky-400'
    return 'text-zinc-400'
  }

  return (
    <div className="panel flex flex-col h-full">
      <div className="panel-header flex items-center justify-between shrink-0">
        <span>OpenOCD Log</span>
        <div className="flex gap-1.5 normal-case font-normal">
          <button className="btn-ghost text-xs px-2 py-0.5" onClick={saveLogs}>Save</button>
          <button className="btn-ghost text-xs px-2 py-0.5" onClick={onClear}>Clear</button>
        </div>
      </div>
      <div ref={containerRef} className="flex-1 overflow-y-auto p-2 mono text-xs space-y-0.5">
        {logs.length === 0 && (
          <div className="text-zinc-600 italic">Waiting for OpenOCD output…</div>
        )}
        {logs.map(l => (
          <div key={l.id} className={`flex gap-2 ${levelColor(l.level)}`}>
            <span className="text-zinc-700 shrink-0">{l.timestamp}</span>
            <span className="break-all">{l.text}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
