import { pushPoint, isConfigured } from '../../lib/db'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  if (!isConfigured()) {
    return res.status(503).json({ error: 'KV not configured' })
  }

  const secret = process.env.PUSH_SECRET
  if (secret && req.headers['x-secret'] !== secret) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  try {
    const { name, balance, kills, deaths, online, ts } = req.body
    if (!name) return res.status(400).json({ error: 'name required' })

    await pushPoint(name, { ts: ts || Date.now(), balance, kills, deaths, online })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
