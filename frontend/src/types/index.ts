export interface OpenOCDStatus {
  server: 'stopped' | 'starting' | 'running' | 'error'
  connected: boolean
  pid?: number | null
}

export interface LogEntry {
  id: number
  text: string
  level: 'info' | 'warn' | 'error'
  timestamp: string
}

export interface MemoryRow {
  address: string
  words: number[]
}

export interface McuTarget {
  name: string
  config: string
  note?: string
}

export interface McuManufacturer {
  name: string
  targets: McuTarget[]
}

export interface SerialPort {
  device: string
  description: string
  hwid: string
}

export interface SerialStatus {
  connected: boolean
  port: string
  baud: number
}

export interface SerialDataEvent {
  type: 'data'
  hex: string
  text: string
  raw: number[]
}

export interface ApiResponse<T = unknown> {
  ok: boolean
  error?: string
  result?: string
  data?: T
}

export type Platform = 'github' | 'bitbucket'

export interface Account {
  id: string
  platform: Platform
  label: string
  username: string
  token: string        // masked on server side
  workspace: string    // bitbucket workspace slug
  clone_base_path: string
}

export type RepoStatus = 'not_cloned' | 'clean' | 'dirty' | 'behind' | 'ahead' | 'diverged' | 'unknown'

export interface GitRepo {
  name: string
  full_name: string
  description: string
  html_url: string
  clone_url: string
  private: boolean
  fork: boolean
  language: string
  updated_at: string
  stargazers_count: number
  status: RepoStatus
  local_path: string
  ahead?: number
  behind?: number
  platform: Platform
  account_id: string
  account_label: string
  account_username: string
}

// Alias kept for compatibility with existing components
export type GitHubRepo = GitRepo

export interface FileEntry {
  name: string
  path: string
  type: 'file' | 'dir'
  size: number
}
