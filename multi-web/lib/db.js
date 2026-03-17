import { kv } from '@vercel/kv'

const WEEK = 7 * 24 * 60 * 60 * 1000

export async function pushPoint(name, point) {
  const member = JSON.stringify({
    ts: point.ts,
    balance: point.balance,
    kills: point.kills,
    deaths: point.deaths,
  })
  await Promise.all([
    kv.zadd(`g:${name}`, { score: point.ts, member }),
    kv.zremrangebyscore(`g:${name}`, 0, Date.now() - WEEK),
    kv.sadd('players', name),
    kv.set(`m:${name}`, {
      balance: point.balance,
      kills: point.kills,
      deaths: point.deaths,
      online: point.online,
      lastSeen: point.ts,
    }),
  ])
}

export async function getGraph(name) {
  const since = Date.now() - WEEK
  const members = await kv.zrangebyscore(`g:${name}`, since, '+inf')
  return (members || []).map(m => (typeof m === 'string' ? JSON.parse(m) : m))
}

export async function getPlayers() {
  return (await kv.smembers('players')) || []
}

export async function getMeta(name) {
  return (await kv.get(`m:${name}`)) || {}
}
