import { useState, useCallback, useRef, useMemo } from 'react'
import type { OcdApi } from '../../api/client'
import type { MemoryRow } from '../../types'

interface Props {
  connected: boolean
  rows: MemoryRow[]
  onRows: (rows: MemoryRow[]) => void
  onLog: (text: string, level?: string) => void
  firmwareData: Uint8Array | null
  firmwareBaseAddr: string
  ocd: OcdApi
}

const BYTES_PER_ROW = 16
const ROW_HEIGHT = 21   // px — must match actual rendered row height
const OVERSCAN    = 20  // extra rows rendered above/below viewport

function wordsToBytes(words: number[]): number[] {
  const bytes: number[] = []
  for (const w of words) {
    bytes.push(w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, (w >> 24) & 0xff)
  }
  return bytes
}

function toHex(n: number, pad = 2) {
  return n.toString(16).toUpperCase().padStart(pad, '0')
}

function isPrintable(b: number) { return b >= 0x20 && b < 0x7f }

function byteClass(b: number): string {
  if (b === 0x00) return 'text-zinc-700'
  if (isPrintable(b)) return 'text-zinc-200'
  return 'text-zinc-500'
}

function flattenRows(rows: MemoryRow[]): { baseAddr: number; data: Uint8Array } | null {
  const validRows = rows.filter(r => !isNaN(parseInt(r.address, 16)) && r.words.length > 0)
  if (validRows.length === 0) return null
  const baseAddr = parseInt(validRows[0].address, 16)
  const allBytes: number[] = []
  for (const row of validRows) allBytes.push(...wordsToBytes(row.words))
  return { baseAddr, data: new Uint8Array(allBytes) }
}

export default function MemoryViewer({ connected, rows, onRows, onLog, firmwareData, firmwareBaseAddr, ocd }: Props) {
  const [address, setAddress] = useState('0x08000000')
  const [size, setSize]       = useState(256)
  const [busy, setBusy]       = useState(false)
  const [autoRefresh, setAutoRefresh]   = useState(false)
  const [intervalMs, setIntervalMs]     = useState(2000)
  const [timerRef, setTimerRef]         = useState<ReturnType<typeof setInterval> | null>(null)

  // Edit state
  const [cursor, setCursor]               = useState<number | null>(null)
  const [editBuf, setEditBuf]             = useState('')
  const [modifications, setModifications] = useState<Map<number, number>>(new Map())

  // Verify mode
  const [verifyMode, setVerifyMode] = useState(false)
  const [writing, setWriting]       = useState(false)

  // Virtual scroll
  const tableContainerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)

  const flat = useMemo(() => flattenRows(rows), [rows])

  const firmBase = useMemo(() => parseInt(firmwareBaseAddr, 16), [firmwareBaseAddr])

  function getByte(absAddr: number): number | undefined {
    if (modifications.has(absAddr)) return modifications.get(absAddr)!
    if (!flat) return undefined
    const off = absAddr - flat.baseAddr
    if (off < 0 || off >= flat.data.length) return undefined
    return flat.data[off]
  }

  function getFirmwareByte(absAddr: number): number | undefined {
    if (!firmwareData) return undefined
    const off = absAddr - firmBase
    if (off < 0 || off >= firmwareData.length) return undefined
    return firmwareData[off]
  }

  const doRead = useCallback(async (addrOverride?: string, sizeOverride?: number) => {
    if (!connected) { onLog('Not connected', 'error'); return }
    setBusy(true)
    const readAddr = addrOverride ?? address
    const readSize = sizeOverride ?? size
    try {
      const res = await ocd.memory.read(readAddr, readSize)
      if (res.ok) {
        onRows(res.rows)
        setModifications(new Map())
        setCursor(null)
        setEditBuf('')
        setScrollTop(0)
        if (tableContainerRef.current) tableContainerRef.current.scrollTop = 0
      } else {
        onLog('Memory read failed', 'error')
      }
    } catch (e) {
      onLog(`Memory read error: ${e}`, 'error')
    } finally {
      setBusy(false)
    }
  }, [connected, address, size, onLog, onRows])

  async function doVerify() {
    if (firmwareData) {
      const addr = firmwareBaseAddr
      const sz = firmwareData.length
      setAddress(addr)
      setSize(sz)
      await doRead(addr, sz)
    } else {
      await doRead()
    }
    setVerifyMode(true)
  }

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

  function handleCellClick(absAddr: number) {
    if (verifyMode) return
    setCursor(absAddr)
    setEditBuf('')
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (verifyMode || cursor === null || !flat) return
    const end = flat.baseAddr + flat.data.length - 1
    if ('0123456789ABCDEFabcdef'.includes(e.key)) {
      e.preventDefault()
      const buf = editBuf + e.key.toUpperCase()
      if (buf.length === 2) {
        const newByte = parseInt(buf, 16)
        setModifications(prev => new Map(prev).set(cursor, newByte))
        setEditBuf('')
        setCursor(prev => (prev !== null && prev < end ? prev + 1 : prev))
      } else {
        setEditBuf(buf)
      }
    } else if (e.key === 'Escape') {
      setModifications(new Map())
      setCursor(null)
      setEditBuf('')
    } else if (e.key === 'Backspace') {
      e.preventDefault()
      if (editBuf) { setEditBuf('') }
      else if (cursor > flat.baseAddr) { setCursor(cursor - 1); setEditBuf('') }
    } else if (e.key === 'ArrowRight') { e.preventDefault(); if (cursor < end) setCursor(cursor + 1) }
    else if (e.key === 'ArrowLeft')  { e.preventDefault(); if (cursor > flat.baseAddr) setCursor(cursor - 1) }
    else if (e.key === 'ArrowDown')  { e.preventDefault(); if (cursor + BYTES_PER_ROW <= end) setCursor(cursor + BYTES_PER_ROW) }
    else if (e.key === 'ArrowUp')    { e.preventDefault(); if (cursor - BYTES_PER_ROW >= flat.baseAddr) setCursor(cursor - BYTES_PER_ROW) }
  }

  async function doWrite() {
    if (!connected || modifications.size === 0) return
    setWriting(true)
    onLog(`Writing ${modifications.size} modified byte(s) to flash…`, 'info')
    try {
      const addrs = [...modifications.keys()].sort((a, b) => a - b)
      const minAddr = addrs[0]
      const maxAddr = addrs[addrs.length - 1]
      const len = maxAddr - minAddr + 1
      const data: number[] = []
      for (let i = 0; i < len; i++) {
        const addr = minAddr + i
        data.push(modifications.has(addr) ? modifications.get(addr)! : (getByte(addr) ?? 0xff))
      }
      const res = await ocd.flash.patchBytes(minAddr, data)
      if (res.ok) {
        onLog(`Flash patched OK (page_size=${res.page_size} B, page_base=${res.page_base})`, 'info')
        setModifications(new Map())
        setCursor(null)
        await doRead()
      } else {
        onLog(`Flash patch failed: ${res.result}`, 'error')
      }
    } catch (e) {
      onLog(`Write error: ${e}`, 'error')
    } finally {
      setWriting(false)
    }
  }

  // ── Display rows ────────────────────────────────────────────────────────────
  const displayRows = useMemo<Array<{ addr: number }>>(() => {
    const out: Array<{ addr: number }> = []
    if (verifyMode && firmwareData) {
      const start = flat ? Math.min(flat.baseAddr, firmBase) : firmBase
      const end   = flat
        ? Math.max(flat.baseAddr + flat.data.length, firmBase + firmwareData.length)
        : firmBase + firmwareData.length
      for (let addr = start; addr < end; addr += BYTES_PER_ROW) out.push({ addr })
    } else if (flat) {
      for (let off = 0; off < flat.data.length; off += BYTES_PER_ROW) {
        out.push({ addr: flat.baseAddr + off })
      }
    }
    return out
  }, [flat, verifyMode, firmwareData, firmBase])

  // ── Virtual scroll window ───────────────────────────────────────────────────
  const viewportHeight = tableContainerRef.current?.clientHeight ?? 500
  const winStart = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const winEnd   = Math.min(displayRows.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN)
  const spacerTop    = winStart * ROW_HEIGHT
  const spacerBottom = Math.max(0, (displayRows.length - winEnd) * ROW_HEIGHT)
  const visibleRows  = displayRows.slice(winStart, winEnd)

  const hasMods = modifications.size > 0

  // ── Colour helpers for verify mode ─────────────────────────────────────────
  function verifyCellClass(mem: number | undefined, fw: number | undefined): string {
    if (mem === undefined) return 'text-zinc-800'
    if (fw === undefined)  return byteClass(mem)
    if (mem !== fw)        return 'text-red-400'
    return byteClass(mem)
  }

  function fwCellClass(mem: number | undefined, fw: number | undefined): string {
    if (fw === undefined)  return 'text-zinc-800'
    if (mem === undefined) return 'text-purple-400'
    if (mem !== fw)        return 'text-blue-400'
    return byteClass(fw)
  }

  const COL_SPAN = verifyMode ? 36 : 18

  return (
    <div className="space-y-3" onKeyDown={handleKeyDown} tabIndex={-1} style={{ outline: 'none' }}>
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
          <div className="flex gap-2 items-center flex-wrap">
            <button className="btn-primary" onClick={() => doRead()} disabled={busy || !connected}>
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
            <button
              className={`btn-ghost ${verifyMode ? 'border-blue-500/60 text-blue-400' : ''}`}
              onClick={() => verifyMode ? setVerifyMode(false) : doVerify()}
              disabled={!connected || !firmwareData}
              title={!firmwareData ? 'Load a firmware file in Flash Ops first' : 'Compare memory with firmware file'}
            >
              {verifyMode ? '✓ Exit Verify' : '⊞ Verify'}
            </button>
            {hasMods && (
              <button className="btn-primary" onClick={doWrite} disabled={writing || !connected}>
                {writing ? 'Writing…' : `⚡ Write ${modifications.size}B to Flash`}
              </button>
            )}
            {hasMods && (
              <button className="btn-ghost text-xs" onClick={() => { setModifications(new Map()); setEditBuf('') }}>
                Discard edits
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Hex table */}
      {displayRows.length > 0 && (
        <div className="panel overflow-hidden">
          <div className="panel-header flex items-center justify-between">
            <span>
              {verifyMode
                ? `Verify — ${address} (${displayRows.length} rows)`
                : `Hex Dump — ${address} (${size} bytes)`}
            </span>
            {verifyMode && firmwareData && (
              <span className="text-[10px] font-normal normal-case flex items-center gap-3">
                <span className="text-zinc-500">■ <span className="text-red-400">Memory differs</span></span>
                <span className="text-zinc-500">■ <span className="text-blue-400">Firmware differs</span></span>
                <span className="text-zinc-500">■ <span className="text-green-400/60">Match</span></span>
              </span>
            )}
            {!verifyMode && flat && (
              <span className="text-[10px] font-normal normal-case text-zinc-500">
                Click bytes to edit · Type hex · Esc to cancel
              </span>
            )}
          </div>

          <div
            ref={tableContainerRef}
            className="overflow-auto max-h-[60vh]"
            onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
          >
            <table
              className="mono text-xs border-collapse"
              style={{ minWidth: verifyMode ? 'max-content' : undefined, width: verifyMode ? undefined : '100%' }}
            >
              <thead className="sticky top-0 bg-[#161b22] border-b border-[#30363d] z-10">
                {verifyMode ? (
                  <tr>
                    <th className="px-2 py-1 text-left text-blue-400 font-normal">Address</th>
                    {Array.from({ length: BYTES_PER_ROW }, (_, i) => (
                      <th key={`m${i}`} className="px-0.5 py-1 text-red-500/50 font-normal w-7 text-center">{toHex(i, 2)}</th>
                    ))}
                    <th className="px-2 py-1 text-red-400/40 font-normal text-left">MEM</th>
                    <th className="px-3 py-1" />
                    {Array.from({ length: BYTES_PER_ROW }, (_, i) => (
                      <th key={`f${i}`} className="px-0.5 py-1 text-blue-500/50 font-normal w-7 text-center">{toHex(i, 2)}</th>
                    ))}
                    <th className="px-2 py-1 text-blue-400/40 font-normal text-left">FW</th>
                  </tr>
                ) : (
                  <tr>
                    <th className="px-2 py-1 text-left text-blue-400 font-normal">Address</th>
                    {Array.from({ length: BYTES_PER_ROW }, (_, i) => (
                      <th key={i} className="px-1 py-1 text-zinc-500 font-normal w-7 text-center">{toHex(i, 2)}</th>
                    ))}
                    <th className="px-2 py-1 text-green-600 font-normal">ASCII</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {/* Top spacer */}
                {spacerTop > 0 && (
                  <tr><td colSpan={COL_SPAN} style={{ height: spacerTop, padding: 0 }} /></tr>
                )}

                {visibleRows.map(({ addr }) => {
                  const memBytes: (number | undefined)[] = Array.from({ length: BYTES_PER_ROW }, (_, i) => getByte(addr + i))
                  const fwBytes:  (number | undefined)[] = Array.from({ length: BYTES_PER_ROW }, (_, i) => getFirmwareByte(addr + i))
                  const hasDiff = verifyMode && memBytes.some((m, i) => m !== fwBytes[i] && (m !== undefined || fwBytes[i] !== undefined))

                  if (verifyMode) {
                    return (
                      <tr key={addr} style={{ height: ROW_HEIGHT }} className={`border-b border-[#21262d]/50 ${hasDiff ? 'bg-[#0f0e0a]' : ''}`}>
                        <td className={`px-2 whitespace-nowrap ${hasDiff ? 'text-amber-500/70' : 'text-blue-400'}`}>
                          0x{addr.toString(16).padStart(8, '0').toUpperCase()}
                        </td>
                        {memBytes.map((m, i) => (
                          <td key={`m${i}`} className="px-0.5 text-center">
                            {m !== undefined
                              ? <span className={verifyCellClass(m, fwBytes[i])}>{toHex(m)}</span>
                              : <span className="text-zinc-800">──</span>}
                          </td>
                        ))}
                        <td className="px-2 whitespace-pre">
                          {memBytes.map((m, i) => {
                            const cls = m === undefined ? 'text-zinc-800' : m !== fwBytes[i] ? 'text-red-400' : 'text-green-500/60'
                            return <span key={i} className={cls}>{m !== undefined ? (isPrintable(m) ? String.fromCharCode(m) : '·') : ' '}</span>
                          })}
                        </td>
                        <td className="px-3 border-l-2 border-[#30363d]" />
                        {fwBytes.map((fw, i) => (
                          <td key={`f${i}`} className="px-0.5 text-center">
                            {fw !== undefined
                              ? <span className={fwCellClass(memBytes[i], fw)}>{toHex(fw)}</span>
                              : <span className="text-zinc-800">──</span>}
                          </td>
                        ))}
                        <td className="px-2 whitespace-pre">
                          {fwBytes.map((fw, i) => {
                            const cls = fw === undefined ? 'text-zinc-800' : fw !== memBytes[i] ? 'text-blue-400' : 'text-green-500/60'
                            return <span key={i} className={cls}>{fw !== undefined ? (isPrintable(fw) ? String.fromCharCode(fw) : '·') : ' '}</span>
                          })}
                        </td>
                      </tr>
                    )
                  }

                  // Normal / edit view
                  return (
                    <tr key={addr} style={{ height: ROW_HEIGHT }} className="hover:bg-[#21262d] border-b border-[#21262d]/50">
                      <td className="px-2 text-blue-400 whitespace-nowrap">
                        0x{addr.toString(16).padStart(8, '0').toUpperCase()}
                      </td>
                      {memBytes.map((b, i) => {
                        const absAddr = addr + i
                        const isCursor = absAddr === cursor
                        const isMod = modifications.has(absAddr)
                        return (
                          <td key={i} className="px-0.5 text-center">
                            {b !== undefined ? (
                              <span
                                className={`inline-block w-6 rounded cursor-pointer transition-colors ${
                                  isCursor ? 'bg-blue-600 text-white'
                                  : isMod   ? 'bg-amber-500/10 text-amber-400'
                                  : byteClass(b) + ' hover:bg-[#30363d]'
                                }`}
                                onClick={() => handleCellClick(absAddr)}
                              >
                                {isCursor && editBuf ? editBuf + '_' : toHex(b)}
                              </span>
                            ) : <span className="inline-block w-6 text-zinc-800">  </span>}
                          </td>
                        )
                      })}
                      <td className="px-2 text-green-500 whitespace-pre">
                        {memBytes.map((b, i) => {
                          const absAddr = addr + i
                          const isCursor = absAddr === cursor
                          const isMod = modifications.has(absAddr)
                          const cls = isCursor ? 'bg-blue-600 text-white rounded' : isMod ? 'text-amber-400' : 'hover:text-green-300'
                          return b !== undefined
                            ? <span key={i} className={`cursor-pointer ${cls}`} onClick={() => handleCellClick(absAddr)}>{isPrintable(b) ? String.fromCharCode(b) : '·'}</span>
                            : <span key={i}> </span>
                        })}
                      </td>
                    </tr>
                  )
                })}

                {/* Bottom spacer */}
                {spacerBottom > 0 && (
                  <tr><td colSpan={COL_SPAN} style={{ height: spacerBottom, padding: 0 }} /></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
