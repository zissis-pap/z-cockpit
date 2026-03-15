import { useState, useEffect, useRef, useCallback } from 'react'
import type { GitRepo, FileEntry, RepoStatus } from '../../types'
import { projects as projectsApi } from '../../api/client'

interface Props {
  repo: GitRepo
  onBack: () => void
  onStatusChange: (repoKey: string, status: RepoStatus) => void
}

function extIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    c: 'C', h: 'H', cpp: 'C++', cc: 'C++', cxx: 'C++',
    py: 'PY', js: 'JS', ts: 'TS', tsx: 'TSX', jsx: 'JSX',
    json: '{}', yaml: 'YML', yml: 'YML', toml: 'TML',
    md: 'MD', txt: 'TXT', sh: 'SH', makefile: 'MK',
    cmake: 'CM', s: 'ASM', asm: 'ASM', ld: 'LD',
    hex: 'HEX', bin: 'BIN', elf: 'ELF',
  }
  return map[ext] ?? (ext.toUpperCase().slice(0, 3) || '·')
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`
  return `${(bytes / 1024 / 1024).toFixed(1)}M`
}

// ── File Tree ──────────────────────────────────────────────────────────────────

interface TreeProps {
  accountId: string
  repoName: string
  selectedPath: string
  onSelect: (entry: FileEntry) => void
}

interface DirState {
  entries: FileEntry[]
  expanded: boolean
  loaded: boolean
}

function FileTree({ accountId, repoName, selectedPath, onSelect }: TreeProps) {
  // Map of dir path → state; '' is root
  const [dirs, setDirs] = useState<Map<string, DirState>>(new Map([['', { entries: [], expanded: true, loaded: false }]]))

  const loadDir = useCallback(async (path: string) => {
    const res = await projectsApi.listFiles(accountId, repoName, path)
    if (!res.ok) return
    setDirs(prev => {
      const next = new Map(prev)
      next.set(path, { entries: res.entries, expanded: true, loaded: true })
      return next
    })
  }, [accountId, repoName])

  useEffect(() => { loadDir('') }, [loadDir])

  function toggle(path: string) {
    setDirs(prev => {
      const cur = prev.get(path)
      if (!cur) return prev
      const next = new Map(prev)
      if (!cur.loaded) {
        // load then expand
        loadDir(path)
        return prev
      }
      next.set(path, { ...cur, expanded: !cur.expanded })
      return next
    })
  }

  function clickDir(entry: FileEntry) {
    if (!dirs.has(entry.path)) {
      setDirs(prev => new Map(prev).set(entry.path, { entries: [], expanded: false, loaded: false }))
    }
    toggle(entry.path)
  }

  function renderEntries(entries: FileEntry[], depth: number): React.ReactNode {
    return entries.map(entry => {
      const isSelected = entry.path === selectedPath
      const indent = depth * 12
      if (entry.type === 'dir') {
        const state = dirs.get(entry.path)
        const expanded = state?.expanded ?? false
        return (
          <div key={entry.path}>
            <button
              className={`w-full text-left flex items-center gap-1.5 px-2 py-0.5 hover:bg-[#21262d] text-xs transition-colors ${isSelected ? 'bg-[#21262d]' : ''}`}
              style={{ paddingLeft: 8 + indent }}
              onClick={() => clickDir(entry)}
            >
              <span className="text-zinc-600 text-[10px] w-3 shrink-0">{expanded ? '▼' : '▶'}</span>
              <span className="text-blue-400/80">📁</span>
              <span className="text-zinc-300 truncate">{entry.name}</span>
            </button>
            {expanded && state?.loaded && renderEntries(state.entries, depth + 1)}
            {expanded && state && !state.loaded && (
              <div className="text-zinc-700 text-xs italic" style={{ paddingLeft: 8 + indent + 20 }}>Loading…</div>
            )}
          </div>
        )
      }
      return (
        <button
          key={entry.path}
          className={`w-full text-left flex items-center gap-1.5 px-2 py-0.5 hover:bg-[#21262d] text-xs transition-colors ${isSelected ? 'bg-blue-600/20 text-blue-300' : 'text-zinc-400'}`}
          style={{ paddingLeft: 8 + indent + 16 }}
          onClick={() => onSelect(entry)}
        >
          <span className="text-[9px] text-zinc-600 w-7 shrink-0 text-right font-mono">{extIcon(entry.name)}</span>
          <span className="truncate flex-1">{entry.name}</span>
          <span className="text-zinc-700 text-[10px] shrink-0">{fileSize(entry.size)}</span>
        </button>
      )
    })
  }

  const root = dirs.get('')
  return (
    <div className="h-full overflow-y-auto py-1">
      {root?.loaded ? renderEntries(root.entries, 0) : (
        <div className="text-zinc-700 text-xs italic p-3">Loading…</div>
      )}
    </div>
  )
}

// ── Editor ─────────────────────────────────────────────────────────────────────

interface EditorProps {
  accountId: string
  repoName: string
  file: FileEntry
}

function Editor({ accountId, repoName, file }: EditorProps) {
  const [content, setContent] = useState('')
  const [saved, setSaved] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setLoading(true)
    setError('')
    projectsApi.readFile(accountId, repoName, file.path).then(res => {
      if (res.ok) {
        setContent(res.content)
        setSaved(res.content)
      } else {
        setError(res.ok ? '' : 'Failed to load file')
      }
    }).catch(e => setError(String(e))).finally(() => setLoading(false))
  }, [accountId, repoName, file.path])

  async function save() {
    setSaving(true)
    try {
      const res = await projectsApi.writeFile(accountId, repoName, file.path, content)
      if (res.ok) setSaved(content)
      else setError('Save failed')
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = e.currentTarget
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const next = content.slice(0, start) + '  ' + content.slice(end)
      setContent(next)
      // restore cursor after state update
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2
      })
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      save()
    }
  }

  const isDirty = content !== saved

  return (
    <div className="flex flex-col h-full">
      {/* Editor toolbar */}
      <div className="shrink-0 flex items-center gap-3 px-3 py-1.5 border-b border-[#21262d] bg-[#161b22]">
        <span className="mono text-xs text-zinc-400 flex-1 truncate">{file.path}</span>
        {isDirty && <span className="text-xs text-amber-400">● unsaved</span>}
        {error && <span className="text-xs text-red-400 truncate max-w-xs">✗ {error}</span>}
        <button
          className="btn-primary text-xs py-1 px-3"
          onClick={save}
          disabled={saving || !isDirty}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <span className="text-zinc-700 text-[10px]">Ctrl+S</span>
      </div>

      {/* Textarea */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm">Loading…</div>
      ) : (
        <textarea
          ref={textareaRef}
          className="flex-1 w-full bg-[#0d1117] text-zinc-300 mono text-xs resize-none outline-none p-4 leading-5"
          value={content}
          onChange={e => { setContent(e.target.value); setError('') }}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
        />
      )}
    </div>
  )
}

// ── Project View ───────────────────────────────────────────────────────────────

export default function ProjectView({ repo, onBack }: Props) {
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null)
  const [showCommit, setShowCommit] = useState(false)
  const [commitMsg, setCommitMsg] = useState('')
  const [committing, setCommitting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function doPull() {
    await projectsApi.pull(repo.account_id, repo.name)
  }

  async function doDelete() {
    setDeleting(true)
    try {
      await projectsApi.deleteLocal(repo.account_id, repo.name)
      onBack()
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  async function doCommit() {
    if (!commitMsg.trim()) return
    setCommitting(true)
    try {
      await projectsApi.commit(repo.account_id, repo.name, commitMsg)
      setCommitMsg('')
      setShowCommit(false)
    } finally {
      setCommitting(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-[#21262d] bg-[#161b22]">
        <button className="btn-ghost text-xs py-1 px-2" onClick={onBack}>← Projects</button>
        <span className="text-zinc-600">/</span>
        <span className="text-sm font-semibold text-zinc-200">{repo.name}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
          repo.platform === 'bitbucket' ? 'bg-blue-900/60 text-blue-300' : 'bg-zinc-700 text-zinc-300'
        }`}>
          {repo.platform === 'bitbucket' ? 'Bitbucket' : 'GitHub'}
        </span>

        <div className="flex items-center gap-1.5 ml-auto">
          {/* External link */}
          <a
            href={repo.html_url}
            target="_blank"
            rel="noreferrer"
            className="btn-ghost text-xs py-1 px-2 inline-flex items-center gap-1"
            title="Open in browser"
          >
            <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
              <path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z"/>
            </svg>
            {repo.platform === 'bitbucket' ? 'Bitbucket' : 'GitHub'}
          </a>

          <button className="btn-ghost text-xs py-1 px-2.5" onClick={doPull}>Pull</button>

          <button
            className={`text-xs py-1 px-2.5 btn ${showCommit ? 'bg-amber-700/30 border border-amber-600/40 text-amber-400' : 'btn-ghost'}`}
            onClick={() => { setShowCommit(v => !v); setConfirmDelete(false) }}
          >
            Commit
          </button>

          {confirmDelete ? (
            <>
              <span className="text-xs text-red-400">Delete local copy?</span>
              <button className="btn text-xs py-1 px-2.5 bg-red-700/40 border border-red-600/50 text-red-300 hover:bg-red-700/60"
                onClick={doDelete} disabled={deleting}>
                {deleting ? '…' : 'Yes, delete'}
              </button>
              <button className="btn-ghost text-xs py-1 px-2" onClick={() => setConfirmDelete(false)}>Cancel</button>
            </>
          ) : (
            <button
              className="btn-ghost text-xs py-1 px-2.5 text-red-400 hover:text-red-300"
              onClick={() => { setConfirmDelete(true); setShowCommit(false) }}
              title="Delete local copy"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Commit panel */}
      {showCommit && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-[#21262d] bg-[#0d1117]">
          <input
            className="input flex-1 text-xs"
            placeholder="Commit message…"
            value={commitMsg}
            onChange={e => setCommitMsg(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doCommit()}
            autoFocus
          />
          <button className="btn-success text-xs px-3" onClick={doCommit} disabled={!commitMsg.trim() || committing}>
            {committing ? '…' : 'Commit & Push'}
          </button>
          <button className="btn-ghost text-xs px-2" onClick={() => setShowCommit(false)}>✕</button>
        </div>
      )}

      {/* Body: file tree + editor */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* File tree */}
        <div className="w-64 shrink-0 border-r border-[#21262d] overflow-hidden flex flex-col">
          <div className="text-[10px] text-zinc-600 uppercase tracking-wider px-3 py-1.5 border-b border-[#21262d] shrink-0">
            Files
          </div>
          {repo.status === 'not_cloned' ? (
            <div className="p-4 text-xs text-zinc-600 italic">Repository not cloned.</div>
          ) : (
            <FileTree
              accountId={repo.account_id}
              repoName={repo.name}
              selectedPath={selectedFile?.path ?? ''}
              onSelect={setSelectedFile}
            />
          )}
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-hidden">
          {selectedFile ? (
            <Editor
              key={selectedFile.path}
              accountId={repo.account_id}
              repoName={repo.name}
              file={selectedFile}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-zinc-700 text-sm italic select-none">
              Select a file to edit
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
