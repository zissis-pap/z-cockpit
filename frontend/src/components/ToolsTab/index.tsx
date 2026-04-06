import { useState, useEffect, useCallback } from 'react'
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

// ── Main ToolsTab ─────────────────────────────────────────────────────────────

export default function ToolsTab() {
  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      <NetworkInfoPanel />
      <NetworkScannerPanel />
    </div>
  )
}
