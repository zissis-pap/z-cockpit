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

export interface McuSeries {
  id: string
  name: string
  config: string
}

export interface McuFamily {
  id: string
  name: string
  config: string
  series: McuSeries[]
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
