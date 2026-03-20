import { useState, useCallback, useEffect, useRef } from 'react'
import ServerControl from './ServerControl'
import MCUSelector from './MCUSelector'
import FlashOps from './FlashOps'
import MemoryViewer from './MemoryViewer'
import ScriptConsole from './ScriptConsole'
import ScriptRunner from './ScriptRunner'
import LogViewer from './LogViewer'
import { useWebSocket } from '../../hooks/useWebSocket'
import { createOCDApi, remotes } from '../../api/client'
import type { RemoteAgent } from '../../api/client'
import type { OpenOCDStatus, LogEntry, MemoryRow } from '../../types'

const RIGHT_TABS = [
  { id: 'flash',   label: 'Flash Ops' },
  { id: 'memory',  label: 'Memory' },
  { id: 'scripts', label: 'Scripts' },
  { id: 'console', label: 'TCL Console' },
] as const

type RightTabId = typeof RIGHT_TABS[number]['id']

let logSeq = 0

export default function OpenOCDTab() {
  const [status, setStatus] = useState<OpenOCDStatus>({ server: 'stopped', connected: false })
  const [targetConfig, setTargetConfig] = useState('')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [rightTab, setRightTab] = useState<RightTabId>('flash')
  const [memoryRows, setMemoryRows] = useState<MemoryRow[]>([])
  const [firmwareData, setFirmwareData]         = useState<Uint8Array | null>(null)
  const [firmwareBaseAddr, setFirmwareBaseAddr]  = useState('0x08000000')
  const [remoteList, setRemoteList] = useState<RemoteAgent[]>([])
  const [selectedRemoteId, setSelectedRemoteId] = useState<string | undefined>(undefined)
  const [agentReachable, setAgentReachable] = useState<boolean | null>(null)
  const wsStatusReceived = useRef(false)   // true once WS delivers first status for this target
  const prevConnected = useRef(false)

  // Load remote agents once
  useEffect(() => {
    remotes.list().then(r => setRemoteList(r.remotes)).catch(() => {})
  }, [])

  // On target switch: reset, probe reachability, and fetch real OpenOCD status immediately
  useEffect(() => {
    setStatus({ server: 'stopped', connected: false })
    setMemoryRows([])
    wsStatusReceived.current = false   // reset for new target

    const ocdApi = createOCDApi(selectedRemoteId)

    if (!selectedRemoteId) {
      setAgentReachable(null)
      // Sync local status without waiting for the WebSocket
      ocdApi.status().then((s: any) => {
        if (s?.server) setStatus({ server: s.server, connected: s.connected ?? false, pid: s.pid })
      }).catch(() => {})
      return
    }

    setAgentReachable(null)
    // Run reachability test and status fetch in parallel — avoids the
    // sequential 2-3s delay that could let a stale HTTP response overwrite
    // the correct status already delivered by the WebSocket.
    Promise.all([
      remotes.test(selectedRemoteId).catch(() => ({ ok: false })),
      ocdApi.status().catch(() => null),
    ]).then(([testResult, statusResult]: [any, any]) => {
      setAgentReachable(testResult.ok)
      // Only apply HTTP status if the WS hasn't already delivered one —
      // prevents a slow HTTP response from overwriting WS-provided "running".
      if (statusResult?.server && !wsStatusReceived.current) {
        setStatus({ server: statusResult.server, connected: statusResult.connected ?? false, pid: statusResult.pid })
      }
    })
  }, [selectedRemoteId])

  // Clear memory rows when board disconnects
  useEffect(() => {
    if (prevConnected.current && !status.connected) {
      setMemoryRows([])
    }
    prevConnected.current = status.connected
  }, [status.connected])


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
      wsStatusReceived.current = true
      setStatus({
        server: (msg.server ?? 'stopped') as OpenOCDStatus['server'],
        connected: msg.connected ?? false,
        pid: msg.pid,
      })
    }
  }, [addLog])

  // Dynamic WS URL: local or proxied through remote agent
  const wsUrl = selectedRemoteId
    ? `/ws/remotes/${selectedRemoteId}/openocd`
    : '/ws/openocd'

  useWebSocket(wsUrl, handleWsMessage)

  // OCD API instance: local or proxied
  const ocd = createOCDApi(selectedRemoteId)

  function handleMcuSelect(config: string, name: string) {
    setTargetConfig(config)
    addLog(`Target selected: ${name} (${config})`, 'info')
  }

  const selectedRemote = remoteList.find(r => r.id === selectedRemoteId)

  return (
    <div className="flex h-full overflow-hidden p-2 gap-2">

      {/* Left panel — full height */}
      <div className="flex flex-col gap-2 w-64 shrink-0 overflow-y-auto">

        {/* Target selector */}
        <div className="panel">
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
          <div className="p-2">
            <select
              className="select w-full text-xs"
              value={selectedRemoteId ?? ''}
              onChange={e => setSelectedRemoteId(e.target.value || undefined)}
            >
              <option value="">Local</option>
              {remoteList.map(r => (
                <option key={r.id} value={r.id}>{r.name} ({r.host}:{r.port})</option>
              ))}
            </select>
            {selectedRemote && (
              <div className="mt-1 text-[10px] text-zinc-500 truncate">
                via {selectedRemote.host}:{selectedRemote.port}
                {selectedRemote.has_token ? ' 🔒' : ''}
              </div>
            )}
          </div>
        </div>

        <ServerControl
          status={status}
          targetConfig={targetConfig}
          onLog={addLog}
          ocd={ocd}
        />
        <MCUSelector
          selectedConfig={targetConfig}
          onSelect={handleMcuSelect}
        />
      </div>

      {/* Right panel — tabs + log stacked */}
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

        {/* Tab content + Log — stacked, log fills remaining */}
        <div className="flex-1 flex flex-col min-h-0">

          {/* Tab content — natural height, scrolls only when taller than available space */}
          <div className="overflow-y-auto min-h-0 pr-0.5">
            <div className={rightTab === 'flash'   ? '' : 'hidden'}>
              <FlashOps
                connected={status.connected}
                onLog={addLog}
                onFirmwareReady={(_, data, base) => { setFirmwareData(data); setFirmwareBaseAddr(base) }}
                ocd={ocd}
              />
            </div>
            <div className={rightTab === 'memory'  ? '' : 'hidden'}>
              <MemoryViewer
                connected={status.connected}
                rows={memoryRows}
                onRows={setMemoryRows}
                onLog={addLog}
                firmwareData={firmwareData}
                firmwareBaseAddr={firmwareBaseAddr}
                ocd={ocd}
              />
            </div>
            <div className={rightTab === 'scripts' ? 'flex flex-col h-full' : 'hidden'}>
              <ScriptRunner />
            </div>
            <div className={rightTab === 'console' ? 'flex flex-col h-full' : 'hidden'}>
              <ScriptConsole connected={status.connected} ocd={ocd} />
            </div>
          </div>

          {/* Log — fills all remaining space below tab content */}
          <div className="flex-1 min-h-32 mt-3 bg-[#0a0c10] overflow-hidden">
            <LogViewer logs={logs} onClear={() => setLogs([])} />
          </div>

        </div>
      </div>
    </div>
  )
}
