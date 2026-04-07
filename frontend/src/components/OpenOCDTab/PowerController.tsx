import { useState, useEffect } from 'react'
import { power, type PowerConfig } from '../../api/client'

export default function PowerController() {
  const [cfg, setCfg] = useState<PowerConfig | null>(null)
  const [publishing, setPublishing] = useState<string | null>(null)
  const [lastSent, setLastSent] = useState<Record<number, 'ON' | 'OFF'>>({})
  const [error, setError] = useState('')

  useEffect(() => {
    power.getConfig().then(r => { if (r.ok) setCfg(r.config) }).catch(() => {})
  }, [])

  async function send(switchNum: number, status: 'ON' | 'OFF') {
    setPublishing(`${switchNum}-${status}`)
    setError('')
    try {
      const r = await power.publish(switchNum, status)
      if (!r.ok) setError(r.error ?? 'Failed')
      else setLastSent(prev => ({ ...prev, [switchNum]: status }))
    } catch (e) {
      setError(String(e))
    } finally {
      setPublishing(null)
    }
  }

  if (!cfg || !cfg.host || !cfg.topic) return null

  const switches = Array.from({ length: cfg.num_switches }, (_, i) => i + 1)

  function btnClass(n: number, status: 'ON' | 'OFF') {
    const isLast = lastSent[n] === status
    const isPublishing = publishing === `${n}-${status}`
    if (status === 'ON') {
      return isLast
        ? 'flex-1 text-xs py-1 btn border border-green-600/50 bg-green-900/30 text-green-300'
        : 'flex-1 btn-ghost text-xs py-1 text-green-400 hover:text-green-300 hover:bg-green-900/20'
    }
    return isLast
      ? 'flex-1 text-xs py-1 btn border border-red-600/50 bg-red-900/30 text-red-300'
      : 'flex-1 btn-ghost text-xs py-1 text-red-400 hover:text-red-300 hover:bg-red-900/20'
  }

  return (
    <div className="panel">
      <div className="panel-header">Power Controller</div>
      <div className="p-2 space-y-1.5">
        {switches.map(n => (
          <div key={n} className="flex items-center gap-1.5">
            <span className="text-xs text-zinc-400 w-16 shrink-0 truncate" title={cfg.switch_names[n - 1] || `Switch ${n}`}>
              {cfg.switch_names[n - 1] || `Switch ${n}`}
            </span>
            <button className={btnClass(n, 'ON')} disabled={publishing !== null} onClick={() => send(n, 'ON')}>
              {publishing === `${n}-ON` ? '…' : 'ON'}
            </button>
            <button className={btnClass(n, 'OFF')} disabled={publishing !== null} onClick={() => send(n, 'OFF')}>
              {publishing === `${n}-OFF` ? '…' : 'OFF'}
            </button>
          </div>
        ))}
        {cfg.num_switches > 1 && (
          <div className="flex gap-1.5 pt-1 border-t border-[#21262d]">
            <button
              className="flex-1 btn-ghost text-xs py-1 text-green-400 hover:text-green-300 hover:bg-green-900/20"
              disabled={publishing !== null}
              onClick={async () => { for (const n of switches) await send(n, 'ON') }}
            >
              All ON
            </button>
            <button
              className="flex-1 btn-ghost text-xs py-1 text-red-400 hover:text-red-300 hover:bg-red-900/20"
              disabled={publishing !== null}
              onClick={async () => { for (const n of switches) await send(n, 'OFF') }}
            >
              All OFF
            </button>
          </div>
        )}
        {error && <div className="text-xs text-red-400 mono truncate">{error}</div>}
      </div>
    </div>
  )
}
