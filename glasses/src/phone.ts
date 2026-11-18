// The phone side: set each agent's rules, see everything, approve without glasses.
import { api, usd, signed, price, type State, type Ev } from './api'

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T
let state: State | null = null
const editing = new Set<string>()

export function mountPhone() {
  document.querySelector('#app')!.innerHTML = `
  <main>
    <header>
      <div class="brand"><span class="mark"></span>Leash</div>
      <div id="src" class="chip">connecting</div>
    </header>
    <section class="hero">
      <div class="label">Paper account</div>
      <div id="eq" class="big">—</div>
      <div id="pnl" class="dim">—</div>
      <div class="stats" id="stats"></div>
    </section>
    <section id="needs"></section>
    <section><h2>Agents</h2><div id="agents"></div></section>
    <section><h2>Open positions</h2><div id="pos"></div></section>
    <section><h2>Activity</h2><div id="feed"></div></section>
    <section class="kill"><button id="kill" class="danger">Pause every agent</button><p class="dim small">Stops all agents at once and rejects anything waiting for you.</p></section>
    <details class="demo"><summary>Demo controls</summary>
      <div class="row wrap">${['Small BTC long', 'Degen 25x DOGE', 'ETH 5x, big', 'Carry SOL short', 'Degen 60% SOL'].map((t, i) => `<button data-demo="${i}" class="ghost">${t}</button>`).join('')}
      <button id="reset" class="ghost">Reset account</button></div>
    </details>
    <footer class="dim small">Agents never touch the exchange. They send intents to Leash; Leash checks your rules and asks you when it matters. Paper trading on live Hyperliquid prices.</footer>
  </main>`
  $('#kill').onclick = () => state && api.kill(!state.killed)
  $('#reset').onclick = () => api.reset()
  document.querySelectorAll<HTMLButtonElement>('[data-demo]').forEach((b) => (b.onclick = () => api.demo(Number(b.dataset.demo))))
  injectStyles()
}

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n}%`
const verb: Record<string, string> = { filled: 'Placed', blocked: 'Blocked', rejected: 'Rejected', expired: 'Timed out', closed: 'Closed', liquidated: 'Liquidated', approval: 'Asked you', paused: 'Paused', kill: 'Kill switch on', unkill: 'Kill switch off', reset: 'Account reset' }

export function setPhoneState(s: State) {
  state = s
  $('#src').textContent = s.source === 'hyperliquid' ? 'live Hyperliquid prices' : s.source
  $('#src').className = 'chip ' + (s.source === 'hyperliquid' ? 'ok' : '')
  $('#eq').textContent = usd(s.equity)
  $('#pnl').textContent = `${signed(s.pnl)} (${pct(s.pnlPct)}) since start`
  $('#stats').innerHTML = [['inside rules', s.stats.auto], ['approved', s.stats.approved], ['rejected', s.stats.rejected + s.stats.expired], ['blocked', s.stats.blocked]].map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('')
  $('#kill').textContent = s.killed ? 'Let agents trade again' : 'Pause every agent'

  $('#needs').innerHTML = s.pending.length
    ? `<h2>Needs you</h2>` +
      s.pending
        .map(
          (r) => `<div class="card need">
        <div class="row"><b>${r.agent}</b><span class="dim">${r.secondsLeft}s</span></div>
        <div class="trade">${r.intent.side.toUpperCase()} ${r.intent.coin} ${r.intent.leverage}x · ${usd(r.intent.usd)}</div>
        <div class="dim small">${Math.round(r.preview.exposurePct)}% of account · liq ${price(r.preview.liq)} (${r.preview.liqDistPct}% away)</div>
        <div class="dim small">Why: ${r.intent.reason}</div>
        <div class="dim small">Rule: ${r.reason}</div>
        <div class="row gap"><button data-ok="${r.id}">Approve</button><button data-no="${r.id}" class="ghost">Reject</button></div>
      </div>`,
        )
        .join('')
    : ''
  document.querySelectorAll<HTMLButtonElement>('[data-ok]').forEach((b) => (b.onclick = () => api.decide(b.dataset.ok!, 'approve', 'phone')))
  document.querySelectorAll<HTMLButtonElement>('[data-no]').forEach((b) => (b.onclick = () => api.decide(b.dataset.no!, 'reject', 'phone')))

  const agentsEl = $('#agents')
  if (!editing.size) {
    agentsEl.innerHTML = s.agents
      .map((a) => {
        const r = a.rules
        return `<div class="card">
        <div class="row"><div><b>${a.name}</b><div class="dim small">${a.kind}</div></div>
          <label class="switch"><input type="checkbox" data-pause="${a.name}" ${a.paused ? '' : 'checked'}><span></span></label></div>
        ${a.paused ? `<div class="warn small">${a.pausedReason ?? 'Paused'}</div>` : ''}
        <div class="rules">
          ${rule(a.name, 'approveAbovePct', 'Ask me if bigger than', r.approveAbovePct, '%', 1, 40)}
          ${rule(a.name, 'maxExposurePct', 'Never bigger than', r.maxExposurePct, '%', 5, 100)}
          ${rule(a.name, 'maxLeverage', 'Max leverage', r.maxLeverage, 'x', 1, 20)}
          ${rule(a.name, 'approveAboveLeverage', 'Ask me above lev.', r.approveAboveLeverage, 'x', 1, 20)}
          ${rule(a.name, 'dailyLossPct', 'Stop after losing', r.dailyLossPct, '% a day', 1, 20)}
        </div>
        <div class="coins">${['BTC', 'ETH', 'SOL', 'HYPE', 'DOGE', 'XRP', 'SUI', 'AVAX'].map((c) => `<button class="coin ${r.allowedCoins.includes(c) ? 'on' : ''}" data-agent="${a.name}" data-coin="${c}">${c}</button>`).join('')}</div>
        <div class="dim small">Today ${signed(a.pnlToday)}</div>
      </div>`
      })
      .join('')
    bindAgents()
  }

  $('#pos').innerHTML = s.positions.length
    ? s.positions
        .map(
          (p) => `<div class="card pos">
        <div class="row"><b>${p.coin} ${p.side.toUpperCase()} ${p.leverage}x</b><span class="${p.pnl >= 0 ? 'up' : 'down'}">${signed(p.pnl)} (${pct(p.pnlPct)})</span></div>
        <div class="dim small">${p.agent} · ${usd(p.sizeUsd)} · entry ${price(p.entry)} · liq ${price(p.liq)} (${p.liqDistPct}% away)</div>
        <div class="row gap"><button class="ghost" data-half="${p.id}">Close half</button><button class="ghost" data-all="${p.id}">Close</button></div>
      </div>`,
        )
        .join('')
    : `<p class="dim">Nothing open.</p>`
  document.querySelectorAll<HTMLButtonElement>('[data-half]').forEach((b) => (b.onclick = () => api.close(b.dataset.half!, 0.5, 'phone')))
  document.querySelectorAll<HTMLButtonElement>('[data-all]').forEach((b) => (b.onclick = () => api.close(b.dataset.all!, 1, 'phone')))

  $('#feed').innerHTML = s.feed
    .filter((e) => verb[e.type])
    .slice(0, 14)
    .map((e) => `<div class="ev ${e.type}"><span class="t">${new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span><span class="tag">${verb[e.type]}</span>${line(e)}</div>`)
    .join('')
}

function line(e: Ev) {
  const i = e.intent ?? e.request?.intent
  const who = e.agent ?? e.request?.agent ?? ''
  if (e.type === 'closed') return `${who} ${e.coin} ${signed(e.pnl ?? 0)}`
  if (e.type === 'liquidated') return `${who} ${e.coin} -${usd(e.loss ?? 0)}`
  if (e.type === 'paused') return `${who}: ${e.reason}`
  if (!i) return who
  return `${who} ${i.side} ${i.coin} ${i.leverage}x ${usd(i.usd)}${e.type === 'blocked' ? ` — ${e.reason}` : e.how === 'auto' ? ' — inside rules' : e.by ? ` — by ${e.by}` : ''}`
}

function rule(agent: string, key: string, label: string, v: number, unit: string, min: number, max: number) {
  return `<label class="rule"><span>${label}</span><input type="range" min="${min}" max="${max}" value="${v}" data-rule="${key}" data-agent="${agent}"><b>${v}${unit}</b></label>`
}

function bindAgents() {
  document.querySelectorAll<HTMLInputElement>('[data-pause]').forEach((el) => (el.onchange = () => api.agent(el.dataset.pause!, { paused: !el.checked })))
  document.querySelectorAll<HTMLInputElement>('[data-rule]').forEach((el) => {
    el.oninput = () => {
      editing.add(el.dataset.agent!)
      ;(el.nextElementSibling as HTMLElement).textContent = el.value + ((el.nextElementSibling as HTMLElement).textContent ?? '').replace(/^[0-9]+/, '')
    }
    el.onchange = async () => {
      await api.agent(el.dataset.agent!, { rules: { [el.dataset.rule!]: Number(el.value) } })
      editing.delete(el.dataset.agent!)
    }
  })
  document.querySelectorAll<HTMLButtonElement>('[data-coin]').forEach((b) => {
    b.onclick = () => {
      const a = state!.agents.find((x) => x.name === b.dataset.agent)!
      const set = new Set<string>(a.rules.allowedCoins)
      set.has(b.dataset.coin!) ? set.delete(b.dataset.coin!) : set.add(b.dataset.coin!)
      api.agent(a.name, { rules: { allowedCoins: [...set] } })
    }
  })
}

export function setPhoneOnline(ok: boolean) {
  if (!ok) $('#src').textContent = 'reconnecting…'
}

function injectStyles() {
  const css = `
  :root { color-scheme: dark; --bg:#111; --s:#1A1A1A; --s2:#232323; --line:#2A2A2A; --t:#fff; --d:#8A8A8A; --a:#FEF991; --up:#7BE38A; --down:#FF7A6B; }
  * { box-sizing: border-box; }
  html,body { margin:0; background:var(--bg); color:var(--t); font:15px/1.45 -apple-system,BlinkMacSystemFont,'Helvetica Neue',system-ui,sans-serif; -webkit-text-size-adjust:100%; touch-action:manipulation; }
  main { max-width:560px; margin:0 auto; padding:20px 16px 48px; display:flex; flex-direction:column; gap:22px; }
  header { display:flex; justify-content:space-between; align-items:center; }
  .brand { font-weight:700; font-size:20px; letter-spacing:-0.02em; display:flex; align-items:center; gap:10px; }
  .mark { width:18px; height:18px; border-radius:6px; border:3px solid var(--a); position:relative; }
  .mark::after { content:''; position:absolute; right:-9px; bottom:-9px; width:9px; height:3px; background:var(--a); transform:rotate(45deg); }
  .chip { font-size:11px; letter-spacing:0.04em; text-transform:uppercase; color:var(--d); border:1px solid var(--line); padding:4px 10px; border-radius:99px; }
  .chip.ok { color:var(--up); border-color:#2f5a36; }
  .label { font-size:11px; text-transform:uppercase; letter-spacing:0.06em; color:var(--d); }
  .big { font-size:38px; font-weight:700; letter-spacing:-0.03em; }
  .dim { color:var(--d); } .small { font-size:13px; } .warn { color:var(--a); }
  .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-top:14px; }
  .stats div { background:var(--s); border-radius:12px; padding:10px; display:flex; flex-direction:column; }
  .stats b { font-size:20px; } .stats span { font-size:11px; color:var(--d); }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:0.06em; color:var(--d); margin:0 0 10px; font-weight:600; }
  .card { background:var(--s); border:1px solid var(--line); border-radius:16px; padding:14px; margin-bottom:10px; display:flex; flex-direction:column; gap:6px; }
  .need { border-color:var(--a); }
  .trade { font-size:20px; font-weight:700; letter-spacing:-0.02em; }
  .row { display:flex; justify-content:space-between; align-items:center; } .gap { gap:8px; justify-content:flex-start; margin-top:6px; } .wrap { flex-wrap:wrap; gap:8px; justify-content:flex-start; }
  button { font:inherit; font-weight:600; border:0; border-radius:12px; padding:10px 16px; background:var(--a); color:#111; }
  button.ghost { background:var(--s2); color:var(--t); border:1px solid var(--line); }
  button.danger { width:100%; background:#2a1513; color:var(--down); border:1px solid #5a2a24; padding:14px; }
  .rules { display:grid; gap:4px; margin-top:6px; }
  .rule { display:grid; grid-template-columns:130px 1fr 74px; align-items:center; gap:8px; font-size:13px; color:var(--d); }
  .rule b { color:var(--t); text-align:right; font-weight:600; }
  input[type=range] { accent-color:var(--a); width:100%; }
  .coins { display:flex; flex-wrap:wrap; gap:6px; margin-top:6px; }
  .coin { padding:5px 10px; font-size:12px; border-radius:99px; background:var(--s2); color:var(--d); border:1px solid var(--line); }
  .coin.on { background:#2b2a17; color:var(--a); border-color:#5c5a2a; }
  .switch { position:relative; width:46px; height:28px; } .switch input { opacity:0; width:0; height:0; }
  .switch span { position:absolute; inset:0; background:var(--s2); border-radius:99px; border:1px solid var(--line); transition:.2s; }
  .switch span::before { content:''; position:absolute; width:22px; height:22px; left:2px; top:2px; background:var(--d); border-radius:50%; transition:.2s; }
  .switch input:checked + span { background:#2b2a17; border-color:#5c5a2a; } .switch input:checked + span::before { transform:translateX(18px); background:var(--a); }
  .up { color:var(--up); } .down { color:var(--down); }
  .ev { font-size:13px; padding:7px 0; border-bottom:1px solid var(--line); display:flex; gap:8px; align-items:baseline; }
  .ev .t { color:var(--d); font-variant-numeric:tabular-nums; } .ev .tag { font-weight:700; min-width:76px; }
  .ev.blocked .tag, .ev.liquidated .tag { color:var(--down); } .ev.filled .tag { color:var(--up); } .ev.approval .tag { color:var(--a); }
  details.demo summary { color:var(--d); font-size:13px; }
  footer { line-height:1.5; }`
  const st = document.createElement('style')
  st.textContent = css
  document.head.appendChild(st)
}
