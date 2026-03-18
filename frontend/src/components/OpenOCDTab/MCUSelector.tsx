import { MCU_MANUFACTURERS } from '../../data/mcuConfigs'

interface Props {
  selectedConfig: string
  onSelect: (config: string, name: string) => void
}

export default function MCUSelector({ selectedConfig, onSelect }: Props) {
  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const config = e.target.value
    if (!config) return
    for (const mfr of MCU_MANUFACTURERS) {
      const t = mfr.targets.find(t => t.config === config)
      if (t) { onSelect(t.config, t.name); return }
    }
  }

  return (
    <div className="panel">
      <div className="panel-header">MCU Target</div>
      <div className="p-3 space-y-2">
        <select
          className="input w-full text-xs mono"
          value={selectedConfig}
          onChange={handleChange}
        >
          <option value="">— Select target —</option>
          {MCU_MANUFACTURERS.map(mfr => (
            <optgroup key={mfr.name} label={mfr.name}>
              {mfr.targets.map(t => (
                <option key={t.config} value={t.config}>{t.name}</option>
              ))}
            </optgroup>
          ))}
        </select>

        {/* Custom config */}
        <div className="space-y-1">
          <div className="text-xs text-zinc-500">Custom Config Path</div>
          <div className="flex gap-1.5">
            <input
              className="input flex-1 mono text-xs"
              placeholder="target/custom.cfg"
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const v = (e.target as HTMLInputElement).value.trim()
                  if (v) onSelect(v, 'Custom')
                }
              }}
            />
            <button
              className="btn-ghost text-xs px-2"
              onClick={e => {
                const input = (e.currentTarget.previousElementSibling as HTMLInputElement)
                if (input?.value.trim()) onSelect(input.value.trim(), 'Custom')
              }}
            >Apply</button>
          </div>
        </div>

        {selectedConfig && (
          <div className="mono text-[10px] text-blue-400/70 truncate" title={selectedConfig}>
            {selectedConfig}
          </div>
        )}
      </div>
    </div>
  )
}
