import { useState, useCallback } from 'react'
import ServerControl from './ServerControl'
import MCUSelector from './MCUSelector'
import FlashOps from './FlashOps'
import MemoryViewer from './MemoryViewer'
import ScriptConsole from './ScriptConsole'
import LogViewer from './LogViewer'
import { useWebSocket } from '../../hooks/useWebSocket'
import { useResizable } from '../../hooks/useResizable'
import type { OpenOCDStatus, LogEntry } from '../../types'

const RIGHT_TABS = [
  { id: 'flash',  label: 'Flash Ops' },
  { id: 'memory', label: 'Memory' },
  { id: 'script', label: 'Script Console' },
] as const

type RightTabId = typeof RIGHT_TABS[number]['id']

let logSeq = 0

export default function OpenOCDTab() {
  const [status, setStatus] = useState<OpenOCDStatus>({ server: 'stopped', connected: false })
  const [targetConfig, setTargetConfig] = useState('')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [rightTab, setRightTab] = useState<RightTabId>('flash')
  const [logCollapsed, setLogCollapsed] = useState(false)
  const { height: logHeight, onMouseDown: logDragStart } = useResizable(200)

  const addLog = useCallback((text: string, level = 'info') => {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false })
    setLogs(prev => [...prev.slice(-2000), {
      id: logSeq++,
      text,
      level: level as LogEntry['level'],
      timestamp: ts,
    }])
  }, [])

  const handleWsMessage = useCallback((data: unknown) => {
    const msg = data as { type: string; text?: string; level?: string; server?: string; connected?: boolean; pid?: number }
    if (msg.type === 'log') {
      addLog(msg.text ?? '', msg.level)
    } else if (msg.type === 'status') {
      setStatus({
        server: (msg.server ?? 'stopped') as OpenOCDStatus['server'],
        connected: msg.connected ?? false,
        pid: msg.pid,
      })
    }
  }, [addLog])

  useWebSocket('/ws/openocd', handleWsMessage)

  function handleMcuSelect(config: string, name: string) {
    setTargetConfig(config)
    addLog(`Target selected: ${name} (${config})`, 'info')
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Main area */}
      <div className="flex flex-1 gap-2 p-2 overflow-hidden min-h-0">

        {/* Left panel */}
        <div className="flex flex-col gap-2 w-64 shrink-0 overflow-y-auto">
          <ServerControl
            status={status}
            targetConfig={targetConfig}
            onLog={addLog}
          />
          <MCUSelector
            selectedConfig={targetConfig}
            onSelect={handleMcuSelect}
          />
        </div>

        {/* Right panel */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-[#30363d] shrink-0 mb-2">
            {RIGHT_TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setRightTab(t.id)}
                className={rightTab === t.id ? 'tab-btn-active' : 'tab-btn-inactive'}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto min-h-0 pr-0.5">
            {rightTab === 'flash'  && <FlashOps connected={status.connected} onLog={addLog} />}
            {rightTab === 'memory' && <MemoryViewer connected={status.connected} onLog={addLog} />}
            {rightTab === 'script' && (
              <div className="flex flex-col h-full">
                <ScriptConsole connected={status.connected} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Log panel */}
      <div
        className="shrink-0 border-t border-[#30363d] bg-[#0a0c10]"
        style={{ height: logCollapsed ? 32 : logHeight }}
      >
        {/* Drag handle */}
        {!logCollapsed && (
          <div
            className="h-1 w-full cursor-ns-resize flex items-center justify-center group hover:bg-blue-500/20 transition-colors"
            onMouseDown={logDragStart}
          >
            <div className="w-8 h-0.5 rounded-full bg-zinc-700 group-hover:bg-blue-500/60 transition-colors" />
          </div>
        )}
        <div className="flex items-center px-3 py-1.5 border-b border-[#21262d] cursor-pointer select-none"
          onClick={() => setLogCollapsed(v => !v)}>
          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider flex-1">
            Log {logs.length > 0 && `(${logs.length})`}
          </span>
          <span className="text-zinc-600 text-xs">{logCollapsed ? '▲' : '▼'}</span>
        </div>
        {!logCollapsed && (
          <div className="h-[calc(100%-36px)]">
            <LogViewer logs={logs} onClear={() => setLogs([])} />
          </div>
        )}
      </div>
    </div>
  )
}
