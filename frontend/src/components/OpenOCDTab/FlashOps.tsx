import { useState, useRef, useEffect } from 'react'
import { openocd } from '../../api/client'

interface Props {
  connected: boolean
  onLog: (text: string, level?: string) => void
  onFirmwareReady: (filename: string, data: Uint8Array, baseAddress: string) => void
}

export default function FlashOps({ connected, onLog, onFirmwareReady }: Props) {
  const [uploadedFile, setUploadedFile] = useState<string>('')
  const [uploadedSize, setUploadedSize] = useState<number>(0)
  const [baseAddress, setBaseAddress] = useState('0x08000000')
  const [localData, setLocalData] = useState<Uint8Array | null>(null)
  const [eraseSize, setEraseSize] = useState('0x20000')
  const [readAddress, setReadAddress] = useState('0x08000000')
  const [readSize, setReadSize] = useState('0x10000')
  const [progress, setProgress] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (localData && uploadedFile) {
      onFirmwareReady(uploadedFile, localData, baseAddress)
    }
  }, [baseAddress]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const res = await openocd.uploadFirmware(file) as { ok: boolean; filename: string; size: number; error?: string }
    if (res.ok) {
      setUploadedFile(res.filename)
      setUploadedSize(res.size)
      onLog(`Firmware uploaded: ${res.filename} (${res.size} bytes)`, 'info')
      const reader = new FileReader()
      reader.onload = ev => {
        const arr = new Uint8Array(ev.target!.result as ArrayBuffer)
        setLocalData(arr)
        onFirmwareReady(res.filename, arr, baseAddress)
      }
      reader.readAsArrayBuffer(file)
    } else {
      onLog(`Upload failed: ${res.error}`, 'error')
    }
  }

  async function run(label: string, fn: () => Promise<{ ok: boolean; result?: string; error?: string }>) {
    if (!connected) { onLog('Not connected to OpenOCD', 'error'); return }
    setBusy(true)
    setProgress(0)
    onLog(`▶ ${label}...`, 'info')
    try {
      const res = await fn()
      setProgress(100)
      const lvl = res.ok ? 'info' : 'error'
      onLog(`${label}: ${res.result || res.error || (res.ok ? 'OK' : 'FAILED')}`, lvl)
    } catch (e) {
      onLog(`${label} error: ${e}`, 'error')
    } finally {
      setBusy(false)
      setTimeout(() => setProgress(null), 2000)
    }
  }

  return (
    <div className="space-y-3">
      {/* Firmware file */}
      <div className="panel">
        <div className="panel-header">Firmware File</div>
        <div className="p-3 space-y-2">
          <div
            className="border border-dashed border-[#30363d] rounded p-3 text-center cursor-pointer
              hover:border-blue-500/50 hover:bg-blue-500/5 transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            {uploadedFile ? (
              <div>
                <div className="text-sm text-green-400 font-medium">{uploadedFile}</div>
                <div className="text-xs text-zinc-500">{(uploadedSize / 1024).toFixed(1)} KB</div>
              </div>
            ) : (
              <div className="text-zinc-500 text-sm">Click to select firmware (.bin / .elf / .hex)</div>
            )}
          </div>
          <input ref={fileInputRef} type="file" className="hidden"
            accept=".bin,.elf,.hex,.s19"
            onChange={handleUpload} />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-zinc-500">Base Address</label>
              <input className="input w-full mono text-xs mt-0.5" value={baseAddress}
                onChange={e => setBaseAddress(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-zinc-500">Erase Size</label>
              <input className="input w-full mono text-xs mt-0.5" value={eraseSize}
                onChange={e => setEraseSize(e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      {/* Progress */}
      {progress !== null && (
        <div className="h-1.5 bg-[#21262d] rounded overflow-hidden">
          <div className="h-full bg-blue-500 transition-all duration-300"
            style={{ width: `${progress}%` }} />
        </div>
      )}

      {/* Operation buttons */}
      <div className="panel">
        <div className="panel-header">Operations</div>
        <div className="p-3 grid grid-cols-2 gap-2">
          <button className="btn-ghost"
            disabled={busy || !connected}
            onClick={() => run('Halt', () => openocd.flash.halt() as Promise<{ ok: boolean; result?: string; error?: string }>)}>
            ⏸ Halt
          </button>
          <button className="btn-amber"
            disabled={busy || !connected}
            onClick={() => run('Erase', () => openocd.flash.erase(baseAddress, eraseSize) as Promise<{ ok: boolean; result?: string; error?: string }>)}>
            🗑 Erase
          </button>
          <button className="btn-primary col-span-2"
            disabled={busy || !connected || !uploadedFile}
            onClick={() => run('Program', () => openocd.flash.program(uploadedFile, baseAddress, true) as Promise<{ ok: boolean; result?: string; error?: string }>)}>
            ⚡ Program & Verify
          </button>
          <button className="btn-ghost"
            disabled={busy || !connected || !uploadedFile}
            onClick={() => run('Verify', () => openocd.flash.verify(uploadedFile, baseAddress) as Promise<{ ok: boolean; result?: string; error?: string }>)}>
            ✓ Verify
          </button>
          <button className="btn-success"
            disabled={busy || !connected}
            onClick={() => run('Reset & Run', () => openocd.flash.reset() as Promise<{ ok: boolean; result?: string; error?: string }>)}>
            ▶ Reset & Run
          </button>
        </div>
      </div>

      {/* Read flash */}
      <div className="panel">
        <div className="panel-header">Read Flash</div>
        <div className="p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-zinc-500">Address</label>
              <input className="input w-full mono text-xs mt-0.5" value={readAddress}
                onChange={e => setReadAddress(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-zinc-500">Size</label>
              <input className="input w-full mono text-xs mt-0.5" value={readSize}
                onChange={e => setReadSize(e.target.value)} />
            </div>
          </div>
          <button className="btn-ghost w-full"
            disabled={busy || !connected}
            onClick={async () => {
              if (!connected) return
              setBusy(true)
              const filename = 'dump.bin'
              const res = await openocd.flash.read(readAddress, readSize, filename) as { ok: boolean; result?: string; filename?: string }
              setBusy(false)
              if (res.ok && res.filename) {
                onLog(`Flash read OK → downloading ${res.filename}`, 'info')
                const a = document.createElement('a')
                a.href = openocd.flash.downloadUrl(res.filename)
                a.download = res.filename
                a.click()
              } else {
                onLog(`Flash read failed: ${res.result}`, 'error')
              }
            }}>
            ↓ Read & Download
          </button>
        </div>
      </div>
    </div>
  )
}
