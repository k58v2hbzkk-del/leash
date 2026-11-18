// Talks to the Leash server. Same origin when served by it; VITE_API overrides for packaged builds.
export const API = (import.meta.env.VITE_API as string | undefined)?.replace(/\/$/, '') ?? ''

export type Intent = { coin: string; side: 'long' | 'short'; leverage: number; usd: number; reason: string }
export type Preview = { entry: number; liq: number; liqDistPct: number; exposurePct: number; marginUsd: number }
export type Request = { id: string; agent: string; intent: Intent; reason: string; preview: Preview; expires: number; secondsLeft: number }
export type Position = { id: string; agent: string; coin: string; side: string; leverage: number; entry: number; mark: number; sizeUsd: number; pnl: number; pnlPct: number; liq: number; liqDistPct: number; reason: string }
export type Agent = { name: string; kind: string; paused: boolean; pausedReason: string | null; pnlToday: number; rules: Record<string, any> }
export type Ev = { id: string; type: string; ts: number; agent?: string; intent?: Intent; reason?: string; request?: Request; how?: string; by?: string; pnl?: number; loss?: number; coin?: string; fraction?: number; position?: Position; preview?: Preview }
export type State = {
  equity: number
  pnl: number
  pnlPct: number
  killed: boolean
  source: string
  mids: Record<string, number>
  positions: Position[]
  pending: Request[]
  agents: Agent[]
  stats: Record<string, number>
  feed: Ev[]
}

async function post(path: string, body: unknown) {
  const r = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return r.json()
}

export const api = {
  decide: (id: string, decision: 'approve' | 'reject', by: string) => post(`/api/approvals/${id}`, { decision, by }),
  close: (positionId: string, fraction: number, by: string) => post('/api/close', { positionId, fraction, by }),
  kill: (on: boolean) => post('/api/kill', { on }),
  agent: (name: string, patch: Record<string, unknown>) => post(`/api/agents/${name}`, patch),
  demo: (step: number) => post(`/api/demo/${step}`, {}),
  reset: () => post('/api/reset', {}),
}

/** Live state + events over server-sent events, with automatic reconnect. */
export function connect(onState: (s: State) => void, onEvent: (e: Ev) => void, onStatus: (ok: boolean) => void) {
  let es: EventSource | null = null
  const open = () => {
    es = new EventSource(API + '/api/stream')
    es.addEventListener('state', (m) => onState(JSON.parse((m as MessageEvent).data)))
    es.addEventListener('event', (m) => onEvent(JSON.parse((m as MessageEvent).data)))
    es.onopen = () => onStatus(true)
    es.onerror = () => {
      onStatus(false)
      es?.close()
      setTimeout(open, 2000)
    }
  }
  open()
}

export const usd = (n: number) => {
  const a = Math.abs(n)
  const s = a >= 1000 ? a.toLocaleString('en-US', { maximumFractionDigits: 0 }) : a.toFixed(2)
  return (n < 0 ? '-$' : '$') + s
}
export const signed = (n: number) => (n >= 0 ? '+' : '-') + usd(Math.abs(n))
export const price = (n: number) => (n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : n >= 10 ? n.toFixed(2) : n.toFixed(4))
