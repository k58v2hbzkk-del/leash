// Plug any agent into Leash. It never gets exchange keys: it sends an intent and Leash decides.
//   LEASH_URL=https://your-leash.onrender.com LEASH_KEY=... node examples/my-agent.mjs
const url = process.env.LEASH_URL ?? 'http://localhost:8787'
const res = await fetch(`${url}/api/intent`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-agent-key': process.env.LEASH_KEY },
  body: JSON.stringify({ coin: 'ETH', side: 'long', leverage: 3, usd: 1500, reason: 'Model sees a breakout' }),
})
const ev = await res.json()
// ev.type is 'filled' (inside your rules), 'approval' (waiting for your glasses) or 'blocked'
console.log(ev.type, ev.reason ?? ev.request?.reason ?? '')
