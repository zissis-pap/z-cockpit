import { useState, useRef, useCallback } from 'react'
import type { OcdApi } from '../../api/client'

type DataFormat = 'default' | 'hex' | 'decimal' | 'ascii'

interface VarRow {
  id: string
  address: string
  name: string
  size: string
  data: string
  originalBytes: number[] | null   // null = not yet read from flash
  modifiedBytes: number[] | null   // null = not modified
}

interface Props {
  connected: boolean
  onLog: (text: string, level?: string) => void
  ocd: OcdApi
}

let rowSeq = 0

function makeRow(): VarRow {
  return {
    id: String(rowSeq++),
    address: '',
    name: '',
    size: '4',
    data: '',
    originalBytes: null,
    modifiedBytes: null,
  }
}

// ─── mdw parsing — faithful port of _parse_mdw from the reference ─────────────
// Accepts OpenOCD mdw output like: "0x08001000: deadbeef 01234567 ..."
// Returns raw bytes in memory order (little-endian words unpacked).

function parseMdwBytes(text: string): number[] {
  const bytes: number[] = []
  for (const line of text.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx < 0) continue
    for (const h of line.slice(colonIdx + 1).trim().split(/\s+/)) {
      if (!h) continue
      const word = parseInt(h, 16)
      if (isNaN(word)) continue
      // little-endian unpack (<I) — same as struct.pack("<I", word)
      bytes.push(word & 0xff, (word >> 8) & 0xff, (word >> 16) & 0xff, (word >> 24) & 0xff)
    }
  }
  return bytes
}

// ─── Format helpers ───────────────────────────────────────────────────────────

function formatBytes(bytes: number[], size: number, fmt: DataFormat): string {
  if (bytes.length === 0) return ''
  const b = bytes.slice(0, size)

  const effectiveFmt: 'decimal' | 'hex' | 'ascii' =
    fmt === 'default'
      ? size <= 2 ? 'decimal' : size <= 4 ? 'hex' : 'ascii'
      : fmt

  if (effectiveFmt === 'decimal') {
    let val = 0
    for (let i = b.length - 1; i >= 0; i--) val = val * 256 + b[i]
    const ascii = b.map(x => (x >= 0x20 && x < 0x7f) ? String.fromCharCode(x) : '.').join('')
    const hasPrintable = b.some(x => x >= 0x20 && x < 0x7f)
    return hasPrintable && b.length <= 8 ? `${val}  "${ascii}"` : String(val)
  }

  if (effectiveFmt === 'hex') {
    if (b.length <= 4) {
      let val = 0
      for (let i = b.length - 1; i >= 0; i--) val = val * 256 + b[i]
      const hexStr = '0x' + val.toString(16).padStart(b.length * 2, '0').toUpperCase()
      const ascii = b.map(x => (x >= 0x20 && x < 0x7f) ? String.fromCharCode(x) : '.').join('')
      const hasPrintable = b.some(x => x >= 0x20 && x < 0x7f)
      return hasPrintable ? `${hexStr}  "${ascii}"` : hexStr
    }
    const ascii = b.map(x => (x >= 0x20 && x < 0x7f) ? String.fromCharCode(x) : '.').join('')
    const hasPrintable = b.some(x => x >= 0x20 && x < 0x7f)
    if (hasPrintable) return `"${ascii}"`
    return b.map(x => x.toString(16).padStart(2, '0').toUpperCase()).join(' ')
  }

  // ascii
  return '"' + b.map(x => (x >= 0x20 && x < 0x7f) ? String.fromCharCode(x) : '.').join('') + '"'
}

// Strip trailing ASCII annotation like '0x37  "7"' → '0x37'
function stripAsciiSuffix(s: string): string {
  const quoteIdx = s.indexOf('"')
  if (quoteIdx < 0) return s
  return s.slice(0, quoteIdx).trim() || s
}

function parseData(text: string, size: number, fmt: DataFormat): number[] | null {
  try {
    const s = text.trim()
    if (!s || s === '—' || s === '…' || s === 'err') return null

    // Quoted string → ASCII bytes
    if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
      const str = s.slice(1, -1)
      return Array.from({ length: size }, (_, i) => i < str.length ? str.charCodeAt(i) & 0xff : 0)
    }

    if (fmt === 'ascii') {
      return Array.from({ length: size }, (_, i) => i < s.length ? s.charCodeAt(i) & 0xff : 0)
    }

    // Strip ASCII annotation suffix before numeric parsing
    const sNum = stripAsciiSuffix(s)

    // 0x... or decimal integer
    if (sNum.toLowerCase().startsWith('0x') || /^\d+$/.test(sNum)) {
      const val = parseInt(sNum, sNum.toLowerCase().startsWith('0x') ? 16 : 10)
      if (isNaN(val)) return null
      const bytes: number[] = []
      let v = val >>> 0
      for (let i = 0; i < size; i++) {
        bytes.push(v & 0xff)
        v >>>= 8
      }
      return bytes
    }

    // Space-separated hex bytes
    const parts = sNum.split(/\s+/).filter(Boolean)
    if (parts.length > 1 && parts.every(p => /^[0-9a-fA-F]{1,2}$/.test(p))) {
      const bytes = parts.map(p => parseInt(p, 16))
      while (bytes.length < size) bytes.push(0)
      return bytes.slice(0, size)
    }

    // Plain hex string
    if (/^[0-9a-fA-F]+$/.test(sNum)) {
      const padded = sNum.padStart(size * 2, '0')
      const bytes: number[] = []
      for (let i = 0; i < size; i++) bytes.push(parseInt(padded.slice(i * 2, i * 2 + 2), 16))
      return bytes.reverse()
    }

    return null
  } catch {
    return null
  }
}

function bytesEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  return a.every((v, i) => v === b[i])
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ContentEditor({ connected, onLog, ocd }: Props) {
  const [rows, setRows] = useState<VarRow[]>([makeRow()])
  const [fmt, setFmt] = useState<DataFormat>('default')
  const [reading, setReading] = useState(false)
  const [storing, setStoring] = useState(false)
  const [progress, setProgress] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Keep a ref to always access the latest rows inside async callbacks
  const rowsRef = useRef(rows)
  rowsRef.current = rows

  // ── Row mutations ────────────────────────────────────────────────────────────

  function addRow() {
    setRows(prev => [...prev, makeRow()])
  }

  function removeRow(id: string) {
    setRows(prev => prev.length > 1 ? prev.filter(r => r.id !== id) : prev)
  }

  function updateRow(id: string, field: keyof VarRow, value: string) {
    setRows(prev => prev.map(r => {
      if (r.id !== id) return r
      const updated: VarRow = { ...r, [field]: value }
      if (field === 'data' && r.originalBytes !== null && r.originalBytes.length > 0) {
        const size = parseInt(r.size) || 0
        if (size > 0) {
          const parsed = parseData(value, size, fmt)
          updated.modifiedBytes = (parsed && !bytesEqual(parsed, r.originalBytes.slice(0, size))) ? parsed : null
        }
      }
      return updated
    }))
  }

  // ── Format switching ─────────────────────────────────────────────────────────

  function changeFmt(newFmt: DataFormat) {
    setFmt(newFmt)
    setRows(prev => prev.map(r => {
      if (!r.originalBytes || r.originalBytes.length === 0) return r
      const size = parseInt(r.size) || r.originalBytes.length
      const bytesToShow = r.modifiedBytes ?? r.originalBytes
      return { ...r, data: formatBytes(bytesToShow, size, newFmt) }
    }))
  }

  // ── Read Values — sends mdw directly like the reference ───────────────────────

  const doRead = useCallback(async (rowsOverride?: VarRow[]) => {
    if (!connected) { onLog('Not connected', 'error'); return }
    const targetRows = rowsOverride ?? rowsRef.current
    setReading(true)

    const updates = new Map<string, Pick<VarRow, 'originalBytes' | 'modifiedBytes' | 'data'>>()

    for (const row of targetRows) {
      const addrStr = row.address.trim()
      const size = parseInt(row.size)
      if (!addrStr || isNaN(size) || size <= 0) {
        onLog(`[WARN] Row "${row.name || addrStr || '?'}": invalid address or size`, 'warn')
        continue
      }

      // Parse address (0x prefix optional) — same as int(addr_text, 0) in reference
      const addrInt = parseInt(addrStr, addrStr.toLowerCase().startsWith('0x') ? 16 : 10)
      if (isNaN(addrInt)) {
        onLog(`[WARN] Cannot parse address "${addrStr}"`, 'warn')
        continue
      }

      // Chunk reads in batches of 64 words — identical to ReadCurrentWorker in reference
      const CHUNK = 64
      const totalWords = Math.ceil(size / 4)
      const allBytes: number[] = []
      let readAddr = addrInt
      let remaining = totalWords

      try {
        while (remaining > 0) {
          const n = Math.min(CHUNK, remaining)
          const res = await ocd.command(`mdw 0x${readAddr.toString(16).padStart(8, '0')} ${n}`)
          if (!res.ok) {
            throw new Error(`command failed: ${res.result}`)
          }
          const chunk = parseMdwBytes(res.result)
          if (chunk.length === 0) {
            throw new Error(`no data returned for mdw 0x${readAddr.toString(16).padStart(8, '0')} ${n}`)
          }
          allBytes.push(...chunk)
          readAddr += n * 4
          remaining -= n
        }

        const original = allBytes.slice(0, size)
        updates.set(row.id, {
          originalBytes: original,
          data: formatBytes(original, size, fmt),
          modifiedBytes: null,
        })
        onLog(`Read ${addrStr} (${size}B): ${formatBytes(original, size, 'hex')}`, 'info')
      } catch (e) {
        onLog(`[ERROR] Read failed for "${row.name || addrStr}": ${e}`, 'error')
      }
    }

    setRows(prev => prev.map(r => {
      const u = updates.get(r.id)
      return u ? { ...r, ...u } : r
    }))
    setReading(false)
  }, [connected, fmt, onLog, ocd])

  // ── Store ────────────────────────────────────────────────────────────────────

  const doStore = useCallback(async () => {
    if (!connected) { onLog('Not connected', 'error'); return }

    const toWrite = rowsRef.current.filter(r =>
      r.modifiedBytes !== null &&
      r.modifiedBytes.length > 0 &&
      r.address.trim() &&
      parseInt(r.size) > 0
    )

    if (toWrite.length === 0) {
      onLog('[WARN] No modified variables to write. Edit a value (green) before storing.', 'warn')
      return
    }

    setStoring(true)
    setProgress(0)

    for (let i = 0; i < toWrite.length; i++) {
      const row = toWrite[i]
      const addrStr = row.address.trim()
      const addrInt = parseInt(addrStr, addrStr.toLowerCase().startsWith('0x') ? 16 : 10)
      const data = row.modifiedBytes!
      const label = row.name || addrStr

      try {
        onLog(`Storing "${label}" @ ${addrStr} (${data.length}B)…`, 'info')
        const res = await ocd.flash.patchBytes(addrInt, data)
        if (res.ok) {
          onLog(`Stored "${label}" OK (page_base=${res.page_base})`, 'info')
        } else {
          onLog(`[ERROR] Store failed for "${label}": ${res.result}`, 'error')
        }
      } catch (e) {
        onLog(`[ERROR] Store error for "${label}": ${e}`, 'error')
      }

      setProgress(Math.round(((i + 1) / toWrite.length) * 100))
    }

    setStoring(false)
    await doRead()
  }, [connected, onLog, ocd, doRead])

  // ── Save / Load ──────────────────────────────────────────────────────────────

  function saveSet() {
    const data = rowsRef.current.map(r => ({
      address: r.address,
      name: r.name,
      size: r.size,
      data: r.data,
    }))
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'variables.varset'
    a.click()
    URL.revokeObjectURL(url)
  }

  function loadSet() {
    fileInputRef.current?.click()
  }

  function onFileLoad(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target?.result as string) as unknown
        if (!Array.isArray(data)) throw new Error('Expected JSON array')
        const newRows: VarRow[] = (data as Record<string, unknown>[]).map(entry => ({
          id: String(rowSeq++),
          address: String(entry.address ?? ''),
          name: String(entry.name ?? ''),
          size: String(entry.size ?? '4'),
          data: '',
          originalBytes: null,
          modifiedBytes: null,
        }))
        const finalRows = newRows.length > 0 ? newRows : [makeRow()]
        setRows(finalRows)
        onLog(`Loaded ${finalRows.length} variable(s) from ${file.name}`, 'info')
        if (connected) doRead(finalRows)
      } catch (err) {
        onLog(`[ERROR] Failed to load: ${err}`, 'error')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const hasModified = rows.some(r => r.modifiedBytes !== null)

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Variables table — scrollable, fills available space */}
      <div className="panel flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className="panel-header flex items-center justify-between shrink-0">
          <span>Variables</span>
          <div className="flex items-center gap-2 font-normal normal-case">
            <label className="text-xs text-zinc-400">Data format:</label>
            <select
              className="select text-xs py-0"
              value={fmt}
              onChange={e => changeFmt(e.target.value as DataFormat)}
            >
              <option value="default">Default</option>
              <option value="hex">Hex</option>
              <option value="decimal">Decimal</option>
              <option value="ascii">ASCII</option>
            </select>
          </div>
        </div>

        <div className="p-2 flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="overflow-auto flex-1 min-h-0">
            <table className="w-full text-xs mono border-collapse">
              <thead className="sticky top-0 bg-[#161b22] z-10">
                <tr className="border-b border-[#30363d] text-zinc-400 text-left">
                  <th className="px-2 py-1 w-7 text-right select-none">#</th>
                  <th className="px-2 py-1 w-36">Address</th>
                  <th className="px-2 py-1">Name</th>
                  <th className="px-2 py-1 w-20 text-center">Size (B)</th>
                  <th className="px-2 py-1">Data</th>
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const isModified = row.modifiedBytes !== null
                  const hasOriginal = row.originalBytes !== null && row.originalBytes.length > 0
                  const rowBg = isModified
                    ? 'bg-[#0d1f0d]'
                    : idx % 2 === 0 ? 'bg-[#161b22]' : 'bg-[#1a1f27]'
                  return (
                    <tr key={row.id} className={`border-b border-[#21262d]/50 ${rowBg}`}>
                      <td className="px-2 py-0.5 text-zinc-500 text-right select-none">{idx + 1}</td>
                      <td className="px-1 py-0.5">
                        <input
                          className="input w-full text-xs mono"
                          placeholder="0x08001000"
                          value={row.address}
                          onChange={e => updateRow(row.id, 'address', e.target.value)}
                        />
                      </td>
                      <td className="px-1 py-0.5">
                        <input
                          className="input w-full text-xs"
                          placeholder="variable name"
                          value={row.name}
                          onChange={e => updateRow(row.id, 'name', e.target.value)}
                        />
                      </td>
                      <td className="px-1 py-0.5">
                        <input
                          className="input w-full text-xs mono text-center"
                          type="number"
                          min={1}
                          value={row.size}
                          onChange={e => updateRow(row.id, 'size', e.target.value)}
                        />
                      </td>
                      <td className="px-1 py-0.5">
                        <input
                          className={`input w-full text-xs mono ${
                            isModified   ? 'text-green-400' :
                            hasOriginal  ? 'text-blue-400'  :
                                           'text-zinc-500'
                          }`}
                          placeholder="—"
                          value={row.data}
                          onChange={e => updateRow(row.id, 'data', e.target.value)}
                        />
                      </td>
                      <td className="px-1 py-0.5 text-center">
                        <button
                          className="text-zinc-600 hover:text-red-400 transition-colors leading-none"
                          onClick={() => removeRow(row.id)}
                          title="Remove row"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex gap-2 mt-2 shrink-0">
            <button className="btn-ghost text-xs" onClick={saveSet}>Save Set…</button>
            <button className="btn-ghost text-xs" onClick={loadSet}>Load Set…</button>
            <div className="flex-1" />
            <button className="btn-ghost text-xs" onClick={addRow}>+ Add Row</button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".varset,.json"
            className="hidden"
            onChange={onFileLoad}
          />
        </div>
      </div>

      {/* Store to Flash — fixed at bottom, never scrolls */}
      <div className="panel shrink-0">
        <div className="panel-header">Store to Flash</div>
        <div className="p-3 space-y-2">
          {storing && (
            <div className="w-full bg-[#21262d] rounded-full h-1.5">
              <div
                className="bg-blue-500 h-1.5 rounded-full transition-all duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
          <div className="flex gap-2 items-center flex-wrap">
            <button
              className="btn-primary"
              onClick={() => doRead()}
              disabled={reading || storing || !connected}
            >
              {reading ? 'Reading…' : 'Read Values'}
            </button>
            <button
              className={`btn-primary ${hasModified ? 'border-green-700 text-green-300' : ''}`}
              style={hasModified ? { background: '#1a4a1a' } : undefined}
              onClick={doStore}
              disabled={storing || reading || !connected || !hasModified}
            >
              {storing ? `Storing… ${progress}%` : 'Store'}
            </button>
            {hasModified && (
              <span className="text-xs text-green-400/70">
                {rows.filter(r => r.modifiedBytes !== null).length} modified
              </span>
            )}
          </div>
          <p className="text-[10px] text-zinc-600">
            Blue = read from flash · Green = modified · Store writes only modified rows
          </p>
        </div>
      </div>
    </div>
  )
}
