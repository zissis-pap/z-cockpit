import { useState, useRef, useEffect, useCallback } from 'react'

const BYTES_PER_ROW = 16
const ROWS_PER_PAGE = 512  // 8 192 bytes per page

function toHex(n: number, pad = 2) {
  return n.toString(16).toUpperCase().padStart(pad, '0')
}

function isPrintable(b: number) {
  return b >= 0x20 && b < 0x7f
}

function byteClass(b: number, modified: boolean): string {
  if (modified) return 'text-amber-400'
  if (b === 0x00) return 'text-zinc-700'
  if (isPrintable(b)) return 'text-zinc-200'
  return 'text-zinc-500'
}

// ── Compare helpers ────────────────────────────────────────────────────────────

function cmpClassA(a: number | undefined, b: number | undefined): string {
  if (a === undefined) return 'text-zinc-800'           // only in B
  if (b === undefined) return 'text-orange-400'         // only in A
  if (a !== b)         return 'text-red-400'            // differs
  return byteClass(a, false)                            // same
}

function cmpClassB(a: number | undefined, b: number | undefined): string {
  if (b === undefined) return 'text-zinc-800'           // only in A
  if (a === undefined) return 'text-purple-400'         // only in B
  if (a !== b)         return 'text-blue-400'           // differs
  return byteClass(b, false)                            // same
}

function isDiffRow(bytesA: (number|undefined)[], bytesB: (number|undefined)[]): boolean {
  for (let i = 0; i < BYTES_PER_ROW; i++) {
    if (bytesA[i] !== bytesB[i]) return true
  }
  return false
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function BinaryEditorTab() {
  const [data, setData]           = useState<Uint8Array | null>(null)
  const [original, setOriginal]   = useState<Uint8Array | null>(null)
  const [fileName, setFileName]   = useState('')
  const [cursor, setCursor]       = useState<number | null>(null)
  const [editBuf, setEditBuf]     = useState('')
  const [page, setPage]           = useState(0)
  const [saved, setSaved]         = useState(true)
  const [jumpInput, setJumpInput] = useState('')

  // Compare state
  const [cmpData, setCmpData]         = useState<Uint8Array | null>(null)
  const [cmpFileName, setCmpFileName] = useState('')
  const [compareMode, setCompareMode] = useState(false)
  const [diffOnly, setDiffOnly]       = useState(false)

  const fileInputRef    = useRef<HTMLInputElement>(null)
  const cmpInputRef     = useRef<HTMLInputElement>(null)
  const editorRef       = useRef<HTMLDivElement>(null)

  // ── Derived ───────────────────────────────────────────────────────────────

  const totalBytes   = data?.length ?? 0
  const cmpTotalBytes = cmpData?.length ?? 0

  const activeTotalBytes = compareMode
    ? Math.max(totalBytes, cmpTotalBytes)
    : totalBytes

  const totalRows  = Math.ceil(activeTotalBytes / BYTES_PER_ROW)
  const totalPages = Math.max(1, Math.ceil(totalRows / ROWS_PER_PAGE))
  const pageStart  = page * ROWS_PER_PAGE * BYTES_PER_ROW
  const pageEnd    = Math.min(pageStart + ROWS_PER_PAGE * BYTES_PER_ROW, activeTotalBytes)
  const modified   = data && original ? data.some((b, i) => b !== original[i]) : false

  const diffCount = compareMode && data && cmpData
    ? (() => {
        const len = Math.max(data.length, cmpData.length)
        let n = 0
        for (let i = 0; i < len; i++) if (data[i] !== cmpData[i]) n++
        return n
      })()
    : 0

  // ── File I/O ──────────────────────────────────────────────────────────────

  function openFile(file: File) {
    const reader = new FileReader()
    reader.onload = e => {
      const arr = new Uint8Array(e.target!.result as ArrayBuffer)
      setData(arr)
      setOriginal(arr.slice())
      setFileName(file.name)
      setCursor(null)
      setEditBuf('')
      setPage(0)
      setSaved(true)
    }
    reader.readAsArrayBuffer(file)
  }

  function openCmpFile(file: File) {
    const reader = new FileReader()
    reader.onload = e => {
      setCmpData(new Uint8Array(e.target!.result as ArrayBuffer))
      setCmpFileName(file.name)
      setPage(0)
    }
    reader.readAsArrayBuffer(file)
  }

  function saveFile() {
    if (!data) return
    const blob = new Blob([new Uint8Array(data)], { type: 'application/octet-stream' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = fileName
    a.click()
    URL.revokeObjectURL(a.href)
    setSaved(true)
  }

  function closeFileA() {
    setData(null); setOriginal(null); setFileName('')
    setCursor(null); setEditBuf(''); setPage(0); setSaved(true)
    exitCompare()
  }

  function exitCompare() {
    setCompareMode(false)
    setCmpData(null)
    setCmpFileName('')
    setDiffOnly(false)
    setPage(0)
  }

  // ── Editing ───────────────────────────────────────────────────────────────

  function setByte(offset: number, value: number) {
    if (!data) return
    const next = new Uint8Array(data)
    next[offset] = value
    setData(next)
    setSaved(false)
  }

  const moveCursor = useCallback((next: number) => {
    if (!data || next < 0 || next >= data.length) return
    setCursor(next)
    setEditBuf('')
    setPage(Math.floor(next / (ROWS_PER_PAGE * BYTES_PER_ROW)))
  }, [data])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (compareMode || cursor === null || !data) return
    if ('0123456789ABCDEFabcdef'.includes(e.key)) {
      e.preventDefault()
      const buf = editBuf + e.key.toUpperCase()
      if (buf.length === 2) { setByte(cursor, parseInt(buf, 16)); setEditBuf(''); moveCursor(cursor + 1) }
      else setEditBuf(buf)
    } else if (e.key === 'Backspace') { e.preventDefault(); editBuf ? setEditBuf('') : moveCursor(cursor - 1) }
    else if (e.key === 'ArrowRight') { e.preventDefault(); moveCursor(cursor + 1) }
    else if (e.key === 'ArrowLeft')  { e.preventDefault(); moveCursor(cursor - 1) }
    else if (e.key === 'ArrowDown')  { e.preventDefault(); moveCursor(cursor + BYTES_PER_ROW) }
    else if (e.key === 'ArrowUp')    { e.preventDefault(); moveCursor(cursor - BYTES_PER_ROW) }
    else if (e.key === 'Home')  { e.preventDefault(); moveCursor(cursor - cursor % BYTES_PER_ROW) }
    else if (e.key === 'End')   { e.preventDefault(); moveCursor(cursor - cursor % BYTES_PER_ROW + BYTES_PER_ROW - 1) }
    else if (e.key === 'Tab')   { e.preventDefault(); moveCursor(cursor + (e.shiftKey ? -1 : 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); moveCursor(cursor + BYTES_PER_ROW) }
  }

  function jumpToOffset() {
    const off = parseInt(jumpInput, 16)
    if (!isNaN(off) && data && off < data.length) moveCursor(off)
    setJumpInput('')
  }

  useEffect(() => { if (!compareMode) editorRef.current?.focus() }, [cursor, compareMode])

  // ── Row data ──────────────────────────────────────────────────────────────

  type EditorRow = { offset: number; bytes: number[] }
  const editorRows: EditorRow[] = []
  if (data && !compareMode) {
    for (let off = pageStart; off < pageEnd; off += BYTES_PER_ROW) {
      editorRows.push({ offset: off, bytes: Array.from(data.slice(off, Math.min(off + BYTES_PER_ROW, totalBytes))) })
    }
  }

  type CmpRow = { offset: number; bytesA: (number|undefined)[]; bytesB: (number|undefined)[] }
  const cmpRows: CmpRow[] = []
  if (compareMode) {
    for (let off = pageStart; off < pageEnd; off += BYTES_PER_ROW) {
      const end = Math.min(off + BYTES_PER_ROW, activeTotalBytes)
      const bytesA: (number|undefined)[] = Array.from({ length: end - off }, (_, i) => data?.[off + i])
      const bytesB: (number|undefined)[] = Array.from({ length: end - off }, (_, i) => cmpData?.[off + i])
      while (bytesA.length < BYTES_PER_ROW) bytesA.push(undefined)
      while (bytesB.length < BYTES_PER_ROW) bytesB.push(undefined)
      cmpRows.push({ offset: off, bytesA, bytesB })
    }
  }

  const visibleCmpRows = diffOnly ? cmpRows.filter(r => isDiffRow(r.bytesA, r.bytesB)) : cmpRows

  function cellClick(abs: number) {
    if (compareMode) return
    setCursor(abs); setEditBuf(''); editorRef.current?.focus()
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const pagination = (
    <div className="flex items-center gap-3 px-3 py-2 border-t border-[#21262d] text-xs text-zinc-500 select-none bg-[#161b22]">
      <button className="btn-ghost py-0.5 px-2.5" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>← Prev</button>
      <span className="mono flex-1 text-center">
        Page {page + 1} / {totalPages} &nbsp;·&nbsp; {toHex(pageStart, 8)}–{toHex(pageEnd - 1, 8)}
      </span>
      <button className="btn-ghost py-0.5 px-2.5" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}>Next →</button>
    </div>
  )

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-[#21262d] bg-[#161b22] flex-wrap">
        <input type="file" ref={fileInputRef} className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) openFile(f); e.target.value = '' }} />
        <input type="file" ref={cmpInputRef} className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) openCmpFile(f); e.target.value = '' }} />

        <button className="btn-primary text-xs py-1 px-3" onClick={() => fileInputRef.current?.click()}>
          {data ? 'Reopen' : 'Open'}
        </button>

        {data && !compareMode && (
          <button className="btn-ghost text-xs py-1 px-3" onClick={() => setCompareMode(true)}>
            Compare…
          </button>
        )}

        {data && compareMode && (
          <>
            {/* File A label */}
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm bg-red-500 shrink-0" />
              <span className="text-xs text-zinc-300 mono truncate max-w-[14ch]" title={fileName}>{fileName}</span>
              <span className="text-xs text-zinc-600">{totalBytes.toLocaleString()} B</span>
            </span>

            <span className="text-zinc-700">vs</span>

            {/* File B label / picker */}
            {cmpData ? (
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm bg-blue-500 shrink-0" />
                <span className="text-xs text-zinc-300 mono truncate max-w-[14ch]" title={cmpFileName}>{cmpFileName}</span>
                <span className="text-xs text-zinc-600">{cmpTotalBytes.toLocaleString()} B</span>
                <button className="btn-ghost text-xs py-0.5 px-1.5" onClick={() => cmpInputRef.current?.click()}>swap</button>
                <button className="text-zinc-600 hover:text-zinc-300 transition-colors px-0.5" onClick={exitCompare} title="Close file B">✕</button>
              </span>
            ) : (
              <button className="btn-primary text-xs py-1 px-3" onClick={() => cmpInputRef.current?.click()}>
                Open file B…
              </button>
            )}

            {/* Diff stats */}
            {cmpData && (
              <span className={`text-xs font-medium mono ${diffCount === 0 ? 'text-green-400' : 'text-red-400'}`}>
                {diffCount === 0 ? '✓ identical' : `${diffCount.toLocaleString()} bytes differ`}
              </span>
            )}

            {/* Diff-only filter */}
            {cmpData && (
              <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer select-none">
                <input type="checkbox" checked={diffOnly} onChange={e => setDiffOnly(e.target.checked)} className="accent-blue-500" />
                Diffs only
              </label>
            )}

            <button className="btn-ghost text-xs py-1 px-2 ml-auto" onClick={exitCompare}>✕ Exit compare</button>
          </>
        )}

        {data && !compareMode && (
          <>
            <span className="flex items-center gap-1.5">
              <span className="text-sm text-zinc-300 font-medium mono truncate max-w-xs" title={fileName}>{fileName}</span>
              <span className="text-xs text-zinc-600 mono">{totalBytes.toLocaleString()} B</span>
              {modified && <span className="text-xs text-amber-400 font-medium">● modified</span>}
              <button className="text-zinc-600 hover:text-zinc-300 transition-colors px-0.5" onClick={closeFileA} title="Close file">✕</button>
            </span>

            <div className="flex items-center gap-1 border-l border-[#30363d] pl-3 ml-1">
              <span className="text-xs text-zinc-600">Jump to offset</span>
              <input
                className="input w-28 text-xs mono py-0.5"
                placeholder="0x000000"
                value={jumpInput}
                onChange={e => setJumpInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && jumpToOffset()}
              />
              <button className="btn-ghost text-xs py-0.5 px-2" onClick={jumpToOffset}>Go</button>
            </div>

            <button className="btn-primary text-xs py-1 px-3 ml-auto" onClick={saveFile} disabled={!modified && saved}>
              Save / Download
            </button>
          </>
        )}

        {!data && (
          <span className="text-xs text-zinc-600">Open a binary file to inspect and edit</span>
        )}
      </div>

      {/* Drop zone */}
      {!data ? (
        <div
          className="flex-1 flex flex-col items-center justify-center gap-5 cursor-pointer select-none"
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) openFile(f) }}
          onDragOver={e => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="w-24 h-24 rounded-2xl border-2 border-dashed border-[#30363d] flex items-center justify-center text-zinc-700 hover:border-blue-600/40 hover:text-blue-600/40 transition-colors">
            <svg viewBox="0 0 24 24" className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth="1.25">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="M3 9h18M9 21V9"/><path d="M7 6h.01M5 6h.01"/>
            </svg>
          </div>
          <div className="text-center">
            <div className="text-zinc-400 font-medium text-sm">Drop a binary file here</div>
            <div className="text-zinc-600 text-xs mt-1">or click to browse — .bin, .hex, .elf, .fw, any binary</div>
          </div>
        </div>

      ) : compareMode ? (
        /* ── Compare view ── */
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {!cmpData ? (
            <div
              className="flex-1 flex flex-col items-center justify-center gap-4 cursor-pointer select-none"
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) openCmpFile(f) }}
              onDragOver={e => e.preventDefault()}
              onClick={() => cmpInputRef.current?.click()}
            >
              <div className="w-20 h-20 rounded-2xl border-2 border-dashed border-[#30363d] flex items-center justify-center text-zinc-700 hover:border-blue-600/40 hover:text-blue-600/40 transition-colors">
                <svg viewBox="0 0 24 24" className="w-9 h-9" fill="none" stroke="currentColor" strokeWidth="1.25">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <path d="M3 9h18M9 21V9"/><path d="M7 6h.01M5 6h.01"/>
                </svg>
              </div>
              <div className="text-center">
                <div className="text-zinc-400 font-medium text-sm">Drop file B here to compare</div>
                <div className="text-zinc-600 text-xs mt-1">or click to browse</div>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-auto outline-none">
              <table className="mono text-xs border-collapse" style={{ minWidth: 'max-content' }}>
                <thead className="sticky top-0 z-10 bg-[#161b22] border-b border-[#30363d]">
                  <tr>
                    <th className="px-3 py-1.5 text-left text-blue-500/70 font-normal w-28">Offset</th>
                    {/* File A header */}
                    {Array.from({ length: 8 }, (_, i) => (
                      <th key={`a${i}`} className="px-0 py-1.5 text-center text-red-500/50 font-normal w-7">{toHex(i, 2)}</th>
                    ))}
                    <th className="px-2 py-1.5 text-zinc-700 font-normal w-4" />
                    {Array.from({ length: 8 }, (_, i) => (
                      <th key={`a${i+8}`} className="px-0 py-1.5 text-center text-red-500/50 font-normal w-7">{toHex(i + 8, 2)}</th>
                    ))}
                    <th className="px-2 py-1.5 text-red-500/40 font-normal text-left">ASCII A</th>
                    {/* Separator */}
                    <th className="px-3 py-1.5" />
                    {/* File B header */}
                    {Array.from({ length: 8 }, (_, i) => (
                      <th key={`b${i}`} className="px-0 py-1.5 text-center text-blue-500/50 font-normal w-7">{toHex(i, 2)}</th>
                    ))}
                    <th className="px-2 py-1.5 text-zinc-700 font-normal w-4" />
                    {Array.from({ length: 8 }, (_, i) => (
                      <th key={`b${i+8}`} className="px-0 py-1.5 text-center text-blue-500/50 font-normal w-7">{toHex(i + 8, 2)}</th>
                    ))}
                    <th className="px-2 py-1.5 text-blue-500/40 font-normal text-left">ASCII B</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleCmpRows.map(({ offset, bytesA, bytesB }) => {
                    const hasDiff = isDiffRow(bytesA, bytesB)
                    return (
                      <tr key={offset} className={`border-b border-[#21262d]/30 ${hasDiff ? 'bg-[#0f0e0a]' : 'hover:bg-[#0f1117]'}`}>
                        <td className={`px-3 py-0.5 whitespace-nowrap select-none ${hasDiff ? 'text-amber-500/70' : 'text-blue-400'}`}>
                          {toHex(offset, 8)}
                        </td>

                        {/* File A first 8 */}
                        {Array.from({ length: 8 }, (_, i) => {
                          const a = bytesA[i]; const b = bytesB[i]
                          return (
                            <td key={`a${i}`} className="px-0 py-0.5 text-center select-none">
                              {a !== undefined
                                ? <span className={`inline-block w-6 rounded ${cmpClassA(a, b)}`}>{toHex(a)}</span>
                                : <span className="inline-block w-6 text-zinc-800">──</span>}
                            </td>
                          )
                        })}
                        <td className="border-r border-[#30363d] w-2" />
                        {/* File A second 8 */}
                        {Array.from({ length: 8 }, (_, i) => {
                          const col = i + 8; const a = bytesA[col]; const b = bytesB[col]
                          return (
                            <td key={`a${col}`} className="px-0 py-0.5 text-center select-none">
                              {a !== undefined
                                ? <span className={`inline-block w-6 rounded ${cmpClassA(a, b)}`}>{toHex(a)}</span>
                                : <span className="inline-block w-6 text-zinc-800">──</span>}
                            </td>
                          )
                        })}

                        {/* ASCII A */}
                        <td className="px-2 py-0.5 whitespace-pre select-none">
                          {bytesA.slice(0, 8).map((a, i) => {
                            const b = bytesB[i]
                            const cls = a === undefined ? 'text-zinc-800' : a !== b ? 'text-red-400' : 'text-green-500/60'
                            return <span key={i} className={cls}>{a !== undefined ? (isPrintable(a) ? String.fromCharCode(a) : '·') : ' '}</span>
                          })}
                          <span className="text-zinc-700 mx-0.5">│</span>
                          {bytesA.slice(8).map((a, i) => {
                            const b = bytesB[i + 8]
                            const cls = a === undefined ? 'text-zinc-800' : a !== b ? 'text-red-400' : 'text-green-500/60'
                            return <span key={i+8} className={cls}>{a !== undefined ? (isPrintable(a) ? String.fromCharCode(a) : '·') : ' '}</span>
                          })}
                        </td>

                        {/* Column separator */}
                        <td className="px-3 border-l-2 border-[#30363d]" />

                        {/* File B first 8 */}
                        {Array.from({ length: 8 }, (_, i) => {
                          const a = bytesA[i]; const b = bytesB[i]
                          return (
                            <td key={`b${i}`} className="px-0 py-0.5 text-center select-none">
                              {b !== undefined
                                ? <span className={`inline-block w-6 rounded ${cmpClassB(a, b)}`}>{toHex(b)}</span>
                                : <span className="inline-block w-6 text-zinc-800">──</span>}
                            </td>
                          )
                        })}
                        <td className="border-r border-[#30363d] w-2" />
                        {/* File B second 8 */}
                        {Array.from({ length: 8 }, (_, i) => {
                          const col = i + 8; const a = bytesA[col]; const b = bytesB[col]
                          return (
                            <td key={`b${col}`} className="px-0 py-0.5 text-center select-none">
                              {b !== undefined
                                ? <span className={`inline-block w-6 rounded ${cmpClassB(a, b)}`}>{toHex(b)}</span>
                                : <span className="inline-block w-6 text-zinc-800">──</span>}
                            </td>
                          )
                        })}

                        {/* ASCII B */}
                        <td className="px-2 py-0.5 whitespace-pre select-none">
                          {bytesB.slice(0, 8).map((b, i) => {
                            const a = bytesA[i]
                            const cls = b === undefined ? 'text-zinc-800' : a !== b ? 'text-blue-400' : 'text-green-500/60'
                            return <span key={i} className={cls}>{b !== undefined ? (isPrintable(b) ? String.fromCharCode(b) : '·') : ' '}</span>
                          })}
                          <span className="text-zinc-700 mx-0.5">│</span>
                          {bytesB.slice(8).map((b, i) => {
                            const a = bytesA[i + 8]
                            const cls = b === undefined ? 'text-zinc-800' : a !== b ? 'text-blue-400' : 'text-green-500/60'
                            return <span key={i+8} className={cls}>{b !== undefined ? (isPrintable(b) ? String.fromCharCode(b) : '·') : ' '}</span>
                          })}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {totalPages > 1 && pagination}
            </div>
          )}

          {/* Compare status bar */}
          <div className="shrink-0 flex items-center gap-6 px-3 py-1 border-t border-[#30363d] bg-[#161b22] mono text-[11px] text-zinc-600 select-none">
            <span><span className="w-2 h-2 inline-block rounded-sm bg-red-500 mr-1" /><span className="text-zinc-400">{fileName}</span></span>
            <span><span className="w-2 h-2 inline-block rounded-sm bg-blue-500 mr-1" /><span className="text-zinc-400">{cmpFileName || '—'}</span></span>
            {cmpData && (
              <>
                <span className={diffCount === 0 ? 'text-green-400' : 'text-red-400'}>
                  {diffCount === 0 ? 'Files are identical' : `${diffCount.toLocaleString()} bytes differ`}
                </span>
                <span>Size diff: <span className="text-zinc-400">{(cmpTotalBytes - totalBytes > 0 ? '+' : '')}{(cmpTotalBytes - totalBytes).toLocaleString()} B</span></span>
              </>
            )}
            <span className="ml-auto">{activeTotalBytes.toLocaleString()} bytes</span>
          </div>
        </div>

      ) : (
        /* ── Editor view ── */
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div
            ref={editorRef}
            className="flex-1 overflow-auto outline-none"
            tabIndex={0}
            onKeyDown={handleKeyDown}
          >
            <table className="mono text-xs w-full border-collapse">
              <thead className="sticky top-0 z-10 bg-[#161b22] border-b border-[#30363d]">
                <tr>
                  <th className="px-3 py-1.5 text-left text-blue-500/70 font-normal w-28">Offset</th>
                  {Array.from({ length: 8 }, (_, i) => (
                    <th key={i} className="px-0 py-1.5 text-center text-zinc-600 font-normal w-7">
                      {toHex(i, 2)}
                    </th>
                  ))}
                  <th className="px-2 py-1.5 text-zinc-700 font-normal w-4" />
                  {Array.from({ length: 8 }, (_, i) => (
                    <th key={i + 8} className="px-0 py-1.5 text-center text-zinc-600 font-normal w-7">
                      {toHex(i + 8, 2)}
                    </th>
                  ))}
                  <th className="px-3 py-1.5 text-left text-green-600/70 font-normal">ASCII</th>
                </tr>
              </thead>
              <tbody>
                {editorRows.map(({ offset, bytes }) => (
                  <tr key={offset} className="hover:bg-[#0f1117] border-b border-[#21262d]/30">
                    <td className="px-3 py-0.5 text-blue-400 whitespace-nowrap select-none">
                      {toHex(offset, 8)}
                    </td>
                    {Array.from({ length: 8 }, (_, i) => {
                      const abs = offset + i; const b = bytes[i]
                      const isCursor = abs === cursor
                      const isModified = original ? b !== original[abs] : false
                      return b !== undefined ? (
                        <td key={i} className="px-0 py-0.5 text-center select-none">
                          <span
                            className={`inline-block w-6 rounded cursor-pointer transition-colors ${
                              isCursor ? 'bg-blue-600 text-white'
                              : isModified ? 'bg-amber-500/10 ' + byteClass(b, true)
                              : byteClass(b, false) + ' hover:bg-[#21262d]'
                            }`}
                            onClick={() => cellClick(abs)}
                          >
                            {isCursor && editBuf ? editBuf + '_' : toHex(b)}
                          </span>
                        </td>
                      ) : <td key={i} />
                    })}
                    <td className="border-r border-[#30363d] w-2" />
                    {Array.from({ length: 8 }, (_, i) => {
                      const col = i + 8; const abs = offset + col; const b = bytes[col]
                      const isCursor = abs === cursor
                      const isModified = original ? b !== original[abs] : false
                      return b !== undefined ? (
                        <td key={col} className="px-0 py-0.5 text-center select-none">
                          <span
                            className={`inline-block w-6 rounded cursor-pointer transition-colors ${
                              isCursor ? 'bg-blue-600 text-white'
                              : isModified ? 'bg-amber-500/10 ' + byteClass(b, true)
                              : byteClass(b, false) + ' hover:bg-[#21262d]'
                            }`}
                            onClick={() => cellClick(abs)}
                          >
                            {isCursor && editBuf ? editBuf + '_' : toHex(b)}
                          </span>
                        </td>
                      ) : <td key={col} />
                    })}
                    <td className="px-3 py-0.5 text-green-500/80 whitespace-pre select-none tracking-wider">
                      {bytes.slice(0, 8).map((b, i) => {
                        const abs = offset + i
                        return (
                          <span key={i} className={`cursor-pointer ${abs === cursor ? 'bg-blue-600 text-white rounded' : 'hover:text-green-300'}`}
                            onClick={() => cellClick(abs)}>
                            {isPrintable(b) ? String.fromCharCode(b) : '·'}
                          </span>
                        )
                      })}
                      <span className="text-zinc-700 mx-0.5">│</span>
                      {bytes.slice(8).map((b, i) => {
                        const abs = offset + 8 + i
                        return (
                          <span key={i + 8} className={`cursor-pointer ${abs === cursor ? 'bg-blue-600 text-white rounded' : 'hover:text-green-300'}`}
                            onClick={() => cellClick(abs)}>
                            {isPrintable(b) ? String.fromCharCode(b) : '·'}
                          </span>
                        )
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {totalPages > 1 && pagination}
          </div>

          {/* Status bar */}
          <div className="shrink-0 flex items-center gap-6 px-3 py-1 border-t border-[#30363d] bg-[#161b22] mono text-[11px] text-zinc-600 select-none">
            {cursor !== null && data ? (
              <>
                <span>Offset <span className="text-blue-400">{toHex(cursor, 8)}</span> <span className="text-zinc-700">({cursor})</span></span>
                <span>Hex <span className="text-zinc-300">{toHex(data[cursor])}</span></span>
                <span>Dec <span className="text-zinc-300">{data[cursor]}</span></span>
                <span>Oct <span className="text-zinc-300">{data[cursor].toString(8).padStart(3, '0')}</span></span>
                <span>Bin <span className="text-zinc-300">{data[cursor].toString(2).padStart(8, '0')}</span></span>
                {isPrintable(data[cursor]) && <span>Char <span className="text-green-400">'{String.fromCharCode(data[cursor])}'</span></span>}
                {original && data[cursor] !== original[cursor] && (
                  <span className="text-amber-400">was {toHex(original[cursor])}</span>
                )}
              </>
            ) : (
              <span>Click a byte to select · Arrow keys navigate · Type hex to edit · Tab/Enter advance</span>
            )}
            <span className="ml-auto">{totalBytes.toLocaleString()} bytes</span>
          </div>
        </div>
      )}
    </div>
  )
}
