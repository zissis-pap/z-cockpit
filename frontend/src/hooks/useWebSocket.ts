import { useEffect, useRef, useCallback } from 'react'

type OnMessage = (data: unknown) => void

export function useWebSocket(path: string, onMessage: OnMessage, enabled = true) {
  const wsRef = useRef<WebSocket | null>(null)
  const onMsgRef = useRef(onMessage)
  onMsgRef.current = onMessage

  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  const connect = useCallback(() => {
    if (!mountedRef.current) return
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const url = `${protocol}//${host}${path}`
    const ws = new WebSocket(url)

    ws.onmessage = (ev) => {
      try {
        onMsgRef.current(JSON.parse(ev.data))
      } catch {
        onMsgRef.current(ev.data)
      }
    }

    ws.onclose = () => {
      if (!mountedRef.current) return
      // Reconnect after 2 s
      reconnectTimer.current = setTimeout(connect, 2000)
    }

    ws.onerror = () => {
      ws.close()
    }

    wsRef.current = ws

    // Keep-alive ping every 20 s
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send('ping')
    }, 20000)

    const origOnClose = ws.onclose
    ws.addEventListener('close', () => clearInterval(pingInterval))
    // suppress TS unused var:
    void origOnClose
  }, [path])

  useEffect(() => {
    mountedRef.current = true
    if (enabled) connect()
    return () => {
      mountedRef.current = false
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect, enabled])
}
