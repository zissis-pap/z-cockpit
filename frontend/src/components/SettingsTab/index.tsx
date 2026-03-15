export default function SettingsTab() {
  return (
    <div className="flex flex-col h-full p-6 overflow-y-auto">
      <div className="max-w-2xl mx-auto w-full space-y-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-200">Settings</h2>
          <p className="text-xs text-zinc-500 mt-0.5">Application preferences and configuration.</p>
        </div>

        <div className="panel p-6 flex flex-col items-center justify-center text-center gap-3 min-h-[200px]">
          <svg viewBox="0 0 24 24" className="w-10 h-10 text-zinc-700" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
          </svg>
          <div>
            <div className="text-zinc-400 font-medium">Coming soon</div>
            <div className="text-zinc-600 text-xs mt-1">
              Settings will be implemented here — theme, defaults, OpenOCD paths, and more.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
