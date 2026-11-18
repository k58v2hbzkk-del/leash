// Leash server: the only thing allowed to place orders. Agents send intents, the glasses approve.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { market, startMarket } from './market.mjs'
import { state, bus, submit, decide, close, setKill, housekeeping, snapshot, reset } from './leash.mjs'
import { createAgents, startAgents, demoScript } from './agents.mjs'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const STATIC = [path.join(ROOT, '..', 'glasses', 'dist')]
const PORT = Number(process.env.PORT ?? 8787)

startMarket()
createAgents()
startAgents()
setInterval(housekeeping, 1000)

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors })
  res.end(JSON.stringify(body))
}
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, x-agent-key', 'access-control-allow-methods': 'GET, POST, OPTIONS' }
async function body(req) {
  let raw = ''
  for await (const c of req) if ((raw += c).length > 4000) throw new Error('Too large')
  return raw ? JSON.parse(raw) : {}
}

// --------------------------------------------------------------- server-sent events
const clients = new Set()
const send = (res, type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
bus.on('event', (ev) => {
  for (const c of clients) send(c, 'event', ev)
})
setInterval(() => {
  const snap = snapshot(market)
  for (const c of clients) send(c, 'state', snap)
}, 1000)

// --------------------------------------------------------------- tiny rate limit for public POSTs
const hits = new Map()
function limited(req) {
  const ip = (req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').toString().split(',')[0]
  const now = Date.now()
  const h = (hits.get(ip) ?? []).filter((t) => now - t < 10_000)
  h.push(now)
  hits.set(ip, h)
  return h.length > 40
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.mp4': 'video/mp4' }
function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '')
  for (const dir of STATIC) {
    const f = path.join(dir, rel)
    if (f.startsWith(dir) && fs.existsSync(f) && fs.statSync(f).isFile()) {
      res.writeHead(200, { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream', ...cors })
      return fs.createReadStream(f).pipe(res)
    }
  }
  res.writeHead(404, cors)
  res.end('not found')
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const p = url.pathname
    try {
      if (req.method === 'OPTIONS') return res.writeHead(204, cors).end()
      if (p === '/api/health') return json(res, 200, { ok: true, source: market.source })
      if (p === '/api/state') return json(res, 200, snapshot(market))
      if (p === '/api/stream') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no', ...cors })
        res.write(': hi\n\n')
        send(res, 'state', snapshot(market))
        clients.add(res)
        const ping = setInterval(() => res.write(': ping\n\n'), 15000)
        req.on('close', () => (clients.delete(res), clearInterval(ping)))
        return
      }
      if (req.method === 'POST' && p.startsWith('/api/')) {
        if (limited(req)) return json(res, 429, { error: 'Slow down' })
        const b = await body(req)
        // external agents: authenticate with their own key
        if (p === '/api/intent') {
          const agent = Object.values(state.agents).find((a) => a.key === req.headers['x-agent-key'])
          if (!agent) return json(res, 401, { error: 'Unknown agent key' })
          return json(res, 200, submit(agent.name, b))
        }
        let m
        if ((m = p.match(/^\/api\/approvals\/([0-9a-f]+)$/))) {
          const ev = decide(m[1], b.decision === 'approve' ? 'approve' : 'reject', b.by ?? 'you')
          return ev ? json(res, 200, ev) : json(res, 404, { error: 'Already decided or expired' })
        }
        if (p === '/api/close') return json(res, 200, close(b.agent, b.coin, Number(b.fraction ?? 1), b.by ?? 'you', b.positionId))
        if (p === '/api/kill') return json(res, 200, (setKill(!!b.on), { killed: state.killed }))
        if ((m = p.match(/^\/api\/agents\/(\w+)$/))) {
          const a = state.agents[m[1]]
          if (!a) return json(res, 404, { error: 'Unknown agent' })
          if (typeof b.paused === 'boolean') Object.assign(a, { paused: b.paused, pausedReason: b.paused ? 'Paused by you' : null })
          if (b.rules) for (const k of Object.keys(a.rules)) if (k in b.rules) a.rules[k] = b.rules[k]
          return json(res, 200, { name: a.name, paused: a.paused, rules: a.rules })
        }
        if ((m = p.match(/^\/api\/demo\/(\d+)$/))) {
          const step = demoScript[Number(m[1])]
          return step ? json(res, 200, step()) : json(res, 404, { error: 'No such step' })
        }
        if (p === '/api/reset') return json(res, 200, (reset(), { ok: true }))
        return json(res, 404, { error: 'Not found' })
      }
      return serveStatic(res, p)
    } catch (e) {
      console.error(e)
      return json(res, 500, { error: e.message })
    }
  })
  .listen(PORT, () => console.log(`Leash on :${PORT} (prices: ${market.source})`))
