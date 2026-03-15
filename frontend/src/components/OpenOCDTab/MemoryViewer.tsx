import { useState, useCallback } from 'react'
import { openocd } from '../../api/client'
import type { MemoryRow } from '../../types'

interface Props {
  connected: boolean
  onLog: (text: string, level?: string) => void
}

function wordsToBytes(words: number[]): number[] {
  const bytes: number[] = []
  for (const w of words) {
    bytes.push((w) & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, (w >> 24) & 0xff)
  }
  return bytes
}

function toAscii(b: number): string {
  return b >= 32 && b < 127 ? String.fromCharCode(b) : '.'
}

export default function MemoryViewer({ connected, onLog }: Props) {
  const [address, setAddress] = useState('0x08000000')
  const [size, setSize] = useState(256)
  const [rows, setRows] = useState<MemoryRow[]>([])
  const [busy, setBusy] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [intervalMs, setIntervalMs] = useState(2000)
  const [timerRef, setTimerRef] = useState<ReturnType<typeof setInterval> | null>(null)

  const doRead = useCallback(async () => {
    if (!connected) { onLog('Not connected', 'error'); return }
    setBusy(true)
    try {
      const res = await openocd.memory.read(address, size)
      if (res.ok) setRows(res.rows)
      else onLog('Memory read failed', 'error')
    } catch (e) {
      onLog(`Memory read error: ${e}`, 'error')
    } finally {
      setBusy(false)
    }
  }, [connected, address, size, onLog])

  function toggleAutoRefresh() {
    if (autoRefresh) {
      if (timerRef) clearInterval(timerRef)
      setTimerRef(null)
      setAutoRefresh(false)
    } else {
      setAutoRefresh(true)
      const t = setInterval(doRead, intervalMs)
      setTimerRef(t)
    }
  }

  // Flatten rows into display rows of 16 bytes each
  const displayRows: Array<{ addr: number; bytes: number[] }> = []
  for (const row of rows) {
    const bytes = wordsToBytes(row.words)
    const baseAddr = parseInt(row.address, 16)
    for (let i = 0; i < bytes.length; i += 16) {
      displayRows.push({ addr: baseAddr + i, bytes: bytes.slice(i, i + 16) })
    }
  }

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="panel">
        <div className="panel-header">Memory Read</div>
        <div className="p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-zinc-500">Address</label>
              <input className="input w-full mono text-xs mt-0.5" value={address}
                onChange={e => setAddress(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-zinc-500">Size (bytes)</label>
              <input className="input w-full mono text-xs mt-0.5" type="number"
                value={size} onChange={e => setSize(Number(e.target.value))} min={4} step={4} />
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <button className="btn-primary" onClick={doRead} disabled={busy || !connected}>
              {busy ? 'Reading…' : 'Read'}
            </button>
            <button className={`btn-ghost ${autoRefresh ? 'border-amber-500 text-amber-400' : ''}`}
              onClick={toggleAutoRefresh} disabled={!connected}>
              {autoRefresh ? '⏹ Stop' : '↺ Auto'}
            </button>
            {autoRefresh && (
              <input className="input w-20 mono text-xs" type="number"
                value={intervalMs} onChange={e => setIntervalMs(Number(e.target.value))}
                min={500} step={500} title="Interval ms" />
            )}
          </div>
        </div>
      </div>

      {/* Hex table */}
      {displayRows.length > 0 && (
        <div className="panel overflow-hidden">
          <div className="panel-header">
            Hex Dump — {address} ({size} bytes)
          </div>
          <div className="overflow-auto max-h-[50vh]">
            <table className="mono text-xs w-full border-collapse">
              <thead className="sticky top-0 bg-[#161b22] border-b border-[#30363d]">
                <tr>
                  <th className="px-2 py-1 text-left text-blue-400 font-normal">Address</th>
                  {Array.from({ length: 16 }, (_, i) => (
                    <th key={i} className="px-1 py-1 text-zinc-500 font-normal w-7 text-center">
                      {i.toString(16).toUpperCase().padStart(2, '0')}
                    </th>
                  ))}
                  <th className="px-2 py-1 text-green-600 font-normal">ASCII</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row, ri) => (
                  <tr key={ri} className="hover:bg-[#21262d] border-b border-[#21262d]/50">
                    <td className="px-2 py-0.5 text-blue-400 whitespace-nowrap">
                      0x{row.addr.toString(16).padStart(8, '0').toUpperCase()}
                    </td>
                    {Array.from({ length: 16 }, (_, ci) => {
                      const b = row.bytes[ci]
                      return (
                        <td key={ci} className="px-0.5 py-0.5 text-center text-zinc-300">
                          {b !== undefined ? b.toString(16).padStart(2, '0').toUpperCase() : '  '}
                        </td>
                      )
                    })}
                    <td className="px-2 py-0.5 text-green-500 whitespace-pre">
                      {row.bytes.map(b => toAscii(b)).join('')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
