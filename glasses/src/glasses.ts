// What the G2 shows. One idea per screen: an agent wants something, approve it or not.
import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  TextContainerUpgrade,
  OsEventTypeList,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { api, usd, signed, price, type State, type Ev, type Request } from './api'

type Mode = 'home' | 'positions'
type Flash = { title: string; body: string; until: number }

const HDR = { id: 1, name: 'hdr' }
const BODY = { id: 2, name: 'body' }
const FOOT = { id: 3, name: 'foot' }

let bridge: EvenAppBridge
let state: State | null = null
let mode: Mode = 'home'
let cursor = 0 // index in positions view (last slot = pause-all)
let flash: Flash | null = null
let online = false
let busy = false
const shown = { hdr: '', body: '', foot: '' }

const bar = (pct: number, n = 12) => {
  const f = Math.max(0, Math.min(n, Math.round((pct / 100) * n)))
  return '━'.repeat(f) + '─'.repeat(n - f)
}
const side = (s: string) => s.toUpperCase()
const cap = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

// ------------------------------------------------------------------ screens
function screen(): [string, string, string] {
  if (!state) return ['LEASH', online ? 'Loading…' : 'Connecting to Leash…', '']
  const head = `LEASH   ${usd(state.equity)}   ${signed(state.pnl)} (${state.pnlPct >= 0 ? '+' : ''}${state.pnlPct}%)`
  if (flash && Date.now() < flash.until) return [head, `${flash.title}\n${flash.body}`, '']
  flash = null
  const req = state.pending[0]
  if (req) return approval(req, state.pending.length)
  if (mode === 'positions') return positions(head)
  return home(head)
}

function approval(r: Request, count: number): [string, string, string] {
  const i = r.intent
  const p = r.preview
  const head = `◆ NEEDS YOU${count > 1 ? `  (1 of ${count})` : ''}        ${r.secondsLeft}s`
  const body =
    `${r.agent.toUpperCase()} wants to\n` +
    `${side(i.side)} ${i.coin} ${i.leverage}x  ·  ${usd(i.usd)}\n` +
    `uses ${Math.round(p.exposurePct)}% of your account\n` +
    `liq ${price(p.liq)}  ·  ${p.liqDistPct}% away\n` +
    `why: ${cap(i.reason, 34)}\n` +
    `rule: ${cap(r.reason, 34)}`
  return [head, body, 'tap ▶ approve        swipe × reject']
}

function home(head: string): [string, string, string] {
  const s = state!
  if (s.killed) return [head, '■ ALL AGENTS PAUSED\nKill switch is on.\nNothing can trade.', 'tap: open positions to resume']
  const live = s.agents.filter((a) => !a.paused).length
  const lines = s.positions.slice(0, 3).map((p) => `${p.coin} ${side(p.side)} ${p.leverage}x  ${signed(p.pnl)}  liq ${p.liqDistPct}%`)
  const last = s.feed.find((e) => ['filled', 'blocked', 'closed', 'liquidated', 'rejected', 'expired'].includes(e.type))
  const body =
    `● ${live} agents on a leash` +
    `\n${lines.length ? lines.join('\n') : 'No open positions'}` +
    (s.positions.length > 3 ? `\n+${s.positions.length - 3} more` : '') +
    (last ? `\n\n${describe(last)}` : '')
  return [head, body, 'tap: positions   double-tap: exit']
}

function positions(head: string): [string, string, string] {
  const s = state!
  const list = s.positions
  const slots = list.length + 1
  cursor = Math.min(cursor, slots - 1)
  if (cursor === list.length) {
    const body = s.killed ? '■ KILL SWITCH IS ON\n\nTap to let agents trade again.' : '■ PAUSE ALL AGENTS\n\nStops every agent and rejects\nanything waiting for you.'
    return [head, body, `${cursor + 1}/${slots}   tap: ${s.killed ? 'resume' : 'pause all'}   double-tap: back`]
  }
  const p = list[cursor]
  const safe = Math.min(100, p.liqDistPct * 2)
  const body =
    `${p.coin} ${side(p.side)} ${p.leverage}x  ·  ${p.agent}\n` +
    `${signed(p.pnl)}  (${p.pnlPct >= 0 ? '+' : ''}${p.pnlPct}%)   size ${usd(p.sizeUsd)}\n` +
    `mark ${price(p.mark)}   entry ${price(p.entry)}\n` +
    `liq ${p.liqDistPct}% away  ${bar(safe)}`
  return [head, body, `${cursor + 1}/${slots}   tap: close half   double-tap: back`]
}

function describe(e: Ev): string {
  const i = e.intent
  switch (e.type) {
    case 'filled':
      return `▶ ${e.agent} ${i ? `${side(i.side)} ${i.coin} ${i.leverage}x` : ''} ${e.how === 'auto' ? '(inside rules)' : 'approved'}`
    case 'blocked':
      return `× BLOCKED ${e.agent}: ${cap(e.reason ?? '', 30)}`
    case 'rejected':
      return `× You said no to ${e.agent}`
    case 'expired':
      return `× ${e.agent} timed out, not placed`
    case 'closed':
      return `○ Closed ${e.coin} ${signed(e.pnl ?? 0)}`
    case 'liquidated':
      return `! ${e.agent} ${e.coin} liquidated -${usd(e.loss ?? 0)}`
    default:
      return ''
  }
}

// ------------------------------------------------------------------ rendering
let queue = Promise.resolve()
function call<T>(fn: () => Promise<T>) {
  const run = queue.then(() => Promise.race([fn(), new Promise<T>((r) => setTimeout(() => r(undefined as T), 4000))]))
  queue = run.then(() => undefined, () => undefined)
  return run
}

async function render() {
  if (!bridge) return
  const [h, b, f] = screen()
  const parts: [typeof HDR, string, keyof typeof shown][] = [
    [HDR, h, 'hdr'],
    [BODY, b || ' ', 'body'],
    [FOOT, f || ' ', 'foot'],
  ]
  for (const [c, text, key] of parts) {
    if (shown[key] === text) continue
    shown[key] = text
    await call(() => bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: c.id, containerName: c.name, content: text })))
  }
}

export function showFlash(title: string, body: string, ms = 2600) {
  flash = { title, body, until: Date.now() + ms }
  render()
}

// ------------------------------------------------------------------ input
function eventType(env?: { eventType?: OsEventTypeList }) {
  return env ? (env.eventType ?? OsEventTypeList.CLICK_EVENT) : null
}

async function onInput(kind: 'click' | 'double' | 'up' | 'down') {
  if (!state || busy) return
  const req = state.pending[0]
  if (req && !flash) {
    if (kind === 'click') return act(() => api.decide(req.id, 'approve', 'glasses'), 'APPROVED', `${side(req.intent.side)} ${req.intent.coin} ${req.intent.leverage}x is live`)
    if (kind === 'up' || kind === 'down') return act(() => api.decide(req.id, 'reject', 'glasses'), 'REJECTED', `${req.agent} will not place it`)
    return
  }
  if (mode === 'home') {
    if (kind === 'click') return (mode = 'positions'), (cursor = 0), render()
    if (kind === 'double') return bridge.shutDownPageContainer(1)
    return
  }
  // positions
  const slots = state.positions.length + 1
  if (kind === 'double') return (mode = 'home'), render()
  if (kind === 'down') return (cursor = (cursor + 1) % slots), render()
  if (kind === 'up') return (cursor = (cursor - 1 + slots) % slots), render()
  if (kind === 'click') {
    if (cursor === state.positions.length) return act(() => api.kill(!state!.killed), state.killed ? 'AGENTS RESUMED' : 'ALL AGENTS PAUSED', state.killed ? 'They can trade inside your rules again.' : 'Nothing can trade until you resume.')
    const p = state.positions[cursor]
    return act(() => api.close(p.id, 0.5, 'glasses'), 'CLOSED HALF', `${p.coin} ${side(p.side)} · ${p.agent}`)
  }
}

async function act(fn: () => Promise<unknown>, title: string, body: string) {
  busy = true
  try {
    await fn()
    showFlash(title, body, 1800)
  } catch {
    showFlash('NO CONNECTION', 'Could not reach Leash. Try again.')
  } finally {
    busy = false
  }
}

// ------------------------------------------------------------------ boot
export async function startGlasses() {
  bridge = await waitForEvenAppBridge()
  const text = (c: { id: number; name: string }, y: number, h: number, capture: 0 | 1, brightness: number, content: string) =>
    new TextContainerProperty({ xPosition: 0, yPosition: y, width: 576, height: h, borderWidth: 0, borderColor: 0, paddingLength: 6, containerID: c.id, containerName: c.name, isEventCapture: capture, textColor: brightness, content })
  const result = await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 3,
      textObject: [text(HDR, 0, 44, 0, 2, 'LEASH'), text(BODY, 44, 200, 1, 4, 'Connecting to Leash…'), text(FOOT, 244, 44, 0, 2, ' ')],
    }),
  )
  console.log('LEASH_READY', result)
  bridge.onEvenHubEvent((e) => {
    const sys = eventType(e.sysEvent)
    const txt = e.textEvent ? (e.textEvent.eventType ?? null) : null
    if (sys === OsEventTypeList.DOUBLE_CLICK_EVENT) return onInput('double')
    if (txt === OsEventTypeList.SCROLL_TOP_EVENT) return onInput('up')
    if (txt === OsEventTypeList.SCROLL_BOTTOM_EVENT) return onInput('down')
    if (sys === OsEventTypeList.CLICK_EVENT && e.sysEvent) return onInput('click')
    if (sys === OsEventTypeList.FOREGROUND_ENTER_EVENT) return (shown.hdr = shown.body = shown.foot = ''), render()
  })
  setInterval(render, 1000)
}

export function setGlassesState(s: State) {
  state = s
  render()
}
export function setOnline(ok: boolean) {
  online = ok
  render()
}

/** Blocks and results are worth a glance even when you are not looking at that screen. */
export function onGlassesEvent(e: Ev) {
  if (e.type === 'blocked') showFlash('■ BLOCKED', `${e.agent} tried ${e.intent ? `${side(e.intent.side)} ${e.intent.coin} ${e.intent.leverage}x` : 'a trade'}\n${e.reason}`, 3500)
  if (e.type === 'liquidated') showFlash('! LIQUIDATED', `${e.agent} ${e.coin} lost ${usd(e.loss ?? 0)}`, 3500)
  if (e.type === 'expired') showFlash('× TIMED OUT', `${e.agent}'s trade was not placed.\nNo answer means no.`, 2500)
}
