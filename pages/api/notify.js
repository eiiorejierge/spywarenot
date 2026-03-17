export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN
  if (!BOT_TOKEN) return res.status(503).json({ error: 'DISCORD_BOT_TOKEN not configured' })

  const { channelId, embed } = req.body
  if (!channelId || !embed) return res.status(400).json({ error: 'missing channelId or embed' })

  try {
    const r = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    })
    if (!r.ok) return res.status(r.status).json({ error: await r.text() })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
