import type { Account, GitRepo, RepoStatus, FileEntry } from '../types'

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

export function createOCDApi(remoteId?: string) {
  // When remoteId is set, all calls are proxied through /api/remotes/{id}/proxy/
  const prefix = remoteId ? `/remotes/${remoteId}/proxy/api` : ''

  function r<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    return req<T>(method, `${prefix}${path}`, body)
  }

  return {
    start:      (cfg: object)  => r('POST', '/openocd/start', cfg),
    stop:       ()             => r('POST', '/openocd/stop'),
    connect:    ()             => r('POST', '/openocd/connect'),
    disconnect: ()             => r('POST', '/openocd/disconnect'),
    status:     ()             => r('GET',  '/openocd/status'),
    command:    (cmd: string)  => r<{ ok: boolean; result: string }>('POST', '/openocd/command', { cmd }),

    uploadFirmware: (file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      return fetch(`${BASE}${prefix}/openocd/firmware/upload`, { method: 'POST', body: fd }).then(res => res.json())
    },

    flash: {
      halt:       ()                                          => r('POST', '/openocd/flash/halt'),
      eraseChip:  ()                                          => r('POST', '/openocd/flash/erase_chip'),
      erase:      (address: string, size: string)             => r('POST', '/openocd/flash/erase', { address, size }),
      program: (filename: string, address: string, verify: boolean) =>
        r('POST', '/openocd/flash/program', { filename, address, verify }),
      read:    (address: string, size: string, output_filename: string) =>
        r('POST', '/openocd/flash/read', { address, size, output_filename }),
      verify:  (filename: string, address: string)         => r('POST', '/openocd/flash/verify', { filename, address }),
      reset:   ()                                          => r('POST', '/openocd/flash/reset'),
      info:    ()                                          => r('GET', '/openocd/flash/info'),
      downloadUrl: (filename: string) => `${BASE}${prefix}/openocd/flash/download/${filename}`,
      patchBytes: (address: number, data: number[]) => r<{ ok: boolean; result: string; page_size?: number; page_base?: string }>('POST', '/openocd/flash/patch_bytes', { address, data }),
      pageSize:   () => r<{ ok: boolean; page_size: number }>('GET', '/openocd/flash/page_size'),
    },

    memory: {
      read:  (address: string, size: number) => r<{ ok: boolean; rows: Array<{ address: string; words: number[] }> }>('POST', '/openocd/memory/read', { address, size }),
      write: (address: string, value: string) => r('POST', '/openocd/memory/write', { address, value }),
    },
  }
}

export type OcdApi = ReturnType<typeof createOCDApi>

export const openocd = createOCDApi()

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
  repos:   () => req<{ ok: boolean; error?: string; errors?: string[]; repos: GitRepo[] }>('GET', '/projects/repos'),
  status:  (accountId: string, name: string) => req<{ ok: boolean; status: RepoStatus; local_path?: string; ahead?: number; behind?: number }>('GET', `/projects/repos/${accountId}/${name}/status`),
  changes: (accountId: string, name: string) => req<{ ok: boolean; files: Array<{ code: string; file: string }> }>('GET', `/projects/repos/${accountId}/${name}/changes`),
  clone:   (accountId: string, name: string, clone_url: string) => req<{ ok: boolean }>('POST', `/projects/repos/${accountId}/${name}/clone?clone_url=${encodeURIComponent(clone_url)}`),
  pull:    (accountId: string, name: string) => req<{ ok: boolean }>('POST', `/projects/repos/${accountId}/${name}/pull`),
  fetch:   (accountId: string, name: string) => req<{ ok: boolean }>('POST', `/projects/repos/${accountId}/${name}/fetch`),
  commit:      (accountId: string, name: string, message: string) => req<{ ok: boolean }>('POST', `/projects/repos/${accountId}/${name}/commit`, { message }),
  deleteLocal: (accountId: string, name: string) => req<{ ok: boolean; error?: string }>('DELETE', `/projects/repos/${accountId}/${name}/local`),
  listFiles: (accountId: string, name: string, path = '') =>
    req<{ ok: boolean; entries: FileEntry[] }>('GET', `/projects/repos/${accountId}/${name}/files${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  readFile:  (accountId: string, name: string, path: string) =>
    req<{ ok: boolean; content: string }>('GET', `/projects/repos/${accountId}/${name}/file?path=${encodeURIComponent(path)}`),
  writeFile: (accountId: string, name: string, path: string, content: string) =>
    req<{ ok: boolean }>('PUT', `/projects/repos/${accountId}/${name}/file?path=${encodeURIComponent(path)}`, { content }),
}

// ── Serial ───────────────────────────────────────────────────────────────────

export function createSerialApi(remoteId?: string) {
  const prefix = remoteId ? `/remotes/${remoteId}/proxy/api` : ''
  function r<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    return req<T>(method, `${prefix}${path}`, body)
  }
  return {
    ports:      () => r<{ ok: boolean; ports: Array<{ device: string; description: string }> }>('GET', '/serial/ports'),
    connect:    (body: object) => r('POST', '/serial/connect', body),
    disconnect: ()             => r('POST', '/serial/disconnect'),
    status:     ()             => r('GET',  '/serial/status'),
    send:       (body: object) => r('POST', '/serial/send', body),
    logStart:   (path: string) => r<{ ok: boolean; path?: string; error?: string }>('POST', '/serial/log/start', { path }),
    logStop:    ()             => r<{ ok: boolean; path?: string }>('POST', '/serial/log/stop'),
  }
}

export type SerialApi = ReturnType<typeof createSerialApi>
export const serial = createSerialApi()

// ── MQTT ──────────────────────────────────────────────────────────────────────

export const mqtt = {
  brokers:          () => req<{ brokers: MqttBroker[] }>('GET', '/mqtt/brokers'),
  addBroker:        (body: { name?: string; host: string; port: number; username?: string; password?: string }) =>
    req<{ ok: boolean; broker?: MqttBroker; error?: string }>('POST', '/mqtt/brokers', body),
  removeBroker:      (id: string) => req<{ ok: boolean }>('DELETE', `/mqtt/brokers/${id}`),
  connectBroker:     (id: string) => req<{ ok: boolean; error?: string }>('POST', `/mqtt/brokers/${id}/connect`),
  disconnectBroker:  (id: string) => req<{ ok: boolean }>('POST', `/mqtt/brokers/${id}/disconnect`),
  subscribeTopic:   (id: string, topic: string) =>
    req<{ ok: boolean; error?: string }>('POST', `/mqtt/brokers/${id}/topics`, { topic }),
  unsubscribeTopic: (id: string, topic: string) =>
    req<{ ok: boolean }>('DELETE', `/mqtt/brokers/${id}/topics/${encodeURIComponent(topic)}`),
  publish:          (id: string, topic: string, payload: string) =>
    req<{ ok: boolean; error?: string }>('POST', `/mqtt/brokers/${id}/publish`, { topic, payload }),
}

export interface MqttBroker {
  id:        string
  name:      string
  host:      string
  port:      number
  username:  string | null
  topics:    string[]
  connected: boolean
  error:     string | null
}

// ── Scripts ───────────────────────────────────────────────────────────────────

export interface ScriptMeta {
  id: number
  name: string
  file_keys: string[]
}

export interface Script {
  id: number
  name: string
  src: string
  files: Record<string, string>
}

export const scripts = {
  list:   ()                               => req<{ ok: boolean; scripts: ScriptMeta[] }>('GET', '/scripts'),
  get:    (id: number)                     => req<{ ok: boolean; script: Script }>('GET', `/scripts/${id}`),
  upsert: (s: Script)                      => req<{ ok: boolean; script: Script }>('POST', '/scripts', s),
  delete: (id: number)                     => req<{ ok: boolean }>('DELETE', `/scripts/${id}`),
  run:    (id: number, remoteId?: string)  => req<{ ok: boolean }>('POST', `/scripts/${id}/run${remoteId ? `?remote_id=${remoteId}` : ''}`),
  stop:   ()                               => req<{ ok: boolean }>('POST', '/scripts/stop'),
}

// ── Remotes ───────────────────────────────────────────────────────────────────

export interface RemoteAgent {
  id:        string
  name:      string
  host:      string
  port:      number
  has_token: boolean
}

export const remotes = {
  list:   ()                                                    => req<{ ok: boolean; remotes: RemoteAgent[] }>('GET', '/remotes'),
  add:    (body: { name: string; host: string; port: number; token?: string }) => req<{ ok: boolean; remote: RemoteAgent }>('POST', '/remotes', body),
  update: (id: string, body: { name: string; host: string; port: number; token?: string }) => req<{ ok: boolean; remote: RemoteAgent }>('PUT', `/remotes/${id}`, body),
  delete: (id: string)                                          => req<{ ok: boolean }>('DELETE', `/remotes/${id}`),
  test:   (id: string)                                          => req<{ ok: boolean; info?: object; error?: string }>('POST', `/remotes/${id}/test`),
}

// ── Tools ─────────────────────────────────────────────────────────────────────

export const tools = {
  networkInterfaces: () => req<{ interfaces: Array<{ interface: string; ip: string; prefix: number; broadcast: string }>; client_ip: string }>('GET', '/tools/network/interfaces'),
  scanNetwork:       (subnet: string) => req<{ hosts: Array<{ ip: string; hostname: string; mac: string }>; count: number }>('POST', '/tools/network/scan', { subnet }),
  captureInterfaces: () => req<{ interfaces: string[] }>('GET', '/tools/network/capture-interfaces'),
}
