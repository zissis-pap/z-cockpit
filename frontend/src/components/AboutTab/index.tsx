declare const __APP_VERSION__: string

const STACK = [
  { name: 'FastAPI',      desc: 'Async Python backend & WebSocket server' },
  { name: 'React 18',     desc: 'Frontend UI framework' },
  { name: 'TypeScript',   desc: 'Type-safe frontend code' },
  { name: 'Vite',         desc: 'Frontend build tool & dev server' },
  { name: 'Tailwind CSS', desc: 'Utility-first styling' },
  { name: 'pyserial',     desc: 'Serial port communication' },
  { name: 'OpenOCD',      desc: 'On-chip debugger (external, system package)' },
]

const FEATURES = [
  'OpenOCD server control with async telnet command interface',
  'STM32 MCU selector (F0 → WL, 17 families)',
  'Flash programming, verification, erase, and memory dump',
  'Live hex memory viewer with auto-refresh',
  'Interactive TCL console + script editor',
  'Serial terminal (ASCII/Hex, configurable line endings & framing)',
  'Real-time format converter: ASCII ↔ Hex ↔ Binary ↔ Decimal ↔ Base64',
]

export default function AboutTab() {
  const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.000'

  return (
    <div className="flex flex-col h-full p-6 overflow-y-auto">
      <div className="max-w-2xl mx-auto w-full space-y-5">

        {/* Header */}
        <div className="panel p-6 flex items-center gap-5">
          <div className="shrink-0 w-14 h-14 rounded-xl bg-blue-600/10 ring-1 ring-blue-500/30 flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="4" y="4" width="16" height="16" rx="2"/>
              <rect x="9" y="9" width="6" height="6"/>
              <path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/>
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-zinc-100 tracking-tight">Z-Cockpit</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="mono text-sm text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded border border-blue-400/20">
                v{version}
              </span>
              <span className="text-xs text-zinc-500">Embedded developer toolkit</span>
            </div>
          </div>
        </div>

        {/* Description */}
        <div className="panel">
          <div className="panel-header">About</div>
          <div className="p-4 text-sm text-zinc-400 leading-relaxed">
            Z-Cockpit is a modern web-based cockpit for embedded systems development.
            It provides a unified GUI for common developer tools — starting with OpenOCD
            and serial communication — accessible from any browser on your network.
          </div>
        </div>

        {/* Features */}
        <div className="panel">
          <div className="panel-header">Features</div>
          <ul className="p-4 space-y-1.5">
            {FEATURES.map(f => (
              <li key={f} className="flex items-start gap-2 text-sm text-zinc-400">
                <span className="text-blue-500 mt-0.5 shrink-0">▸</span>
                {f}
              </li>
            ))}
          </ul>
        </div>

        {/* Tech stack */}
        <div className="panel">
          <div className="panel-header">Tech Stack</div>
          <div className="divide-y divide-[#21262d]">
            {STACK.map(s => (
              <div key={s.name} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-sm font-medium text-zinc-300">{s.name}</span>
                <span className="text-xs text-zinc-500">{s.desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Version note */}
        <div className="text-center text-xs text-zinc-700 pb-2">
          Version increments automatically with each git commit.
        </div>
      </div>
    </div>
  )
}
