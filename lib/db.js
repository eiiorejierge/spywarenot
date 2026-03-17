// Direct Upstash Redis REST calls — no npm package, never crashes at build time

const WEEK = 7 * 24 * 60 * 60 * 1000

function cfg() {
  return {
    url:   process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  }
}

export function isConfigured() {
  const { url, token } = cfg()
  return !!(url && token)
}

async function redis(...args) {
  const { url, token } = cfg()
  if (!url || !token) return null
  try {
    const res = await fetch(`${url}/${args.map(a => encodeURIComponent(a)).join('/')}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    const { result } = await res.json()
    return result
  } catch (_) {
    return null
  }
}

async function redisPipeline(commands) {
  const { url, token } = cfg()
  if (!url || !token) return null
  try {
    const res = await fetch(`${url}/pipeline`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(commands),
    })
    if (!res.ok) return null
    return await res.json()
  } catch (_) {
    return null
  }
}

export async function pushPoint(name, point) {
  const cutoff = Date.now() - WEEK
  const member = JSON.stringify({
    ts:      point.ts,
    balance: point.balance,
    kills:   point.kills,
    deaths:  point.deaths,
  })
  const meta = JSON.stringify({
    balance:  point.balance,
    kills:    point.kills,
    deaths:   point.deaths,
    online:   point.online,
    lastSeen: point.ts,
  })

  await redisPipeline([
    ['ZADD', `g:${name}`, point.ts, member],
    ['ZREMRANGEBYSCORE', `g:${name}`, '0', String(cutoff)],
    ['SADD', 'players', name],
    ['SET', `m:${name}`, meta],
  ])
}

export async function getGraph(name) {
  const since = Date.now() - WEEK
  const raw   = await redis('ZRANGEBYSCORE', `g:${name}`, since, '+inf')
  if (!Array.isArray(raw)) return []
  return raw.map(m => { try { return JSON.parse(m) } catch (_) { return null } }).filter(Boolean)
}

export async function getPlayers() {
  const raw = await redis('SMEMBERS', 'players')
  return Array.isArray(raw) ? raw : []
}

export async function getMeta(name) {
  const raw = await redis('GET', `m:${name}`)
  if (!raw) return {}
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw } catch (_) { return {} }
}
