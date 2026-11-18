// Three built-in demo agents with different personalities. They read live Hyperliquid data and
// send intents to Leash exactly like an external agent would through the HTTP API.
import { market, change } from './market.mjs'
import { state, submit, close, equity, addAgent } from './leash.mjs'

const pick = (a) => a[Math.floor(Math.random() * a.length)]
const pct = (n) => `${(n * 100).toFixed(2)}%`

export function createAgents() {
  addAgent('Momentum', 'Rides short bursts on majors')
  addAgent('Carry', 'Farms funding rates', { approveAbovePct: 15 })
  // Your own agent (an LLM, a bot, anything) plugs in over HTTP with this key.
  if (process.env.EXTERNAL_AGENT_KEY) addAgent('External', 'Your own agent over the API', { approveAbovePct: 5 }, process.env.EXTERNAL_AGENT_KEY)
  addAgent('Degen', 'High-risk agent, kept on a short leash', { maxLeverage: 5, allowedCoins: ['BTC', 'ETH', 'SOL', 'HYPE'], approveAbovePct: 8 })
}

function hasOpen(agent, coin) {
  return state.positions.some((p) => p.agent === agent && (!coin || p.coin === coin))
}

function momentum() {
  const a = state.agents.Momentum
  // take profit / cut after a few minutes
  for (const p of state.positions.filter((p) => p.agent === 'Momentum')) {
    if (Date.now() - p.opened > (3 + Math.random() * 3) * 60_000) submit('Momentum', { coin: p.coin, reduceOnly: true, fraction: 1, reason: 'Burst faded, taking it off' })
  }
  if (hasOpen('Momentum') && Math.random() < 0.6) return
  const ranked = a.rules.allowedCoins.map((c) => [c, change(c, 2 * 60_000)]).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))
  const [coin, chg] = ranked[0]
  if (Math.abs(chg) < 0.0008 && market.source === 'hyperliquid') return
  const big = Math.random() < 0.35
  submit('Momentum', {
    coin,
    side: chg >= 0 ? 'long' : 'short',
    leverage: big ? 5 : pick([2, 3]),
    usd: equity() * (big ? 0.16 + Math.random() * 0.08 : 0.04 + Math.random() * 0.04),
    reason: `${coin} moved ${pct(chg)} in 2 min`,
  })
}

function carry() {
  const a = state.agents.Carry
  if (hasOpen('Carry') && Math.random() < 0.8) return
  const rates = a.rules.allowedCoins.map((c) => [c, market.funding[c] ?? (Math.random() - 0.5) * 0.0002]).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))
  const [coin, f] = rates[0]
  submit('Carry', {
    coin,
    side: f > 0 ? 'short' : 'long',
    leverage: 2,
    usd: equity() * (0.18 + Math.random() * 0.1),
    reason: `Funding ${(f * 100).toFixed(4)}%/h, ${f > 0 ? 'longs' : 'shorts'} pay`,
  })
}

function degen() {
  const roll = Math.random()
  if (roll < 0.3) return submit('Degen', { coin: 'DOGE', side: 'long', leverage: 25, usd: equity() * 0.3, reason: 'DOGE trending on X, max send' })
  if (roll < 0.55) return submit('Degen', { coin: 'SOL', side: pick(['long', 'short']), leverage: 4, usd: equity() * 0.6, reason: 'Conviction play, sizing up' })
  if (roll < 0.75) return submit('Degen', { coin: 'ETH', side: 'long', leverage: 20, usd: equity() * 0.12, reason: 'Breakout incoming' })
  return submit('Degen', { coin: pick(['HYPE', 'SOL']), side: pick(['long', 'short']), leverage: 4, usd: equity() * (0.1 + Math.random() * 0.05), reason: 'Quick scalp' })
}

export function startAgents() {
  const every = (fn, min, max) => {
    const run = () => {
      try {
        if (!state.killed) fn()
      } catch (e) {
        console.error(e)
      }
      setTimeout(run, (min + Math.random() * (max - min)) * 1000)
    }
    setTimeout(run, (5 + Math.random() * 10) * 1000)
  }
  if (process.env.AGENTS === 'off') return
  every(momentum, 25, 50)
  every(carry, 70, 120)
  every(degen, 60, 110)
}

/** A fixed, repeatable sequence for recording the demo video. */
export const demoScript = [
  () => submit('Momentum', { coin: 'BTC', side: 'long', leverage: 2, usd: equity() * 0.05, reason: 'BTC moved 0.31% in 2 min' }),
  () => submit('Degen', { coin: 'DOGE', side: 'long', leverage: 25, usd: equity() * 0.3, reason: 'DOGE trending on X, max send' }),
  () => submit('Momentum', { coin: 'ETH', side: 'long', leverage: 5, usd: equity() * 0.18, reason: 'ETH moved 0.42% in 2 min' }),
  () => submit('Carry', { coin: 'SOL', side: 'short', leverage: 2, usd: equity() * 0.22, reason: 'Funding 0.0125%/h, longs pay' }),
  () => submit('Degen', { coin: 'SOL', side: 'long', leverage: 4, usd: equity() * 0.6, reason: 'Conviction play, sizing up' }),
]
export { close }
