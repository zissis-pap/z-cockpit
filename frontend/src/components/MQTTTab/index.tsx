import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { mqtt, type MqttBroker } from '../../api/client'

// ── Types ─────────────────────────────────────────────────────────────────────

interface MqttMessage {
  id:        number
  ts:        string
  broker_id: string
  topic:     string
  payload:   string
  qos:       number
  retain:    boolean
}

// ── Virtual scroll constants ──────────────────────────────────────────────────

const ROW_HEIGHT = 21
const OVERSCAN   = 20
const MAX_MSGS   = 5000

let msgSeq = 0

// ── JSON tree renderer ────────────────────────────────────────────────────────

function JsonValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const [collapsed, setCollapsed] = useState(false)
  const indent = depth * 16

  if (value === null)    return <span className="text-zinc-500">null</span>
  if (value === true)    return <span className="text-yellow-400">true</span>
  if (value === false)   return <span className="text-yellow-400">false</span>
  if (typeof value === 'number') return <span className="text-blue-400">{value}</span>
  if (typeof value === 'string') return <span className="text-green-400">"{value}"</span>

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-zinc-400">[]</span>
    return (
      <span>
        <button
          className="text-zinc-500 hover:text-zinc-300 select-none"
          onClick={() => setCollapsed(v => !v)}
        >{collapsed ? '▶' : '▼'}</button>
        {collapsed ? (
          <span className="text-zinc-500 cursor-pointer" onClick={() => setCollapsed(false)}>
            {' ['}
            <span className="text-zinc-600">{value.length} items</span>
            {']'}
          </span>
        ) : (
          <>
            <span className="text-zinc-400"> [</span>
            <div style={{ marginLeft: indent + 16 }}>
              {value.map((item, i) => (
                <div key={i}>
                  <JsonValue value={item} depth={depth + 1} />
                  {i < value.length - 1 && <span className="text-zinc-600">,</span>}
                </div>
              ))}
            </div>
            <div style={{ marginLeft: indent }}><span className="text-zinc-400">]</span></div>
          </>
        )}
      </span>
    )
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value as object)
    if (keys.length === 0) return <span className="text-zinc-400">{'{}'}</span>
    return (
      <span>
        <button
          className="text-zinc-500 hover:text-zinc-300 select-none"
          onClick={() => setCollapsed(v => !v)}
        >{collapsed ? '▶' : '▼'}</button>
        {collapsed ? (
          <span className="text-zinc-500 cursor-pointer" onClick={() => setCollapsed(false)}>
            {' {'}
            <span className="text-zinc-600">{keys.length} keys</span>
            {'}'}
          </span>
        ) : (
          <>
            <span className="text-zinc-400"> {'{'}</span>
            <div style={{ marginLeft: indent + 16 }}>
              {keys.map((k, i) => (
                <div key={k}>
                  <span className="text-cyan-300">"{k}"</span>
                  <span className="text-zinc-500">: </span>
                  <JsonValue value={(value as Record<string, unknown>)[k]} depth={depth + 1} />
                  {i < keys.length - 1 && <span className="text-zinc-600">,</span>}
                </div>
              ))}
            </div>
            <div style={{ marginLeft: indent }}><span className="text-zinc-400">{'}'}</span></div>
          </>
        )}
      </span>
    )
  }

  return <span className="text-zinc-300">{String(value)}</span>
}

function JsonViewer({ raw }: { raw: string }) {
  const [copied, setCopied] = useState(false)

  const parsed = useMemo(() => {
    try { return { ok: true, value: JSON.parse(raw) } }
    catch (e) { return { ok: false, error: String(e) } }
  }, [raw])

  function copy() {
    const text = parsed.ok ? JSON.stringify(parsed.value, null, 2) : raw
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#30363d] shrink-0">
        <span className="text-xs text-zinc-500">
          {parsed.ok ? 'JSON' : 'Raw payload'}
        </span>
        <button
          className="btn-ghost text-xs px-2 py-0.5"
          onClick={copy}
        >{copied ? '✓ Copied' : 'Copy'}</button>
      </div>
      <div className="flex-1 overflow-auto p-3">
        {parsed.ok ? (
          <div className="mono text-xs leading-5">
            <JsonValue value={parsed.value} />
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-xs text-amber-400 mono">{parsed.error}</div>
            <pre className="mono text-xs text-zinc-300 whitespace-pre-wrap break-all">{raw}</pre>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Payload detail panel ──────────────────────────────────────────────────────

function DetailPanel({
  msg,
  brokerLabel,
  onClose,
}: {
  msg:         MqttMessage
  brokerLabel: (id: string) => string
  onClose:     () => void
}) {
  return (
    <div className="flex flex-col h-full border-l border-[#30363d] bg-[#0f1117]">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-[#30363d]">
        <div className="min-w-0">
          <div className="mono text-xs text-cyan-400 truncate">{msg.topic}</div>
          <div className="text-xs text-zinc-500 truncate">
            {brokerLabel(msg.broker_id)} · {msg.ts}
            {msg.retain && <span className="ml-1.5 text-amber-500">RETAIN</span>}
            <span className="ml-1.5">QoS {msg.qos}</span>
          </div>
        </div>
        <button
          className="btn-ghost text-xs px-1.5 py-0.5 shrink-0 ml-2"
          onClick={onClose}
          title="Close"
        >✕</button>
      </div>

      {/* JSON viewer */}
      <div className="flex-1 min-h-0">
        <JsonViewer raw={msg.payload} />
      </div>
    </div>
  )
}

// ── Broker Panel ──────────────────────────────────────────────────────────────

function BrokerPanel({
  brokers,
  onAdd,
  onRemove,
  onSubscribe,
  onUnsubscribe,
}: {
  brokers:       MqttBroker[]
  onAdd:         (host: string, port: number, user: string, pass: string) => Promise<void>
  onRemove:      (id: string) => Promise<void>
  onSubscribe:   (id: string, topic: string) => Promise<void>
  onUnsubscribe: (id: string, topic: string) => Promise<void>
}) {
  const [host, setHost]         = useState('localhost')
  const [port, setPort]         = useState('1883')
  const [user, setUser]         = useState('')
  const [pass, setPass]         = useState('')
  const [showPass, setShowPass] = useState(false)
  const [adding, setAdding]     = useState(false)
  const [error, setError]       = useState('')
  const [topicInputs, setTopicInputs] = useState<Record<string, string>>({})

  async function handleAdd() {
    if (!host.trim()) return
    setAdding(true); setError('')
    try {
      await onAdd(host.trim(), parseInt(port) || 1883, user.trim(), pass)
      setHost('localhost'); setPort('1883'); setUser(''); setPass('')
    } catch (e) {
      setError(String(e))
    } finally {
      setAdding(false)
    }
  }

  async function handleSubscribe(brokerId: string) {
    const topic = (topicInputs[brokerId] ?? '').trim()
    if (!topic) return
    await onSubscribe(brokerId, topic)
    setTopicInputs(prev => ({ ...prev, [brokerId]: '' }))
  }

  return (
    <div className="flex flex-col gap-3 h-full overflow-y-auto">
      <div className="panel shrink-0">
        <div className="panel-header">Add Broker</div>
        <div className="p-3 space-y-2">
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs text-zinc-500 block mb-0.5">Host</label>
              <input className="input w-full mono text-xs" value={host} onChange={e => setHost(e.target.value)}
                placeholder="192.168.1.100" onKeyDown={e => e.key === 'Enter' && handleAdd()} />
            </div>
            <div className="w-20">
              <label className="text-xs text-zinc-500 block mb-0.5">Port</label>
              <input className="input w-full mono text-xs" value={port} onChange={e => setPort(e.target.value)} placeholder="1883" />
            </div>
          </div>
          <div>
            <label className="text-xs text-zinc-500 block mb-0.5">Username <span className="text-zinc-600">(optional)</span></label>
            <input className="input w-full text-xs" value={user} onChange={e => setUser(e.target.value)}
              placeholder="anonymous" autoComplete="off" />
          </div>
          <div>
            <label className="text-xs text-zinc-500 block mb-0.5">Password <span className="text-zinc-600">(optional)</span></label>
            <div className="flex gap-1">
              <input className="input flex-1 text-xs" type={showPass ? 'text' : 'password'}
                value={pass} onChange={e => setPass(e.target.value)}
                placeholder="••••••••" autoComplete="new-password" />
              <button className="btn-ghost text-xs px-2 py-0.5" onClick={() => setShowPass(v => !v)}>
                {showPass ? '🙈' : '👁'}
              </button>
            </div>
          </div>
          {error && <div className="text-xs text-red-400 mono">{error}</div>}
          <button className="btn-primary w-full" onClick={handleAdd} disabled={adding || !host.trim()}>
            {adding ? 'Connecting…' : '+ Connect'}
          </button>
        </div>
      </div>

      {brokers.length === 0 ? (
        <div className="text-xs text-zinc-600 italic px-1">No brokers connected yet.</div>
      ) : brokers.map(broker => (
        <div key={broker.id} className="panel shrink-0">
          <div className="panel-header flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`w-2 h-2 rounded-full shrink-0 ${
                broker.connected ? 'bg-green-400' : broker.error ? 'bg-red-400 animate-pulse' : 'bg-yellow-400 animate-pulse'
              }`} />
              <span className="mono truncate text-sm">{broker.host}:{broker.port}</span>
              {broker.username && <span className="text-zinc-600 text-xs truncate">({broker.username})</span>}
            </div>
            <button className="btn-ghost text-xs px-1.5 py-0.5 text-red-400 border-red-500/30 hover:border-red-400 shrink-0"
              onClick={() => onRemove(broker.id)} title="Disconnect and remove">✕</button>
          </div>
          <div className="p-3 space-y-2">
            {broker.error && (
              <div className="text-xs text-red-400 mono bg-red-900/10 border border-red-500/20 rounded px-2 py-1">
                {broker.error}
              </div>
            )}
            {broker.topics.length > 0 && (
              <div className="space-y-1">
                {broker.topics.map(topic => (
                  <div key={topic} className="flex items-center justify-between gap-2 px-2 py-0.5 rounded bg-[#0f1117] border border-[#30363d]">
                    <span className="mono text-xs text-cyan-400 truncate">{topic}</span>
                    <button className="text-zinc-600 hover:text-red-400 text-xs shrink-0"
                      onClick={() => onUnsubscribe(broker.id, topic)} title="Unsubscribe">✕</button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-1">
              <input className="input flex-1 mono text-xs"
                value={topicInputs[broker.id] ?? ''}
                onChange={e => setTopicInputs(prev => ({ ...prev, [broker.id]: e.target.value }))}
                placeholder="sensors/# or device/temp"
                onKeyDown={e => e.key === 'Enter' && handleSubscribe(broker.id)}
                disabled={!broker.connected} />
              <button className="btn-ghost text-xs px-2"
                onClick={() => handleSubscribe(broker.id)}
                disabled={!broker.connected || !(topicInputs[broker.id] ?? '').trim()}>+</button>
            </div>
            <div className="text-xs text-zinc-600 mono">id: {broker.id}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Message Log ───────────────────────────────────────────────────────────────

function MessageLog({
  messages,
  brokers,
  selectedId,
  onSelect,
  onClear,
}: {
  messages:   MqttMessage[]
  brokers:    MqttBroker[]
  selectedId: number | null
  onSelect:   (msg: MqttMessage) => void
  onClear:    () => void
}) {
  const [filterBroker, setFilterBroker] = useState('')
  const [filterTopic,  setFilterTopic]  = useState('')
  const [autoScroll,   setAutoScroll]   = useState(true)
  const [scrollTop,    setScrollTop]    = useState(0)

  const containerRef = useRef<HTMLDivElement>(null)

  const brokerLabel = useCallback((id: string) => {
    const b = brokers.find(b => b.id === id)
    return b ? `${b.host}:${b.port}` : id
  }, [brokers])

  const filtered = useMemo(() => messages.filter(m => {
    if (filterBroker && m.broker_id !== filterBroker) return false
    if (filterTopic  && !m.topic.includes(filterTopic))  return false
    return true
  }), [messages, filterBroker, filterTopic])

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [filtered, autoScroll])

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget
    setScrollTop(el.scrollTop)
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 60 && autoScroll) setAutoScroll(false)
  }

  const viewportH = containerRef.current?.clientHeight ?? 400
  const winStart  = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const winEnd    = Math.min(filtered.length, Math.ceil((scrollTop + viewportH) / ROW_HEIGHT) + OVERSCAN)
  const spacerTop = winStart * ROW_HEIGHT
  const spacerBot = Math.max(0, (filtered.length - winEnd) * ROW_HEIGHT)
  const visible   = useMemo(() => filtered.slice(winStart, winEnd), [filtered, winStart, winEnd])

  // Detect whether payload looks like JSON (for cursor hint)
  function looksLikeJson(p: string) {
    const t = p.trim()
    return t.startsWith('{') || t.startsWith('[')
  }

  return (
    <div className="panel flex flex-col min-h-0 h-full">
      <div className="panel-header shrink-0 flex items-center justify-between flex-wrap gap-2">
        <span>
          Messages
          {filtered.length > 0 && (
            <span className="text-zinc-500 font-normal text-xs ml-1.5">
              {filtered.length.toLocaleString()}
              {filtered.length < messages.length && ` / ${messages.length.toLocaleString()}`}
              {messages.length >= MAX_MSGS && <span className="text-amber-500 ml-1">(capped)</span>}
            </span>
          )}
        </span>
        <div className="flex gap-1.5 items-center normal-case font-normal flex-wrap">
          <select className="select text-xs py-0.5 px-1 h-6 w-36" value={filterBroker} onChange={e => setFilterBroker(e.target.value)}>
            <option value="">All brokers</option>
            {brokers.map(b => <option key={b.id} value={b.id}>{b.host}:{b.port}</option>)}
          </select>
          <input className="input text-xs py-0.5 h-6 w-36 mono" value={filterTopic}
            onChange={e => setFilterTopic(e.target.value)} placeholder="Filter topic…" />
          <button
            className={`text-xs px-2 py-0.5 rounded border transition-colors ${autoScroll ? 'bg-blue-600/20 border-blue-500/40 text-blue-400' : 'btn-ghost'}`}
            onClick={() => setAutoScroll(v => !v)}>↓ Auto</button>
          <button className="btn-ghost text-xs px-2 py-0.5" onClick={onClear}>Clear</button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="p-3 text-xs text-zinc-600 italic">
          {messages.length === 0
            ? 'No messages received yet. Connect a broker and subscribe to topics.'
            : 'No messages match the current filter.'}
        </div>
      ) : (
        <div ref={containerRef} className="flex-1 overflow-auto" style={{ minHeight: 0 }} onScroll={handleScroll}>
          <table className="w-full mono text-xs border-collapse" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '7rem' }} />
              <col style={{ width: '10rem' }} />
              <col style={{ width: '14rem' }} />
              <col style={{ width: '2rem' }} />
              <col />
            </colgroup>
            <thead className="sticky top-0 bg-[#161b22] border-b border-[#30363d] z-10">
              <tr>
                <th className="px-2 py-1 text-left text-zinc-500 font-normal">Time</th>
                <th className="px-2 py-1 text-left text-zinc-500 font-normal">Broker</th>
                <th className="px-2 py-1 text-left text-zinc-500 font-normal">Topic</th>
                <th className="px-2 py-1 text-left text-zinc-500 font-normal">Q</th>
                <th className="px-2 py-1 text-left text-zinc-500 font-normal">Payload</th>
              </tr>
            </thead>
            <tbody>
              {spacerTop > 0 && <tr><td colSpan={5} style={{ height: spacerTop, padding: 0 }} /></tr>}

              {visible.map(msg => {
                const isSelected = msg.id === selectedId
                const isJson = looksLikeJson(msg.payload)
                return (
                  <tr
                    key={msg.id}
                    style={{ height: ROW_HEIGHT }}
                    className={`border-b border-[#21262d]/50 transition-colors
                      ${isSelected ? 'bg-blue-600/20 border-blue-500/30' : 'hover:bg-[#21262d]/60'}
                      ${isJson ? 'cursor-pointer' : ''}
                      ${msg.retain ? 'opacity-70' : ''}`}
                    onClick={() => onSelect(msg)}
                    title={isJson ? 'Click to inspect JSON' : undefined}
                  >
                    <td className="px-2 text-zinc-500 truncate">{msg.ts}</td>
                    <td className="px-2 text-blue-400 truncate">{brokerLabel(msg.broker_id)}</td>
                    <td className="px-2 text-cyan-400 truncate">{msg.topic}</td>
                    <td className="px-2 text-zinc-600 text-center">{msg.qos}</td>
                    <td className={`px-2 truncate ${isJson ? 'text-green-400/80' : 'text-zinc-200'}`}>
                      {msg.payload}
                    </td>
                  </tr>
                )
              })}

              {spacerBot > 0 && <tr><td colSpan={5} style={{ height: spacerBot, padding: 0 }} /></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Main MQTTTab ──────────────────────────────────────────────────────────────

export default function MQTTTab() {
  const [brokers,  setBrokers]  = useState<MqttBroker[]>([])
  const [messages, setMessages] = useState<MqttMessage[]>([])
  const [selected, setSelected] = useState<MqttMessage | null>(null)

  const wsRef = useRef<WebSocket | null>(null)

  const brokerLabel = useCallback((id: string) => {
    const b = brokers.find(b => b.id === id)
    return b ? `${b.host}:${b.port}` : id
  }, [brokers])

  // ── WebSocket ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/mqtt`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'init') {
          setBrokers(msg.brokers ?? [])
        } else if (msg.type === 'broker_updated') {
          setBrokers(prev => prev.map(b => b.id === msg.broker.id ? msg.broker : b))
        } else if (msg.type === 'broker_removed') {
          setBrokers(prev => prev.filter(b => b.id !== msg.broker_id))
        } else if (msg.type === 'message') {
          const now = new Date()
          const ts  = now.toLocaleTimeString('en-US', { hour12: false }) +
                      '.' + String(now.getMilliseconds()).padStart(3, '0')
          const entry: MqttMessage = {
            id: msgSeq++, ts,
            broker_id: msg.broker_id,
            topic:     msg.topic,
            payload:   msg.payload,
            qos:       msg.qos,
            retain:    msg.retain,
          }
          setMessages(prev => {
            const next = [...prev, entry]
            return next.length > MAX_MSGS ? next.slice(next.length - MAX_MSGS) : next
          })
        }
      } catch { /* ignore */ }
    }

    return () => { ws.close(); wsRef.current = null }
  }, [])

  // ── Broker actions ─────────────────────────────────────────────────────────

  async function handleAdd(host: string, port: number, user: string, pass: string) {
    const res = await mqtt.addBroker({ host, port, username: user || undefined, password: pass || undefined })
    if (!res.ok) throw new Error(res.error ?? 'Failed to connect')
    if (res.broker) setBrokers(prev => [...prev, res.broker!])
  }

  async function handleRemove(id: string) {
    await mqtt.removeBroker(id)
    setBrokers(prev => prev.filter(b => b.id !== id))
    setMessages(prev => prev.filter(m => m.broker_id !== id))
    if (selected?.broker_id === id) setSelected(null)
  }

  async function handleSubscribe(id: string, topic: string) {
    await mqtt.subscribeTopic(id, topic)
  }

  async function handleUnsubscribe(id: string, topic: string) {
    await mqtt.unsubscribeTopic(id, topic)
  }

  return (
    <div className="flex h-full overflow-hidden">

      {/* Left: broker management */}
      <div className="w-72 shrink-0 flex flex-col p-3 border-r border-[#21262d] overflow-y-auto">
        <BrokerPanel
          brokers={brokers}
          onAdd={handleAdd}
          onRemove={handleRemove}
          onSubscribe={handleSubscribe}
          onUnsubscribe={handleUnsubscribe}
        />
      </div>

      {/* Middle: message log */}
      <div className={`flex flex-col p-3 min-w-0 overflow-hidden transition-all ${selected ? 'flex-[2]' : 'flex-1'}`}>
        <MessageLog
          messages={messages}
          brokers={brokers}
          selectedId={selected?.id ?? null}
          onSelect={setSelected}
          onClear={() => { setMessages([]); setSelected(null) }}
        />
      </div>

      {/* Right: detail panel */}
      {selected && (
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden min-w-[280px] max-w-[480px]">
          <DetailPanel
            msg={selected}
            brokerLabel={brokerLabel}
            onClose={() => setSelected(null)}
          />
        </div>
      )}
    </div>
  )
}
