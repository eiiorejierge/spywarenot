import { useState, useEffect, useRef, useCallback } from 'react'
import Head from 'next/head'

// ── Helpers ───────────────────────────────────────────────────────────────────

const CR = 0.04 / 1_000_000

function fmt(v) {
  if (v == null) return '—'
  if (v >= 1e6)  return `$${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3)  return `$${(v / 1e3).toFixed(1)}K`
  return `$${Math.round(v).toLocaleString()}`
}

function fmtReal(v) {
  if (v == null) return '—'
  const r = Math.abs(v) * CR
  return `$${r < 0.01 ? r.toFixed(4) : r.toFixed(2)}`
}

function fmtSign(v)  { return v >= 0 ? '+' : '' }

function fmtAge(ts) {
  if (!ts) return '—'
  const d = Date.now() - ts
  if (d < 60e3)    return 'just now'
  if (d < 3600e3)  return `${Math.floor(d / 60e3)}m ago`
  if (d < 86400e3) return `${Math.floor(d / 3600e3)}h ago`
  return `${Math.floor(d / 86400e3)}d ago`
}

// ── Canvas Chart ──────────────────────────────────────────────────────────────

function Chart({ pts, h = 90 }) {
  const ref = useRef(null)

  useEffect(() => {
    const c = ref.current
    if (!c) return
    const valid = (pts || []).filter(d => d.balance != null)
    const dpr = window.devicePixelRatio || 1
    const W   = c.offsetWidth || 400
    c.width   = W * dpr
    c.height  = h * dpr
    const ctx = c.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, W, h)

    if (valid.length < 2) {
      ctx.fillStyle = 'rgba(255,255,255,.02)'
      ctx.fillRect(0, 0, W, h)
      ctx.fillStyle = '#333'
      ctx.font      = "9px 'Space Mono', monospace"
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('no data', W / 2, h / 2)
      return
    }

    const vals  = valid.map(d => d.balance)
    const vMin  = Math.min(...vals), vMax = Math.max(...vals)
    const vRng  = vMax - vMin || Math.abs(vMin) * 0.005 || 1
    const tsMin = valid[0].ts
    const tsRng = valid.at(-1).ts - tsMin || 1
    const P     = 8
    const cW    = W - P * 2
    const cH    = h - P * 2
    const xp    = d => P + ((d.ts - tsMin) / tsRng) * cW
    const yp    = d => P + cH - ((d.balance - vMin) / vRng) * cH
    const up    = valid.at(-1).balance >= valid[0].balance
    const col   = up ? '#00ff88' : '#ed4245'

    // H/L guides
    ctx.setLineDash([2, 5])
    ctx.strokeStyle = 'rgba(255,255,255,.05)'
    ctx.lineWidth   = 1
    ;[vMax, vMin].forEach(v => {
      ctx.beginPath()
      ctx.moveTo(P, yp({ balance: v }))
      ctx.lineTo(W - P, yp({ balance: v }))
      ctx.stroke()
    })
    ctx.setLineDash([])

    // Fill
    const g = ctx.createLinearGradient(0, P, 0, h)
    g.addColorStop(0, up ? 'rgba(0,255,136,.12)' : 'rgba(237,66,69,.12)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.beginPath()
    valid.forEach((d, i) => i === 0 ? ctx.moveTo(xp(d), yp(d)) : ctx.lineTo(xp(d), yp(d)))
    ctx.lineTo(xp(valid.at(-1)), h + 2)
    ctx.lineTo(xp(valid[0]), h + 2)
    ctx.closePath()
    ctx.fillStyle = g
    ctx.fill()

    // Glow
    ctx.beginPath()
    valid.forEach((d, i) => i === 0 ? ctx.moveTo(xp(d), yp(d)) : ctx.lineTo(xp(d), yp(d)))
    ctx.strokeStyle = up ? 'rgba(0,255,136,.15)' : 'rgba(237,66,69,.15)'
    ctx.lineWidth   = 6
    ctx.lineJoin    = 'round'
    ctx.stroke()

    // Line
    ctx.beginPath()
    valid.forEach((d, i) => i === 0 ? ctx.moveTo(xp(d), yp(d)) : ctx.lineTo(xp(d), yp(d)))
    ctx.strokeStyle = col
    ctx.lineWidth   = 1.5
    ctx.lineJoin    = 'round'
    ctx.stroke()

    // End dot
    const lp = valid.at(-1)
    ctx.beginPath(); ctx.arc(xp(lp), yp(lp), 5, 0, Math.PI * 2)
    ctx.fillStyle = up ? 'rgba(0,255,136,.15)' : 'rgba(237,66,69,.15)'; ctx.fill()
    ctx.beginPath(); ctx.arc(xp(lp), yp(lp), 2.5, 0, Math.PI * 2)
    ctx.fillStyle = col; ctx.fill()
  }, [pts, h])

  return <canvas ref={ref} style={{ width: '100%', height: h + 'px', display: 'block' }} />
}

// ── Demo Data ─────────────────────────────────────────────────────────────────

const now = Date.now()
const DEMO_PLAYERS = [
  { name: 'Steve',   balance: 4820000, kills: 312, deaths: 44, online: true,  lastSeen: now },
  { name: 'Alex',    balance: 1250000, kills: 87,  deaths: 21, online: false, lastSeen: now - 3_600_000 },
  { name: 'Notch',   balance: 9100000, kills: 501, deaths: 12, online: true,  lastSeen: now },
  { name: 'Herobrine', balance: 320000, kills: 29, deaths: 88, online: false, lastSeen: now - 7_200_000 },
]

function makeDemoGraph(base) {
  const pts = []
  for (let i = 48; i >= 0; i--) {
    pts.push({ ts: now - i * 1_800_000, balance: base + (Math.random() - 0.48) * base * 0.04 * i })
  }
  return pts
}

const DEMO_GRAPHS = Object.fromEntries(DEMO_PLAYERS.map(p => [p.name, makeDemoGraph(p.balance)]))

// ── Player Card ───────────────────────────────────────────────────────────────

function PlayerCard({ player, pts, selected, onClick }) {
  const chg = pts.length > 1 ? pts.at(-1).balance - pts[0].balance : null
  const pct = chg != null && pts[0].balance ? chg / pts[0].balance * 100 : null
  const up  = chg != null && chg >= 0

  return (
    <div className={`card ${selected ? 'selected' : ''}`} onClick={onClick}>
      <div className="card-head">
        <div className="card-top-row">
          <img
            className="avatar"
            src={`https://mc-heads.net/avatar/${player.name}/40`}
            alt=""
            loading="lazy"
          />
          <div className="card-info">
            <div className="card-name">{player.name}</div>
            <div className={`card-status ${player.online ? 'on' : 'off'}`}>
              <span className={`dot ${player.online ? 'pulse' : ''}`} />
              {player.online ? 'ONLINE' : player.lastSeen ? `OFFLINE · ${fmtAge(player.lastSeen)}` : 'OFFLINE'}
            </div>
          </div>
        </div>

        <div className="card-bal">{fmt(player.balance)}</div>

        <div className="card-change">
          {chg != null ? (
            <span style={{ color: up ? 'var(--g)' : 'var(--r)' }}>
              {fmtSign(chg)}{fmt(chg)}
              {pct != null &&
                <span style={{ color: 'var(--dim)', marginLeft: 5, fontSize: 9 }}>
                  ({fmtSign(pct)}{pct.toFixed(1)}%)
                </span>
              }
            </span>
          ) : <span style={{ color: 'var(--dim)' }}>—</span>}
          <span className="real-val">{fmtReal(player.balance)}</span>
        </div>
      </div>

      <div className="card-chart">
        <Chart pts={pts} h={76} />
      </div>

      <div className="card-foot">
        <div className="stat"><div className="sl">KILLS</div><div className="sv g">{player.kills ?? '—'}</div></div>
        <div className="stat"><div className="sl">DEATHS</div><div className="sv r">{player.deaths ?? '—'}</div></div>
        <div className="stat"><div className="sl">K/D</div><div className="sv">
          {player.kills != null && player.deaths > 0 ? (player.kills / player.deaths).toFixed(2) : '—'}
        </div></div>
        <div className="stat nobr"><div className="sl">DATA PTS</div><div className="sv">{pts.length.toLocaleString()}</div></div>
      </div>
    </div>
  )
}

// ── Detail Panel ──────────────────────────────────────────────────────────────

function DetailPanel({ player, allPts, rangeMs, onClose }) {
  const pts = allPts.filter(d => d.ts >= Date.now() - rangeMs)

  const hiVal  = pts.length ? Math.max(...pts.map(d => d.balance)) : null
  const loVal  = pts.length ? Math.min(...pts.map(d => d.balance)) : null
  const chg    = pts.length > 1 ? pts.at(-1).balance - pts[0].balance : null
  const pct    = chg != null && pts[0].balance ? chg / pts[0].balance * 100 : null
  const up     = chg != null && chg >= 0

  return (
    <div className="detail">
      <div className="detail-head">
        <div className="detail-title-row">
          <img className="avatar lg" src={`https://mc-heads.net/avatar/${player.name}/64`} alt="" />
          <div>
            <div className="detail-name">{player.name}</div>
            <div className={`card-status ${player.online ? 'on' : 'off'}`} style={{ marginTop: 5 }}>
              <span className={`dot ${player.online ? 'pulse' : ''}`} />
              {player.online ? 'ONLINE NOW' : player.lastSeen ? `OFFLINE · last seen ${fmtAge(player.lastSeen)}` : 'OFFLINE'}
            </div>
          </div>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="detail-stats">
          <div className="ds"><div className="ds-label">BALANCE</div><div className="ds-val">{fmt(player.balance)}</div></div>
          <div className="ds"><div className="ds-label">REAL VALUE</div><div className="ds-val">{fmtReal(player.balance)}</div></div>
          <div className="ds"><div className="ds-label">CHANGE</div>
            <div className="ds-val" style={{ color: up ? 'var(--g)' : chg != null ? 'var(--r)' : 'var(--dim)' }}>
              {chg != null ? `${fmtSign(chg)}${fmt(chg)}` : '—'}
            </div>
          </div>
          <div className="ds"><div className="ds-label">CHANGE %</div>
            <div className="ds-val" style={{ color: up ? 'var(--g)' : pct != null ? 'var(--r)' : 'var(--dim)' }}>
              {pct != null ? `${fmtSign(pct)}${pct.toFixed(2)}%` : '—'}
            </div>
          </div>
          <div className="ds"><div className="ds-label">HIGH</div><div className="ds-val g">{fmt(hiVal)}</div></div>
          <div className="ds"><div className="ds-label">LOW</div><div className="ds-val r">{fmt(loVal)}</div></div>
          <div className="ds"><div className="ds-label">KILLS</div><div className="ds-val g">{player.kills ?? '—'}</div></div>
          <div className="ds"><div className="ds-label">DEATHS</div><div className="ds-val r">{player.deaths ?? '—'}</div></div>
        </div>
      </div>

      <div className="detail-chart">
        <Chart pts={pts} h={200} />
      </div>

      <div className="detail-footer">
        <span>{pts.length.toLocaleString()} data points in range</span>
        <span>·</span>
        <span>{allPts.length.toLocaleString()} total stored</span>
        <span>·</span>
        <span>stored up to 7 days</span>
      </div>
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

const RANGES = [
  { l: '1H', ms: 3_600_000 },
  { l: '6H', ms: 21_600_000 },
  { l: '1D', ms: 86_400_000 },
  { l: '3D', ms: 259_200_000 },
  { l: '1W', ms: 604_800_000 },
]

export default function Home() {
  const [configured, setConfigured] = useState(true)
  const [players,    setPlayers]    = useState([])
  const [graphs,     setGraphs]     = useState({})
  const [rangeMs,    setRangeMs]    = useState(86_400_000)
  const [selected,   setSelected]   = useState(null)
  const [updated,    setUpdated]    = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)

  const demo        = !configured || (players.length === 0 && !loading)
  const viewPlayers = demo ? DEMO_PLAYERS : players
  const viewGraphs  = demo ? DEMO_GRAPHS  : graphs

  const load = useCallback(async () => {
    try {
      const res  = await fetch('/api/data')
      const data = await res.json()

      setConfigured(data.configured !== false)

      if (data.players?.length) {
        setPlayers(data.players)
        const gs = { ...graphs }
        await Promise.all(data.players.map(async p => {
          try {
            const r = await fetch(`/api/data?name=${encodeURIComponent(p.name)}`)
            const d = await r.json()
            gs[p.name] = d.graph || []
          } catch (_) { gs[p.name] = gs[p.name] || [] }
        }))
        setGraphs(gs)
      }

      setUpdated(Date.now())
      setError(null)
    } catch (e) {
      setError('Failed to fetch data')
    }
    setLoading(false)
  }, []) // eslint-disable-line

  useEffect(() => {
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [load])

  const totalBal    = viewPlayers.reduce((s, p) => s + (p.balance || 0), 0)
  const onlineCount = viewPlayers.filter(p => p.online).length
  const selPlayer   = selected ? viewPlayers.find(p => p.name === selected) : null

  const getFilteredPts = name =>
    (viewGraphs[name] || []).filter(d => d.ts >= Date.now() - rangeMs)

  return (
    <>
      <Head>
        <title>multi tracker</title>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Mono:ital,wght@0,400;0,700;1,400&display=swap"
          rel="stylesheet"
        />
      </Head>

      <style>{CSS}</style>

      <div id="root">
        {/* ── Header ── */}
        <header>
          <div className="brand">
            <span className="bdot" />
            <span className="bname">MULTI TRACKER</span>
          </div>

          {viewPlayers.length > 0 && (
            <div className="hstats">
              <div className="hstat">
                <div className="hsl">ONLINE</div>
                <div className="hsv" style={{ color: onlineCount > 0 ? 'var(--g)' : 'var(--dim)' }}>
                  {onlineCount}<span style={{ color: 'var(--dim)' }}>/{players.length}</span>
                </div>
              </div>
              <div className="hsep" />
              <div className="hstat">
                <div className="hsl">COMBINED</div>
                <div className="hsv">{fmt(totalBal)}</div>
              </div>
              <div className="hsep" />
              <div className="hstat">
                <div className="hsl">REAL $</div>
                <div className="hsv">{fmtReal(totalBal)}</div>
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
            <button className="refresh-btn" onClick={load} title="Refresh now">↻</button>
            {updated && <div className="upd">{fmtAge(updated)}</div>}
          </div>
        </header>

        {/* ── Body ── */}
        <div className="body">
          {/* Left: grid */}
          <div className="left">
            {loading ? (
              <div className="empty"><span className="spinner" /> loading...</div>
            ) : (
              <>
                {demo && (
                  <div className="demo-banner">DEMO MODE — connect KV storage to show real data</div>
                )}
                <div className="grid">
                  {viewPlayers.map(p => (
                    <PlayerCard
                      key={p.name}
                      player={p}
                      pts={getFilteredPts(p.name)}
                      selected={selected === p.name}
                      onClick={() => setSelected(selected === p.name ? null : p.name)}
                    />
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Right: detail panel */}
          {selPlayer && (
            <div className="right">
              <DetailPanel
                player={selPlayer}
                allPts={viewGraphs[selPlayer.name] || []}
                rangeMs={rangeMs}
                onClose={() => setSelected(null)}
              />
            </div>
          )}
        </div>

        <footer>
          <span>multi tracker</span>
          <span className="fsep">·</span>
          <span>auto-refreshes every 30s</span>
          <span className="fsep">·</span>
          <span>graph data kept 7 days</span>
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
    --mono:  'Space Mono', monospace;
  }

  html, body {
    background: var(--bg);
    color: var(--t);
    font-family: var(--mono);
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
  }

  #root { max-width: 1600px; margin: 0 auto; padding: 0 20px; }

  /* ── Header ── */
  header {
    display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
    padding: 18px 0 14px;
    border-bottom: 1px solid var(--bd);
    margin-bottom: 20px;
  }

  .brand { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
  .bdot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--g);
    box-shadow: 0 0 0 2px rgba(0,255,136,.1), 0 0 14px rgba(0,255,136,.5);
    animation: glow 2.8s ease-in-out infinite;
    flex-shrink: 0;
  }
  .bname { font-size: 12px; font-weight: 700; letter-spacing: .24em; }

  .hstats { display: flex; align-items: center; gap: 12px; }
  .hstat  { display: flex; flex-direction: column; gap: 2px; }
  .hsl    { font-size: 7px; color: var(--dimmer); letter-spacing: .14em; }
  .hsv    { font-size: 12px; font-weight: 700; letter-spacing: .04em; }
  .hsep   { width: 1px; height: 28px; background: var(--bd); }

  .hright { display: flex; align-items: center; gap: 10px; margin-left: auto; }
  .ranges { display: flex; gap: 3px; }
  .ranges button {
    background: transparent; border: 1px solid var(--bd); color: var(--dim);
    padding: 5px 11px; border-radius: 3px;
    font: 9px/1 var(--mono); cursor: pointer; letter-spacing: .12em;
    transition: all .1s;
  }
  .ranges button:hover { border-color: var(--bd2); color: var(--t); }
  .ranges button.act   { background: rgba(255,255,255,.07); border-color: var(--bd2); color: var(--t); }
  .refresh-btn {
    background: transparent; border: 1px solid var(--bd); color: var(--dim);
    width: 28px; height: 28px; border-radius: 3px;
    font-size: 13px; cursor: pointer; transition: all .1s; line-height: 1;
  }
  .refresh-btn:hover { border-color: var(--bd2); color: var(--t); }
  .upd { font-size: 9px; color: var(--dimmer); letter-spacing: .06em; }

  /* ── Body layout ── */
  .body { display: flex; gap: 14px; align-items: flex-start; }
  .left { flex: 1; min-width: 0; }
  .right { width: 380px; flex-shrink: 0; position: sticky; top: 16px; }

  /* ── Demo banner ── */
  .demo-banner {
    font-size: 9px; letter-spacing: .14em; color: #ff9500;
    border: 1px solid rgba(255,149,0,.2); background: rgba(255,149,0,.05);
    border-radius: 4px; padding: 7px 12px; margin-bottom: 12px;
  }

  /* ── Grid ── */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px;
  }

  .empty {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 8px; padding: 80px 20px;
    font-size: 11px; color: var(--dim); letter-spacing: .08em; text-align: center;
    line-height: 1.6;
  }

  /* ── Card ── */
  .card {
    background: var(--bg2); border: 1px solid var(--bd);
    border-radius: 6px; overflow: hidden;
    cursor: pointer; transition: border-color .15s;
  }
  .card:hover    { border-color: var(--bd2); }
  .card.selected { border-color: rgba(0,255,136,.3); background: rgba(0,255,136,.02); }

  .card-head     { padding: 13px 13px 9px; }
  .card-top-row  { display: flex; align-items: center; gap: 9px; margin-bottom: 9px; }
  .avatar        { width: 32px; height: 32px; border-radius: 3px; image-rendering: pixelated; flex-shrink: 0; background: var(--bg3); }
  .avatar.lg     { width: 44px; height: 44px; }
  .card-info     { flex: 1; min-width: 0; }
  .card-name     { font-size: 12px; font-weight: 700; letter-spacing: .06em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 3px; }
  .card-status   { font-size: 8px; letter-spacing: .12em; display: flex; align-items: center; gap: 5px; }
  .card-status.on  { color: var(--g); }
  .card-status.off { color: var(--dim); }
  .dot       { width: 5px; height: 5px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
  .dot.pulse { animation: sdpulse 2s ease-in-out infinite; }
  .card-bal  { font-size: 22px; font-weight: 700; letter-spacing: .01em; line-height: 1; margin-bottom: 5px; }
  .card-change { display: flex; align-items: baseline; font-size: 10px; gap: 6px; min-height: 14px; }
  .real-val    { font-size: 9px; color: var(--dim); margin-left: auto; }

  .card-chart { background: var(--bg); border-top: 1px solid var(--bd); border-bottom: 1px solid var(--bd); }

  .card-foot { display: grid; grid-template-columns: repeat(4, 1fr); }
  .stat      { padding: 7px 4px; text-align: center; border-right: 1px solid var(--bd); }
  .stat.nobr { border-right: none; }
  .sl { font-size: 7px; color: var(--dimmer); letter-spacing: .13em; margin-bottom: 3px; }
  .sv { font-size: 10px; letter-spacing: .04em; }
  .g  { color: var(--g); }
  .r  { color: var(--r); }

  /* ── Detail panel ── */
  .detail {
    background: var(--bg2); border: 1px solid var(--bd);
    border-radius: 6px; overflow: hidden;
  }
  .detail-head { padding: 16px; border-bottom: 1px solid var(--bd); }
  .detail-title-row { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
  .detail-name { font-size: 16px; font-weight: 700; letter-spacing: .06em; }
  .close-btn {
    margin-left: auto; background: transparent; border: 1px solid var(--bd);
    color: var(--dim); width: 28px; height: 28px; border-radius: 3px;
    font-size: 11px; cursor: pointer; flex-shrink: 0; transition: all .1s;
  }
  .close-btn:hover { border-color: var(--bd2); color: var(--t); }

  .detail-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--bd); border: 1px solid var(--bd); border-radius: 4px; overflow: hidden; }
  .ds       { padding: 8px 10px; background: var(--bg); }
  .ds-label { font-size: 7px; color: var(--dimmer); letter-spacing: .14em; margin-bottom: 3px; }
  .ds-val   { font-size: 11px; font-weight: 700; letter-spacing: .04em; }

  .detail-chart  { background: var(--bg); border-top: 1px solid var(--bd); border-bottom: 1px solid var(--bd); }
  .detail-footer { padding: 8px 14px; display: flex; gap: 8px; font-size: 9px; color: var(--dimmer); letter-spacing: .06em; flex-wrap: wrap; }

  /* ── Setup box ── */
  .setup-box { border: 1px solid rgba(255,153,0,.2); background: rgba(255,153,0,.04); border-radius: 6px; padding: 24px; max-width: 600px; }
  .setup-title { font-size: 12px; font-weight: 700; letter-spacing: .1em; color: var(--o, #ff9500); margin-bottom: 16px; }
  .setup-body { font-size: 11px; color: var(--dim); line-height: 1.8; }
  .setup-body ol { padding-left: 20px; margin: 10px 0; }
  .setup-body li { margin-bottom: 6px; }
  .setup-body strong { color: var(--t); }
  .setup-body code { background: var(--bg3); padding: 1px 5px; border-radius: 3px; font-family: var(--mono); font-size: 10px; }

  /* ── Footer ── */
  footer {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    padding: 16px 0; border-top: 1px solid var(--bd);
    font-size: 9px; color: var(--dimmer); letter-spacing: .08em;
  }
  .fsep { color: var(--bd2); }

  /* ── Spinner ── */
  .spinner {
    display: inline-block; width: 12px; height: 12px;
    border: 1.5px solid var(--bd2); border-top-color: var(--g);
    border-radius: 50%; animation: spin .65s linear infinite;
  }

  /* ── Animations ── */
  @keyframes glow {
    0%,100% { box-shadow: 0 0 0 2px rgba(0,255,136,.1), 0 0 14px rgba(0,255,136,.5); }
    50%      { box-shadow: 0 0 0 3px rgba(0,255,136,.04), 0 0 6px rgba(0,255,136,.15); }
  }
  @keyframes sdpulse { 0%,100% { opacity:1; } 50% { opacity:.2; } }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Responsive ── */
  @media (max-width: 900px) {
    .body  { flex-direction: column; }
    .right { width: 100%; position: static; }
  }
  @media (max-width: 600px) {
    .grid  { grid-template-columns: 1fr; }
    .hstats { display: none; }
    .ranges button { padding: 4px 8px; font-size: 8px; }
    .upd   { display: none; }
  }
`
