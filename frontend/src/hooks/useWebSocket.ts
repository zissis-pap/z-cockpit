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
      clearInterval(pingInterval)
      if (!mountedRef.current) return
      if (wsRef.current !== ws) return  // stale connection — path changed, don't reconnect
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
  }, [path])

  useEffect(() => {
    mountedRef.current = true
    if (enabled) connect()
    return () => {
      mountedRef.current = false
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      const ws = wsRef.current
      wsRef.current = null  // nullify before close so onclose skips stale reconnect
      ws?.close()
    }
  }, [connect, enabled])
}
