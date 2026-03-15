import { useState, useEffect } from 'react'
import { settings as settingsApi } from '../../api/client'

interface FormState {
  github_username: string
  github_token: string
  clone_base_path: string
}

export default function SettingsTab() {
  const [form, setForm] = useState<FormState>({
    github_username: '',
    github_token: '',
    clone_base_path: '',
  })
  const [savedToken, setSavedToken] = useState('')   // masked value from server
  const [tokenFocused, setTokenFocused] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    settingsApi.get().then(res => {
      if (res.ok) {
        setForm({
          github_username: res.settings.github_username,
          github_token: res.settings.github_token,   // masked
          clone_base_path: res.settings.clone_base_path,
        })
        setSavedToken(res.settings.github_token)
      }
    }).catch(() => {})
  }, [])

  function field(key: keyof FormState, value: string) {
    setForm(f => ({ ...f, [key]: value }))
    setSaveMsg(null)
  }

  async function save() {
    setSaving(true)
    setSaveMsg(null)
    const payload: Partial<FormState> = {
      github_username: form.github_username,
      clone_base_path: form.clone_base_path,
    }
    // Only include token if it was actually changed (not the masked placeholder)
    if (form.github_token && form.github_token !== savedToken) {
      payload.github_token = form.github_token
    }
    try {
      const res = await settingsApi.save(payload)
      setSaveMsg({ ok: res.ok, text: res.ok ? 'Settings saved.' : 'Save failed.' })
      if (res.ok) {
        // Refresh to get new masked token
        const fresh = await settingsApi.get()
        if (fresh.ok) {
          setForm(f => ({ ...f, github_token: fresh.settings.github_token }))
          setSavedToken(fresh.settings.github_token)
        }
      }
    } catch (e) {
      setSaveMsg({ ok: false, text: String(e) })
    } finally {
      setSaving(false)
    }
  }

  async function testConnection() {
    setTesting(true)
    setTestMsg(null)
    try {
      const res = await settingsApi.testConnection()
      if (res.ok) {
        setTestMsg({ ok: true, text: `Connected as ${res.login}${res.name ? ` (${res.name})` : ''}` })
      } else {
        setTestMsg({ ok: false, text: res.error ?? 'Connection failed' })
      }
    } catch (e) {
      setTestMsg({ ok: false, text: String(e) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="flex flex-col h-full p-6 overflow-y-auto">
      <div className="max-w-2xl mx-auto w-full space-y-5">

        <div>
          <h2 className="text-base font-semibold text-zinc-200">Settings</h2>
          <p className="text-xs text-zinc-500 mt-0.5">Application configuration. Stored in ~/.config/z-cockpit/settings.json</p>
        </div>

        {/* GitHub */}
        <div className="panel">
          <div className="panel-header">GitHub</div>
          <div className="p-4 space-y-4">

            <div>
              <label className="text-xs text-zinc-400 block mb-1">GitHub Username</label>
              <input
                className="input w-full"
                value={form.github_username}
                onChange={e => field('github_username', e.target.value)}
                placeholder="your-username"
                autoComplete="off"
              />
              <p className="text-xs text-zinc-600 mt-1">Used to list public repos if no token is set.</p>
            </div>

            <div>
              <label className="text-xs text-zinc-400 block mb-1">Personal Access Token</label>
              <input
                className="input w-full mono"
                type={tokenFocused ? 'text' : 'password'}
                value={tokenFocused ? (form.github_token === savedToken ? '' : form.github_token) : form.github_token}
                onFocus={() => {
                  setTokenFocused(true)
                  // Clear so user can type a new one
                  if (form.github_token === savedToken) field('github_token', '')
                }}
                onBlur={() => {
                  setTokenFocused(false)
                  // Restore masked value if user left it blank
                  if (!form.github_token) {
                    setForm(f => ({ ...f, github_token: savedToken }))
                  }
                }}
                onChange={e => field('github_token', e.target.value)}
                placeholder="ghp_… (leave blank to keep existing)"
                autoComplete="new-password"
              />
              <p className="text-xs text-zinc-600 mt-1">
                Needed for private repos and higher API rate limits. Requires <code className="text-zinc-500">repo</code> scope.
              </p>
            </div>

            <div className="flex gap-2 items-center">
              <button className="btn-ghost" onClick={testConnection} disabled={testing}>
                {testing ? 'Testing…' : 'Test Connection'}
              </button>
              {testMsg && (
                <span className={`text-xs ${testMsg.ok ? 'text-green-400' : 'text-red-400'}`}>
                  {testMsg.ok ? '✓' : '✗'} {testMsg.text}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Paths */}
        <div className="panel">
          <div className="panel-header">Local Storage</div>
          <div className="p-4">
            <label className="text-xs text-zinc-400 block mb-1">Clone Base Path</label>
            <input
              className="input w-full mono"
              value={form.clone_base_path}
              onChange={e => field('clone_base_path', e.target.value)}
              placeholder="~/Projects"
            />
            <p className="text-xs text-zinc-600 mt-1">
              Repositories will be cloned into subdirectories of this path.
            </p>
          </div>
        </div>

        {/* Save */}
        <div className="flex items-center gap-3">
          <button className="btn-primary px-6" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
          {saveMsg && (
            <span className={`text-sm ${saveMsg.ok ? 'text-green-400' : 'text-red-400'}`}>
              {saveMsg.ok ? '✓' : '✗'} {saveMsg.text}
            </span>
          )}
        </div>

      </div>
    </div>
  )
}
