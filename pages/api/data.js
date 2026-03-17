import { getGraph, getPlayers, getMeta, isConfigured } from '../../lib/db'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=20')

  if (!isConfigured()) {
    return res.json({ configured: false, players: [], graph: [] })
  }

  try {
    const { name } = req.query

    if (name) {
      const [graph, meta] = await Promise.all([getGraph(name), getMeta(name)])
      return res.json({ configured: true, graph, meta })
    }

    const players = await getPlayers()
    const metas   = await Promise.all(players.map(getMeta))
    res.json({ configured: true, players: players.map((p, i) => ({ name: p, ...metas[i] })) })
  } catch (e) {
    res.status(500).json({ configured: true, error: e.message, players: [] })
  }
}
