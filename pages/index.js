import { useState, useEffect, useRef, useCallback } from 'react'
import Head from 'next/head'

// ── Constants ──────────────────────────────────────────────────────────────────

const COIN_RATE = 0.04 / 1_000_000
const THEMES = ['dark', 'matrix', 'nord', 'warm']

// ── Formatters ─────────────────────────────────────────────────────────────────

function fmt(v) {
  if (v == null) return '—'
  return v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M'
       : v >= 1e3 ? '$' + (v / 1e3).toFixed(1) + 'K'
       : '$' + Math.round(v).toLocaleString()
}

function fmtReal(c, sign = false) {
  if (c == null) return ''
  const v = c * COIN_RATE, a = Math.abs(v), s = a < 0.01 ? a.toFixed(4) : a.toFixed(2)
  return sign ? (v >= 0 ? '+$' : '-$') + s : '$' + s
}

function ago(ts) {
  if (!ts) return '—'
  const s = (Date.now() - ts) / 1000 | 0
  return s < 60 ? s + 's' : s < 3600 ? (s / 60 | 0) + 'm' : (s / 3600 | 0) + 'h'
}

function fmtAge(ts) {
  if (!ts) return '—'
  const d = Date.now() - ts
  if (d < 60e3)    return 'just now'
  if (d < 3600e3)  return `${Math.floor(d / 60e3)}m ago`
  if (d < 86400e3) return `${Math.floor(d / 3600e3)}h ago`
  return `${Math.floor(d / 86400e3)}d ago`
}

function trendColors(a, b) {
  const up = b >= a
  return { col: up ? '#00ff88' : '#ff3355', glow: up ? 'rgba(0,255,136,.5)' : 'rgba(255,51,85,.5)', fill: up ? 'rgba(0,255,136,.07)' : 'rgba(255,51,85,.07)' }
}

function trendCls(ch) {
  return ch ? (ch.up ? 'up' : ch.flat ? 'flat' : 'down') : 'flat'
}

function getChange(graphData) {
  const pts = (graphData || []).filter(d => d.balance != null)
  if (pts.length < 2) return null
  const first = pts[0].balance, last = pts.at(-1).balance, diff = last - first
  return { diff, pct: first ? diff / first * 100 : 0, up: diff > 0, flat: !diff }
}

// ── Technical Indicators ───────────────────────────────────────────────────────

function calcMA(vals, p) {
  return vals.map((_, i) => i < p - 1 ? null : vals.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p)
}

function calcEMA(vals, p) {
  const k = 2 / (p + 1), ema = [vals[0]]
  for (let i = 1; i < vals.length; i++) ema.push(vals[i] * k + ema[i - 1] * (1 - k))
  return ema
}

function calcBollingerBands(vals, p = 20, m = 2) {
  return vals.map((_, i) => {
    if (i < p - 1) return null
    const sl = vals.slice(i - p + 1, i + 1), mean = sl.reduce((a, b) => a + b, 0) / p
    const sd = Math.sqrt(sl.reduce((a, b) => a + (b - mean) ** 2, 0) / p)
    return { mid: mean, upper: mean + m * sd, lower: mean - m * sd }
  })
}

function calcRSI(vals, p = 14) {
  if (vals.length <= p) return vals.map(() => null)
  const out = Array(p).fill(null)
  let G = 0, L = 0
  for (let i = 1; i <= p; i++) { const d = vals[i] - vals[i - 1]; d > 0 ? G += d : L -= d }
  G /= p; L /= p
  out.push(L === 0 ? 100 : 100 - 100 / (1 + G / L))
  for (let i = p + 1; i < vals.length; i++) {
    const d = vals[i] - vals[i - 1]
    G = (G * (p - 1) + Math.max(0, d)) / p; L = (L * (p - 1) + Math.max(0, -d)) / p
    out.push(L === 0 ? 100 : 100 - 100 / (1 + G / L))
  }
  return out
}

function calcMACD(vals, f = 12, s = 26, sig = 9) {
  if (vals.length < s + sig) return vals.map(() => null)
  const ml = calcEMA(vals, f).map((v, i) => v - calcEMA(vals, s)[i])
  const sl = calcEMA(ml, sig)
  return vals.map((_, i) => i < s - 1 || sl[i] == null ? null : { macd: ml[i], signal: sl[i], hist: ml[i] - sl[i] })
}

// ── Canvas Utilities ───────────────────────────────────────────────────────────

function smoothPath(ctx, pts, t = 0.35) {
  if (pts.length < 2) return
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 0; i < pts.length - 1; i++) {
    const [p0, p1, p2, p3] = [pts[Math.max(0, i - 1)], pts[i], pts[i + 1], pts[Math.min(pts.length - 1, i + 2)]]
    ctx.bezierCurveTo(p1.x + (p2.x - p0.x) * t, p1.y + (p2.y - p0.y) * t, p2.x - (p3.x - p1.x) * t, p2.y - (p3.y - p1.y) * t, p2.x, p2.y)
  }
}

function plotLine(ctx, pairs) {
  ctx.beginPath()
  let on = false
  for (const { x, y } of pairs) {
    if (y == null) { on = false; continue }
    on ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), on = true)
  }
  ctx.stroke()
}

function buildCandles(pts, key, period) {
  const map = new Map()
  for (const pt of pts) {
    const v = pt[key] ?? 0, b = Math.floor(pt.ts / period) * period
    const c = map.get(b) || map.set(b, { ts: b, open: v, high: v, low: v, close: v }).get(b)
    c.high = Math.max(c.high, v); c.low = Math.min(c.low, v); c.close = v
  }
  return [...map.values()].sort((a, b) => a.ts - b.ts)
}

function sliceData(arr, zoom, pan) {
  if (zoom <= 1 || arr.length < 5) return arr
  const n = arr.length, vf = 1 / zoom, s = Math.max(0, Math.min(1 - vf, pan - vf / 2))
  const i0 = s * n | 0
  return arr.slice(i0, i0 + Math.max(5, Math.ceil(vf * n)))
}

function drawGrid(ctx, PAD, cW, cH, vMin, vMax) {
  ctx.font = "8px 'Space Mono',monospace"; ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.textAlign = 'left'
  for (let i = 0; i <= 4; i++) {
    const v = vMax - (vMax - vMin) * (i / 4), y = PAD.top + (cH / 4) * i
    ctx.strokeStyle = 'rgba(255,255,255,.04)'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke()
    ctx.textBaseline = i === 0 ? 'top' : i === 4 ? 'bottom' : 'middle'
    ctx.fillText(fmt(v), PAD.left + cW + 5, y)
  }
}

function drawTimeAxis(ctx, PAD, H, cW, t0, t1) {
  const f = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.font = "8px 'Space Mono',monospace"; ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left';   ctx.fillText(f(t0),        PAD.left,         H - 2)
  ctx.textAlign = 'center'; ctx.fillText(f((t0+t1)/2), PAD.left + cW/2,  H - 2)
  ctx.textAlign = 'right';  ctx.fillText(f(t1),        PAD.left + cW,    H - 2)
}

function drawSessionHL(ctx, PAD, cW, vals, toY) {
  const hi = Math.max(...vals), lo = Math.min(...vals)
  ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1; ctx.setLineDash([2, 8])
  for (const v of [hi, lo]) { ctx.beginPath(); ctx.moveTo(PAD.left, toY(v)); ctx.lineTo(PAD.left + cW, toY(v)); ctx.stroke() }
  ctx.setLineDash([])
  ctx.font = "7px 'Space Mono',monospace"; ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'; ctx.fillText('H ' + fmt(hi), PAD.left + cW - 2, toY(hi))
  ctx.textBaseline = 'top';   ctx.fillText('L ' + fmt(lo),  PAD.left + cW - 2, toY(lo))
}

function drawCurPriceLine(ctx, PAD, cW, val, toY) {
  ctx.strokeStyle = 'rgba(255,255,255,.1)'; ctx.lineWidth = 1; ctx.setLineDash([4, 6])
  ctx.beginPath(); ctx.moveTo(PAD.left, toY(val)); ctx.lineTo(PAD.left + cW, toY(val)); ctx.stroke()
  ctx.setLineDash([])
}

function drawMALine(ctx, pts, toX, toY, color, period) {
  const ma = calcMA(pts.map(v => v.val), period)
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.setLineDash([])
  plotLine(ctx, pts.map((v, i) => ({ x: toX(v.ts), y: ma[i] != null ? toY(ma[i]) : null })))
}

function drawMALegend(ctx, PAD, showMA7, showMA25, showBB) {
  ctx.font = "8px 'Space Mono',monospace"; ctx.textBaseline = 'top'; ctx.textAlign = 'left'
  let x = PAD.left + 4
  if (showMA7)  { ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillText('MA7',  x, PAD.top + 2); x += 34 }
  if (showMA25) { ctx.fillStyle = 'rgba(255,149,0,.7)';    ctx.fillText('MA25', x, PAD.top + 2); x += 40 }
  if (showBB)   { ctx.fillStyle = 'rgba(100,149,255,.6)';  ctx.fillText('BB20', x, PAD.top + 2) }
}

function drawBBOverlay(ctx, vis, toX, toY) {
  const bb = calcBollingerBands(vis.map(d => d.balance))
  if (!bb.some(Boolean)) return
  ctx.save()
  ctx.beginPath()
  let on = false
  for (let i = 0; i < vis.length; i++) {
    if (!bb[i]) { on = false; continue }
    const x = toX(vis[i].ts), y = toY(bb[i].upper)
    on ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), on = true)
  }
  for (let i = vis.length - 1; i >= 0; i--) if (bb[i]) ctx.lineTo(toX(vis[i].ts), toY(bb[i].lower))
  ctx.closePath(); ctx.fillStyle = 'rgba(100,149,255,.06)'; ctx.fill()
  ctx.lineWidth = 1
  const band = (key, alpha, dash) => {
    ctx.strokeStyle = `rgba(100,149,255,${alpha})`; ctx.setLineDash(dash)
    plotLine(ctx, vis.map((d, i) => ({ x: toX(d.ts), y: bb[i] ? toY(bb[i][key]) : null })))
  }
  band('upper', .35, [3, 5]); band('lower', .35, [3, 5]); band('mid', .22, [1, 3])
  ctx.setLineDash([]); ctx.restore()
}

// ── Events ─────────────────────────────────────────────────────────────────────

function computeBalanceEvents(graphPts) {
  const pts = (graphPts || []).filter(d => d.balance != null).sort((a, b) => a.ts - b.ts)
  const events = []
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1], curr = pts[i]
    if (prev.balance > 0) {
      const pct = (curr.balance - prev.balance) / prev.balance * 100
      if (Math.abs(pct) >= 1) {
        events.push({
          type: 'balance', positive: pct > 0,
          emoji: pct > 0 ? '📈' : '📉',
          label: `${pct > 0 ? '+' : ''}${pct.toFixed(1)}% (${pct > 0 ? '+' : ''}${fmt(curr.balance - prev.balance)})`,
          before: prev.balance, after: curr.balance, ts: curr.ts
        })
      }
    }
  }
  return events.reverse().slice(0, 20)
}

function evColor(ev) {
  return ev.type === 'combat' ? (ev.positive ? 'o' : 'r') : (ev.positive ? 'g' : 'r')
}

// ── Notifications ──────────────────────────────────────────────────────────────

function notify(title, body, icon) {
  if (typeof window === 'undefined') return
  if (!('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  new Notification(title, { body, icon: icon || '/favicon.ico', silent: false })
}

function checkAlerts(prev, next) {
  if (!prev || !next) return
  const icon = `https://mc-heads.net/avatar/${next.name}/64`
  if (!prev.online && next.online)
    notify(`${next.name} joined`, `${next.name} is now online`, icon)
  if (prev.online && !next.online)
    notify(`${next.name} left`, `${next.name} went offline`, icon)
  if (prev.kills != null && next.kills != null && next.kills > prev.kills)
    notify(`${next.name} got a kill`, `Kills: ${prev.kills} → ${next.kills}`, icon)
  if (prev.deaths != null && next.deaths != null && next.deaths > prev.deaths)
    notify(`${next.name} died`, `Deaths: ${prev.deaths} → ${next.deaths}`, icon)
  if (prev.balance != null && next.balance != null && prev.balance > 0) {
    const pct = (next.balance - prev.balance) / prev.balance * 100
    if (Math.abs(pct) >= 5) {
      const dir = pct > 0 ? 'gained' : 'lost'
      notify(`${next.name} ${dir} ${Math.abs(pct).toFixed(1)}%`,
        `Balance: ${fmt(prev.balance)} → ${fmt(next.balance)}`, icon)
    }
  }
}

// ── Mini Graph ─────────────────────────────────────────────────────────────────

function MiniGraph({ name, graphData, chartType }) {
  const canvasRef = useRef(null)
  const stateRef  = useRef({ zoom: 1, pan: 0.5, hoverX: null })

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const s   = stateRef.current
    const dpr = devicePixelRatio || 1
    const W   = canvas.offsetWidth || 200
    const H   = canvas.offsetHeight || 100
    canvas.width  = W * dpr
    canvas.height = H * dpr
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr); ctx.clearRect(0, 0, W, H)

    const raw = sliceData((graphData || []).filter(d => d.balance != null), s.zoom, s.pan)
    if (raw.length < 2) {
      ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.font = "8px 'Space Mono',monospace"
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('collecting...', W / 2, H / 2); return
    }

    const PAD = { top: 6, right: 6, bottom: 6, left: 6 }, cW = W - 12, cH = H - 12
    const vals   = raw.map(d => d.balance)
    const vMin   = Math.min(...vals), vMax = Math.max(...vals), vRng = Math.max(vMax - vMin, 1)
    const tsMin  = raw[0].ts, tsMax = raw.at(-1).ts, tsRng = Math.max(tsMax - tsMin, 1)
    const toY    = v  => PAD.top + cH - ((v - vMin) / vRng) * cH
    const toXts  = ts => PAD.left + ((ts - tsMin) / tsRng) * cW
    const { col, glow, fill } = trendColors(vals[0], vals.at(-1))

    ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1; ctx.setLineDash([2, 6])
    for (const v of [vMax, vMin]) { ctx.beginPath(); ctx.moveTo(PAD.left, toY(v)); ctx.lineTo(PAD.left + cW, toY(v)); ctx.stroke() }
    ctx.setLineDash([])

    if (chartType === 'candle') {
      const period  = Math.max(1000, tsRng / Math.max(10, cW / 8) | 0)
      const candles = buildCandles(raw, 'balance', period)
      if (!candles.length) return
      const pMin = Math.min(...candles.map(c => c.low)), pMax = Math.max(...candles.map(c => c.high))
      const pRng = Math.max(pMax - pMin, 1), slotW = cW / candles.length, bodyW = Math.max(2, slotW * .6)
      const toYc = v => PAD.top + cH - ((v - pMin) / pRng) * cH

      let hovIdx = -1
      if (s.hoverX != null) candles.forEach((_, i) => {
        const d = Math.abs(PAD.left + slotW * i + slotW / 2 - s.hoverX)
        if (d < (hovIdx < 0 ? Infinity : Math.abs(PAD.left + slotW * hovIdx + slotW / 2 - s.hoverX))) hovIdx = i
      })

      candles.forEach((c, i) => {
        const cx  = PAD.left + slotW * i + slotW / 2, up = c.close >= c.open, col2 = up ? '#00ff88' : '#ff3355'
        const bTop = toYc(Math.max(c.open, c.close)), bH = Math.max(1.5, toYc(Math.min(c.open, c.close)) - bTop)
        ctx.strokeStyle = col2; ctx.globalAlpha = i === hovIdx ? 1 : .45; ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(cx, toYc(c.high)); ctx.lineTo(cx, toYc(c.low)); ctx.stroke()
        ctx.globalAlpha = 1; ctx.fillStyle = col2
        ctx.shadowColor = up ? 'rgba(0,255,136,.4)' : 'rgba(255,51,85,.4)'; ctx.shadowBlur = i === hovIdx ? 10 : 3
        ctx.fillRect(cx - bodyW / 2, bTop, bodyW, bH); ctx.shadowBlur = 0
      })

      if (hovIdx >= 0) {
        const c = candles[hovIdx], cx = PAD.left + slotW * hovIdx + slotW / 2, col2 = c.close >= c.open ? '#00ff88' : '#ff3355'
        ctx.save()
        ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1; ctx.setLineDash([2, 4])
        ctx.beginPath(); ctx.moveTo(cx, PAD.top); ctx.lineTo(cx, PAD.top + cH); ctx.stroke(); ctx.setLineDash([])
        const tip = `${new Date(c.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}  C:${fmt(c.close)}`
        ctx.font = "8px 'Space Mono',monospace"
        const bW = ctx.measureText(tip).width + 10; let tx = cx + 6; if (tx + bW > W - 6) tx = cx - bW - 4
        ctx.fillStyle = 'rgba(6,6,6,.9)'; ctx.beginPath(); ctx.roundRect(tx, PAD.top + 2, bW, 16, 2); ctx.fill()
        ctx.fillStyle = col2; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(tip, tx + 5, PAD.top + 10)
        ctx.restore()
      }
    } else {
      const pts  = raw.map(d => ({ x: toXts(d.ts), y: toY(d.balance) }))
      const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + cH)
      grad.addColorStop(0, fill); grad.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.beginPath(); smoothPath(ctx, pts)
      ctx.lineTo(pts.at(-1).x, PAD.top + cH); ctx.lineTo(PAD.left, PAD.top + cH); ctx.closePath()
      ctx.fillStyle = grad; ctx.fill()
      ctx.shadowColor = glow; ctx.shadowBlur = 7; ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round'
      ctx.beginPath(); smoothPath(ctx, pts); ctx.stroke(); ctx.shadowBlur = 0
      const lp = pts.at(-1)
      ctx.beginPath(); ctx.arc(lp.x, lp.y, 2.5, 0, Math.PI * 2)
      ctx.fillStyle = col; ctx.shadowColor = glow; ctx.shadowBlur = 8; ctx.fill(); ctx.shadowBlur = 0

      if (s.hoverX != null) {
        let ni = 0, md = Infinity
        pts.forEach((p, i) => { const d = Math.abs(p.x - s.hoverX); if (d < md) { md = d; ni = i } })
        const np = pts[ni], nd = raw[ni]
        ctx.save()
        ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.lineWidth = 1; ctx.setLineDash([2, 4])
        ctx.beginPath(); ctx.moveTo(np.x, PAD.top); ctx.lineTo(np.x, PAD.top + cH); ctx.stroke(); ctx.setLineDash([])
        ctx.beginPath(); ctx.arc(np.x, np.y, 3.5, 0, Math.PI * 2)
        ctx.fillStyle = col; ctx.shadowColor = glow; ctx.shadowBlur = 12; ctx.fill(); ctx.shadowBlur = 0
        const tip = fmt(nd.balance), bW = ctx.measureText(tip).width + 10
        ctx.font = "8px 'Space Mono',monospace"
        let tx = np.x + 5; if (tx + bW > W - 6) tx = np.x - bW - 4
        let ty = np.y - 20; if (ty < PAD.top) ty = np.y + 4
        ctx.fillStyle = 'rgba(6,6,6,.9)'; ctx.beginPath(); ctx.roundRect(tx, ty, bW, 16, 2); ctx.fill()
        ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(tip, tx + 5, ty + 8)
        ctx.restore()
      }
    }

    if (s.zoom > 1.05) {
      ctx.font = "7px 'Space Mono',monospace"; ctx.fillStyle = 'rgba(0,255,136,.55)'
      ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(s.zoom.toFixed(1) + '×', PAD.left + 2, PAD.top + 1)
    }
  }, [graphData, chartType])

  useEffect(() => { draw() }, [draw])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const s = stateRef.current

    const zoomAt = (xRatio, delta) => {
      const vf = 1 / s.zoom, st = Math.max(0, Math.min(1 - vf, s.pan - vf / 2)), dr = st + xRatio * vf
      s.zoom = Math.max(1, Math.min(30, s.zoom * delta))
      const nvf = 1 / s.zoom, ns = dr - xRatio * nvf
      s.pan = Math.max(nvf / 2, Math.min(1 - nvf / 2, ns + nvf / 2))
    }

    const onWheel = e => {
      e.preventDefault(); e.stopPropagation()
      const r = canvas.getBoundingClientRect()
      zoomAt(Math.max(0, Math.min(1, (e.clientX - r.left - 6) / (r.width - 12))), e.deltaY < 0 ? 1.35 : .74)
      draw()
    }
    const onMove    = e => { s.hoverX = e.clientX - canvas.getBoundingClientRect().left; draw() }
    const onLeave   = ()  => { s.hoverX = null; draw() }
    const onDblClick = e => { e.stopPropagation(); s.zoom = 1; s.pan = .5; draw() }

    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('mousemove', onMove)
    canvas.addEventListener('mouseleave', onLeave)
    canvas.addEventListener('dblclick', onDblClick)
    return () => {
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('mousemove', onMove)
      canvas.removeEventListener('mouseleave', onLeave)
      canvas.removeEventListener('dblclick', onDblClick)
    }
  }, [draw])

  return (
    <div style={{ position: 'relative' }}>
      <canvas ref={canvasRef} className="col-graph-canvas" />
      <div className="col-zoom-hint">scroll=zoom</div>
    </div>
  )
}

// ── Player Column ──────────────────────────────────────────────────────────────

function PlayerCol({ player, graphData, events, onFocus, chartType }) {
  const d   = player || {}
  const ch  = getChange(graphData)
  const onCls  = d.online === true ? 'on' : d.online === false ? 'off' : 'unk'
  const onTxt  = d.online === true ? 'LIVE' : d.online === false ? 'OFFLINE' : '—'
  const pulse  = d.online === true ? ' online-pulse' : ''
  const cls    = trendCls(ch)
  const name   = d.name || ''

  return (
    <div className="col" onClick={() => onFocus(name)}>
      <div className="col-head">
        <img className="col-avatar" src={`https://mc-heads.net/avatar/${name}/64`} alt="" />
        <div className="col-head-right">
          <div className="col-name-row">
            <div className="col-name">{name}</div>
            <span className={`col-badge ${onCls}${pulse}`}>{onTxt}</span>
          </div>
        </div>
      </div>

      <div className="col-price-row">
        <div className={`col-balance ${cls}`}>
          {fmt(d.balance)}<span className="col-real-total">({fmtReal(d.balance)})</span>
        </div>
        {ch && (
          <div className={`col-change ${cls}`}>
            <span className="col-change-arrow">{ch.up ? '▲' : ch.flat ? '—' : '▼'}</span>
            <span>{ch.pct >= 0 ? '+' : ''}{ch.pct.toFixed(2)}%</span>
            <span style={{ opacity: .5 }}>{ch.diff >= 0 ? '+' : ''}{fmt(ch.diff)}</span>
            <span className="col-real-inline">({fmtReal(ch.diff, true)})</span>
          </div>
        )}
      </div>

      <div className="col-kd">
        <div className="col-kd-item">⚔&nbsp;<b>{d.kills ?? '—'}</b></div>
        <div className="col-kd-item">💀&nbsp;<b>{d.deaths ?? '—'}</b></div>
        {d.kills != null && d.deaths > 0 && (
          <div className="col-kd-item" style={{ color: 'var(--orange)' }}>K/D&nbsp;<b>{(d.kills / d.deaths).toFixed(2)}</b></div>
        )}
      </div>

      <div className="col-graph-wrap">
        <MiniGraph name={name} graphData={graphData} chartType={chartType} />
      </div>

      <div className="col-events">
        {events && events.length > 0 ? events.slice(0, 5).map((ev, i) => (
          <div key={i} className="col-ev">
            <span className="col-ev-icon">{ev.emoji}</span>
            <span className={`col-ev-label ${evColor(ev)}`}>
              {ev.label}
              {ev.type === 'balance' && ev.before != null && ev.after != null &&
                <span className="col-real-inline"> ({fmtReal(ev.after - ev.before, true)})</span>
              }
            </span>
            <span className="col-ev-time">{ago(ev.ts)}</span>
          </div>
        )) : (
          <div style={{ fontSize: 9, color: 'var(--dimmest)', fontFamily: 'var(--mono)', paddingTop: 4 }}>// waiting...</div>
        )}
      </div>
    </div>
  )
}

// ── Empty Slot ─────────────────────────────────────────────────────────────────

function EmptySlot() {
  return (
    <div className="col empty-slot">
      <div className="col-empty-msg">
        <div className="col-empty-icon">＋</div>
        <div className="col-empty-text">EMPTY</div>
      </div>
    </div>
  )
}

// ── Leaderboard ────────────────────────────────────────────────────────────────

function Leaderboard({ players, graphs, onFocus }) {
  const entries = players
    .filter(p => p.balance != null)
    .map(p => {
      const pts = (graphs[p.name] || []).filter(d => d.balance != null)
      const start = pts.length > 0 ? pts[0].balance : null
      const gain  = start != null ? p.balance - start : 0
      return { name: p.name, gain }
    })
    .sort((a, b) => b.gain - a.gain)

  return (
    <div className="leaderboard-panel">
      <div className="lb-header">Leaderboard</div>
      <div id="leaderboard">
        {entries.length === 0
          ? <div className="lb-empty">// waiting...</div>
          : entries.map((e, i) => (
            <div key={e.name} className="lb-entry" onClick={() => onFocus(e.name)}>
              <span className="lb-rank">{i + 1}</span>
              <img className="lb-avatar" src={`https://mc-heads.net/avatar/${e.name}/32`} alt="" />
              <div className="lb-info">
                <div className="lb-name">{e.name}</div>
                <div className={`lb-gain ${e.gain > 0 ? 'g' : e.gain < 0 ? 'r' : 'flat'}`}>
                  {e.gain >= 0 ? '+' : ''}{fmt(e.gain)}
                </div>
                <div className="lb-real">{fmtReal(e.gain, true)}</div>
              </div>
            </div>
          ))
        }
      </div>
    </div>
  )
}

// ── Focus Panel ────────────────────────────────────────────────────────────────

function FocusPanel({ player, graphData, events, onClose, globalChartType }) {
  const [focusRange,     setFocusRange]     = useState(300_000)
  const [chartType,      setChartType]      = useState(globalChartType || 'line')
  const [candlePeriod,   setCandlePeriod]   = useState(60_000)
  const [showBB,         setShowBB]         = useState(false)
  const [showRSI,        setShowRSI]        = useState(true)
  const [showMACD,       setShowMACD]       = useState(false)
  const [showMA7,        setShowMA7]        = useState(true)
  const [showMA25,       setShowMA25]       = useState(true)
  const [focusZoom,      setFocusZoom]      = useState(1)
  const [focusPan,       setFocusPan]       = useState(0.5)

  const balRef   = useRef(null)
  const volRef   = useRef(null)
  const kdRef    = useRef(null)
  const rsiRef   = useRef(null)
  const macdRef  = useRef(null)
  const hoverX   = useRef(null)
  const dragRef  = useRef({ active: false, startX: 0, startPan: 0 })

  const zoomRef  = useRef(1)
  const panRef   = useRef(0.5)

  const getVisible = useCallback(() => {
    let pts = (graphData || []).filter(d => d.balance != null)
    if (focusRange > 0) pts = pts.filter(d => d.ts >= Date.now() - focusRange)
    return sliceData(pts, zoomRef.current, panRef.current)
  }, [graphData, focusRange])

  const drawBalance = useCallback(() => {
    const canvas = balRef.current
    if (!canvas) return
    const dpr = devicePixelRatio || 1
    const W   = canvas.offsetWidth || 400, H = canvas.offsetHeight || 200
    canvas.width = W * dpr; canvas.height = H * dpr
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)

    const vis = getVisible()
    if (vis.length < 2) {
      ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.font = "10px 'Space Mono',monospace"
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('// collecting data...', W / 2, H / 2); return
    }

    const PAD = { top: 12, right: 82, bottom: 20, left: 10 }, cW = W - 92, cH = H - 32
    const t0 = vis[0].ts, t1 = vis.at(-1).ts, tRange = Math.max(t1 - t0, 1)
    const vals = vis.map(d => d.balance)
    const hX   = hoverX.current

    let vMin = Math.min(...vals), vMax = Math.max(...vals)
    if (showBB) calcBollingerBands(vals).forEach(b => b && (vMin = Math.min(vMin, b.lower), vMax = Math.max(vMax, b.upper)))
    const vRng  = Math.max(vMax - vMin, 1)
    const toY   = v  => PAD.top + cH - ((v - vMin) / vRng) * cH
    const toXts = ts => PAD.left + ((ts - t0) / tRange) * cW

    drawGrid(ctx, PAD, cW, cH, vMin, vMax)
    drawTimeAxis(ctx, PAD, H, cW, t0, t1)
    drawSessionHL(ctx, PAD, cW, vals, toY)
    if (showBB) drawBBOverlay(ctx, vis, toXts, toY)

    if (chartType === 'candle') {
      const candles = buildCandles(vis, 'balance', candlePeriod)
      if (!candles.length) return
      const slotW = cW / candles.length, bodyW = Math.max(2, slotW * .62)
      const toXi  = i => PAD.left + (i + .5) * slotW
      const maPts = candles.map((c, i) => ({ ts: i, val: c.close }))
      if (showMA7  && candles.length >= 7)  drawMALine(ctx, maPts, toXi, toY, 'rgba(255,255,255,.65)', 7)
      if (showMA25 && candles.length >= 25) drawMALine(ctx, maPts, toXi, toY, 'rgba(255,149,0,.75)', 25)
      drawCurPriceLine(ctx, PAD, cW, candles.at(-1).close, toY)
      drawMALegend(ctx, PAD, showMA7, showMA25, showBB)

      let hovIdx = -1
      if (hX != null) { let best = Infinity; candles.forEach((_, i) => { const d = Math.abs(toXi(i) - hX); if (d < best) { best = d; hovIdx = i } }) }

      candles.forEach((c, i) => {
        const cx = toXi(i), up = c.close >= c.open, col = up ? '#00ff88' : '#ff3355'
        const bTop = toY(Math.max(c.open, c.close)), bH = Math.max(1.5, toY(Math.min(c.open, c.close)) - bTop)
        ctx.strokeStyle = col; ctx.globalAlpha = i === hovIdx ? 1 : .55; ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(cx, toY(c.high)); ctx.lineTo(cx, toY(c.low)); ctx.stroke()
        ctx.globalAlpha = 1; ctx.fillStyle = col
        ctx.shadowColor = up ? 'rgba(0,255,136,.35)' : 'rgba(255,51,85,.35)'; ctx.shadowBlur = i === hovIdx ? 14 : 4
        ctx.fillRect(cx - bodyW / 2, bTop, bodyW, bH); ctx.shadowBlur = 0
      })

      const last = candles.at(-1), up = last.close >= last.open
      ctx.fillStyle = up ? '#00ff88' : '#ff3355'; ctx.font = "bold 11px 'Space Mono',monospace"
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
      ctx.fillText(fmt(last.close), PAD.left + cW + 5, Math.max(PAD.top + 6, Math.min(toY(last.close), PAD.top + cH - 6)))

      if (hovIdx >= 0) {
        const c = candles[hovIdx], cx = toXi(hovIdx), col = c.close >= c.open ? '#00ff88' : '#ff3355'
        ctx.save()
        ctx.strokeStyle = 'rgba(255,255,255,.13)'; ctx.lineWidth = 1; ctx.setLineDash([3, 5])
        ctx.beginPath(); ctx.moveTo(cx, PAD.top); ctx.lineTo(cx, PAD.top + cH); ctx.stroke(); ctx.setLineDash([])
        const time = new Date(c.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        const lines = [time, `O ${fmt(c.open)}  H ${fmt(c.high)}`, `L ${fmt(c.low)}  C ${fmt(c.close)}`]
        ctx.font = "10px 'Space Mono',monospace"
        const bW = Math.max(...lines.map(l => ctx.measureText(l).width)) + 18, bH2 = lines.length * 16 + 10
        let tx = cx + 10; if (tx + bW > W - 82) tx = cx - bW - 8
        ctx.fillStyle = 'rgba(6,6,6,.95)'; ctx.beginPath(); ctx.roundRect(tx, PAD.top + 10, bW, bH2, 3); ctx.fill()
        ctx.globalAlpha = .5; ctx.strokeStyle = col; ctx.lineWidth = 1
        ctx.beginPath(); ctx.roundRect(tx, PAD.top + 10, bW, bH2, 3); ctx.stroke()
        ctx.globalAlpha = 1; ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.textBaseline = 'top'
        lines.forEach((l, i) => ctx.fillText(l, tx + 9, PAD.top + 18 + i * 16))
        ctx.restore()
      }
    } else {
      const maPts = vis.map(d => ({ ts: d.ts, val: d.balance }))
      const pts   = vis.map(d => ({ x: toXts(d.ts), y: toY(d.balance) }))
      const { col, glow, fill } = trendColors(vals[0], vals.at(-1))

      const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + cH)
      grad.addColorStop(0, fill); grad.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.beginPath(); smoothPath(ctx, pts)
      ctx.lineTo(pts.at(-1).x, PAD.top + cH); ctx.lineTo(PAD.left, PAD.top + cH); ctx.closePath()
      ctx.fillStyle = grad; ctx.fill()

      ctx.shadowColor = glow; ctx.shadowBlur = 14; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'
      ctx.beginPath(); smoothPath(ctx, pts); ctx.stroke(); ctx.shadowBlur = 0

      if (showMA7  && vis.length >= 7)  drawMALine(ctx, maPts, toXts, toY, 'rgba(255,255,255,.65)', 7)
      if (showMA25 && vis.length >= 25) drawMALine(ctx, maPts, toXts, toY, 'rgba(255,149,0,.75)', 25)
      drawCurPriceLine(ctx, PAD, cW, vals.at(-1), toY)
      drawMALegend(ctx, PAD, showMA7, showMA25, showBB)

      const ep = pts.at(-1), ey = Math.max(PAD.top + 4, Math.min(ep.y, PAD.top + cH - 4))
      ctx.beginPath(); ctx.arc(ep.x, ey, 4, 0, Math.PI * 2)
      ctx.fillStyle = col; ctx.shadowColor = glow; ctx.shadowBlur = 16; ctx.fill(); ctx.shadowBlur = 0
      ctx.fillStyle = col; ctx.font = "bold 11px 'Space Mono',monospace"; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
      ctx.fillText(fmt(vals.at(-1)), ep.x + 8, ey)

      if (hX != null) {
        let ni = 0, md = Infinity
        pts.forEach((p, i) => { const d = Math.abs(p.x - hX); if (d < md) { md = d; ni = i } })
        const np = pts[ni], nd = vis[ni]
        ctx.save()
        ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 1; ctx.setLineDash([3, 4])
        ctx.beginPath(); ctx.moveTo(np.x, PAD.top); ctx.lineTo(np.x, PAD.top + cH); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(PAD.left, np.y); ctx.lineTo(PAD.left + cW, np.y); ctx.stroke()
        ctx.setLineDash([])
        ctx.beginPath(); ctx.arc(np.x, np.y, 5, 0, Math.PI * 2)
        ctx.fillStyle = col; ctx.shadowColor = glow; ctx.shadowBlur = 20; ctx.fill(); ctx.shadowBlur = 0
        const tip = `${fmt(nd.balance)}   ${new Date(nd.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
        ctx.font = "bold 10px 'Space Mono',monospace"
        const bW = ctx.measureText(tip).width + 14, bH2 = 22
        let tx = np.x + 10; if (tx + bW > W - 82) tx = np.x - bW - 6
        let ty = np.y - bH2 - 6; if (ty < PAD.top) ty = np.y + 8
        ctx.fillStyle = 'rgba(6,6,6,.92)'; ctx.beginPath(); ctx.roundRect(tx, ty, bW, bH2, 3); ctx.fill()
        ctx.globalAlpha = .45; ctx.strokeStyle = col; ctx.lineWidth = 1
        ctx.beginPath(); ctx.roundRect(tx, ty, bW, bH2, 3); ctx.stroke()
        ctx.globalAlpha = 1; ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
        ctx.fillText(tip, tx + 7, ty + bH2 / 2)
        ctx.restore()
      }
    }
  }, [getVisible, chartType, candlePeriod, showBB, showMA7, showMA25])

  const drawVolume = useCallback(() => {
    const canvas = volRef.current
    if (!canvas) return
    const dpr = devicePixelRatio || 1
    const W = canvas.offsetWidth || 400, H = canvas.offsetHeight || 60
    canvas.width = W * dpr; canvas.height = H * dpr
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)

    const vis = getVisible()
    if (vis.length < 2) return
    const PAD = { top: 4, right: 82, bottom: 4, left: 10 }, cW = W - 92, cH = H - 8
    const candles = buildCandles(vis, 'balance', candlePeriod)
    if (!candles.length) return
    const vols = candles.map(c => Math.abs(c.high - c.low)), vMax = Math.max(...vols, 1)
    const slotW = cW / candles.length, barW = Math.max(1.5, slotW * .7)
    candles.forEach((c, i) => {
      const bH = Math.max(1, (vols[i] / vMax) * cH), x = PAD.left + slotW * i + slotW / 2
      ctx.fillStyle = c.close >= c.open ? 'rgba(0,255,136,.45)' : 'rgba(255,51,85,.45)'
      ctx.fillRect(x - barW / 2, PAD.top + cH - bH, barW, bH)
    })
    ctx.font = "8px 'Space Mono',monospace"; ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'
    ctx.fillText('VOL ' + fmt(vols.at(-1)), PAD.left + cW + 5, PAD.top)
  }, [getVisible, candlePeriod])

  const drawKD = useCallback(() => {
    const canvas = kdRef.current
    if (!canvas) return
    const dpr = devicePixelRatio || 1
    const W = canvas.offsetWidth || 400, H = canvas.offsetHeight || 60
    canvas.width = W * dpr; canvas.height = H * dpr
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)

    const vis = sliceData(
      (() => { let pts = (graphData || []); if (focusRange > 0) pts = pts.filter(d => d.ts >= Date.now() - focusRange); return pts })(),
      zoomRef.current, panRef.current
    )
    if (vis.length < 2) return

    const PAD = { top: 4, right: 82, bottom: 4, left: 10 }, cW = W - 92, cH = H - 8
    const t0 = vis[0].ts, tRange = Math.max(vis.at(-1).ts - t0, 1)
    const toX = d => PAD.left + ((d.ts - t0) / tRange) * cW

    const drawSeries = (key, color, glow) => {
      const pts = vis.filter(d => d[key] != null)
      if (pts.length < 2) return
      const mn = Math.min(...pts.map(d => d[key])), mx = Math.max(...pts.map(d => d[key])), rng = Math.max(mx - mn, 1)
      const toY = v => PAD.top + cH - ((v - mn) / rng) * cH
      ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'
      ctx.shadowColor = glow; ctx.shadowBlur = 6
      ctx.beginPath(); smoothPath(ctx, pts.map(d => ({ x: toX(d), y: toY(d[key]) }))); ctx.stroke(); ctx.shadowBlur = 0
    }
    drawSeries('kills', '#ff9500', 'rgba(255,149,0,.5)')
    drawSeries('deaths', '#ff3355', 'rgba(255,51,85,.5)')
    ctx.font = "8px 'Space Mono',monospace"; ctx.textBaseline = 'top'; ctx.textAlign = 'left'
    ctx.fillStyle = '#ff9500'; ctx.fillText('⚔', PAD.left + cW + 5, PAD.top)
    ctx.fillStyle = '#ff3355'; ctx.fillText('💀', PAD.left + cW + 5, PAD.top + 13)
  }, [graphData, focusRange])

  const drawRSI = useCallback(() => {
    const canvas = rsiRef.current
    if (!canvas || !showRSI) return
    const dpr = devicePixelRatio || 1
    const W = canvas.offsetWidth || 400, H = canvas.offsetHeight || 80
    canvas.width = W * dpr; canvas.height = H * dpr
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)

    const vis = getVisible()
    if (vis.length < 16) {
      ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.font = "9px 'Space Mono',monospace"
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('// need more data', W / 2, H / 2); return
    }
    const PAD = { top: 4, right: 82, bottom: 4, left: 10 }, cW = W - 92, cH = H - 8
    const rsi = calcRSI(vis.map(d => d.balance))
    const toX = i => PAD.left + (i / (vis.length - 1)) * cW
    const toY = v => PAD.top + (1 - v / 100) * cH

    ctx.fillStyle = 'rgba(255,51,85,.06)'; ctx.fillRect(PAD.left, PAD.top, cW, toY(70) - PAD.top)
    ctx.fillStyle = 'rgba(0,255,136,.06)'; ctx.fillRect(PAD.left, toY(30), cW, PAD.top + cH - toY(30))
    ctx.lineWidth = 1; ctx.setLineDash([3, 5])
    for (const { v, c } of [{ v: 70, c: 'rgba(255,51,85,.28)' }, { v: 30, c: 'rgba(0,255,136,.28)' }, { v: 50, c: 'rgba(255,255,255,.08)' }]) {
      ctx.strokeStyle = c; ctx.beginPath(); ctx.moveTo(PAD.left, toY(v)); ctx.lineTo(PAD.left + cW, toY(v)); ctx.stroke()
    }
    ctx.setLineDash([])
    ctx.strokeStyle = '#a78bfa'; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'
    ctx.shadowColor = 'rgba(167,139,250,.4)'; ctx.shadowBlur = 6
    plotLine(ctx, rsi.map((v, i) => ({ x: toX(i), y: v != null ? toY(v) : null })))
    ctx.shadowBlur = 0

    ctx.font = "7px 'Space Mono',monospace"; ctx.textAlign = 'left'
    ctx.fillStyle = 'rgba(255,51,85,.55)'; ctx.textBaseline = 'middle'; ctx.fillText('70', PAD.left + cW + 4, toY(70))
    ctx.fillStyle = 'rgba(0,255,136,.55)'; ctx.fillText('30', PAD.left + cW + 4, toY(30))
    const lastRSI = [...rsi].reverse().find(v => v != null)
    if (lastRSI != null) {
      ctx.font = "bold 9px 'Space Mono',monospace"; ctx.fillStyle = lastRSI > 70 ? '#ff3355' : lastRSI < 30 ? '#00ff88' : '#a78bfa'
      ctx.textBaseline = 'top'; ctx.fillText(lastRSI.toFixed(1), PAD.left + cW + 4, PAD.top)
    }

    if (hoverX.current != null) {
      const ni = Math.round(Math.max(0, Math.min(1, (hoverX.current - 10) / (W - 92))) * (vis.length - 1))
      if (rsi[ni] != null) {
        ctx.beginPath(); ctx.arc(toX(ni), toY(rsi[ni]), 3, 0, Math.PI * 2)
        ctx.fillStyle = '#a78bfa'; ctx.shadowColor = 'rgba(167,139,250,.6)'; ctx.shadowBlur = 8; ctx.fill(); ctx.shadowBlur = 0
      }
    }
  }, [getVisible, showRSI])

  const drawMACD_ = useCallback(() => {
    const canvas = macdRef.current
    if (!canvas || !showMACD) return
    const dpr = devicePixelRatio || 1
    const W = canvas.offsetWidth || 400, H = canvas.offsetHeight || 90
    canvas.width = W * dpr; canvas.height = H * dpr
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)

    const vis = getVisible()
    if (vis.length < 40) {
      ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.font = "9px 'Space Mono',monospace"
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('// need more data', W / 2, H / 2); return
    }
    const PAD = { top: 4, right: 82, bottom: 4, left: 10 }, cW = W - 92, cH = H - 8
    const macd = calcMACD(vis.map(d => d.balance)), valid = macd.filter(Boolean)
    if (!valid.length) return
    const hMax = Math.max(...valid.map(v => Math.abs(v.hist)), 1)
    const toX  = i => PAD.left + (i / (vis.length - 1)) * cW
    const midY = PAD.top + cH / 2
    const toY  = v => midY - (v / hMax) * (cH / 2 - 2)
    const barW = Math.max(1, (cW / vis.length) * .8)

    ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(PAD.left, midY); ctx.lineTo(PAD.left + cW, midY); ctx.stroke()

    macd.forEach((m, i) => {
      if (!m) return
      const x = toX(i), bH = Math.abs(toY(m.hist) - midY)
      ctx.fillStyle = m.hist >= 0 ? 'rgba(0,255,136,.5)' : 'rgba(255,51,85,.5)'
      ctx.fillRect(x - barW / 2, m.hist >= 0 ? toY(m.hist) : midY, barW, bH)
    })

    ctx.lineWidth = 1.5; ctx.lineJoin = 'round'
    ctx.strokeStyle = 'rgba(255,255,255,.7)'
    plotLine(ctx, macd.map((m, i) => ({ x: toX(i), y: m ? toY(m.macd) : null })))
    ctx.strokeStyle = 'rgba(255,149,0,.8)'
    plotLine(ctx, macd.map((m, i) => ({ x: toX(i), y: m ? toY(m.signal) : null })))

    ctx.font = "7px 'Space Mono',monospace"; ctx.textAlign = 'left'
    ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.textBaseline = 'top'; ctx.fillText('MACD', PAD.left + cW + 4, PAD.top)
    ctx.fillStyle = 'rgba(255,149,0,.65)'; ctx.fillText('SIG', PAD.left + cW + 4, PAD.top + 11)
  }, [getVisible, showMACD])

  const drawAll = useCallback(() => {
    drawBalance(); drawVolume(); drawKD()
    if (showRSI)  drawRSI()
    if (showMACD) drawMACD_()
  }, [drawBalance, drawVolume, drawKD, drawRSI, drawMACD_, showRSI, showMACD])

  useEffect(() => { drawAll() }, [drawAll])

  // Wheel / drag / hover on balance canvas
  useEffect(() => {
    const canvas = balRef.current
    if (!canvas) return

    const zoomAt = (xRatio, delta) => {
      const vf = 1 / zoomRef.current
      const st = Math.max(0, Math.min(1 - vf, panRef.current - vf / 2)), dr = st + xRatio * vf
      zoomRef.current = Math.max(1, Math.min(80, zoomRef.current * delta))
      const nvf = 1 / zoomRef.current, ns = dr - xRatio * nvf
      panRef.current = Math.max(nvf / 2, Math.min(1 - nvf / 2, ns + nvf / 2))
      setFocusZoom(zoomRef.current); setFocusPan(panRef.current)
    }

    const onWheel = e => {
      e.preventDefault()
      const r = canvas.getBoundingClientRect()
      zoomAt(Math.max(0, Math.min(1, (e.clientX - r.left - 10) / (r.width - 92))), e.deltaY < 0 ? 1.35 : .74)
      canvas.style.cursor = zoomRef.current > 1.05 ? 'grab' : 'crosshair'
      drawAll()
    }
    const onDown = e => {
      if (e.button) return
      Object.assign(dragRef.current, { active: true, startX: e.clientX, startPan: panRef.current })
      canvas.style.cursor = 'grabbing'
    }
    const onMove = e => {
      const r = canvas.getBoundingClientRect()
      hoverX.current = e.clientX - r.left
      if (dragRef.current.active) {
        const vf = 1 / zoomRef.current
        panRef.current = Math.max(vf / 2, Math.min(1 - vf / 2, dragRef.current.startPan - (e.clientX - dragRef.current.startX) / (r.width - 92)))
        setFocusPan(panRef.current)
      }
      drawBalance(); if (showRSI) drawRSI(); if (showMACD) drawMACD_()
    }
    const onUp    = () => { dragRef.current.active = false; canvas.style.cursor = zoomRef.current > 1.05 ? 'grab' : 'crosshair' }
    const onLeave = () => {
      dragRef.current.active = false; hoverX.current = null; canvas.style.cursor = 'crosshair'
      drawBalance(); if (showRSI) drawRSI(); if (showMACD) drawMACD_()
    }

    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('mousedown', onDown)
    canvas.addEventListener('mousemove', onMove)
    canvas.addEventListener('mouseup', onUp)
    canvas.addEventListener('mouseleave', onLeave)
    return () => {
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('mousedown', onDown)
      canvas.removeEventListener('mousemove', onMove)
      canvas.removeEventListener('mouseup', onUp)
      canvas.removeEventListener('mouseleave', onLeave)
    }
  }, [drawBalance, drawRSI, drawMACD_, showRSI, showMACD])

  // Key handler for Escape
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const d   = player || {}
  const ch  = getChange(graphData)
  const cls = trendCls(ch)

  const resetZoom = () => { zoomRef.current = 1; panRef.current = 0.5; setFocusZoom(1); setFocusPan(0.5); drawAll() }

  return (
    <div id="focus" className="open">
      <div className="focus-panel">
        <div className="focus-head">
          <img className="focus-avatar" src={`https://mc-heads.net/avatar/${d.name}/64`} alt="" />
          <div className="focus-info">
            <div className="focus-name-row">
              <div className="focus-name">{d.name}</div>
              <div className={`col-badge ${d.online === true ? 'on' : d.online === false ? 'off' : 'unk'}`}>
                {d.online === true ? 'LIVE' : d.online === false ? 'OFFLINE' : '—'}
              </div>
            </div>
            <div className="focus-price-row">
              <span className="focus-price">{fmt(d.balance)}  ({fmtReal(d.balance)})</span>
              {ch && <span className={`focus-change ${cls}`}>{ch.up ? '▲' : ch.flat ? '—' : '▼'} {ch.pct >= 0 ? '+' : ''}{ch.pct.toFixed(2)}%  {ch.diff >= 0 ? '+' : ''}{fmt(ch.diff)}</span>}
            </div>
            <div className="focus-meta-row">
              {d.kills  != null && <span className="focus-meta-item">⚔ <b>{d.kills}</b></span>}
              {d.deaths != null && <span className="focus-meta-item">💀 <b>{d.deaths}</b></span>}
              {d.kills != null && d.deaths > 0 && <span className="focus-meta-item">K/D <b>{(d.kills / d.deaths).toFixed(2)}</b></span>}
            </div>
          </div>
          <button className="focus-close" onClick={onClose}>✕</button>
        </div>

        <div className="focus-toolbar">
          <div className="focus-range-bar">
            {[{l:'1m',ms:60000},{l:'5m',ms:300000},{l:'15m',ms:900000},{l:'1h',ms:3600000},{l:'All',ms:0}].map(r => (
              <button key={r.l} className={`focus-range-btn${focusRange === r.ms ? ' active' : ''}`}
                onClick={() => { setFocusRange(r.ms); resetZoom() }}>{r.l}</button>
            ))}
          </div>
          <div className="focus-toolbar-sep" />
          <div className="focus-candle-periods">
            <span className="fcp-label">Period</span>
            {[{l:'30s',ms:30000},{l:'1m',ms:60000},{l:'5m',ms:300000},{l:'15m',ms:900000}].map(p => (
              <button key={p.l} className={`fcp-btn${candlePeriod === p.ms ? ' active' : ''}`}
                onClick={() => setCandlePeriod(p.ms)}>{p.l}</button>
            ))}
          </div>
          <div className="focus-toolbar-sep" />
          <div className="focus-indicators">
            {[
              { id: 'MA7',  get: showMA7,  set: () => setShowMA7(v => !v) },
              { id: 'MA25', get: showMA25, set: () => setShowMA25(v => !v) },
              { id: 'BB',   get: showBB,   set: () => setShowBB(v => !v) },
              { id: 'RSI',  get: showRSI,  set: () => setShowRSI(v => !v) },
              { id: 'MACD', get: showMACD, set: () => setShowMACD(v => !v) },
            ].map(({ id, get, set }) => (
              <button key={id} className={`fi-btn${get ? ' active' : ''}`} onClick={set}>{id}</button>
            ))}
          </div>
          <div className="focus-toolbar-sep" />
          <div className="focus-chart-toggle">
            <button className={`fct-btn${chartType === 'line' ? ' active' : ''}`} onClick={() => setChartType('line')}>LINE</button>
            <button className={`fct-btn${chartType === 'candle' ? ' active' : ''}`} onClick={() => setChartType('candle')}>CANDLE</button>
          </div>
          <div className="focus-toolbar-sep" />
          {focusZoom > 1.05 && (
            <span className="zoom-pill active" onClick={resetZoom} title="click to reset zoom">{focusZoom.toFixed(1)}×</span>
          )}
        </div>

        <div className="focus-body">
          <div className="focus-charts">
            <div className="focus-chart-block price-block">
              <div className="fc-label">BALANCE <span style={{ color: 'var(--dimmest)', fontWeight: 400 }}>scroll=zoom · drag=pan</span></div>
              <div className="focus-chart-wrap"><canvas ref={balRef} style={{ cursor: 'crosshair' }} /></div>
            </div>
            <div className="focus-chart-divider" />
            <div className="focus-chart-block vol-block">
              <div className="fc-label">VOLATILITY</div>
              <div className="focus-chart-wrap"><canvas ref={volRef} /></div>
            </div>
            <div className="focus-chart-divider" />
            <div className="focus-chart-block kd-block">
              <div className="fc-label">K/D</div>
              <div className="focus-chart-wrap"><canvas ref={kdRef} /></div>
            </div>
            {showRSI && <>
              <div className="focus-chart-divider" />
              <div className="focus-chart-block rsi-block visible">
                <div className="fc-label">RSI (14)</div>
                <div className="focus-chart-wrap"><canvas ref={rsiRef} /></div>
              </div>
            </>}
            {showMACD && <>
              <div className="focus-chart-divider" />
              <div className="focus-chart-block macd-block visible">
                <div className="fc-label">MACD (12,26,9)</div>
                <div className="focus-chart-wrap"><canvas ref={macdRef} /></div>
              </div>
            </>}
          </div>

          <div className="focus-feed">
            <div className="focus-feed-label">Events</div>
            <div>
              {events && events.length > 0 ? events.map((ev, i) => (
                <div key={i} className="focus-ev">
                  <span className="focus-ev-icon">{ev.emoji}</span>
                  <div className="focus-ev-body">
                    <div className={`focus-ev-label ${evColor(ev)}`}>{ev.label}</div>
                    {ev.type === 'balance' && ev.before != null && ev.after != null &&
                      <div className="focus-ev-real">({fmtReal(ev.after - ev.before, true)})</div>
                    }
                    <div className="focus-ev-time">{new Date(ev.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
                  </div>
                </div>
              )) : (
                <div style={{ fontSize: 10, color: 'var(--dimmest)', fontFamily: 'var(--mono)' }}>// no events yet</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function Home() {
  const [players,     setPlayers]     = useState([])
  const [graphs,      setGraphs]      = useState({})
  const [events,      setEvents]      = useState({})
  const [theme,       setTheme]       = useState('dark')
  const [chartType,   setChartType]   = useState('line')
  const [focusedName, setFocusedName] = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [updated,     setUpdated]     = useState(null)
  const prevPlayers   = useRef({})
  const graphsRef     = useRef({})

  // Load theme from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return
    const saved = localStorage.getItem('multi-theme')
    if (THEMES.includes(saved)) setTheme(saved)
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('multi-theme', theme)
  }, [theme])

  const load = useCallback(async () => {
    try {
      const res  = await fetch('/api/data')
      const data = await res.json()

      if (data.players?.length) {
        data.players.forEach(p => {
          checkAlerts(prevPlayers.current[p.name], p)
          // Compute events from state changes
          if (prevPlayers.current[p.name]) {
            const prev = prevPlayers.current[p.name]
            setEvents(ev => {
              const list = [...(ev[p.name] || [])]
              if (prev.kills != null && p.kills != null && p.kills > prev.kills) {
                list.unshift({ type: 'combat', positive: true, emoji: '⚔', label: `Kill! (${prev.kills} → ${p.kills})`, ts: Date.now() })
              }
              if (prev.deaths != null && p.deaths != null && p.deaths > prev.deaths) {
                list.unshift({ type: 'combat', positive: false, emoji: '💀', label: `Died (${prev.deaths} → ${p.deaths})`, ts: Date.now() })
              }
              if (!prev.online && p.online) {
                list.unshift({ type: 'presence', positive: true, emoji: '🟢', label: 'Joined server', ts: Date.now() })
              }
              if (prev.online && !p.online) {
                list.unshift({ type: 'presence', positive: false, emoji: '🔴', label: 'Left server', ts: Date.now() })
              }
              return { ...ev, [p.name]: list.slice(0, 20) }
            })
          }
          prevPlayers.current[p.name] = p
        })
        setPlayers(data.players)

        // Accumulate graph points in memory instead of fetching stored history
        const now = Date.now()
        for (const p of data.players) {
          const existing = graphsRef.current[p.name] || []
          const newPt    = { ts: now, balance: p.balance, kills: p.kills || 0, deaths: p.deaths || 0 }
          graphsRef.current[p.name] = [...existing, newPt].slice(-600)
        }
        const gs = { ...graphsRef.current }
        setGraphs(gs)

        // Compute balance events from accumulated graph data
        setEvents(ev => {
          const updated = { ...ev }
          for (const p of data.players) {
            const balEvs = computeBalanceEvents(gs[p.name] || [])
            const existing = (ev[p.name] || []).filter(e => e.type !== 'balance')
            const merged   = [...existing, ...balEvs].sort((a, b) => b.ts - a.ts).slice(0, 20)
            updated[p.name] = merged
          }
          return updated
        })
      }

      setUpdated(Date.now())
    } catch (_) {}
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 15_000)
    return () => clearInterval(t)
  }, [load])

  const focusedPlayer = focusedName ? players.find(p => p.name === focusedName) : null

  // Build 4-slot grid (fill with nulls for empty slots)
  const SLOTS = 4
  const slots = Array.from({ length: SLOTS }, (_, i) => players[i] || null)

  return (
    <>
      <Head>
        <title>Multi Stat Tracker</title>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet" />
      </Head>

      <style>{CSS}</style>

      {loading ? (
        <div id="loader">
          <div className="loader-logo"><span>STAT</span> · MULTI</div>
          <div className="loader-sub">Multi Player Tracker</div>
          <div className="loader-bar-track">
            <div className="loader-bar-fill" style={{ width: '85%' }} />
          </div>
          <div className="loader-status">Loading...</div>
        </div>
      ) : (
        <div id="dashboard" className="visible">
          <div className="topbar">
            <div className="topbar-logo"><span>STAT</span> · MULTI</div>
            <div className="topbar-count">
              {players.length > 0 ? `${players.length} player${players.length > 1 ? 's' : ''} live` : ''}
            </div>

            <div className="chart-toggle">
              <button className={`ct-btn${chartType === 'line' ? ' active' : ''}`} data-type="line" onClick={() => setChartType('line')}>▲ LINE</button>
              <button className={`ct-btn${chartType === 'candle' ? ' active' : ''}`} data-type="candle" onClick={() => setChartType('candle')}>╪ CANDLE</button>
            </div>

            <div className="topbar-actions">
              <div className="theme-picker">
                {THEMES.map(t => (
                  <button key={t} className={`theme-btn${theme === t ? ' active' : ''}`} data-theme={t} title={t} onClick={() => setTheme(t)} />
                ))}
              </div>
              <button className="topbar-btn" title="Refresh" onClick={load}>↻</button>
              {updated && <span className="topbar-upd">{fmtAge(updated)}</span>}
            </div>
          </div>

          <div className="columns-area">
            <div className="main-area">
              <Leaderboard players={players} graphs={graphs} onFocus={setFocusedName} />
              <div className="col-row" id="col-row">
                {slots.map((p, i) =>
                  p ? (
                    <PlayerCol
                      key={p.name}
                      player={p}
                      graphData={graphs[p.name] || []}
                      events={events[p.name] || []}
                      onFocus={setFocusedName}
                      chartType={chartType}
                    />
                  ) : (
                    <EmptySlot key={i} />
                  )
                )}
              </div>
            </div>
          </div>

          {players.length === 0 && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dimmest)', fontFamily: 'var(--mono)', fontSize: 11 }}>
              // waiting for data...
            </div>
          )}
        </div>
      )}

      {focusedPlayer && (
        <FocusPanel
          player={focusedPlayer}
          graphData={graphs[focusedPlayer.name] || []}
          events={events[focusedPlayer.name] || []}
          onClose={() => setFocusedName(null)}
          globalChartType={chartType}
        />
      )}
    </>
  )
}

// ── CSS ────────────────────────────────────────────────────────────────────────

const CSS = `
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#050505;--s1:#0c0c0c;--s2:#141414;--s3:#1c1c1c;--s4:#242424;
  --border:rgba(255,255,255,0.06);--border2:rgba(255,255,255,0.12);--border3:rgba(255,255,255,0.22);
  --text:#fff;--dim:rgba(255,255,255,0.5);--dimmer:rgba(255,255,255,0.28);--dimmest:rgba(255,255,255,0.08);
  --green:#00ff88;--green-dim:rgba(0,255,136,0.1);--green-glow:rgba(0,255,136,0.4);
  --red:#ff3355;--red-dim:rgba(255,51,85,0.1);--red-glow:rgba(255,51,85,0.4);
  --orange:#ff9500;--purple:#a78bfa;
  --mono:'Space Mono',monospace;--sans:'DM Sans',sans-serif;
}
[data-theme="matrix"]{
  --bg:#000;--s1:#020602;--s2:#050e05;--s3:#081408;--s4:#0c1a0c;
  --text:#00ff88;--dim:rgba(0,255,136,.75);--dimmer:rgba(0,255,136,.45);--dimmest:rgba(0,255,136,.14);
  --border:rgba(0,255,136,.08);--border2:rgba(0,255,136,.16);--border3:rgba(0,255,136,.3);
  --green:#00ff88;--green-dim:rgba(0,255,136,.12);--green-glow:rgba(0,255,136,.5);
  --red:#ff3355;--red-dim:rgba(255,51,85,.1);--red-glow:rgba(255,51,85,.4);
  --orange:#00e5ff;--purple:#00ff88;
}
[data-theme="nord"]{
  --bg:#242933;--s1:#2e3440;--s2:#3b4252;--s3:#434c5e;--s4:#4c566a;
  --text:#eceff4;--dim:rgba(236,239,244,.7);--dimmer:rgba(236,239,244,.45);--dimmest:rgba(236,239,244,.15);
  --border:rgba(236,239,244,.06);--border2:rgba(236,239,244,.12);--border3:rgba(236,239,244,.24);
  --green:#a3be8c;--green-dim:rgba(163,190,140,.12);--green-glow:rgba(163,190,140,.4);
  --red:#bf616a;--red-dim:rgba(191,97,106,.12);--red-glow:rgba(191,97,106,.4);
  --orange:#d08770;--purple:#b48ead;
}
[data-theme="warm"]{
  --bg:#0d0a08;--s1:#1a1510;--s2:#231e17;--s3:#2c261d;--s4:#352f24;
  --text:#f5e6d3;--dim:rgba(245,230,211,.68);--dimmer:rgba(245,230,211,.42);--dimmest:rgba(245,230,211,.13);
  --border:rgba(245,230,211,.06);--border2:rgba(245,230,211,.12);--border3:rgba(245,230,211,.24);
  --green:#c8a96e;--green-dim:rgba(200,169,110,.12);--green-glow:rgba(200,169,110,.4);
  --red:#e05c4b;--red-dim:rgba(224,92,75,.1);--red-glow:rgba(224,92,75,.4);
  --orange:#ff9500;--purple:#c9a0dc;
}

html,body{height:100%;overflow:hidden;user-select:none;background:var(--bg);color:var(--text);font-family:var(--sans)}

/* Loading Screen */
#loader{position:fixed;inset:0;background:var(--bg);z-index:999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0}
.loader-logo{font-family:var(--mono);font-size:14px;font-weight:700;letter-spacing:.34em;color:var(--dimmer);text-transform:uppercase;margin-bottom:10px}
.loader-logo span{color:var(--text)}
.loader-sub{font-size:9px;font-family:var(--mono);color:var(--dimmest);letter-spacing:.18em;text-transform:uppercase;margin-bottom:44px}
.loader-bar-track{width:220px;height:2px;background:var(--s3);border-radius:2px;overflow:hidden}
.loader-bar-fill{height:100%;border-radius:2px;background:var(--text);box-shadow:0 0 10px rgba(255,255,255,.5);transition:width .12s ease}
.loader-status{margin-top:14px;font-size:9px;font-family:var(--mono);color:var(--dimmest);letter-spacing:.1em;height:14px}

/* Dashboard */
#dashboard{position:fixed;inset:0;display:flex;flex-direction:column;opacity:0;pointer-events:none;transition:opacity .35s ease}
#dashboard.visible{opacity:1;pointer-events:all}

/* Top bar */
.topbar{
  height:40px;display:flex;align-items:center;padding:0 16px;gap:12px;
  background:var(--s1);border-bottom:1px solid var(--border);flex-shrink:0;
}
.topbar-logo{font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:.22em;color:var(--dimmer);text-transform:uppercase;flex:1}
.topbar-logo span{color:var(--text)}
.topbar-count{font-size:10px;color:var(--dimmest);font-family:var(--mono);margin-right:4px}
.topbar-upd{font-size:9px;color:var(--dimmest);font-family:var(--mono)}

/* Chart toggle */
.chart-toggle{display:flex;background:var(--s2);border:1px solid var(--border2);border-radius:4px;overflow:hidden}
.ct-btn{padding:4px 11px;background:transparent;border:none;color:var(--dimmer);cursor:pointer;font-size:9px;font-family:var(--mono);font-weight:700;letter-spacing:.12em;text-transform:uppercase;transition:all .15s;white-space:nowrap}
.ct-btn.active{background:var(--s4);color:var(--text)}
.ct-btn:hover:not(.active){color:var(--dim)}

.topbar-actions{display:flex;gap:5px;align-items:center}
.topbar-btn{width:26px;height:21px;background:transparent;border:1px solid var(--border);border-radius:3px;color:var(--dimmer);cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;transition:all .15s;font-family:var(--mono)}
.topbar-btn:hover{background:var(--dimmest);color:var(--text);border-color:var(--border2)}

/* Main layout */
.columns-area{flex:1;display:flex;overflow:hidden;min-height:0}
.main-area{flex:1;display:flex;overflow:hidden;min-height:0}

/* 2x2 quarter grid */
.col-row{
  flex:1;display:grid;
  grid-template-columns:1fr 1fr;
  grid-template-rows:1fr 1fr;
  gap:1px;background:var(--border2);
  min-height:0;overflow:hidden;
}

/* Leaderboard panel */
.leaderboard-panel{width:170px;flex-shrink:0;background:var(--s1);border-right:1px solid var(--border2);display:flex;flex-direction:column;overflow:hidden}
.lb-header{padding:9px 12px 7px;font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--dimmer);border-bottom:1px solid var(--border);flex-shrink:0}
#leaderboard{flex:1;overflow-y:auto;padding:6px 0}
#leaderboard::-webkit-scrollbar{width:2px}
#leaderboard::-webkit-scrollbar-thumb{background:rgba(255,255,255,.08)}
.lb-entry{display:flex;align-items:center;gap:7px;padding:6px 12px;border-bottom:1px solid rgba(255,255,255,.04);cursor:pointer;transition:background .12s}
.lb-entry:hover{background:rgba(255,255,255,.025)}
.lb-rank{font-family:var(--mono);font-size:9px;color:var(--dimmest);width:10px;flex-shrink:0;text-align:right}
.lb-avatar{width:24px;height:24px;border-radius:2px;image-rendering:pixelated;flex-shrink:0;border:1px solid var(--border)}
.lb-info{flex:1;min-width:0}
.lb-name{font-family:var(--mono);font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lb-gain{font-family:var(--mono);font-size:9px;margin-top:1px}
.lb-gain.g{color:var(--green)}.lb-gain.r{color:var(--red)}.lb-gain.flat{color:var(--dimmer)}
.lb-real{font-family:var(--mono);font-size:8px;color:var(--dimmest);margin-top:1px}
.lb-empty{padding:14px 12px;font-size:9px;font-family:var(--mono);color:var(--dimmest)}

/* Quarters (each is a player tile) */
.col{
  display:flex;flex-direction:column;min-width:0;background:var(--bg);
  overflow:hidden;cursor:pointer;transition:background .12s;position:relative;
}
.col:hover{background:rgba(255,255,255,.012)}
.col.empty-slot{cursor:default;opacity:.3}
.col.empty-slot:hover{background:transparent}

/* Column header */
.col-head{padding:8px 10px 5px;display:flex;align-items:center;gap:8px;flex-shrink:0;border-bottom:1px solid var(--border)}
.col-avatar{width:28px;height:28px;border-radius:3px;border:1px solid var(--border2);background:var(--s2);image-rendering:pixelated;flex-shrink:0}
.col-head-right{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.col-name-row{display:flex;align-items:center;gap:5px}
.col-name{font-family:var(--mono);font-size:11px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-transform:uppercase;letter-spacing:.04em}
.col-badge{font-size:7px;font-weight:700;letter-spacing:.1em;padding:1px 5px;border-radius:6px;text-transform:uppercase;font-family:var(--mono);flex-shrink:0}
.col-badge.on{color:var(--green);background:var(--green-dim);border:1px solid rgba(0,255,136,.2)}
.col-badge.off{color:var(--red);background:var(--red-dim);border:1px solid rgba(255,51,85,.2)}
.col-badge.unk{color:var(--dimmer);background:var(--dimmest);border:1px solid var(--border)}

/* Stock price display */
.col-price-row{padding:6px 10px 2px;flex-shrink:0}
.col-balance{font-family:var(--mono);font-size:20px;font-weight:700;line-height:1;letter-spacing:-.5px}
.col-balance.up{color:var(--green);text-shadow:0 0 16px var(--green-glow)}
.col-balance.down{color:var(--red);text-shadow:0 0 16px var(--red-glow)}
.col-balance.flat{color:var(--text)}
.col-change{font-family:var(--mono);font-size:10px;margin-top:3px;display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.col-change.up{color:var(--green)}.col-change.down{color:var(--red)}.col-change.flat{color:var(--dimmer)}
.col-change-arrow{font-size:9px}
.col-real-total{font-size:11px;font-family:var(--mono);color:var(--dimmer);font-weight:400;margin-left:6px;letter-spacing:0}
.col-real-inline{font-size:9px;color:var(--dimmer);font-family:var(--mono);opacity:.7}

/* K/D compact row */
.col-kd{display:flex;gap:10px;padding:3px 10px 4px;flex-shrink:0}
.col-kd-item{font-size:10px;color:var(--dimmer);font-family:var(--mono)}
.col-kd-item b{color:var(--dim)}

/* Mini graph */
.col-graph-wrap{padding:2px 4px 3px;flex-shrink:0;position:relative}
.col-graph-canvas{width:100%;height:100px;display:block;cursor:crosshair}
.col-zoom-hint{position:absolute;top:4px;left:7px;font-size:7px;font-family:var(--mono);color:rgba(0,255,136,.5);pointer-events:none;opacity:0;transition:opacity .2s}
.col-graph-wrap:hover .col-zoom-hint{opacity:1}

/* Events */
.col-events{flex:1;overflow:hidden;padding:2px 10px 4px;min-height:0}
.col-ev{display:flex;align-items:baseline;gap:5px;padding:3px 0;border-top:1px solid rgba(255,255,255,.04)}
.col-ev:first-child{border-top:none}
.col-ev-icon{font-size:10px;flex-shrink:0}
.col-ev-label{flex:1;font-size:9px;font-family:var(--mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3}
.col-ev-label.g{color:var(--green)}.col-ev-label.r{color:var(--red)}.col-ev-label.o{color:var(--orange)}
.col-ev-time{font-size:8px;color:var(--dimmest);font-family:var(--mono);flex-shrink:0}
.col-empty-msg{flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px;color:var(--dimmest)}
.col-empty-icon{font-size:18px;opacity:.35}
.col-empty-text{font-size:9px;font-family:var(--mono);letter-spacing:.1em}

/* Focus Panel */
#focus{position:fixed;inset:0;z-index:50;pointer-events:none;opacity:0;visibility:hidden;transition:opacity .18s,visibility 0s .18s}
#focus.open{opacity:1;pointer-events:all;visibility:visible;transition:opacity .18s,visibility 0s}
.focus-panel{width:100%;height:100%;background:var(--bg);display:flex;flex-direction:column;overflow:hidden}
.focus-head{padding:10px 18px 8px;display:flex;align-items:center;gap:14px;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--s1)}
.focus-avatar{width:40px;height:40px;border-radius:3px;border:1px solid var(--border2);image-rendering:pixelated;background:var(--s2);flex-shrink:0}
.focus-info{flex:1;min-width:0}
.focus-name-row{display:flex;align-items:center;gap:8px;margin-bottom:2px}
.focus-name{font-family:var(--mono);font-size:14px;font-weight:700;letter-spacing:.05em;text-transform:uppercase}
.focus-price-row{display:flex;align-items:baseline;gap:10px;margin-bottom:2px}
.focus-price{font-family:var(--mono);font-size:18px;font-weight:700}
.focus-change{font-family:var(--mono);font-size:11px}
.focus-change.up{color:var(--green)}.focus-change.down{color:var(--red)}.focus-change.flat{color:var(--dimmer)}
.focus-meta-row{display:flex;gap:14px;flex-wrap:wrap}
.focus-meta-item{font-family:var(--mono);font-size:10px;color:var(--dimmer)}
.focus-meta-item b{color:var(--text)}
.focus-close{background:transparent;border:1px solid var(--border);border-radius:3px;color:var(--dimmer);cursor:pointer;width:27px;height:27px;font-size:13px;display:flex;align-items:center;justify-content:center;transition:all .15s;flex-shrink:0}
.focus-close:hover{border-color:var(--border2);color:var(--text)}
.focus-toolbar{display:flex;align-items:center;gap:6px;padding:5px 14px;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--s1);flex-wrap:wrap}
.focus-toolbar-sep{width:1px;height:14px;background:var(--border2);flex-shrink:0;margin:0 2px}
.focus-range-bar{display:flex;gap:2px}
.focus-range-btn{padding:3px 7px;background:transparent;border:1px solid var(--border);border-radius:3px;color:var(--dimmer);cursor:pointer;font-size:9px;font-family:var(--mono);transition:all .15s}
.focus-range-btn.active{color:var(--text);border-color:var(--border2)}
.focus-candle-periods{display:flex;align-items:center;gap:2px}
.fcp-label{font-size:8px;font-family:var(--mono);color:var(--dimmest);letter-spacing:.1em;margin-right:3px;text-transform:uppercase}
.fcp-btn{padding:3px 7px;background:transparent;border:1px solid var(--border);border-radius:3px;color:var(--dimmer);cursor:pointer;font-size:9px;font-family:var(--mono);transition:all .15s}
.fcp-btn.active{color:var(--text);border-color:var(--border2)}
.focus-indicators{display:flex;gap:3px;flex-wrap:wrap}
.fi-btn{padding:3px 8px;background:transparent;border:1px solid var(--border);border-radius:3px;color:var(--dimmer);cursor:pointer;font-size:9px;font-family:var(--mono);font-weight:700;letter-spacing:.08em;transition:all .15s}
.fi-btn.active{background:var(--s4);color:var(--text);border-color:var(--border2)}
.focus-chart-toggle{display:flex;background:var(--s2);border:1px solid var(--border2);border-radius:4px;overflow:hidden}
.fct-btn{padding:3px 9px;background:transparent;border:none;color:var(--dimmer);cursor:pointer;font-size:9px;font-family:var(--mono);font-weight:700;letter-spacing:.1em;transition:all .15s}
.fct-btn.active{background:var(--s4);color:var(--text)}
.zoom-pill{font-size:8px;font-family:var(--mono);color:var(--green);padding:2px 8px;background:rgba(0,255,136,.07);border:1px solid rgba(0,255,136,.2);border-radius:3px;display:none;letter-spacing:.06em;cursor:pointer;transition:all .15s}
.zoom-pill:hover{background:rgba(0,255,136,.13)}
.zoom-pill.active{display:inline-block}
.focus-body{flex:1;display:flex;overflow:hidden;min-height:0}
.focus-charts{flex:1;display:flex;flex-direction:column;overflow:hidden;min-height:0;border-right:1px solid var(--border)}
.focus-chart-block{display:flex;flex-direction:column;min-height:0}
.focus-chart-block.price-block{flex:3}
.focus-chart-block.vol-block{flex:0 0 60px}
.focus-chart-block.kd-block{flex:0 0 60px}
.focus-chart-block.rsi-block{flex:0 0 80px;display:flex;flex-direction:column}
.focus-chart-block.macd-block{flex:0 0 90px;display:flex;flex-direction:column}
.focus-chart-divider{height:1px;background:var(--border);flex-shrink:0}
.fc-label{font-family:var(--mono);font-size:8px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--dimmest);padding:3px 14px 1px;flex-shrink:0}
.focus-chart-wrap{flex:1;position:relative;min-height:0}
.focus-chart-wrap canvas{position:absolute;inset:0;width:100%;height:100%}
.focus-feed{width:220px;flex-shrink:0;overflow-y:auto;padding:10px 12px;background:var(--s1);border-left:1px solid var(--border)}
.focus-feed::-webkit-scrollbar{width:2px}
.focus-feed::-webkit-scrollbar-thumb{background:rgba(255,255,255,.08)}
.focus-feed-label{font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--dimmer);font-family:var(--mono);margin-bottom:8px}
.focus-ev{display:flex;gap:7px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--border)}
.focus-ev:last-child{border-bottom:none}
.focus-ev-icon{font-size:12px;flex-shrink:0;margin-top:1px}
.focus-ev-body{flex:1;min-width:0}
.focus-ev-label{font-size:10px;font-family:var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.focus-ev-label.g{color:var(--green)}.focus-ev-label.r{color:var(--red)}.focus-ev-label.o{color:var(--orange)}
.focus-ev-real{font-size:9px;color:var(--dimmer);font-family:var(--mono);margin-top:1px}
.focus-ev-time{font-size:9px;color:var(--dimmest);margin-top:2px}

/* Theme Picker */
.theme-picker{display:flex;gap:5px;align-items:center;margin-right:6px}
.theme-btn{width:13px;height:13px;border-radius:50%;border:2px solid transparent;cursor:pointer;padding:0;transition:all .15s;flex-shrink:0}
.theme-btn[data-theme="dark"]{background:#888}
.theme-btn[data-theme="matrix"]{background:#00ff88}
.theme-btn[data-theme="nord"]{background:#88c0d0}
.theme-btn[data-theme="warm"]{background:#d08770}
.theme-btn.active{border-color:var(--text);transform:scale(1.18)}
.theme-btn:hover:not(.active){transform:scale(1.15)}

/* Animations */
@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
.online-pulse{animation:blink 2.5s infinite}
`
