// Mirrors the G2 screen from live Leash state, so anyone can see the glasses view in a browser.
const $ = (id) => document.getElementById(id)
const usd = (n) => { const a = Math.abs(n); return (n < 0 ? '-$' : '$') + (a >= 1000 ? a.toLocaleString('en-US', { maximumFractionDigits: 0 }) : a.toFixed(2)) }
const signed = (n) => (n >= 0 ? '+' : '-') + usd(Math.abs(n))
const price = (n) => (n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : n >= 10 ? n.toFixed(2) : n.toFixed(4))
const cap = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
let state = null
let flash = null

function screen(s) {
  const head = `LEASH   ${usd(s.equity)}   ${signed(s.pnl)} (${s.pnlPct >= 0 ? '+' : ''}${s.pnlPct}%)`
  if (flash && Date.now() < flash.until) return [head, flash.text, '']
  const r = s.pending[0]
  if (r) {
    const i = r.intent, p = r.preview
    return [
      `◆ NEEDS YOU${s.pending.length > 1 ? `  (1 of ${s.pending.length})` : ''}        ${r.secondsLeft}s`,
      `${r.agent.toUpperCase()} wants to\n${i.side.toUpperCase()} ${i.coin} ${i.leverage}x  ·  ${usd(i.usd)}\nuses ${Math.round(p.exposurePct)}% of your account\nliq ${price(p.liq)}  ·  ${p.liqDistPct}% away\nwhy: ${cap(i.reason, 34)}\nrule: ${cap(r.reason, 34)}`,
      'tap ▶ approve        swipe × reject',
    ]
  }
  if (s.killed) return [head, '■ ALL AGENTS PAUSED\nKill switch is on.\nNothing can trade.', '']
  const lines = s.positions.slice(0, 3).map((p) => `${p.coin} ${p.side.toUpperCase()} ${p.leverage}x  ${signed(p.pnl)}  liq ${p.liqDistPct}%`)
  return [head, `● ${s.agents.filter((a) => !a.paused).length} agents on a leash\n${lines.length ? lines.join('\n') : 'No open positions'}`, 'tap: positions   double-tap: exit']
}

const label = { filled: 'Placed', blocked: 'Blocked', rejected: 'Said no', expired: 'Timed out', closed: 'Closed', liquidated: 'Liquidated', approval: 'Asked you' }
function line(e) {
  const i = e.intent ?? e.request?.intent
  const who = e.agent ?? e.request?.agent ?? ''
  if (e.type === 'closed') return `${who} closed ${e.coin} ${signed(e.pnl ?? 0)}`
  if (e.type === 'liquidated') return `${who} ${e.coin} -${usd(e.loss ?? 0)}`
  if (!i) return who
  const t = `${who}: ${i.side} ${i.coin} ${i.leverage}x, ${usd(i.usd)}`
  if (e.type === 'blocked') return `${t}. ${e.reason}`
  if (e.type === 'filled') return `${t}. ${e.how === 'auto' ? 'Inside rules' : `Approved on ${e.by}`}`
  return t
}

function render() {
  if (!state) return
  const [h, b, f] = screen(state)
  $('lh').textContent = h
  $('lb').textContent = b
  $('lf').textContent = f
  const pending = !!state.pending[0] && !(flash && Date.now() < flash.until)
  $('ok').disabled = $('no').disabled = !pending
  $('src').textContent = state.source === 'hyperliquid' ? '● live Hyperliquid prices' : state.source
  $('eq').textContent = usd(state.equity)
  $('pnl').textContent = `${signed(state.pnl)} (${state.pnlPct >= 0 ? '+' : ''}${state.pnlPct}%) since start · paper`
  $('sAuto').textContent = state.stats.auto
  $('sOk').textContent = state.stats.approved
  $('sNo').textContent = state.stats.rejected + state.stats.expired
  $('sBlk').textContent = state.stats.blocked
  $('feed').innerHTML = state.feed
    .filter((e) => label[e.type])
    .slice(0, 7)
    .map((e) => `<li><span class="k ${e.type}">${label[e.type]}</span><span>${line(e)}</span></li>`)
    .join('')
}

function connect() {
  const es = new EventSource('/api/stream')
  es.addEventListener('state', (m) => ((state = JSON.parse(m.data)), render()))
  es.addEventListener('event', (m) => {
    const e = JSON.parse(m.data)
    if (e.type === 'blocked') flash = { text: `■ BLOCKED\n${e.agent} tried ${e.intent.side.toUpperCase()} ${e.intent.coin} ${e.intent.leverage}x\n${e.reason}`, until: Date.now() + 3500 }
    render()
  })
  es.onerror = () => (es.close(), setTimeout(connect, 2000))
}
connect()
setInterval(render, 1000)

const post = (path, body = {}) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
$('ok').onclick = () => state?.pending[0] && post(`/api/approvals/${state.pending[0].id}`, { decision: 'approve', by: 'website' })
$('no').onclick = () => state?.pending[0] && post(`/api/approvals/${state.pending[0].id}`, { decision: 'reject', by: 'website' })
document.querySelectorAll('[data-demo]').forEach((b) => (b.onclick = () => post(`/api/demo/${b.dataset.demo}`)))
