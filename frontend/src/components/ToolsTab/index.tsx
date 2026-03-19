import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { tools } from '../../api/client'

// ── Types ─────────────────────────────────────────────────────────────────────

interface IfaceInfo {
  interface: string
  ip: string
  prefix: number
  broadcast: string
}

interface ScanHost {
  ip: string
  hostname: string
  mac: string
}

interface Packet {
  id: number
  time: string
  src: string
  src_port: string
  dst: string
  dst_port: string
  proto: string
  length: string
  info: string
}

// ── Virtual scroll constants ──────────────────────────────────────────────────

const ROW_HEIGHT = 21   // px — must match actual rendered row height
const OVERSCAN   = 20  // extra rows rendered above/below viewport
const MAX_PACKETS = 5000

// ── Network Info Panel ────────────────────────────────────────────────────────

function NetworkInfoPanel() {
  const [ifaces, setIfaces]     = useState<IfaceInfo[]>([])
  const [clientIp, setClientIp] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await tools.networkInterfaces()
      setIfaces(res.interfaces)
      setClientIp(res.client_ip)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="panel">
      <div className="panel-header flex items-center justify-between">
        <span>Network Info</span>
        <button className="btn-ghost text-xs px-2 py-0.5 normal-case font-normal" onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : '↺ Refresh'}
        </button>
      </div>
      <div className="p-3 space-y-3">
        {error && <div className="text-red-400 text-xs mono">{error}</div>}

        {clientIp && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-zinc-500 text-xs">Client IP:</span>
            <span className="mono text-amber-400">{clientIp}</span>
          </div>
        )}

        {ifaces.length > 0 ? (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#30363d]">
                <th className="text-left py-1 pr-4 text-zinc-500 font-normal">Interface</th>
                <th className="text-left py-1 pr-4 text-zinc-500 font-normal">IP Address</th>
                <th className="text-left py-1 pr-4 text-zinc-500 font-normal">Prefix</th>
                <th className="text-left py-1 text-zinc-500 font-normal">Broadcast</th>
              </tr>
            </thead>
            <tbody>
              {ifaces.map((iface, i) => (
                <tr key={i} className="border-b border-[#21262d]/50 hover:bg-[#21262d]/40">
                  <td className="py-1 pr-4 text-blue-400 mono">{iface.interface}</td>
                  <td className="py-1 pr-4 mono text-zinc-200">{iface.ip}</td>
                  <td className="py-1 pr-4 mono text-zinc-400">/{iface.prefix}</td>
                  <td className="py-1 mono text-zinc-500">{iface.broadcast || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          !loading && <div className="text-zinc-600 text-xs italic">No interfaces found.</div>
        )}
      </div>
    </div>
  )
}

// ── Network Scanner Panel ─────────────────────────────────────────────────────

function NetworkScannerPanel() {
  const [subnet, setSubnet]   = useState('192.168.1.0/24')
  const [hosts, setHosts]     = useState<ScanHost[]>([])
  const [scanning, setScanning] = useState(false)
  const [error, setError]     = useState('')
  const [scanned, setScanned] = useState(false)

  async function doScan() {
    setScanning(true)
    setError('')
    setScanned(false)
    try {
      const res = await tools.scanNetwork(subnet)
      setHosts(res.hosts)
      setScanned(true)
    } catch (e) {
      setError(String(e))
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="panel">
      <div className="panel-header flex items-center justify-between">
        <span>Network Scanner {scanned && <span className="text-zinc-500 font-normal text-xs ml-1">— {hosts.length} host{hosts.length !== 1 ? 's' : ''} found</span>}</span>
      </div>
      <div className="p-3 space-y-3">
        <div className="flex gap-2 items-center">
          <input
            className="input mono text-xs w-48"
            value={subnet}
            onChange={e => setSubnet(e.target.value)}
            placeholder="192.168.1.0/24"
            onKeyDown={e => e.key === 'Enter' && !scanning && doScan()}
          />
          <button className="btn-primary" onClick={doScan} disabled={scanning}>
            {scanning ? 'Scanning…' : 'Scan'}
          </button>
        </div>

        {error && <div className="text-red-400 text-xs mono">{error}</div>}

        {scanned && hosts.length === 0 && (
          <div className="text-zinc-600 text-xs italic">No hosts discovered.</div>
        )}

        {hosts.length > 0 && (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#30363d]">
                <th className="text-left py-1 pr-4 text-zinc-500 font-normal">IP Address</th>
                <th className="text-left py-1 pr-4 text-zinc-500 font-normal">Hostname</th>
                <th className="text-left py-1 text-zinc-500 font-normal">MAC Address</th>
              </tr>
            </thead>
            <tbody>
              {hosts.map((host, i) => (
                <tr key={i} className="border-b border-[#21262d]/50 hover:bg-[#21262d]/40">
                  <td className="py-1 pr-4 mono text-blue-400">{host.ip}</td>
                  <td className="py-1 pr-4 mono text-zinc-300">{host.hostname || '—'}</td>
                  <td className="py-1 mono text-zinc-500">{host.mac || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Packet Capturer Panel ─────────────────────────────────────────────────────

function PacketCapturerPanel() {
  const [captureIfaces, setCaptureIfaces] = useState<string[]>([])
  const [selectedIface, setSelectedIface] = useState('')
  const [filterExpr, setFilterExpr]       = useState('')
  const [packets, setPackets]             = useState<Packet[]>([])
  const [capturing, setCapturing]         = useState(false)
  const [captureError, setCaptureError]   = useState('')
  const [autoScroll, setAutoScroll]       = useState(true)
  const [scrollTop, setScrollTop]         = useState(0)

  const wsRef            = useRef<WebSocket | null>(null)
  const tableContainerRef = useRef<HTMLDivElement>(null)
  const bottomRef        = useRef<HTMLDivElement>(null)

  // Load capture interfaces on mount
  useEffect(() => {
    tools.captureInterfaces().then(res => {
      setCaptureIfaces(res.interfaces)
      if (res.interfaces.length > 0) setSelectedIface(res.interfaces[0])
    }).catch(() => {
      setCaptureIfaces(['eth0'])
      setSelectedIface('eth0')
    })
  }, [])

  // Auto-scroll effect
  useEffect(() => {
    if (autoScroll && packets.length > 0) {
      bottomRef.current?.scrollIntoView({ block: 'end' })
    }
  }, [packets, autoScroll])

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget
    setScrollTop(el.scrollTop)
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    if (!atBottom && autoScroll) setAutoScroll(false)
  }

  const startCapture = useCallback(() => {
    setCaptureError('')
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/tools/capture`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({ action: 'start', interface: selectedIface, filter: filterExpr }))
      setCapturing(true)
    }

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'packet') {
          setPackets(prev => {
            const next = [...prev, msg.data as Packet]
            return next.length > MAX_PACKETS ? next.slice(next.length - MAX_PACKETS) : next
          })
        } else if (msg.type === 'stopped') {
          setCapturing(false)
        } else if (msg.type === 'error') {
          setCaptureError(msg.message ?? 'Unknown capture error')
          setCapturing(false)
        }
      } catch {
        // ignore parse errors
      }
    }

    ws.onerror = () => {
      setCapturing(false)
    }

    ws.onclose = () => {
      setCapturing(false)
      wsRef.current = null
    }
  }, [selectedIface, filterExpr])

  const stopCapture = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'stop' }))
    } else {
      setCapturing(false)
    }
  }, [])

  // Clean up WS on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [])

  function clearPackets() {
    setPackets([])
    setCaptureError('')
    setScrollTop(0)
    if (tableContainerRef.current) tableContainerRef.current.scrollTop = 0
  }

  // ── Virtual scroll ──────────────────────────────────────────────────────────
  const viewportHeight = tableContainerRef.current?.clientHeight ?? 400
  const winStart = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const winEnd   = Math.min(packets.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN)
  const spacerTop    = winStart * ROW_HEIGHT
  const spacerBottom = Math.max(0, (packets.length - winEnd) * ROW_HEIGHT)
  const visiblePackets = useMemo(() => packets.slice(winStart, winEnd), [packets, winStart, winEnd])

  const protoColor = (proto: string) => {
    switch (proto.toUpperCase()) {
      case 'TCP':  return 'text-blue-400'
      case 'UDP':  return 'text-green-400'
      case 'ICMP': return 'text-amber-400'
      case 'ARP':  return 'text-purple-400'
      case 'IP6':  return 'text-cyan-400'
      default:     return 'text-zinc-400'
    }
  }

  return (
    <div className="panel flex flex-col" style={{ minHeight: 0 }}>
      <div className="panel-header flex items-center justify-between shrink-0">
        <span>
          Packet Capturer
          {packets.length > 0 && (
            <span className="text-zinc-500 font-normal text-xs ml-1">
              — {packets.length.toLocaleString()} packet{packets.length !== 1 ? 's' : ''}
              {packets.length >= MAX_PACKETS && <span className="text-amber-500"> (capped at {MAX_PACKETS.toLocaleString()})</span>}
            </span>
          )}
        </span>
      </div>

      <div className="p-3 space-y-2 shrink-0">
        <div className="flex flex-wrap gap-2 items-center">
          <select
            className="input text-xs mono w-36"
            value={selectedIface}
            onChange={e => setSelectedIface(e.target.value)}
            disabled={capturing}
          >
            {captureIfaces.map(iface => (
              <option key={iface} value={iface}>{iface}</option>
            ))}
          </select>

          <input
            className="input mono text-xs flex-1 min-w-32"
            value={filterExpr}
            onChange={e => setFilterExpr(e.target.value)}
            placeholder="Filter (e.g. port 80, tcp, host 192.168.1.1)"
            disabled={capturing}
            onKeyDown={e => e.key === 'Enter' && !capturing && startCapture()}
          />

          {!capturing ? (
            <button className="btn-primary" onClick={startCapture}>
              ▶ Start
            </button>
          ) : (
            <button className="btn-ghost border-red-500/50 text-red-400 hover:border-red-400" onClick={stopCapture}>
              ■ Stop
            </button>
          )}

          <button className="btn-ghost text-xs px-2 py-0.5" onClick={clearPackets} disabled={capturing}>
            Clear
          </button>

          <button
            className={`text-xs px-2 py-0.5 rounded border transition-colors ${autoScroll ? 'bg-blue-600/20 border-blue-500/40 text-blue-400' : 'btn-ghost'}`}
            onClick={() => setAutoScroll(v => !v)}
            title="Auto-scroll to latest"
          >
            ↓ Auto
          </button>
        </div>
      </div>

      {captureError && (
        <div className="px-3 pb-2 text-red-400 text-xs mono bg-red-900/10 border-t border-red-500/20 py-2">
          ⚠ {captureError}
        </div>
      )}

      {packets.length > 0 && (
        <div
          ref={tableContainerRef}
          className="flex-1 overflow-auto"
          style={{ minHeight: 0 }}
          onScroll={handleScroll}
        >
          <table className="w-full mono text-xs border-collapse" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '3rem' }} />
              <col style={{ width: '10rem' }} />
              <col style={{ width: '5rem' }} />
              <col style={{ width: '13rem' }} />
              <col style={{ width: '13rem' }} />
              <col style={{ width: '4rem' }} />
              <col />
            </colgroup>
            <thead className="sticky top-0 bg-[#161b22] border-b border-[#30363d] z-10">
              <tr>
                <th className="px-2 py-1 text-left text-zinc-500 font-normal">#</th>
                <th className="px-2 py-1 text-left text-zinc-500 font-normal">Time</th>
                <th className="px-2 py-1 text-left text-zinc-500 font-normal">Protocol</th>
                <th className="px-2 py-1 text-left text-zinc-500 font-normal">Source</th>
                <th className="px-2 py-1 text-left text-zinc-500 font-normal">Destination</th>
                <th className="px-2 py-1 text-left text-zinc-500 font-normal">Len</th>
                <th className="px-2 py-1 text-left text-zinc-500 font-normal">Info</th>
              </tr>
            </thead>
            <tbody>
              {spacerTop > 0 && (
                <tr><td colSpan={7} style={{ height: spacerTop, padding: 0 }} /></tr>
              )}

              {visiblePackets.map(pkt => (
                <tr
                  key={pkt.id}
                  style={{ height: ROW_HEIGHT }}
                  className="border-b border-[#21262d]/50 hover:bg-[#21262d]/60"
                >
                  <td className="px-2 text-zinc-600">{pkt.id + 1}</td>
                  <td className="px-2 text-zinc-500 truncate">{pkt.time}</td>
                  <td className={`px-2 font-medium ${protoColor(pkt.proto)}`}>{pkt.proto}</td>
                  <td className="px-2 text-zinc-300 truncate">
                    {pkt.src}{pkt.src_port ? <span className="text-zinc-600">:{pkt.src_port}</span> : ''}
                  </td>
                  <td className="px-2 text-zinc-300 truncate">
                    {pkt.dst}{pkt.dst_port ? <span className="text-zinc-600">:{pkt.dst_port}</span> : ''}
                  </td>
                  <td className="px-2 text-zinc-500 text-right">{pkt.length}</td>
                  <td className="px-2 text-zinc-400 truncate">{pkt.info}</td>
                </tr>
              ))}

              {spacerBottom > 0 && (
                <tr><td colSpan={7} style={{ height: spacerBottom, padding: 0 }} /></tr>
              )}
            </tbody>
          </table>
          <div ref={bottomRef} />
        </div>
      )}

      {packets.length === 0 && (
        <div className="px-3 pb-3 text-zinc-600 text-xs italic">
          {capturing ? 'Capturing… waiting for packets.' : 'No packets captured yet. Select an interface and press Start.'}
        </div>
      )}
    </div>
  )
}

// ── Main ToolsTab ─────────────────────────────────────────────────────────────

export default function ToolsTab() {
  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      <NetworkInfoPanel />
      <NetworkScannerPanel />
      <PacketCapturerPanel />
    </div>
  )
}
