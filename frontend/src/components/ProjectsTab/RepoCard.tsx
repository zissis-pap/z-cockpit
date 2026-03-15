import { useState, useEffect } from 'react'
import type { GitRepo, RepoStatus } from '../../types'
import { projects as projectsApi } from '../../api/client'

interface Props {
  repo: GitRepo
  busy: boolean
  onAction: (repo: GitRepo, action: 'clone' | 'pull' | 'fetch') => void
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

export default function RepoCard({ repo, busy, onAction, onStatusChange }: Props) {
  const [showCommit, setShowCommit] = useState(false)
  const [commitMsg, setCommitMsg] = useState('')
  const [changes, setChanges] = useState<Array<{ code: string; file: string }>>([])
  const [committingLocal, setCommittingLocal] = useState(false)

  useEffect(() => {
    if (showCommit && (repo.status === 'dirty' || repo.status === 'diverged')) {
      projectsApi.changes(repo.account_id, repo.name).then(r => { if (r.ok) setChanges(r.files) })
    }
  }, [showCommit, repo.account_id, repo.name, repo.status])

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

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <a href={repo.html_url} target="_blank" rel="noreferrer"
                className="font-medium text-zinc-200 hover:text-blue-400 transition-colors text-sm">
                {repo.name}
              </a>
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
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1.5 shrink-0">
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
