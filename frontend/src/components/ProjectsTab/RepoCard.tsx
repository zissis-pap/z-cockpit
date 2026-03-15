import { useState, useEffect } from 'react'
import type { GitRepo, RepoStatus } from '../../types'
import { projects as projectsApi } from '../../api/client'

interface Props {
  repo: GitRepo
  busy: boolean
  onOpen: (repo: GitRepo) => void
  onAction: (repo: GitRepo, action: 'clone' | 'pull' | 'fetch') => void
  onDelete: (repo: GitRepo) => void
  onStatusChange: (repoKey: string, status: RepoStatus) => void
}

function repoKey(repo: GitRepo) { return `${repo.account_id}/${repo.name}` }

const STATUS_DOT: Record<RepoStatus, string> = {
  clean:     'status-dot-green',
  dirty:     'status-dot-amber',
  behind:    'status-dot-red',
  diverged:  'status-dot-red',
  not_cloned:'status-dot bg-zinc-700',
  unknown:   'status-dot bg-zinc-700',
}

const STATUS_LABEL: Record<RepoStatus, string> = {
  clean:     'Up to date',
  dirty:     'Local changes',
  behind:    'Pull needed',
  diverged:  'Changes + pull needed',
  not_cloned:'Not cloned',
  unknown:   'Unknown',
}

const STATUS_COLOR: Record<RepoStatus, string> = {
  clean:     'text-green-400',
  dirty:     'text-amber-400',
  behind:    'text-red-400',
  diverged:  'text-red-400',
  not_cloned:'text-zinc-500',
  unknown:   'text-zinc-600',
}

function timeAgo(iso: string): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

export default function RepoCard({ repo, busy, onOpen, onAction, onDelete, onStatusChange }: Props) {
  const [showCommit, setShowCommit] = useState(false)
  const [commitMsg, setCommitMsg] = useState('')
  const [changes, setChanges] = useState<Array<{ code: string; file: string }>>([])
  const [committingLocal, setCommittingLocal] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (showCommit && (repo.status === 'dirty' || repo.status === 'diverged')) {
      projectsApi.changes(repo.account_id, repo.name).then(r => { if (r.ok) setChanges(r.files) })
    }
  }, [showCommit, repo.account_id, repo.name, repo.status])

  async function doDelete() {
    setDeleting(true)
    try {
      await projectsApi.deleteLocal(repo.account_id, repo.name)
      onDelete(repo)
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  async function doCommit() {
    if (!commitMsg.trim()) return
    setCommittingLocal(true)
    try {
      await projectsApi.commit(repo.account_id, repo.name, commitMsg)
      setCommitMsg('')
      setShowCommit(false)
    } finally {
      setCommittingLocal(false)
    }
  }

  const s = repo.status

  return (
    <div className={`panel transition-colors duration-150 ${
      s === 'dirty' || s === 'diverged' ? 'border-amber-500/20' :
      s === 'behind' ? 'border-red-500/20' :
      s === 'clean' ? 'border-green-500/10' : ''
    }`}>
      <div className="p-3">
        {/* Header row */}
        <div className="flex items-start gap-2.5">
          <span className={`${STATUS_DOT[s]} mt-1.5 shrink-0`} title={STATUS_LABEL[s]} />

          {/* Clickable info area */}
          <div
            className="flex-1 min-w-0 cursor-pointer"
            onClick={() => onOpen(repo)}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-zinc-200 hover:text-blue-400 transition-colors text-sm">
                {repo.name}
              </span>
              {repo.private && (
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-[#30363d] text-zinc-500">private</span>
              )}
              {repo.fork && (
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-[#30363d] text-zinc-500">fork</span>
              )}
              {repo.language && (
                <span className="text-xs text-zinc-500">{repo.language}</span>
              )}
            </div>
            {repo.description && (
              <p className="text-xs text-zinc-500 mt-0.5 truncate" title={repo.description}>
                {repo.description}
              </p>
            )}
            <div className={`text-xs mt-0.5 ${STATUS_COLOR[s]}`}>
              {STATUS_LABEL[s]}
              {repo.behind ? ` (${repo.behind} commit${repo.behind !== 1 ? 's' : ''} behind)` : ''}
              <span className="text-zinc-700 ml-2">{timeAgo(repo.updated_at)}</span>
            </div>
          </div>  {/* end clickable area */}

          {/* Action buttons */}
          <div className="flex items-center gap-1.5 shrink-0">
            <a
              href={repo.html_url}
              target="_blank"
              rel="noreferrer"
              className="btn-ghost text-xs py-1 px-2 inline-flex items-center"
              title="Open repository in browser"
              onClick={e => e.stopPropagation()}
            >
              <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
                <path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z"/>
              </svg>
            </a>
            {s === 'not_cloned' && (
              <button className="btn-primary text-xs py-1 px-2.5"
                onClick={() => onAction(repo, 'clone')}
                disabled={busy}>
                {busy ? '…' : 'Clone'}
              </button>
            )}
            {(s === 'clean' || s === 'behind' || s === 'diverged') && (
              <button className="btn-ghost text-xs py-1 px-2.5"
                onClick={() => onAction(repo, 'pull')}
                disabled={busy}>
                {busy ? '…' : 'Pull'}
              </button>
            )}
            {(s === 'dirty' || s === 'diverged' || s === 'clean') && (
              <button
                className={`text-xs py-1 px-2.5 btn ${showCommit ? 'bg-amber-700/30 border border-amber-600/40 text-amber-400' : 'btn-ghost'}`}
                onClick={() => setShowCommit(v => !v)}
                disabled={busy}>
                Commit
              </button>
            )}
            {s !== 'not_cloned' && (
              <button className="btn-ghost text-xs py-1 px-2" title="Fetch remote status"
                onClick={() => onAction(repo, 'fetch')}
                disabled={busy}>
                ⟳
              </button>
            )}
            {s !== 'not_cloned' && !confirmDelete && (
              <button className="btn-ghost text-xs py-1 px-2 text-red-400 hover:text-red-300"
                title="Delete local copy"
                onClick={() => { setConfirmDelete(true); setShowCommit(false) }}
                disabled={busy}>
                ✕
              </button>
            )}
            {confirmDelete && (
              <>
                <button className="btn text-xs py-1 px-2 bg-red-700/40 border border-red-600/50 text-red-300 hover:bg-red-700/60"
                  onClick={doDelete} disabled={deleting}>
                  {deleting ? '…' : 'Delete?'}
                </button>
                <button className="btn-ghost text-xs py-1 px-1.5" onClick={() => setConfirmDelete(false)}>Cancel</button>
              </>
            )}
          </div>
        </div>

        {/* Commit panel */}
        {showCommit && (
          <div className="mt-3 border-t border-[#30363d] pt-3 space-y-2">
            {changes.length > 0 && (
              <div className="mono text-xs max-h-28 overflow-y-auto space-y-0.5 bg-[#0f1117] rounded p-2">
                {changes.map((f, i) => (
                  <div key={i} className={`flex gap-2 ${
                    f.code === 'M' ? 'text-amber-400' :
                    f.code === 'A' || f.code === '?' ? 'text-green-400' :
                    f.code === 'D' ? 'text-red-400' : 'text-zinc-400'
                  }`}>
                    <span className="shrink-0 w-4">{f.code}</span>
                    <span className="truncate">{f.file}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                className="input flex-1 text-xs"
                placeholder="Commit message…"
                value={commitMsg}
                onChange={e => setCommitMsg(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && doCommit()}
                autoFocus
              />
              <button className="btn-success text-xs px-3"
                onClick={doCommit}
                disabled={!commitMsg.trim() || committingLocal}>
                {committingLocal ? '…' : 'Commit & Push'}
              </button>
              <button className="btn-ghost text-xs px-2" onClick={() => setShowCommit(false)}>✕</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
