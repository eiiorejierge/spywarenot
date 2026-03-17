const DONUT_API = 'https://api.donutsmp.net/v1/stats'
const API_TOKEN = process.env.DONUT_API_TOKEN || '1b55240d4b324d72ad921cc4c7dbdd72'

async function fetchPlayer(name) {
  const resp = await fetch(`${DONUT_API}/${name}`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  })
  if (!resp.ok) return null
  const data = await resp.json()
  const r    = data?.result || {}
  const balance = parseFloat(r.money)
  if (isNaN(balance)) return null
  return {
    name,
    balance,
    kills:  isNaN(parseInt(r.kills))  ? null : parseInt(r.kills),
    deaths: isNaN(parseInt(r.deaths)) ? null : parseInt(r.deaths),
    online: null,
    lastSeen: Date.now(),
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=20')

  // Single player graph request — no storage, return empty graph
  if (req.query.name) {
    return res.json({ graph: [], meta: {} })
  }

  const players = (req.query.players || process.env.PLAYERS || '')
    .split(',').map(p => p.trim()).filter(Boolean)

  if (!players.length) {
    return res.json({ configured: false, players: [], graph: [] })
  }

  try {
    const results = await Promise.all(players.map(fetchPlayer))
    const valid   = results.filter(Boolean)
    res.json({ configured: true, players: valid })
  } catch (e) {
    res.status(500).json({ configured: true, error: e.message, players: [] })
  }
}
