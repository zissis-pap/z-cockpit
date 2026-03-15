import { useState, useCallback } from 'react'

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
      // Mark source field as error, clear others
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
    <div className="flex flex-col h-full p-4 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full space-y-4">

        {/* Header */}
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

        {/* Converter fields */}
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

        {/* Extra tools section */}
        <div className="panel">
          <div className="panel-header">Quick Tools</div>
          <div className="p-3 flex flex-wrap gap-2">
            {[
              { label: 'NULL byte',    bytes: [0x00] },
              { label: 'CR+LF',        bytes: [0x0D, 0x0A] },
              { label: 'ESC',          bytes: [0x1B] },
              { label: 'DEL',          bytes: [0x7F] },
            ].map(t => (
              <button
                key={t.label}
                className="btn-ghost text-xs"
                onClick={() => {
                  const bytes = new Uint8Array(t.bytes)
                  const encoded = encode(bytes)
                  const next = emptyFields()
                  for (const [k, v] of Object.entries(encoded)) {
                    next[k as Format] = { value: v, error: false }
                  }
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
                for (const [k, v] of Object.entries(encoded)) {
                  next[k as Format] = { value: v, error: false }
                }
                setFields(next)
                setByteCount(256)
              }}
            >
              All bytes (0-255)
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
