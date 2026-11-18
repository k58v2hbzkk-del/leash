// Leash core: a paper trading account, per-agent rules enforced server-side, and a human
// approval queue. Agents never touch the exchange; they send *intents* to Leash.
import { EventEmitter } from 'node:events'
import crypto from 'node:crypto'
import { COINS, px } from './market.mjs'

export const bus = new EventEmitter()
bus.setMaxListeners(200)

const FEE = 0.00035 // Hyperliquid base taker fee
const SLIP = 0.0003
const MAINT = 0.005 // maintenance margin used for the liquidation estimate
export const APPROVAL_TTL_MS = Number(process.env.APPROVAL_TTL_MS ?? 30_000)
const START_CASH = 10_000

const id = () => crypto.randomBytes(4).toString('hex')
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d

export const DEFAULT_RULES = {
  maxLeverage: 5,
  maxExposurePct: 40, // largest single position, as % of account equity
  approveAbovePct: 10, // anything bigger than this needs a human
  approveAboveLeverage: 3,
  allowedCoins: ['BTC', 'ETH', 'SOL', 'HYPE'],
  dailyLossPct: 5, // agent is paused if it loses more than this today
  maxOrdersPerMin: 6,
}

export const state = {
  cash: START_CASH,
  startEquity: START_CASH,
  killed: false,
  agents: {}, // name -> { name, kind, key, rules, paused, pausedReason, pnlToday, orders: [ts] }
  positions: [], // { id, agent, coin, side, size, entry, leverage, margin, opened }
  pending: [], // approval requests
  feed: [], // recent events, newest first
  stats: { approved: 0, rejected: 0, blocked: 0, auto: 0, expired: 0 },
}

export function addAgent(name, kind, rules = {}) {
  const key = 'lsh_' + crypto.randomBytes(12).toString('hex')
  state.agents[name] = { name, kind, key, rules: { ...DEFAULT_RULES, ...rules }, paused: false, pausedReason: null, pnlToday: 0, orders: [] }
  return state.agents[name]
}

// ------------------------------------------------------------------ account maths
export function upnl(p) {
  const mark = px(p.coin)
  return (p.side === 'long' ? mark - p.entry : p.entry - mark) * p.size
}
export function liqPx(p) {
  const d = 1 / p.leverage - MAINT
  return p.side === 'long' ? p.entry * (1 - d) : p.entry * (1 + d)
}
export function liqDistancePct(p) {
  const mark = px(p.coin)
  return Math.max(0, (Math.abs(mark - liqPx(p)) / mark) * 100)
}
export function equity() {
  return state.cash + state.positions.reduce((s, p) => s + p.margin + upnl(p), 0)
}
const exposurePct = (usd) => (usd / Math.max(equity(), 1)) * 100

// ------------------------------------------------------------------ events
function emit(type, data) {
  const ev = { id: id(), type, ts: Date.now(), ...data }
  state.feed.unshift(ev)
  state.feed.length = Math.min(state.feed.length, 60)
  bus.emit('event', ev)
  return ev
}

// ------------------------------------------------------------------ the rules engine
/** Every intent goes through here. Returns { verdict: 'auto' | 'needs_you' | 'blocked', reason }. */
export function judge(agent, intent) {
  const r = agent.rules
  if (state.killed) return { verdict: 'blocked', reason: 'Kill switch is on' }
  if (agent.paused) return { verdict: 'blocked', reason: agent.pausedReason ?? 'Agent is paused' }
  if (intent.reduceOnly) return { verdict: 'auto', reason: 'Closing risk is always allowed' }
  if (!COINS.includes(intent.coin)) return { verdict: 'blocked', reason: `${intent.coin} is not a market Leash knows` }
  if (!r.allowedCoins.includes(intent.coin)) return { verdict: 'blocked', reason: `${intent.coin} is not on this agent's list` }
  if (intent.leverage > r.maxLeverage) return { verdict: 'blocked', reason: `${intent.leverage}x is over the ${r.maxLeverage}x limit` }
  const exp = exposurePct(intent.usd)
  if (exp > r.maxExposurePct) return { verdict: 'blocked', reason: `${round(exp, 0)}% of account is over the ${r.maxExposurePct}% limit` }
  const now = Date.now()
  agent.orders = agent.orders.filter((t) => now - t < 60_000)
  if (agent.orders.length >= r.maxOrdersPerMin) return { verdict: 'blocked', reason: `More than ${r.maxOrdersPerMin} orders in a minute` }
  if (-agent.pnlToday > (state.startEquity * r.dailyLossPct) / 100) {
    pauseAgent(agent, `Lost over ${r.dailyLossPct}% today`)
    return { verdict: 'blocked', reason: `Lost over ${r.dailyLossPct}% today, agent paused` }
  }
  if (exp > r.approveAbovePct) return { verdict: 'needs_you', reason: `${round(exp, 0)}% > your ${r.approveAbovePct}% ask-me line` }
  if (intent.leverage > r.approveAboveLeverage) return { verdict: 'needs_you', reason: `${intent.leverage}x > your ${r.approveAboveLeverage}x ask-me line` }
  return { verdict: 'auto', reason: 'Inside your rules' }
}

/** What a position would look like if this intent were filled, for the approval card. */
function preview(intent) {
  const entry = px(intent.coin) * (intent.side === 'long' ? 1 + SLIP : 1 - SLIP)
  const p = { coin: intent.coin, side: intent.side, entry, leverage: intent.leverage }
  return { entry: round(entry, entry < 10 ? 4 : 2), liq: round(liqPx(p), entry < 10 ? 4 : 2), liqDistPct: round((1 / intent.leverage - MAINT) * 100, 1), exposurePct: round(exposurePct(intent.usd), 1), marginUsd: round(intent.usd / intent.leverage) }
}

export function submit(agentName, raw) {
  const agent = state.agents[agentName]
  if (!agent) throw new Error('Unknown agent')
  const intent = normalise(raw)
  agent.orders.push(Date.now())
  if (intent.reduceOnly) return close(agentName, intent.coin, intent.fraction ?? 1, 'agent')
  const decision = judge(agent, intent)
  const base = { agent: agent.name, intent, reason: decision.reason, preview: COINS.includes(intent.coin) ? preview(intent) : null }
  if (decision.verdict === 'blocked') {
    state.stats.blocked++
    return emit('blocked', base)
  }
  if (decision.verdict === 'auto') {
    state.stats.auto++
    const pos = fill(agent, intent)
    return emit('filled', { ...base, how: 'auto', position: view(pos) })
  }
  const req = { id: id(), ...base, created: Date.now(), expires: Date.now() + APPROVAL_TTL_MS }
  state.pending.push(req)
  return emit('approval', { request: req })
}

function normalise(raw) {
  const coin = String(raw.coin ?? '').toUpperCase()
  const side = raw.side === 'short' ? 'short' : 'long'
  const leverage = Math.max(1, Math.round(Number(raw.leverage ?? 1)))
  const usd = Math.max(10, Number(raw.usd ?? 0))
  return { coin, side, leverage, usd: round(usd), reduceOnly: !!raw.reduceOnly, fraction: raw.fraction, reason: String(raw.reason ?? '').slice(0, 120) }
}

export function decide(reqId, decision, by = 'you') {
  const i = state.pending.findIndex((r) => r.id === reqId)
  if (i < 0) return null
  const [req] = state.pending.splice(i, 1)
  const agent = state.agents[req.agent]
  if (decision !== 'approve') {
    state.stats[decision === 'expired' ? 'expired' : 'rejected']++
    return emit(decision === 'expired' ? 'expired' : 'rejected', { agent: req.agent, intent: req.intent, by, requestId: req.id })
  }
  // re-check at approval time: the market or the rules may have moved
  const again = judge(agent, req.intent)
  if (again.verdict === 'blocked') {
    state.stats.blocked++
    return emit('blocked', { agent: req.agent, intent: req.intent, reason: again.reason, requestId: req.id })
  }
  state.stats.approved++
  const pos = fill(agent, req.intent)
  return emit('filled', { agent: req.agent, intent: req.intent, how: 'approved', by, requestId: req.id, position: view(pos) })
}

function fill(agent, intent) {
  const entry = px(intent.coin) * (intent.side === 'long' ? 1 + SLIP : 1 - SLIP)
  const margin = intent.usd / intent.leverage
  const fee = intent.usd * FEE
  state.cash -= margin + fee
  agent.pnlToday -= fee
  const pos = { id: id(), agent: agent.name, coin: intent.coin, side: intent.side, size: intent.usd / entry, entry, leverage: intent.leverage, margin, opened: Date.now(), reason: intent.reason }
  state.positions.push(pos)
  return pos
}

export function close(agentName, coin, fraction = 1, by = 'you', posId) {
  const matches = state.positions.filter((p) => (posId ? p.id === posId : p.agent === agentName && p.coin === coin))
  if (!matches.length) return emit('noop', { agent: agentName, coin, reason: 'No open position' })
  let realised = 0
  for (const p of matches) {
    const part = Math.min(1, Math.max(0.01, fraction))
    const exit = px(p.coin) * (p.side === 'long' ? 1 - SLIP : 1 + SLIP)
    const pnl = (p.side === 'long' ? exit - p.entry : p.entry - exit) * p.size * part
    const fee = exit * p.size * part * FEE
    state.cash += p.margin * part + pnl - fee
    realised += pnl - fee
    const agent = state.agents[p.agent]
    if (agent) agent.pnlToday += pnl - fee
    p.size *= 1 - part
    p.margin *= 1 - part
    if (part >= 0.999) state.positions = state.positions.filter((x) => x !== p)
  }
  return emit('closed', { agent: agentName ?? matches[0].agent, coin: coin ?? matches[0].coin, fraction, by, pnl: round(realised) })
}

export function pauseAgent(agent, reason) {
  agent.paused = true
  agent.pausedReason = reason
  emit('paused', { agent: agent.name, reason })
}

export function setKill(on) {
  state.killed = !!on
  if (on) {
    for (const r of [...state.pending]) decide(r.id, 'reject', 'kill switch')
  }
  emit(on ? 'kill' : 'unkill', {})
}

/** Runs every second: expire stale approvals, liquidate positions that crossed their liq price. */
export function housekeeping() {
  const now = Date.now()
  for (const r of [...state.pending]) if (now > r.expires) decide(r.id, 'expired', 'timeout')
  for (const p of [...state.positions]) {
    const mark = px(p.coin)
    const hit = p.side === 'long' ? mark <= liqPx(p) : mark >= liqPx(p)
    if (hit) {
      state.positions = state.positions.filter((x) => x !== p)
      const agent = state.agents[p.agent]
      if (agent) agent.pnlToday -= p.margin
      emit('liquidated', { agent: p.agent, coin: p.coin, loss: round(p.margin) })
    }
  }
}

export function reset() {
  state.cash = START_CASH
  state.startEquity = START_CASH
  state.killed = false
  state.positions = []
  state.pending = []
  state.feed = []
  state.stats = { approved: 0, rejected: 0, blocked: 0, auto: 0, expired: 0 }
  for (const a of Object.values(state.agents)) Object.assign(a, { paused: false, pausedReason: null, pnlToday: 0, orders: [] })
  emit('reset', {})
}

export function view(p) {
  const pnl = upnl(p)
  return { id: p.id, agent: p.agent, coin: p.coin, side: p.side, leverage: p.leverage, entry: round(p.entry, p.entry < 10 ? 4 : 2), mark: round(px(p.coin), p.entry < 10 ? 4 : 2), sizeUsd: round(p.size * px(p.coin)), pnl: round(pnl), pnlPct: round((pnl / p.margin) * 100, 1), liq: round(liqPx(p), p.entry < 10 ? 4 : 2), liqDistPct: round(liqDistancePct(p), 1), reason: p.reason }
}

export function snapshot(market) {
  const eq = equity()
  return {
    equity: round(eq),
    pnl: round(eq - state.startEquity),
    pnlPct: round(((eq - state.startEquity) / state.startEquity) * 100, 2),
    killed: state.killed,
    source: market.source,
    mids: Object.fromEntries(Object.entries(market.mids).map(([k, v]) => [k, round(v, v < 10 ? 4 : 2)])),
    positions: state.positions.map(view),
    pending: state.pending.map((r) => ({ ...r, secondsLeft: Math.max(0, Math.ceil((r.expires - Date.now()) / 1000)) })),
    agents: Object.values(state.agents).map((a) => ({ name: a.name, kind: a.kind, rules: a.rules, paused: a.paused, pausedReason: a.pausedReason, pnlToday: round(a.pnlToday) })),
    stats: state.stats,
    feed: state.feed.slice(0, 25),
  }
}
