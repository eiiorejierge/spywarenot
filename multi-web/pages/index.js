import { useState, useEffect, useRef, useCallback } from 'react'
import Head from 'next/head'

// ── Helpers ───────────────────────────────────────────────────────────────────

const CR = 0.04 / 1_000_000

function fmt(v) {
  if (v == null) return '—'
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`
  return `$${Math.round(v).toLocaleString()}`
}

function fmtReal(v) {
  if (v == null) return '—'
  const r = Math.abs(v) * CR
  return `$${r < 0.01 ? r.toFixed(4) : r.toFixed(2)}`
}

function fmtSign(v) { return v >= 0 ? '+' : '' }

function fmtAge(ts) {
  const d = Date.now() - ts
  if (d < 60e3) return 'just now'
  if (d < 3600e3) return `${Math.floor(d / 60e3)}m ago`
  if (d < 86400e3) return `${Math.floor(d / 3600e3)}h ago`
  return `${Math.floor(d / 86400e3)}d ago`
}

// ── Canvas Chart ──────────────────────────────────────────────────────────────

function MiniChart({ data, h = 80 }) {
  const ref = useRef(null)

  useEffect(() => {
    const c = ref.current
    if (!c) return
    const pts = (data || []).filter(d => d.balance != null)
    const dpr = window.devicePixelRatio || 1
    const W = c.offsetWidth || 300
    c.width = W * dpr
    c.height = h * dpr
    const ctx = c.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, W, h)

    if (pts.length < 2) {
      ctx.fillStyle = 'rgba(255,255,255,.02)'
      ctx.fillRect(0, 0, W, h)
      return
    }

    const vals = pts.map(d => d.balance)
    const vMin = Math.min(...vals), vMax = Math.max(...vals)
    const vRng = vMax - vMin || Math.abs(vMin) * 0.01 || 1
    const tsMin = pts[0].ts, tsRng = pts.at(-1).ts - tsMin || 1
    const P = 7
    const cW = W - P * 2, cH = h - P * 2
    const x = d => P + ((d.ts - tsMin) / tsRng) * cW
    const y = d => P + cH - ((d.balance - vMin) / vRng) * cH
    const up = pts.at(-1).balance >= pts[0].balance
    const col = up ? '#00ff88' : '#ed4245'

    // H/L guide lines
    ctx.setLineDash([2, 5])
    ctx.strokeStyle = 'rgba(255,255,255,.06)'
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(P, y({ balance: vMax })); ctx.lineTo(W - P, y({ balance: vMax })); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(P, y({ balance: vMin })); ctx.lineTo(W - P, y({ balance: vMin })); ctx.stroke()
    ctx.setLineDash([])

    // Gradient fill
    const g = ctx.createLinearGradient(0, P, 0, h)
    g.addColorStop(0, up ? 'rgba(0,255,136,.14)' : 'rgba(237,66,69,.14)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.beginPath()
    pts.forEach((d, i) => i === 0 ? ctx.moveTo(x(d), y(d)) : ctx.lineTo(x(d), y(d)))
    ctx.lineTo(x(pts.at(-1)), h + 2)
    ctx.lineTo(x(pts[0]), h + 2)
    ctx.closePath()
    ctx.fillStyle = g
    ctx.fill()

    // Glow line
    ctx.beginPath()
    pts.forEach((d, i) => i === 0 ? ctx.moveTo(x(d), y(d)) : ctx.lineTo(x(d), y(d)))
    ctx.strokeStyle = up ? 'rgba(0,255,136,.18)' : 'rgba(237,66,69,.18)'
    ctx.lineWidth = 5
    ctx.lineJoin = 'round'
    ctx.stroke()

    // Main line
    ctx.beginPath()
    pts.forEach((d, i) => i === 0 ? ctx.moveTo(x(d), y(d)) : ctx.lineTo(x(d), y(d)))
    ctx.strokeStyle = col
    ctx.lineWidth = 1.5
    ctx.lineJoin = 'round'
    ctx.stroke()

    // End dot
    const lp = pts.at(-1)
    ctx.beginPath(); ctx.arc(x(lp), y(lp), 5, 0, Math.PI * 2)
    ctx.fillStyle = up ? 'rgba(0,255,136,.18)' : 'rgba(237,66,69,.18)'; ctx.fill()
    ctx.beginPath(); ctx.arc(x(lp), y(lp), 2.5, 0, Math.PI * 2)
    ctx.fillStyle = col; ctx.fill()
  }, [data, h])

  return <canvas ref={ref} style={{ width: '100%', height: h + 'px', display: 'block' }} />
}

// ── Player Card ───────────────────────────────────────────────────────────────

function PlayerCard({ player, graph, rangeMs }) {
  const now = Date.now()
  const pts = graph.filter(d => d.ts >= now - rangeMs)
  const chg = pts.length > 1 ? pts.at(-1).balance - pts[0].balance : null
  const pct = (chg != null && pts[0].balance) ? (chg / pts[0].balance * 100) : null
  const up = chg != null && chg >= 0
  const online = player.online

  const hiVal = pts.length ? Math.max(...pts.map(d => d.balance)) : null
  const loVal = pts.length ? Math.min(...pts.map(d => d.balance)) : null

  return (
    <div className="card">
      <div className="card-head">
        <div className="row-top">
          <img
            className="avatar"
            src={`https://mc-heads.net/avatar/${player.name}/40`}
            alt=""
            loading="lazy"
          />
          <div className="card-info">
            <div className="card-name">{player.name}</div>
            <div className={`card-status ${online ? 'on' : 'off'}`}>
              <span className={`sdot ${online ? 'pulse' : ''}`} />
              {online
                ? 'ONLINE'
                : player.lastSeen
                  ? `OFFLINE · ${fmtAge(player.lastSeen)}`
                  : 'OFFLINE'}
            </div>
          </div>
        </div>

        <div className="card-bal">{fmt(player.balance)}</div>

        <div className="card-sub">
          {chg != null ? (
            <span style={{ color: up ? 'var(--g)' : 'var(--r)' }}>
              {fmtSign(chg)}{fmt(chg)}
              {pct != null && (
                <span style={{ color: 'var(--dim)', marginLeft: 5 }}>
                  ({fmtSign(pct)}{pct.toFixed(1)}%)
                </span>
              )}
            </span>
          ) : (
            <span style={{ color: 'var(--dim)' }}>—</span>
          )}
          <span className="real-val">{fmtReal(player.balance)}</span>
        </div>
      </div>

      <div className="chart-wrap">
        {pts.length > 1
          ? <MiniChart data={pts} h={86} />
          : <div className="no-data">no data for range</div>
        }
      </div>

      {pts.length > 1 && (
        <div className="hl-bar">
          <span className="hl-item"><span className="hl-label">H</span><span style={{ color: 'var(--g)' }}>{fmt(hiVal)}</span></span>
          <span className="hl-item"><span className="hl-label">L</span><span style={{ color: 'var(--r)' }}>{fmt(loVal)}</span></span>
          <span className="hl-item"><span className="hl-label">REAL</span><span>{fmtReal(player.balance)}</span></span>
          <span className="hl-item"><span className="hl-label">PTS</span><span>{pts.length.toLocaleString()}</span></span>
        </div>
      )}

      <div className="card-foot">
        <div className="stat">
          <div className="sl">KILLS</div>
          <div className="sv" style={{ color: 'var(--g)' }}>{player.kills ?? '—'}</div>
        </div>
        <div className="stat">
          <div className="sl">DEATHS</div>
          <div className="sv" style={{ color: 'var(--r)' }}>{player.deaths ?? '—'}</div>
        </div>
        <div className="stat">
          <div className="sl">K/D</div>
          <div className="sv">
            {player.kills != null && player.deaths > 0
              ? (player.kills / player.deaths).toFixed(2)
              : '—'}
          </div>
        </div>
        <div className="stat" style={{ borderRight: 'none' }}>
          <div className="sl">BALANCE</div>
          <div className="sv">{fmt(player.balance)}</div>
        </div>
      </div>
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

const RANGES = [
  { l: '1H',  ms: 3_600_000 },
  { l: '6H',  ms: 21_600_000 },
  { l: '1D',  ms: 86_400_000 },
  { l: '3D',  ms: 259_200_000 },
  { l: '1W',  ms: 604_800_000 },
]

export default function Home() {
  const [players, setPlayers] = useState([])
  const [graphs,  setGraphs]  = useState({})
  const [rangeMs, setRangeMs] = useState(86_400_000)
  const [updated, setUpdated] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tick,    setTick]    = useState(0)

  const load = useCallback(async () => {
    try {
      const { players: ps } = await fetch('/api/data').then(r => r.json())
      if (ps?.length) {
        setPlayers(ps)
        const gs = {}
        await Promise.all(ps.map(async p => {
          const { graph } = await fetch(`/api/data?name=${encodeURIComponent(p.name)}`).then(r => r.json())
          gs[p.name] = graph || []
        }))
        setGraphs(gs)
      }
      setUpdated(Date.now())
    } catch (_) {}
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const refresh = setInterval(load, 30_000)
    const clock   = setInterval(() => setTick(t => t + 1), 15_000)
    return () => { clearInterval(refresh); clearInterval(clock) }
  }, [load])

  const totalBalance = players.reduce((s, p) => s + (p.balance || 0), 0)
  const onlineCount  = players.filter(p => p.online).length

  return (
    <>
      <Head>
        <title>multi tracker</title>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Space+Mono:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet" />
      </Head>

      <style>{CSS}</style>

      <div id="root">
        <header>
          <div className="brand">
            <span className="bdot" />
            <span className="bname">MULTI TRACKER</span>
          </div>

          {players.length > 0 && (
            <div className="hstats">
              <div className="hstat">
                <span className="hsl">ONLINE</span>
                <span className="hsv" style={{ color: onlineCount > 0 ? 'var(--g)' : 'var(--dim)' }}>
                  {onlineCount}/{players.length}
                </span>
              </div>
              <div className="hsep" />
              <div className="hstat">
                <span className="hsl">TOTAL BAL</span>
                <span className="hsv">{fmt(totalBalance)}</span>
              </div>
            </div>
          )}

          <div className="hright">
            <div className="ranges">
              {RANGES.map(r => (
                <button
                  key={r.l}
                  className={rangeMs === r.ms ? 'act' : ''}
                  onClick={() => setRangeMs(r.ms)}
                >
                  {r.l}
                </button>
              ))}
            </div>
            <div className="upd">
              {updated ? `↻ ${fmtAge(updated)}` : ''}
            </div>
          </div>
        </header>

        <main>
          {loading ? (
            <div className="empty">
              <span className="spinner" />
              loading...
            </div>
          ) : players.length === 0 ? (
            <div className="empty">
              no data yet — open the tracker app and configure the web dashboard URL
            </div>
          ) : (
            <div className="grid">
              {players.map(p => (
                <PlayerCard
                  key={p.name}
                  player={p}
                  graph={graphs[p.name] || []}
                  rangeMs={rangeMs}
                />
              ))}
            </div>
          )}
        </main>

        <footer>
          <span>multi tracker</span>
          <span className="fsep">·</span>
          <span>refreshes every 30s</span>
          <span className="fsep">·</span>
          <span>graph data kept 7 days</span>
          {updated && (
            <>
              <span className="fsep">·</span>
              <span>updated {fmtAge(updated)}</span>
            </>
          )}
        </footer>
      </div>
    </>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:    #050505;
    --bg2:   #0b0b0b;
    --bg3:   #111;
    --bd:    rgba(255,255,255,.055);
    --bd2:   rgba(255,255,255,.12);
    --t:     #e8e8e8;
    --dim:   #606060;
    --dimmer:#363636;
    --g:     #00ff88;
    --r:     #ed4245;
    --o:     #ff9500;
    --mono:  'Space Mono', monospace;
  }

  html, body {
    background: var(--bg);
    color: var(--t);
    font-family: var(--mono);
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
  }

  #root { max-width: 1500px; margin: 0 auto; padding: 0 20px; }

  /* ── Header ── */
  header {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 18px 0 14px;
    border-bottom: 1px solid var(--bd);
    margin-bottom: 22px;
    flex-wrap: wrap;
  }

  .brand { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
  .bdot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--g);
    box-shadow: 0 0 0 2px rgba(0,255,136,.12), 0 0 16px rgba(0,255,136,.5);
    animation: glowpulse 2.8s ease-in-out infinite;
    flex-shrink: 0;
  }
  .bname { font-size: 12px; font-weight: 700; letter-spacing: .24em; }

  .hstats { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
  .hstat  { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; }
  .hsl    { font-size: 7px; color: var(--dimmer); letter-spacing: .14em; }
  .hsv    { font-size: 11px; font-weight: 700; letter-spacing: .06em; }
  .hsep   { width: 1px; height: 24px; background: var(--bd); }

  .hright { display: flex; align-items: center; gap: 12px; margin-left: auto; }
  .ranges { display: flex; gap: 4px; }
  .ranges button {
    background: transparent;
    border: 1px solid var(--bd);
    color: var(--dim);
    padding: 5px 11px;
    border-radius: 3px;
    font: 9px/1 var(--mono);
    cursor: pointer;
    letter-spacing: .12em;
    transition: border-color .1s, color .1s, background .1s;
  }
  .ranges button:hover { border-color: var(--bd2); color: var(--t); }
  .ranges button.act   { background: rgba(255,255,255,.07); border-color: var(--bd2); color: var(--t); }
  .upd { font-size: 9px; color: var(--dimmer); letter-spacing: .06em; white-space: nowrap; }

  /* ── Main ── */
  main { padding-bottom: 48px; }

  .empty {
    display: flex; align-items: center; justify-content: center; gap: 10px;
    padding: 100px 20px;
    font-size: 11px; color: var(--dim); letter-spacing: .08em;
    text-align: center;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 14px;
  }

  /* ── Card ── */
  .card {
    background: var(--bg2);
    border: 1px solid var(--bd);
    border-radius: 6px;
    overflow: hidden;
    transition: border-color .15s;
  }
  .card:hover { border-color: var(--bd2); }

  .card-head { padding: 14px 14px 10px; }
  .row-top   { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }

  .avatar {
    width: 34px; height: 34px;
    border-radius: 3px;
    image-rendering: pixelated;
    flex-shrink: 0;
    background: var(--bg3);
  }
  .card-info   { flex: 1; min-width: 0; }
  .card-name   {
    font-size: 12px; font-weight: 700; letter-spacing: .06em;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    margin-bottom: 4px;
  }
  .card-status {
    font-size: 8px; letter-spacing: .12em;
    display: flex; align-items: center; gap: 5px;
  }
  .card-status.on  { color: var(--g); }
  .card-status.off { color: var(--dim); }

  .sdot       { width: 5px; height: 5px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
  .sdot.pulse { animation: sdpulse 2s ease-in-out infinite; }

  .card-bal {
    font-size: 24px; font-weight: 700; letter-spacing: .01em;
    line-height: 1; margin-bottom: 6px;
  }
  .card-sub {
    display: flex; align-items: baseline;
    font-size: 10px; gap: 6px; min-height: 15px;
  }
  .real-val { font-size: 9px; color: var(--dim); margin-left: auto; }

  /* ── Chart ── */
  .chart-wrap {
    background: var(--bg);
    border-top: 1px solid var(--bd);
    border-bottom: 1px solid var(--bd);
  }
  .no-data {
    height: 86px;
    display: flex; align-items: center; justify-content: center;
    font-size: 9px; color: var(--dimmer); letter-spacing: .08em;
  }

  /* ── H/L bar ── */
  .hl-bar {
    display: flex;
    border-bottom: 1px solid var(--bd);
    background: rgba(255,255,255,.015);
  }
  .hl-item {
    flex: 1; padding: 5px 8px;
    display: flex; flex-direction: column; align-items: center; gap: 2px;
    border-right: 1px solid var(--bd);
    font-size: 9px;
  }
  .hl-item:last-child { border-right: none; }
  .hl-label { font-size: 7px; color: var(--dimmer); letter-spacing: .12em; }

  /* ── Footer stats ── */
  .card-foot { display: grid; grid-template-columns: repeat(4, 1fr); }
  .stat {
    padding: 8px 4px; text-align: center;
    border-right: 1px solid var(--bd);
  }
  .sl { font-size: 7px; color: var(--dimmer); letter-spacing: .14em; margin-bottom: 3px; }
  .sv { font-size: 10px; letter-spacing: .04em; }

  /* ── Page footer ── */
  footer {
    display: flex; align-items: center; gap: 8px;
    padding: 16px 0;
    border-top: 1px solid var(--bd);
    font-size: 9px; color: var(--dimmer); letter-spacing: .08em;
  }
  .fsep { color: var(--bd2); }

  /* ── Spinner ── */
  .spinner {
    display: inline-block;
    width: 12px; height: 12px;
    border: 1.5px solid var(--bd2);
    border-top-color: var(--g);
    border-radius: 50%;
    animation: spin .65s linear infinite;
  }

  /* ── Animations ── */
  @keyframes glowpulse {
    0%, 100% { box-shadow: 0 0 0 2px rgba(0,255,136,.12), 0 0 16px rgba(0,255,136,.5); }
    50%       { box-shadow: 0 0 0 3px rgba(0,255,136,.05), 0 0 6px  rgba(0,255,136,.15); }
  }
  @keyframes sdpulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: .2; }
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Responsive ── */
  @media (max-width: 640px) {
    .grid { grid-template-columns: 1fr; }
    .hright { gap: 8px; }
    .ranges button { padding: 4px 8px; font-size: 8px; }
    .upd { display: none; }
    .card-bal { font-size: 20px; }
    .hstats { display: none; }
  }
`
