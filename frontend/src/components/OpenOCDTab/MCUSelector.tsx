import { useState } from 'react'
import { MCU_FAMILIES } from '../../data/mcuConfigs'
import type { McuFamily, McuSeries } from '../../types'

interface Props {
  selectedConfig: string
  onSelect: (config: string, name: string) => void
}

export default function MCUSelector({ selectedConfig, onSelect }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [customConfig, setCustomConfig] = useState('')

  function toggleFamily(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function selectFamily(family: McuFamily) {
    onSelect(family.config, family.name)
  }

  function selectSeries(series: McuSeries) {
    onSelect(series.config, series.name)
  }

  function applyCustom() {
    if (customConfig.trim()) onSelect(customConfig.trim(), 'Custom')
  }

  return (
    <div className="panel flex flex-col min-h-0">
      <div className="panel-header">MCU Selector</div>

      {/* Selected config display */}
      <div className="px-3 py-2 border-b border-[#30363d]">
        <div className="text-xs text-zinc-500 mb-0.5">Selected</div>
        <div className="mono text-xs text-blue-400 truncate" title={selectedConfig}>
          {selectedConfig || '—'}
        </div>
      </div>

      {/* Family tree */}
      <div className="flex-1 overflow-y-auto text-xs">
        {MCU_FAMILIES.map(family => (
          <div key={family.id}>
            <div
              className={`flex items-center gap-1 px-3 py-1.5 cursor-pointer hover:bg-[#21262d] select-none
                ${selectedConfig === family.config ? 'text-blue-400' : 'text-zinc-300'}`}
              onClick={() => { toggleFamily(family.id); selectFamily(family) }}
            >
              <span className="text-zinc-600 w-3 text-center">
                {expanded.has(family.id) ? '▾' : '▸'}
              </span>
              <span className="font-medium">{family.name}</span>
            </div>
            {expanded.has(family.id) && family.series.map(s => (
              <div
                key={s.id}
                className={`pl-8 pr-3 py-1 cursor-pointer hover:bg-[#21262d] select-none
                  ${selectedConfig === s.config && selectedConfig !== family.config ? 'text-blue-400' : 'text-zinc-400'}`}
                onClick={() => selectSeries(s)}
              >
                {s.name}
              </div>
            ))}
          </div>
        ))}
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
