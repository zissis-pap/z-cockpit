import { useState, useEffect } from 'react'
import type { Account, Platform } from '../../types'
import { settings as settingsApi, remotes as remotesApi, type RemoteAgent } from '../../api/client'

const PLATFORM_LABEL: Record<Platform, string> = {
  github: 'GitHub',
  bitbucket: 'Bitbucket',
}

const PLATFORM_COLOR: Record<Platform, string> = {
  github: 'bg-zinc-700 text-zinc-300',
  bitbucket: 'bg-blue-900/60 text-blue-300',
}

interface FormState {
  platform: Platform
  label: string
  username: string
  token: string
  workspace: string
  clone_base_path: string
}

const EMPTY_FORM: FormState = {
  platform: 'github',
  label: '',
  username: '',
  token: '',
  workspace: '',
  clone_base_path: '',
}

function AccountForm({
  initial,
  savedToken,
  onSave,
  onCancel,
}: {
  initial: FormState
  savedToken: string
  onSave: (data: FormState) => Promise<void>
  onCancel: () => void
}) {
  const [form, setForm] = useState<FormState>(initial)
  const [tokenFocused, setTokenFocused] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function field<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(f => ({ ...f, [key]: value }))
    setError('')
  }

  async function submit() {
    if (!form.username.trim()) { setError('Username is required'); return }
    setSaving(true)
    try {
      const payload: Partial<FormState> = { ...form }
      // Don't send masked token back
      if (payload.token && payload.token === savedToken) {
        delete payload.token
      }
      await onSave(payload as FormState)
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const isBitbucket = form.platform === 'bitbucket'

  return (
    <div className="border-t border-[#21262d] pt-4 mt-2 space-y-3">
      {/* Platform */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-zinc-400 block mb-1">Platform</label>
          <select
            className="input w-full"
            value={form.platform}
            onChange={e => field('platform', e.target.value as Platform)}
          >
            <option value="github">GitHub</option>
            <option value="bitbucket">Bitbucket</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-zinc-400 block mb-1">Label</label>
          <input
            className="input w-full"
            placeholder="e.g. Work, Personal"
            value={form.label}
            onChange={e => field('label', e.target.value)}
          />
        </div>
      </div>

      {/* Username */}
      <div>
        <label className="text-xs text-zinc-400 block mb-1">
          {isBitbucket ? 'Bitbucket Username' : 'GitHub Username'}
        </label>
        <input
          className="input w-full"
          placeholder={isBitbucket ? 'your-username' : 'your-username'}
          value={form.username}
          onChange={e => field('username', e.target.value)}
          autoComplete="off"
        />
      </div>

      {/* Token */}
      <div>
        <label className="text-xs text-zinc-400 block mb-1">
          {isBitbucket ? 'App Password' : 'Personal Access Token'}
        </label>
        <input
          className="input w-full mono"
          type={tokenFocused ? 'text' : 'password'}
          value={tokenFocused ? (form.token === savedToken ? '' : form.token) : form.token}
          onFocus={() => {
            setTokenFocused(true)
            if (form.token === savedToken) field('token', '')
          }}
          onBlur={() => {
            setTokenFocused(false)
            if (!form.token) field('token', savedToken)
          }}
          onChange={e => field('token', e.target.value)}
          placeholder="Leave blank to keep existing"
          autoComplete="new-password"
        />
        <p className="text-xs text-zinc-600 mt-1">
          {isBitbucket
            ? 'Create an App Password with repository read/write permissions.'
            : 'Requires repo scope for private repositories.'}
        </p>
      </div>

      {/* Workspace (Bitbucket only) */}
      {isBitbucket && (
        <div>
          <label className="text-xs text-zinc-400 block mb-1">Workspace slug</label>
          <input
            className="input w-full"
            placeholder="Defaults to username if blank"
            value={form.workspace}
            onChange={e => field('workspace', e.target.value)}
          />
          <p className="text-xs text-zinc-600 mt-1">
            The workspace slug from bitbucket.org/&#123;workspace&#125;
          </p>
        </div>
      )}

      {/* Clone path */}
      <div>
        <label className="text-xs text-zinc-400 block mb-1">Clone Base Path</label>
        <input
          className="input w-full mono"
          placeholder="~/Projects"
          value={form.clone_base_path}
          onChange={e => field('clone_base_path', e.target.value)}
        />
      </div>

      {error && <p className="text-xs text-red-400">✗ {error}</p>}

      <div className="flex gap-2 pt-1">
        <button className="btn-primary text-xs px-4" onClick={submit} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button className="btn-ghost text-xs px-3" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Remote Agents section ──────────────────────────────────────────────────────

interface RemoteForm { name: string; host: string; port: string; token: string }
const EMPTY_REMOTE: RemoteForm = { name: '', host: '', port: '7777', token: '' }

function RemoteAgentsSection() {
  const [list, setList]         = useState<RemoteAgent[]>([])
  const [form, setForm]         = useState<RemoteForm>(EMPTY_REMOTE)
  const [editId, setEditId]     = useState<string | null>(null)  // null=closed, 'new'=add form, id=edit
  const [testRes, setTestRes]   = useState<Record<string, { ok: boolean; text: string }>>({})
  const [testing, setTesting]   = useState<string | null>(null)
  const [saving, setSaving]     = useState(false)
  const [err, setErr]           = useState('')

  async function load() {
    try { const r = await remotesApi.list(); setList(r.remotes) } catch {}
  }
  useEffect(() => { load() }, [])

  function openAdd() { setForm(EMPTY_REMOTE); setEditId('new'); setErr('') }
  function openEdit(r: RemoteAgent) {
    setForm({ name: r.name, host: r.host, port: String(r.port), token: '' })
    setEditId(r.id); setErr('')
  }
  function closeForm() { setEditId(null) }

  async function save() {
    if (!form.name.trim() || !form.host.trim()) { setErr('Name and host are required'); return }
    setSaving(true); setErr('')
    try {
      const body = { name: form.name.trim(), host: form.host.trim(),
                     port: parseInt(form.port) || 7777, token: form.token }
      if (editId === 'new') await remotesApi.add(body)
      else                   await remotesApi.update(editId!, body)
      await load(); closeForm()
    } catch (e) { setErr(String(e)) }
    finally { setSaving(false) }
  }

  async function del(id: string) {
    if (!confirm('Delete this remote agent?')) return
    await remotesApi.delete(id); await load()
    if (editId === id) closeForm()
  }

  async function test(id: string) {
    setTesting(id)
    setTestRes(p => ({ ...p, [id]: { ok: false, text: 'Testing…' } }))
    try {
      const r = await remotesApi.test(id)
      setTestRes(p => ({ ...p, [id]: {
        ok: r.ok,
        text: r.ok ? `Connected — ${JSON.stringify(r.info)}` : (r.error ?? 'Failed'),
      }}))
    } catch (e) { setTestRes(p => ({ ...p, [id]: { ok: false, text: String(e) } })) }
    finally { setTesting(null) }
  }

  const f = (k: keyof RemoteForm, v: string) => { setForm(p => ({ ...p, [k]: v })); setErr('') }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-zinc-200">Remote Agents</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Run <code className="text-zinc-400">python remote_agent.py</code> on the target PC, then add it here.
          </p>
        </div>
        <button className="btn-primary text-xs px-3 py-1.5"
          onClick={() => editId === 'new' ? closeForm() : openAdd()}>
          {editId === 'new' ? 'Cancel' : '+ Add Agent'}
        </button>
      </div>

      {/* Add form */}
      {editId === 'new' && (
        <div className="panel p-4 space-y-3">
          <div className="text-sm font-medium text-zinc-300">New Remote Agent</div>
          <RemoteFormFields form={form} setField={f} />
          {err && <p className="text-xs text-red-400">✗ {err}</p>}
          <div className="flex gap-2">
            <button className="btn-primary text-xs px-4" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            <button className="btn-ghost text-xs px-3" onClick={closeForm} disabled={saving}>Cancel</button>
          </div>
        </div>
      )}

      {/* Agent list */}
      {list.length === 0 && editId !== 'new' ? (
        <div className="panel p-6 text-center">
          <div className="text-zinc-500 text-sm">No remote agents configured.</div>
          <div className="text-zinc-600 text-xs mt-1">
            Deploy <code>remote_agent.py</code> on the remote PC and add its address here.
          </div>
        </div>
      ) : list.map(agent => (
        <div key={agent.id} className="panel">
          <div className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-zinc-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-zinc-200">{agent.name}</div>
                <div className="text-xs text-zinc-500 mono">
                  {agent.host}:{agent.port}
                  {agent.has_token && <span className="ml-2 text-amber-500/70">🔑 token set</span>}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button className="btn-ghost text-xs py-1 px-2"
                  onClick={() => test(agent.id)} disabled={testing === agent.id}>
                  {testing === agent.id ? 'Testing…' : 'Test'}
                </button>
                <button className={`text-xs py-1 px-2 btn ${editId === agent.id ? 'bg-amber-700/30 border border-amber-600/40 text-amber-400' : 'btn-ghost'}`}
                  onClick={() => editId === agent.id ? closeForm() : openEdit(agent)}>Edit</button>
                <button className="btn-ghost text-xs py-1 px-2 text-red-400 hover:text-red-300"
                  onClick={() => del(agent.id)}>✕</button>
              </div>
            </div>

            {testRes[agent.id] && (
              <div className={`text-xs mt-2 mono ${testRes[agent.id].ok ? 'text-green-400' : 'text-red-400'}`}>
                {testRes[agent.id].ok ? '✓' : '✗'} {testRes[agent.id].text}
              </div>
            )}

            {editId === agent.id && (
              <div className="mt-4 border-t border-[#21262d] pt-4 space-y-3">
                <RemoteFormFields form={form} setField={f} />
                <p className="text-xs text-zinc-600">Leave token blank to keep the existing value.</p>
                {err && <p className="text-xs text-red-400">✗ {err}</p>}
                <div className="flex gap-2">
                  <button className="btn-primary text-xs px-4" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                  <button className="btn-ghost text-xs px-3" onClick={closeForm} disabled={saving}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function RemoteFormFields({ form, setField }: {
  form: RemoteForm
  setField: (k: keyof RemoteForm, v: string) => void
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-zinc-400 block mb-1">Name</label>
          <input className="input w-full" placeholder="e.g. Raspberry Pi" value={form.name}
            onChange={e => setField('name', e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-zinc-400 block mb-1">Port</label>
          <input className="input w-full mono" placeholder="7777" value={form.port}
            onChange={e => setField('port', e.target.value)} />
        </div>
      </div>
      <div>
        <label className="text-xs text-zinc-400 block mb-1">Host / IP</label>
        <input className="input w-full mono" placeholder="192.168.1.100" value={form.host}
          onChange={e => setField('host', e.target.value)} />
      </div>
      <div>
        <label className="text-xs text-zinc-400 block mb-1">API Token (optional)</label>
        <input className="input w-full mono" type="password" placeholder="Leave blank for no auth"
          value={form.token} onChange={e => setField('token', e.target.value)}
          autoComplete="new-password" />
      </div>
    </>
  )
}

// ── Main settings tab ──────────────────────────────────────────────────────────

export default function SettingsTab() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)  // account id or 'new'
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; text: string }>>({})
  const [testing, setTesting] = useState<string | null>(null)

  async function loadAccounts() {
    try {
      const res = await settingsApi.accounts()
      if (res.ok) setAccounts(res.accounts)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAccounts() }, [])

  async function handleAdd(data: FormState) {
    await settingsApi.addAccount(data)
    setEditingId(null)
    await loadAccounts()
  }

  async function handleUpdate(id: string, data: FormState) {
    await settingsApi.updateAccount(id, data)
    setEditingId(null)
    await loadAccounts()
  }

  async function handleDelete(id: string) {
    await settingsApi.deleteAccount(id)
    setAccounts(prev => prev.filter(a => a.id !== id))
    if (editingId === id) setEditingId(null)
  }

  async function handleTest(id: string) {
    setTesting(id)
    setTestResults(prev => ({ ...prev, [id]: { ok: false, text: 'Testing…' } }))
    try {
      const res = await settingsApi.testAccount(id)
      setTestResults(prev => ({
        ...prev,
        [id]: {
          ok: res.ok,
          text: res.ok
            ? `Connected as ${res.login}${res.name ? ` (${res.name})` : ''}`
            : (res.error ?? 'Connection failed'),
        },
      }))
    } catch (e) {
      setTestResults(prev => ({ ...prev, [id]: { ok: false, text: String(e) } }))
    } finally {
      setTesting(null)
    }
  }

  return (
    <div className="flex flex-col h-full p-6 overflow-y-auto">
      <div className="max-w-2xl mx-auto w-full space-y-10">

        <RemoteAgentsSection />

        <hr className="border-[#21262d]" />

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-zinc-200">Git Accounts</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Stored in ~/.config/z-cockpit/settings.json</p>
          </div>
          <button
            className="btn-primary text-xs px-3 py-1.5"
            onClick={() => setEditingId(editingId === 'new' ? null : 'new')}
          >
            {editingId === 'new' ? 'Cancel' : '+ Add Account'}
          </button>
        </div>

        {/* Add account form */}
        {editingId === 'new' && (
          <div className="panel p-4">
            <div className="text-sm font-medium text-zinc-300 mb-1">New Account</div>
            <AccountForm
              initial={EMPTY_FORM}
              savedToken=""
              onSave={handleAdd}
              onCancel={() => setEditingId(null)}
            />
          </div>
        )}

        {/* Account list */}
        {loading ? (
          <div className="text-xs text-zinc-600 italic">Loading…</div>
        ) : accounts.length === 0 && editingId !== 'new' ? (
          <div className="panel p-6 text-center">
            <div className="text-zinc-500 text-sm">No accounts configured.</div>
            <div className="text-zinc-600 text-xs mt-1">Add a GitHub or Bitbucket account to get started.</div>
          </div>
        ) : (
          accounts.map(acct => (
            <div key={acct.id} className="panel">
              <div className="p-4">
                {/* Account header */}
                <div className="flex items-center gap-3">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${PLATFORM_COLOR[acct.platform]}`}>
                    {PLATFORM_LABEL[acct.platform]}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-zinc-200">
                      {acct.label || acct.username}
                    </div>
                    <div className="text-xs text-zinc-500">
                      @{acct.username}
                      {acct.workspace && acct.workspace !== acct.username && ` · workspace: ${acct.workspace}`}
                      <span className="text-zinc-700 ml-2 mono">{acct.clone_base_path}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      className="btn-ghost text-xs py-1 px-2"
                      onClick={() => handleTest(acct.id)}
                      disabled={testing === acct.id}
                    >
                      {testing === acct.id ? 'Testing…' : 'Test'}
                    </button>
                    <button
                      className={`text-xs py-1 px-2 btn ${editingId === acct.id ? 'bg-amber-700/30 border border-amber-600/40 text-amber-400' : 'btn-ghost'}`}
                      onClick={() => setEditingId(editingId === acct.id ? null : acct.id)}
                    >
                      Edit
                    </button>
                    <button
                      className="btn-ghost text-xs py-1 px-2 text-red-400 hover:text-red-300"
                      onClick={() => handleDelete(acct.id)}
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Test result */}
                {testResults[acct.id] && (
                  <div className={`text-xs mt-2 ${testResults[acct.id].ok ? 'text-green-400' : 'text-red-400'}`}>
                    {testResults[acct.id].ok ? '✓' : '✗'} {testResults[acct.id].text}
                  </div>
                )}

                {/* Edit form */}
                {editingId === acct.id && (
                  <AccountForm
                    initial={{
                      platform: acct.platform,
                      label: acct.label,
                      username: acct.username,
                      token: acct.token,
                      workspace: acct.workspace,
                      clone_base_path: acct.clone_base_path,
                    }}
                    savedToken={acct.token}
                    onSave={data => handleUpdate(acct.id, data)}
                    onCancel={() => setEditingId(null)}
                  />
                )}
              </div>
            </div>
          ))
        )}

      </div>
    </div>
  )
}
