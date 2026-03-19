import { useState } from 'react'
import ProjectsTab  from './components/ProjectsTab'
import OpenOCDTab   from './components/OpenOCDTab'
import SerialTab    from './components/SerialTab'
import ConverterTab    from './components/ConverterTab'
import BinaryEditorTab from './components/BinaryEditorTab'
import SettingsTab  from './components/SettingsTab'
import AboutTab     from './components/AboutTab'
import ToolsTab     from './components/ToolsTab'

function IconGit()      { return <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M6 9v12"/></svg> }
function IconCpu()      { return <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/></svg> }
function IconCable()    { return <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a1 1 0 0 1-1-1v-1a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1a1 1 0 0 1-1 1v2"/><path d="M19 15V6.5a3.5 3.5 0 0 0-7 0v11a3.5 3.5 0 0 1-7 0V9"/><path d="M7 9V7a1 1 0 0 1 1-1V4"/><path d="M5 3h4"/><path d="M21 19h-4"/></svg> }
function IconConvert()  { return <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M7 16V4m0 0L3 8m4-4 4 4"/><path d="M17 8v12m0 0 4-4m-4 4-4-4"/></svg> }
function IconBinary()   { return <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/><path d="M7 6h.01M5 6h.01"/></svg> }
function IconTools()    { return <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg> }
function IconSettings() { return <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07M8.46 8.46a5 5 0 0 0 0 7.07"/></svg> }
function IconInfo()     { return <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg> }
function IconMenu()     { return <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg> }

const MAIN_TABS = [
  { id: 'projects',  label: 'Projects',         Icon: IconGit },
  { id: 'openocd',   label: 'OpenOCD',          Icon: IconCpu },
  { id: 'serial',    label: 'Serial Terminal',  Icon: IconCable },
  { id: 'converter', label: 'Converter',        Icon: IconConvert },
  { id: 'binary',    label: 'Binary Editor',   Icon: IconBinary },
  { id: 'tools',     label: 'Tools',           Icon: IconTools },
] as const

const BOTTOM_TABS = [
  { id: 'settings', label: 'Settings', Icon: IconSettings },
  { id: 'about',    label: 'About',    Icon: IconInfo },
] as const

type TabId = typeof MAIN_TABS[number]['id'] | typeof BOTTOM_TABS[number]['id']

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('projects')
  const [expanded, setExpanded] = useState(true)

  const SIDEBAR_W = expanded ? 'w-52' : 'w-12'

  function NavItem({ id, label, Icon }: { id: TabId; label: string; Icon: () => JSX.Element }) {
    const active = activeTab === id
    return (
      <button
        onClick={() => setActiveTab(id)}
        title={!expanded ? label : undefined}
        className={`flex items-center gap-3 w-full rounded-md px-2.5 py-2 text-sm font-medium
          transition-colors duration-100 whitespace-nowrap overflow-hidden
          ${active
            ? 'bg-blue-600/20 text-blue-400 ring-1 ring-blue-600/30'
            : 'text-zinc-400 hover:bg-[#21262d] hover:text-zinc-200'}`}
      >
        <span className="shrink-0"><Icon /></span>
        {expanded && <span className="truncate">{label}</span>}
      </button>
    )
  }

  return (
    <div className="flex h-screen bg-[#0a0c10] text-zinc-200 overflow-hidden">

      {/* Sidebar */}
      <aside className={`${SIDEBAR_W} shrink-0 flex flex-col bg-[#0f1117] border-r border-[#21262d] transition-all duration-200 overflow-hidden`}>
        {/* Top: hamburger + logo */}
        <div className="flex items-center h-12 border-b border-[#21262d] shrink-0 px-2 gap-2">
          <button
            onClick={() => setExpanded(v => !v)}
            className="p-1.5 rounded hover:bg-[#21262d] text-zinc-400 hover:text-zinc-200 transition-colors shrink-0"
            title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            <IconMenu />
          </button>
          {expanded && (
            <span className="text-sm font-semibold text-zinc-200 tracking-tight whitespace-nowrap">Z-Cockpit</span>
          )}
        </div>

        {/* Main nav */}
        <nav className="flex-1 flex flex-col gap-0.5 p-2 overflow-hidden">
          {MAIN_TABS.map(t => <NavItem key={t.id} id={t.id} label={t.label} Icon={t.Icon} />)}
        </nav>

        {/* Bottom nav */}
        <div className="flex flex-col gap-0.5 p-2 border-t border-[#21262d]">
          {BOTTOM_TABS.map(t => <NavItem key={t.id} id={t.id} label={t.label} Icon={t.Icon} />)}
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-hidden">
        <div className={activeTab === 'projects' ? 'h-full' : 'hidden'}><ProjectsTab /></div>
        <div className={activeTab === 'openocd' ? 'h-full' : 'hidden'}><OpenOCDTab /></div>
        <div className={activeTab === 'serial' ? 'h-full' : 'hidden'}><SerialTab /></div>
        <div className={activeTab === 'converter' ? 'h-full' : 'hidden'}><ConverterTab /></div>
        <div className={activeTab === 'binary' ? 'h-full' : 'hidden'}><BinaryEditorTab /></div>
        <div className={activeTab === 'tools' ? 'h-full' : 'hidden'}><ToolsTab /></div>
        {activeTab === 'settings'  && <SettingsTab />}
        {activeTab === 'about'     && <AboutTab />}
      </main>
    </div>
  )
}
