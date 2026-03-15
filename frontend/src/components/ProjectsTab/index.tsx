import { useState, useEffect, useCallback, useRef } from 'react'
import type { GitRepo, RepoStatus, LogEntry, Platform } from '../../types'
import { projects as projectsApi } from '../../api/client'
import { useWebSocket } from '../../hooks/useWebSocket'
import RepoCard from './RepoCard'

let logSeq = 0

// repo_key format from backend: "{account_id}/{repo_name}"
function repoKey(repo: GitRepo) { return `${repo.account_id}/${repo.name}` }

const PLATFORM_LABEL: Record<Platform, string> = { github: 'GitHub', bitbucket: 'Bitbucket' }

export default function ProjectsTab() {
  const [repos, setRepos] = useState<GitRepo[]>([])
  const [loading, setLoading] = useState(false)
  const [notConfigured, setNotConfigured] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'cloned' | 'changes' | 'behind'>('all')
  const [busyRepos, setBusyRepos] = useState<Set<string>>(new Set())
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [logCollapsed, setLogCollapsed] = useState(false)
  const logBottomRef = useRef<HTMLDivElement>(null)
  const logContainerRef = useRef<HTMLDivElement>(null)

  const addLog = useCallback((text: string, level = 'info') => {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false })
    setLogs(prev => [...prev.slice(-1000), { id: logSeq++, text, level: level as LogEntry['level'], timestamp: ts }])
  }, [])

  const refreshRepoStatus = useCallback(async (key: string) => {
    // key is "{account_id}/{repo_name}"
    const slash = key.indexOf('/')
    if (slash < 0) return
    const accountId = key.slice(0, slash)
    const name = key.slice(slash + 1)
    try {
      const res = await projectsApi.status(accountId, name)
      if (res.ok) {
        setRepos(prev => prev.map(r =>
          repoKey(r) === key
            ? { ...r, status: res.status as RepoStatus, local_path: res.local_path ?? r.local_path, behind: res.behind }
            : r
        ))
      }
    } catch { /* ignore */ }
  }, [])

  const handleWsMessage = useCallback((data: unknown) => {
    const msg = data as { type: string; text?: string; level?: string; repo?: string; op?: string; ok?: boolean }
    if (msg.type === 'log') {
      addLog(`[${msg.repo ?? ''}] ${msg.text ?? ''}`, msg.level ?? 'info')
    } else if (msg.type === 'op_start') {
      setBusyRepos(prev => new Set(prev).add(msg.repo ?? ''))
      addLog(`▶ ${msg.op} ${msg.repo}`, 'info')
    } else if (msg.type === 'op_done') {
      setBusyRepos(prev => { const s = new Set(prev); s.delete(msg.repo ?? ''); return s })
      addLog(`${msg.ok ? '✓' : '✗'} ${msg.op} ${msg.repo}`, msg.ok ? 'info' : 'error')
      if (msg.repo) refreshRepoStatus(msg.repo)
    }
  }, [addLog, refreshRepoStatus])

  useWebSocket('/ws/projects', handleWsMessage)

  useEffect(() => {
    const el = logContainerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    if (atBottom) logBottomRef.current?.scrollIntoView({ block: 'end' })
  }, [logs])

  async function loadRepos() {
    setLoading(true)
    setNotConfigured(false)
    try {
      const res = await projectsApi.repos()
      if (!res.ok && res.error === 'not_configured') {
        setNotConfigured(true)
        setRepos([])
      } else if (res.ok) {
        setRepos(res.repos)
      }
    } catch (e) {
      addLog(`Failed to load repos: ${e}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadRepos() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleAction(repo: GitRepo, action: 'clone' | 'pull' | 'fetch') {
    if (action === 'clone') projectsApi.clone(repo.account_id, repo.name, repo.clone_url)
    else if (action === 'pull') projectsApi.pull(repo.account_id, repo.name)
    else if (action === 'fetch') projectsApi.fetch(repo.account_id, repo.name)
  }

  function handleStatusChange(key: string, status: RepoStatus) {
    setRepos(prev => prev.map(r => repoKey(r) === key ? { ...r, status } : r))
  }

  // Filtered + searched repos
  const filtered = repos.filter(r => {
    const q = search.toLowerCase()
    const matchSearch = !q || r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)
    const matchFilter =
      filter === 'all'     ? true :
      filter === 'cloned'  ? r.status !== 'not_cloned' :
      filter === 'changes' ? (r.status === 'dirty' || r.status === 'diverged') :
      filter === 'behind'  ? (r.status === 'behind' || r.status === 'diverged') : true
    return matchSearch && matchFilter
  })

  const counts = {
    cloned:  repos.filter(r => r.status !== 'not_cloned').length,
    changes: repos.filter(r => r.status === 'dirty' || r.status === 'diverged').length,
    behind:  repos.filter(r => r.status === 'behind' || r.status === 'diverged').length,
  }

  const levelColor = (l: string) =>
    l === 'error' ? 'text-red-400' : l === 'warn' ? 'text-amber-400' : 'text-zinc-400'

  // Group filtered repos by platform → account_id
  const grouped = (() => {
    const platformOrder: Platform[] = ['github', 'bitbucket']
    const map = new Map<string, { platform: Platform; label: string; repos: GitRepo[] }>()
    for (const r of filtered) {
      const key = r.account_id
      if (!map.has(key)) map.set(key, { platform: r.platform, label: r.account_label || r.account_username, repos: [] })
      map.get(key)!.repos.push(r)
    }
    // Sort by platform then by label
    return [...map.entries()]
      .sort(([, a], [, b]) => {
        const pi = platformOrder.indexOf(a.platform) - platformOrder.indexOf(b.platform)
        if (pi !== 0) return pi
        return a.label.localeCompare(b.label)
      })
      .map(([, v]) => v)
  })()

  const showGroupHeaders = grouped.length > 1

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">

        {/* Toolbar */}
        <div className="shrink-0 px-3 py-2 border-b border-[#21262d] flex items-center gap-2 flex-wrap">
          <input
            className="input flex-1 min-w-40 text-sm"
            placeholder="Search repositories…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {(['all', 'cloned', 'changes', 'behind'] as const).map(f => (
            <button key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                filter === f
                  ? 'bg-blue-600/20 border-blue-500/40 text-blue-400'
                  : 'border-[#30363d] text-zinc-500 hover:text-zinc-300'
              }`}>
              {f === 'all'     ? `All (${repos.length})` :
               f === 'cloned'  ? `Cloned (${counts.cloned})` :
               f === 'changes' ? `Changes (${counts.changes})` :
               `Behind (${counts.behind})`}
            </button>
          ))}
          <button className="btn-ghost text-xs py-1 px-2.5 ml-auto"
            onClick={loadRepos} disabled={loading}>
            {loading ? 'Loading…' : '↺ Refresh'}
          </button>
        </div>

        {/* Repo list */}
        <div className="flex-1 overflow-y-auto p-3">
          {notConfigured ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <svg viewBox="0 0 24 24" className="w-10 h-10 text-zinc-700" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
              </svg>
              <div>
                <div className="text-zinc-400 font-medium">No accounts configured</div>
                <div className="text-zinc-600 text-xs mt-1">Go to Settings and add a GitHub or Bitbucket account.</div>
              </div>
            </div>
          ) : loading && repos.length === 0 ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="panel p-3 animate-pulse">
                  <div className="h-4 bg-[#21262d] rounded w-48 mb-2" />
                  <div className="h-3 bg-[#21262d] rounded w-72" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-zinc-600 text-sm text-center mt-10 italic">No repositories match.</div>
          ) : (
            <div className="space-y-4">
              {grouped.map(group => (
                <div key={`${group.platform}-${group.label}`}>
                  {showGroupHeaders && (
                    <div className="flex items-center gap-2 mb-2 px-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        group.platform === 'bitbucket' ? 'bg-blue-900/60 text-blue-300' : 'bg-zinc-700 text-zinc-300'
                      }`}>
                        {PLATFORM_LABEL[group.platform]}
                      </span>
                      <span className="text-xs font-medium text-zinc-400">{group.label}</span>
                      <span className="text-xs text-zinc-600">({group.repos.length})</span>
                    </div>
                  )}
                  <div className="space-y-2">
                    {group.repos.map(repo => (
                      <RepoCard
                        key={repoKey(repo)}
                        repo={repo}
                        busy={busyRepos.has(repoKey(repo))}
                        onAction={handleAction}
                        onStatusChange={handleStatusChange}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Log panel */}
      <div className="shrink-0 border-t border-[#30363d] bg-[#0a0c10] transition-all duration-200"
        style={{ height: logCollapsed ? 32 : 180 }}>
        <div className="flex items-center px-3 py-1.5 border-b border-[#21262d] cursor-pointer select-none"
          onClick={() => setLogCollapsed(v => !v)}>
          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider flex-1">
            Git Log {logs.length > 0 && `(${logs.length})`}
          </span>
          <button className="text-xs text-zinc-600 hover:text-zinc-400 mr-2"
            onClick={e => { e.stopPropagation(); setLogs([]) }}>
            Clear
          </button>
          <span className="text-zinc-600 text-xs">{logCollapsed ? '▲' : '▼'}</span>
        </div>
        {!logCollapsed && (
          <div ref={logContainerRef} className="h-[calc(100%-32px)] overflow-y-auto p-2 mono text-xs space-y-0.5">
            {logs.length === 0 && <div className="text-zinc-700 italic">No git activity yet.</div>}
            {logs.map(l => (
              <div key={l.id} className={`flex gap-2 ${levelColor(l.level)}`}>
                <span className="text-zinc-700 shrink-0">{l.timestamp}</span>
                <span className="break-all">{l.text}</span>
              </div>
            ))}
            <div ref={logBottomRef} />
          </div>
        )}
      </div>
    </div>
  )
}
