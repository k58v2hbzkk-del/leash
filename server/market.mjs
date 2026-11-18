// Live prices from Hyperliquid's public info API (read-only, no account needed).
// If Hyperliquid can't be reached (e.g. offline dev), falls back to a labelled simulated feed.
const HL = process.env.HL_INFO_URL ?? 'https://api.hyperliquid.xyz/info'
export const COINS = ['BTC', 'ETH', 'SOL', 'HYPE', 'DOGE', 'XRP', 'SUI', 'AVAX']
const SEED = { BTC: 91000, ETH: 3100, SOL: 140, HYPE: 32, DOGE: 0.16, XRP: 2.1, SUI: 1.6, AVAX: 14 }

export const market = {
  source: 'starting',
  mids: { ...SEED },
  funding: {},
  history: Object.fromEntries(COINS.map((c) => [c, []])), // [ts, px] last ~10 min
  updated: 0,
}

async function post(body) {
  const r = await fetch(HL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(4000) })
  if (!r.ok) throw new Error(`hyperliquid ${r.status}`)
  return r.json()
}

let failures = 0
async function tick() {
  try {
    const mids = await post({ type: 'allMids' })
    for (const c of COINS) if (mids[c]) market.mids[c] = Number(mids[c])
    market.source = 'hyperliquid'
    failures = 0
  } catch {
    failures++
    if (failures > 2 || market.source !== 'hyperliquid') {
      market.source = 'simulated'
      for (const c of COINS) market.mids[c] *= 1 + (Math.random() - 0.5) * 0.002
    }
  }
  const now = Date.now()
  for (const c of COINS) {
    const h = market.history[c]
    h.push([now, market.mids[c]])
    while (h.length && now - h[0][0] > 10 * 60_000) h.shift()
  }
  market.updated = now
}

async function fundingTick() {
  try {
    const [meta, ctxs] = await post({ type: 'metaAndAssetCtxs' })
    meta.universe.forEach((u, i) => {
      if (COINS.includes(u.name)) market.funding[u.name] = Number(ctxs[i].funding)
    })
  } catch {}
}

export function startMarket() {
  tick()
  fundingTick()
  setInterval(tick, 2000)
  setInterval(fundingTick, 60_000)
}

/** % change over the last `ms` milliseconds. */
export function change(coin, ms) {
  const h = market.history[coin]
  if (!h.length) return 0
  const now = h[h.length - 1]
  const then = h.find(([t]) => now[0] - t <= ms) ?? h[0]
  return (now[1] - then[1]) / then[1]
}

export const px = (coin) => market.mids[coin]
