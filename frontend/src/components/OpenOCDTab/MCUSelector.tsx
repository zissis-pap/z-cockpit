import { useState, useMemo } from 'react'
import { MCU_MANUFACTURERS } from '../../data/mcuConfigs'

interface Props {
  selectedConfig: string
  onSelect: (config: string, name: string) => void
}

export default function MCUSelector({ selectedConfig, onSelect }: Props) {
  const [search, setSearch] = useState('')
  const [customConfig, setCustomConfig] = useState('')

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return MCU_MANUFACTURERS
    return MCU_MANUFACTURERS
      .map(mfr => ({
        ...mfr,
        targets: mfr.targets.filter(t =>
          t.name.toLowerCase().includes(q) || mfr.name.toLowerCase().includes(q)
        ),
      }))
      .filter(mfr => mfr.targets.length > 0)
  }, [search])

  function applyCustom() {
    if (customConfig.trim()) onSelect(customConfig.trim(), 'Custom')
  }

  return (
    <div className="panel flex flex-col min-h-0">
      <div className="panel-header">MCU Target</div>

      {/* Selected config display */}
      <div className="px-3 py-2 border-b border-[#30363d]">
        <div className="text-xs text-zinc-500 mb-0.5">Selected</div>
        <div className="mono text-xs text-blue-400 truncate" title={selectedConfig}>
          {selectedConfig || '—'}
        </div>
      </div>

      {/* Search */}
      <div className="px-2 py-1.5 border-b border-[#30363d]">
        <input
          className="input w-full text-xs"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search targets…"
        />
      </div>

      {/* Flat list grouped by manufacturer */}
      <div className="flex-1 overflow-y-auto text-xs min-h-0">
        {filtered.map(mfr => (
          <div key={mfr.name}>
            <div className="px-3 py-1 text-zinc-600 font-semibold uppercase tracking-wider text-[10px] bg-[#0f1117] sticky top-0">
              {mfr.name}
            </div>
            {mfr.targets.map(t => (
              <button
                key={t.config + t.name}
                onClick={() => onSelect(t.config, t.name)}
                className={`w-full text-left px-4 py-1.5 hover:bg-[#21262d] transition-colors
                  ${selectedConfig === t.config ? 'text-blue-400 bg-blue-500/10' : 'text-zinc-300'}`}
              >
                {t.name}
              </button>
            ))}
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="px-4 py-3 text-zinc-600 text-xs italic">No targets match "{search}"</div>
        )}
      </div>

      {/* Custom config */}
      <div className="p-3 border-t border-[#30363d] space-y-1.5">
        <div className="text-xs text-zinc-500">Custom Config Path</div>
        <div className="flex gap-1.5">
          <input
            className="input flex-1 mono text-xs"
            value={customConfig}
            onChange={e => setCustomConfig(e.target.value)}
            placeholder="target/custom.cfg"
            onKeyDown={e => e.key === 'Enter' && applyCustom()}
          />
          <button className="btn-ghost text-xs px-2" onClick={applyCustom}>Apply</button>
        </div>
      </div>
    </div>
  )
}
