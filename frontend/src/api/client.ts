import type { Account, GitRepo, RepoStatus } from '../types'

const BASE = '/api'

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status}: ${text}`)
  }
  return res.json()
}

// ── OpenOCD ─────────────────────────────────────────────────────────────────

export const openocd = {
  start:      (cfg: object)  => req('POST', '/openocd/start', cfg),
  stop:       ()             => req('POST', '/openocd/stop'),
  connect:    ()             => req('POST', '/openocd/connect'),
  disconnect: ()             => req('POST', '/openocd/disconnect'),
  status:     ()             => req('GET',  '/openocd/status'),
  command:    (cmd: string)  => req<{ ok: boolean; result: string }>('POST', '/openocd/command', { cmd }),

  uploadFirmware: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return fetch(`${BASE}/openocd/firmware/upload`, { method: 'POST', body: fd }).then(r => r.json())
  },

  flash: {
    halt:    ()                                          => req('POST', '/openocd/flash/halt'),
    erase:   (address: string, size: string)             => req('POST', '/openocd/flash/erase', { address, size }),
    program: (filename: string, address: string, verify: boolean) =>
      req('POST', '/openocd/flash/program', { filename, address, verify }),
    read:    (address: string, size: string, output_filename: string) =>
      req('POST', '/openocd/flash/read', { address, size, output_filename }),
    verify:  (filename: string, address: string)         => req('POST', '/openocd/flash/verify', { filename, address }),
    reset:   ()                                          => req('POST', '/openocd/flash/reset'),
    info:    ()                                          => req('GET', '/openocd/flash/info'),
    downloadUrl: (filename: string) => `${BASE}/openocd/flash/download/${filename}`,
  },

  memory: {
    read:  (address: string, size: number) => req<{ ok: boolean; rows: Array<{ address: string; words: number[] }> }>('POST', '/openocd/memory/read', { address, size }),
    write: (address: string, value: string) => req('POST', '/openocd/memory/write', { address, value }),
  },
}

// ── Settings ─────────────────────────────────────────────────────────────────

export const settings = {
  accounts:      () => req<{ ok: boolean; accounts: Account[] }>('GET', '/settings/accounts'),
  addAccount:    (body: object) => req<{ ok: boolean; account: Account }>('POST', '/settings/accounts', body),
  updateAccount: (id: string, body: object) => req<{ ok: boolean; account: Account }>('PUT', `/settings/accounts/${id}`, body),
  deleteAccount: (id: string) => req<{ ok: boolean }>('DELETE', `/settings/accounts/${id}`),
  testAccount:   (id: string) => req<{ ok: boolean; login?: string; name?: string; error?: string }>('POST', `/settings/accounts/${id}/test`),
}

// ── Projects ──────────────────────────────────────────────────────────────────

export const projects = {
  repos:   () => req<{ ok: boolean; error?: string; repos: GitRepo[] }>('GET', '/projects/repos'),
  status:  (accountId: string, name: string) => req<{ ok: boolean; status: RepoStatus; local_path?: string; behind?: number }>('GET', `/projects/repos/${accountId}/${name}/status`),
  changes: (accountId: string, name: string) => req<{ ok: boolean; files: Array<{ code: string; file: string }> }>('GET', `/projects/repos/${accountId}/${name}/changes`),
  clone:   (accountId: string, name: string, clone_url: string) => req<{ ok: boolean }>('POST', `/projects/repos/${accountId}/${name}/clone?clone_url=${encodeURIComponent(clone_url)}`),
  pull:    (accountId: string, name: string) => req<{ ok: boolean }>('POST', `/projects/repos/${accountId}/${name}/pull`),
  fetch:   (accountId: string, name: string) => req<{ ok: boolean }>('POST', `/projects/repos/${accountId}/${name}/fetch`),
  commit:  (accountId: string, name: string, message: string) => req<{ ok: boolean }>('POST', `/projects/repos/${accountId}/${name}/commit`, { message }),
}

// ── Serial ───────────────────────────────────────────────────────────────────

export const serial = {
  ports:      () => req<{ ok: boolean; ports: Array<{ device: string; description: string }> }>('GET', '/serial/ports'),
  connect:    (body: object) => req('POST', '/serial/connect', body),
  disconnect: ()             => req('POST', '/serial/disconnect'),
  status:     ()             => req('GET',  '/serial/status'),
  send:       (body: object) => req('POST', '/serial/send', body),
}
