// Lazily create the KV client so missing env vars don't crash at import time
async function getKV() {
  const url   = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  if (!url || !token) return null
  try {
    const { createClient } = await import('@vercel/kv')
    return createClient({ url, token })
  } catch (_) {
    return null
  }
}

export function isConfigured() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
}

const WEEK = 7 * 24 * 60 * 60 * 1000

export async function pushPoint(name, point) {
  const kv = await getKV()
  if (!kv) return

  const member = JSON.stringify({
    ts:      point.ts,
    balance: point.balance,
    kills:   point.kills,
    deaths:  point.deaths,
  })
  const cutoff = Date.now() - WEEK

  await Promise.all([
    kv.zadd(`g:${name}`, { score: point.ts, member }),
    kv.zremrangebyscore(`g:${name}`, 0, cutoff),
    kv.sadd('players', name),
    kv.set(`m:${name}`, {
      balance:  point.balance,
      kills:    point.kills,
      deaths:   point.deaths,
      online:   point.online,
      lastSeen: point.ts,
    }),
  ])
}

export async function getGraph(name) {
  const kv = await getKV()
  if (!kv) return []
  try {
    const since   = Date.now() - WEEK
    const members = await kv.zrangebyscore(`g:${name}`, since, '+inf')
    return (members || []).map(m => (typeof m === 'string' ? JSON.parse(m) : m))
  } catch (_) { return [] }
}

export async function getPlayers() {
  const kv = await getKV()
  if (!kv) return []
  try { return (await kv.smembers('players')) || [] }
  catch (_) { return [] }
}

export async function getMeta(name) {
  const kv = await getKV()
  if (!kv) return {}
  try { return (await kv.get(`m:${name}`)) || {} }
  catch (_) { return {} }
}
