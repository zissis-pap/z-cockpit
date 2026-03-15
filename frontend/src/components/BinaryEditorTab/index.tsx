import { useState, useRef, useEffect, useCallback } from 'react'

const BYTES_PER_ROW = 16
const ROWS_PER_PAGE = 512  // 8 192 bytes per page

function toHex(n: number, pad = 2) {
  return n.toString(16).toUpperCase().padStart(pad, '0')
}

function isPrintable(b: number) {
  return b >= 0x20 && b < 0x7f
}

export default function BinaryEditorTab() {
  const [data, setData]           = useState<Uint8Array | null>(null)
  const [fileName, setFileName]   = useState('')
  const [cursor, setCursor]       = useState<number | null>(null)
  const [editBuf, setEditBuf]     = useState('')   // partial hex input (0 or 1 char)
  const [page, setPage]           = useState(0)
  const [modified, setModified]   = useState(false)
  const [jumpInput, setJumpInput] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const editorRef    = useRef<HTMLDivElement>(null)

  const totalBytes = data?.length ?? 0
  const totalRows  = Math.ceil(totalBytes / BYTES_PER_ROW)
  const totalPages = Math.max(1, Math.ceil(totalRows / ROWS_PER_PAGE))
  const pageStart  = page * ROWS_PER_PAGE * BYTES_PER_ROW
  const pageEnd    = Math.min(pageStart + ROWS_PER_PAGE * BYTES_PER_ROW, totalBytes)

  // ── File I/O ──────────────────────────────────────────────────────────────

  function openFile(file: File) {
    const reader = new FileReader()
    reader.onload = e => {
      setData(new Uint8Array(e.target!.result as ArrayBuffer))
      setFileName(file.name)
      setCursor(null)
      setEditBuf('')
      setPage(0)
      setModified(false)
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
    setModified(false)
  }

  // ── Editing ───────────────────────────────────────────────────────────────

  function setByte(offset: number, value: number) {
    if (!data) return
    const next = new Uint8Array(data)
    next[offset] = value
    setData(next)
    setModified(true)
  }

  const moveCursor = useCallback((next: number) => {
    if (!data || next < 0 || next >= data.length) return
    setCursor(next)
    setEditBuf('')
    // Switch page if needed
    const nextPage = Math.floor(next / (ROWS_PER_PAGE * BYTES_PER_ROW))
    setPage(nextPage)
  }, [data])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (cursor === null || !data) return
    const hexChars = '0123456789ABCDEFabcdef'

    if (hexChars.includes(e.key)) {
      e.preventDefault()
      const buf = editBuf + e.key.toUpperCase()
      if (buf.length === 2) {
        setByte(cursor, parseInt(buf, 16))
        setEditBuf('')
        moveCursor(cursor + 1)
      } else {
        setEditBuf(buf)
      }
    } else if (e.key === 'Backspace') {
      e.preventDefault()
      if (editBuf) setEditBuf('')
      else moveCursor(cursor - 1)
    } else if (e.key === 'ArrowRight') { e.preventDefault(); moveCursor(cursor + 1) }
    else if (e.key === 'ArrowLeft')    { e.preventDefault(); moveCursor(cursor - 1) }
    else if (e.key === 'ArrowDown')    { e.preventDefault(); moveCursor(cursor + BYTES_PER_ROW) }
    else if (e.key === 'ArrowUp')      { e.preventDefault(); moveCursor(cursor - BYTES_PER_ROW) }
    else if (e.key === 'Home')         { e.preventDefault(); moveCursor(cursor - (cursor % BYTES_PER_ROW)) }
    else if (e.key === 'End')          { e.preventDefault(); moveCursor(cursor - (cursor % BYTES_PER_ROW) + BYTES_PER_ROW - 1) }
    else if (e.key === 'Enter')        { e.preventDefault(); moveCursor(cursor + BYTES_PER_ROW) }
    else if (e.key === 'Tab')          { e.preventDefault(); moveCursor(cursor + (e.shiftKey ? -1 : 1)) }
  }

  function handleAsciiKey(e: React.KeyboardEvent, offset: number) {
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      setByte(offset, e.key.charCodeAt(0))
      moveCursor(offset + 1)
    }
  }

  function jumpToOffset() {
    const off = parseInt(jumpInput, 16)
    if (!isNaN(off) && data && off < data.length) moveCursor(off)
    setJumpInput('')
  }

  // Keep editor focused when cursor moves
  useEffect(() => { editorRef.current?.focus() }, [cursor])

  // ── Rows for current page ─────────────────────────────────────────────────

  const rows: { offset: number; bytes: number[] }[] = []
  if (data) {
    for (let off = pageStart; off < pageEnd; off += BYTES_PER_ROW) {
      rows.push({
        offset: off,
        bytes: Array.from(data.slice(off, Math.min(off + BYTES_PER_ROW, totalBytes))),
      })
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-[#21262d] flex-wrap">
        <input type="file" ref={fileInputRef} className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) openFile(f); e.target.value = '' }} />
        <button className="btn-primary text-xs py-1 px-3" onClick={() => fileInputRef.current?.click()}>
          Open File
        </button>

        {data && (
          <>
            <span className="text-sm text-zinc-300 font-medium mono truncate max-w-xs" title={fileName}>{fileName}</span>
            <span className="text-xs text-zinc-600">{totalBytes.toLocaleString()} bytes</span>
            {modified && <span className="text-xs text-amber-400">● modified</span>}

            {/* Jump to offset */}
            <div className="flex items-center gap-1 ml-2">
              <span className="text-xs text-zinc-600">Jump:</span>
              <input
                className="input w-24 text-xs mono py-1"
                placeholder="0x0000"
                value={jumpInput}
                onChange={e => setJumpInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && jumpToOffset()}
              />
              <button className="btn-ghost text-xs py-1 px-2" onClick={jumpToOffset}>→</button>
            </div>

            <div className="ml-auto flex gap-2">
              <button className="btn-primary text-xs py-1 px-3" onClick={saveFile}>
                Save / Download
              </button>
            </div>
          </>
        )}
      </div>

      {/* Drop zone or editor */}
      {!data ? (
        <div
          className="flex-1 flex flex-col items-center justify-center gap-4 cursor-pointer select-none"
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) openFile(f) }}
          onDragOver={e => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
        >
          <svg viewBox="0 0 24 24" className="w-14 h-14 text-zinc-700" fill="none" stroke="currentColor" strokeWidth="1.25">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <path d="M3 9h18M9 21V9"/>
            <path d="M7 6h.01M5 6h.01"/>
          </svg>
          <div className="text-center">
            <div className="text-zinc-400 font-medium">Drop a binary file here</div>
            <div className="text-zinc-600 text-xs mt-1">or click to browse</div>
          </div>
        </div>
      ) : (
        <div
          ref={editorRef}
          className="flex-1 overflow-auto outline-none p-3"
          tabIndex={0}
          onKeyDown={handleKeyDown}
        >
          {/* Column headers */}
          <div className="mono text-[11px] text-zinc-700 flex mb-1 select-none sticky top-0 bg-[#0a0c10] pb-1 z-10">
            <span className="w-[4.5rem] shrink-0 pr-3">Offset</span>
            <span className="flex gap-0">
              {Array.from({ length: BYTES_PER_ROW }, (_, i) => (
                <span key={i} className={`w-[1.625rem] text-center ${i === 8 ? 'ml-2' : ''}`}>
                  {toHex(i, 2)}
                </span>
              ))}
            </span>
            <span className="ml-4">ASCII</span>
          </div>

          {/* Data rows */}
          {rows.map(({ offset, bytes }) => (
            <div key={offset} className="mono text-[11px] flex hover:bg-[#0f1117] leading-5">

              {/* Offset */}
              <span className="w-[4.5rem] shrink-0 pr-3 text-zinc-600 select-none">{toHex(offset, 8)}</span>

              {/* Hex cells */}
              <span className="flex gap-0">
                {bytes.map((byte, i) => {
                  const abs = offset + i
                  const isCursor = abs === cursor
                  return (
                    <span
                      key={i}
                      className={`w-[1.625rem] text-center cursor-pointer rounded select-none transition-colors ${i === 8 ? 'ml-2' : ''} ${
                        isCursor
                          ? 'bg-blue-600 text-white'
                          : 'text-zinc-300 hover:bg-[#21262d]'
                      }`}
                      onClick={() => { setCursor(abs); setEditBuf(''); editorRef.current?.focus() }}
                    >
                      {isCursor && editBuf ? editBuf + '_' : toHex(byte)}
                    </span>
                  )
                })}
                {/* Padding for last row */}
                {bytes.length < BYTES_PER_ROW && Array.from({ length: BYTES_PER_ROW - bytes.length }, (_, i) => (
                  <span key={`p${i}`} className={`w-[1.625rem] ${bytes.length + i === 8 ? 'ml-2' : ''}`} />
                ))}
              </span>

              {/* ASCII */}
              <span
                className="ml-4 text-zinc-500 tracking-wide cursor-text select-none"
                onKeyDown={cursor !== null ? e => handleAsciiKey(e, cursor) : undefined}
              >
                {bytes.map((b, i) => {
                  const abs = offset + i
                  const isCursor = abs === cursor
                  return (
                    <span
                      key={i}
                      className={`cursor-pointer ${isCursor ? 'bg-blue-600 text-white rounded' : 'hover:text-zinc-200'}`}
                      onClick={() => { setCursor(abs); setEditBuf(''); editorRef.current?.focus() }}
                    >
                      {isPrintable(b) ? String.fromCharCode(b) : '·'}
                    </span>
                  )
                })}
              </span>
            </div>
          ))}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center gap-3 mt-4 pt-3 border-t border-[#21262d] text-xs text-zinc-500 select-none">
              <button className="btn-ghost py-1 px-2.5" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>← Prev</button>
              <span className="mono">
                Page {page + 1}/{totalPages} &nbsp;·&nbsp; {toHex(pageStart, 8)}–{toHex(pageEnd - 1, 8)}
              </span>
              <button className="btn-ghost py-1 px-2.5" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}>Next →</button>
            </div>
          )}

          {/* Status bar */}
          {cursor !== null && (
            <div className="sticky bottom-0 mt-2 flex items-center gap-4 text-[11px] text-zinc-600 mono bg-[#0a0c10] pt-1 border-t border-[#21262d] select-none">
              <span>Offset: <span className="text-zinc-400">{toHex(cursor, 8)}</span> ({cursor})</span>
              <span>Value: <span className="text-zinc-400">{toHex(data[cursor])} ({data[cursor]})</span></span>
              {isPrintable(data[cursor]) && <span>Char: <span className="text-zinc-400">'{String.fromCharCode(data[cursor])}'</span></span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
