import { getGraph, getPlayers, getMeta } from '../../lib/db'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=20')

  const { name } = req.query

  if (name) {
    const [graph, meta] = await Promise.all([getGraph(name), getMeta(name)])
    return res.json({ graph, meta })
  }

  const players = await getPlayers()
  const metas = await Promise.all(players.map(getMeta))
  res.json({ players: players.map((p, i) => ({ name: p, ...metas[i] })) })
}
