import { useState, useCallback, useEffect } from 'react'

type Format = 'ascii' | 'hex' | 'binary' | 'decimal' | 'base64'

interface FieldState {
  value: string
  error: boolean
}

const FIELDS: { id: Format; label: string; placeholder: string; mono?: boolean }[] = [
  { id: 'ascii',   label: 'ASCII / UTF-8', placeholder: 'Hello, World!', mono: false },
  { id: 'hex',     label: 'Hexadecimal',   placeholder: '48 65 6C 6C 6F',  mono: true },
  { id: 'binary',  label: 'Binary',        placeholder: '01001000 01100101 …', mono: true },
  { id: 'decimal', label: 'Decimal (space-separated bytes)', placeholder: '72 101 108 108 111', mono: true },
  { id: 'base64',  label: 'Base64',        placeholder: 'SGVsbG8sIFdvcmxkIQ==', mono: true },
]

function encode(bytes: Uint8Array): Record<Format, string> {
  const ascii = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
  const binary = Array.from(bytes).map(b => b.toString(2).padStart(8, '0')).join(' ')
  const decimal = Array.from(bytes).join(' ')
  const base64 = btoa(String.fromCharCode(...bytes))
  return { ascii, hex, binary, decimal, base64 }
}

function decode(format: Format, value: string): Uint8Array | null {
  try {
    switch (format) {
      case 'ascii':
        return new TextEncoder().encode(value)
      case 'hex': {
        const clean = value.replace(/\s+/g, '')
        if (clean.length % 2 !== 0) return null
        const bytes = new Uint8Array(clean.length / 2)
        for (let i = 0; i < clean.length; i += 2) {
          const b = parseInt(clean.slice(i, i + 2), 16)
          if (isNaN(b)) return null
          bytes[i / 2] = b
        }
        return bytes
      }
      case 'binary': {
        const parts = value.trim().split(/\s+/)
        const bytes = new Uint8Array(parts.length)
        for (let i = 0; i < parts.length; i++) {
          const b = parseInt(parts[i], 2)
          if (isNaN(b) || parts[i].length > 8) return null
          bytes[i] = b
        }
        return bytes
      }
      case 'decimal': {
        const parts = value.trim().split(/\s+/)
        const bytes = new Uint8Array(parts.length)
        for (let i = 0; i < parts.length; i++) {
          const b = parseInt(parts[i], 10)
          if (isNaN(b) || b < 0 || b > 255) return null
          bytes[i] = b
        }
        return bytes
      }
      case 'base64': {
        const bin = atob(value.trim())
        return new Uint8Array(bin.split('').map(c => c.charCodeAt(0)))
      }
    }
  } catch {
    return null
  }
}

const emptyFields = (): Record<Format, FieldState> => ({
  ascii:   { value: '', error: false },
  hex:     { value: '', error: false },
  binary:  { value: '', error: false },
  decimal: { value: '', error: false },
  base64:  { value: '', error: false },
})

// ── Page Calculator ───────────────────────────────────────────────────────────

function parseAddress(s: string): number | null {
  const clean = s.trim()
  if (!clean) return null
  const n = clean.toLowerCase().startsWith('0x')
    ? parseInt(clean, 16)
    : parseInt(clean, 10)
  return isNaN(n) || n < 0 ? null : n
}

function PageCalculator() {
  const [pageSizeKb, setPageSizeKb] = useState('2')
  const [baseAddr, setBaseAddr]     = useState('0x08000000')
  const [address, setAddress]       = useState('0x08000000')
  const [page, setPage]             = useState('')
  const [baseError, setBaseError]   = useState(false)
  const [addrError, setAddrError]   = useState(false)
  const [pageError, setPageError]   = useState(false)

  const pageSizeBytes = parseFloat(pageSizeKb) * 1024
  const baseNum = parseAddress(baseAddr)

  // Recalculate page from address
  function onAddressChange(val: string, base = baseNum, psb = pageSizeBytes) {
    setAddress(val)
    setAddrError(false)
    setPageError(false)
    if (!val.trim()) { setPage(''); return }
    const addr = parseAddress(val)
    if (addr === null || base === null || isNaN(psb) || psb <= 0 || addr < base) {
      setAddrError(true)
      setPage('')
      return
    }
    setPage(String(Math.floor((addr - base) / psb)))
  }

  // Recalculate address from page
  function onPageChange(val: string, base = baseNum, psb = pageSizeBytes) {
    setPage(val)
    setAddrError(false)
    setPageError(false)
    if (!val.trim()) { setAddress(baseAddr); return }
    const p = parseInt(val, 10)
    if (isNaN(p) || p < 0 || base === null || isNaN(psb) || psb <= 0) {
      setPageError(true)
      return
    }
    const addr = base + p * psb
    setAddress('0x' + addr.toString(16).toUpperCase().padStart(8, '0'))
  }

  function onBaseChange(val: string) {
    setBaseAddr(val)
    setBaseError(false)
    const base = parseAddress(val)
    if (base === null && val.trim()) { setBaseError(true); return }
    // Recompute keeping whichever side was last edited
    if (page.trim()) onPageChange(page, base, pageSizeBytes)
    else onAddressChange(address, base, pageSizeBytes)
  }

  // Recompute when page size changes
  useEffect(() => {
    if (page.trim()) onPageChange(page, baseNum, pageSizeBytes)
    else onAddressChange(address, baseNum, pageSizeBytes)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSizeKb, baseAddr])

  const addrNum = parseAddress(address)
  const pageNum = parseInt(page, 10)
  const pageStart = (baseNum !== null && !isNaN(pageNum) && pageSizeBytes > 0)
    ? baseNum + pageNum * pageSizeBytes
    : null
  const pageEnd = pageStart !== null ? pageStart + pageSizeBytes - 1 : null
  const offsetInPage = (addrNum !== null && pageStart !== null)
    ? addrNum - pageStart
    : null

  function field(label: string, value: string, onChange: (v: string) => void, error: boolean, placeholder: string, hint?: string) {
    return (
      <div>
        <label className="text-xs text-zinc-500 block mb-1">{label}</label>
        <input
          className={`input w-full mono text-sm ${error ? 'border-red-500/60 text-red-400' : ''}`}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
        />
        {hint && !error && <div className="text-xs text-zinc-600 mt-1 mono">{hint}</div>}
        {error && <div className="text-xs text-red-400 mt-1">Invalid value</div>}
      </div>
    )
  }

  return (
    <div className="panel">
      <div className="panel-header">Page Calculator</div>
      <div className="p-3 space-y-3">

        {/* Page Size */}
        <div>
          <label className="text-xs text-zinc-500 block mb-1">Page Size (KB)</label>
          <div className="flex gap-1 flex-wrap">
            {['1', '2', '4', '8', '16', '32', '64', '128', '256'].map(s => (
              <button
                key={s}
                className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                  pageSizeKb === s
                    ? 'bg-blue-600/20 border-blue-500/40 text-blue-400'
                    : 'btn-ghost'
                }`}
                onClick={() => setPageSizeKb(s)}
              >{s}</button>
            ))}
            <input
              className="input mono text-xs w-20"
              value={pageSizeKb}
              onChange={e => setPageSizeKb(e.target.value)}
              placeholder="KB"
            />
          </div>
          {!isNaN(pageSizeBytes) && pageSizeBytes > 0 && (
            <div className="text-xs text-zinc-600 mt-1 mono">{pageSizeBytes.toLocaleString()} bytes</div>
          )}
        </div>

        <div className="border-t border-[#30363d]" />

        {/* Base Address */}
        {field(
          'Base Address',
          baseAddr,
          onBaseChange,
          baseError,
          '0x08000000',
          baseNum !== null ? `decimal: ${baseNum.toLocaleString()}` : undefined
        )}

        <div className="border-t border-[#30363d]" />

        {/* Memory Address */}
        {field(
          'Memory Address',
          address,
          onAddressChange,
          addrError,
          '0x08040000 or decimal',
          addrNum !== null ? `decimal: ${addrNum.toLocaleString()}` : undefined
        )}

        {/* Page */}
        {field(
          'Page',
          page,
          onPageChange,
          pageError,
          '0',
        )}

        {/* Result summary */}
        {pageStart !== null && pageEnd !== null && !baseError && !addrError && !pageError && (
          <div className="rounded bg-[#0f1117] border border-[#30363d] p-2 space-y-1 text-xs mono">
            <div className="flex justify-between">
              <span className="text-zinc-500">Page start</span>
              <span className="text-green-400">0x{pageStart.toString(16).toUpperCase().padStart(8, '0')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Page end</span>
              <span className="text-green-400">0x{pageEnd.toString(16).toUpperCase().padStart(8, '0')}</span>
            </div>
            {offsetInPage !== null && (
              <div className="flex justify-between">
                <span className="text-zinc-500">Offset in page</span>
                <span className="text-amber-400">
                  0x{offsetInPage.toString(16).toUpperCase().padStart(4, '0')}
                  <span className="text-zinc-600 ml-1">({offsetInPage})</span>
                </span>
              </div>
            )}
          </div>
        )}

        <button
          className="btn-ghost text-xs w-full"
          onClick={() => {
            setAddress(baseAddr)
            setPage('')
            setAddrError(false)
            setPageError(false)
          }}
        >
          Clear
        </button>
      </div>
    </div>
  )
}

// ── Main tab ──────────────────────────────────────────────────────────────────

export default function ConverterTab() {
  const [fields, setFields] = useState<Record<Format, FieldState>>(emptyFields)
  const [byteCount, setByteCount] = useState<number | null>(null)

  const convert = useCallback((from: Format, value: string) => {
    if (!value.trim()) {
      setFields(emptyFields())
      setByteCount(null)
      return
    }
    const bytes = decode(from, value)
    if (!bytes) {
      setFields(prev => {
        const next = emptyFields()
        next[from] = { value, error: true }
        return next
      })
      setByteCount(null)
      return
    }
    const encoded = encode(bytes)
    const next = emptyFields()
    for (const [k, v] of Object.entries(encoded)) {
      next[k as Format] = { value: v, error: false }
    }
    next[from] = { value, error: false }
    setFields(next)
    setByteCount(bytes.length)
  }, [])

  function clear() {
    setFields(emptyFields())
    setByteCount(null)
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="flex gap-4 items-start max-w-6xl mx-auto">

        {/* ── Left column: Format Converter ── */}
        <div className="flex-1 min-w-0 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-zinc-200">Format Converter</h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                Edit any field — all others update instantly.
                {byteCount !== null && (
                  <span className="ml-2 text-blue-400">{byteCount} byte{byteCount !== 1 ? 's' : ''}</span>
                )}
              </p>
            </div>
            <button className="btn-ghost" onClick={clear}>Clear All</button>
          </div>

          {FIELDS.map(f => (
            <div key={f.id} className="panel">
              <div className="panel-header flex items-center justify-between">
                <span>{f.label}</span>
                {fields[f.id].value && (
                  <button
                    className="text-xs text-zinc-500 hover:text-zinc-300 normal-case font-normal"
                    onClick={() => navigator.clipboard.writeText(fields[f.id].value)}
                    title="Copy to clipboard"
                  >
                    Copy
                  </button>
                )}
              </div>
              <div className="p-3">
                <textarea
                  className={`w-full bg-[#0f1117] rounded border text-sm p-2 resize-none focus:outline-none
                    transition-colors min-h-[56px] max-h-40
                    ${fields[f.id].error
                      ? 'border-red-500/60 text-red-400 focus:border-red-500'
                      : 'border-[#30363d] text-zinc-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30'}
                    ${f.mono ? 'font-mono' : ''}`}
                  value={fields[f.id].value}
                  onChange={e => convert(f.id, e.target.value)}
                  placeholder={f.placeholder}
                  spellCheck={false}
                  rows={2}
                />
                {fields[f.id].error && (
                  <div className="text-xs text-red-400 mt-1">Invalid {f.label} input</div>
                )}
              </div>
            </div>
          ))}

          <div className="panel">
            <div className="panel-header">Quick Tools</div>
            <div className="p-3 flex flex-wrap gap-2">
              {[
                { label: 'NULL byte', bytes: [0x00] },
                { label: 'CR+LF',     bytes: [0x0D, 0x0A] },
                { label: 'ESC',       bytes: [0x1B] },
                { label: 'DEL',       bytes: [0x7F] },
              ].map(t => (
                <button
                  key={t.label}
                  className="btn-ghost text-xs"
                  onClick={() => {
                    const bytes = new Uint8Array(t.bytes)
                    const encoded = encode(bytes)
                    const next = emptyFields()
                    for (const [k, v] of Object.entries(encoded)) next[k as Format] = { value: v, error: false }
                    setFields(next)
                    setByteCount(bytes.length)
                  }}
                >
                  {t.label}
                </button>
              ))}
              <button
                className="btn-ghost text-xs"
                onClick={() => {
                  const bytes = new Uint8Array(256)
                  for (let i = 0; i < 256; i++) bytes[i] = i
                  const encoded = encode(bytes)
                  const next = emptyFields()
                  for (const [k, v] of Object.entries(encoded)) next[k as Format] = { value: v, error: false }
                  setFields(next)
                  setByteCount(256)
                }}
              >
                All bytes (0-255)
              </button>
            </div>
          </div>
        </div>

        {/* ── Right column: Page Calculator ── */}
        <div className="w-72 shrink-0 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-zinc-200">Page Calculator</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Address ↔ page number conversion.</p>
          </div>
          <PageCalculator />
        </div>

      </div>
    </div>
  )
}
