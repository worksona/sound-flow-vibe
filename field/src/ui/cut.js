// CUT — the CHOP waveform editor, touch-first. Slice boundaries are draggable
// delimiters with fat grab lugs; double-tap splits; a selected delimiter's ✕ merges
// (left slice keeps its params and extends its end); pinch zooms 1×–32×; the strip
// below pans; auto-slice (grid-N / on-silence) replaces the slice set as a single
// undoable action with one-level undo/redo. All edits write plain cfg fields — a
// config authored by hand and one made here are the same thing.

import { store } from '../state.js'
import {
  sliceDefaults, scheduleHit, autoSliceGrid, autoSliceSilence, autoMapPads, round3,
} from '../engine/chop.js'
import { fmtDur } from './capture.js'

const MIN_SLICE = 0.03
const LUG_H = 26

export function initCut(el) {
  el.innerHTML = `
    <div class="panel">
      <h2>waveform</h2>
      <canvas class="wave" id="wave"></canvas>
      <canvas class="wavestrip" id="strip"></canvas>
      <div class="row tight">
        <button class="btn small" id="grid4">grid 4</button>
        <button class="btn small" id="grid8">grid 8</button>
        <button class="btn small" id="grid16">grid 16</button>
        <button class="btn small" id="silence">on silence</button>
        <span class="spacer"></span>
        <button class="btn small" id="undo" disabled>&#8617;</button>
        <button class="btn small" id="redo" disabled>&#8618;</button>
      </div>
      <div class="row tight">
        <span class="chip" id="slice-count"></span>
        <span class="chip" id="zoom-chip">1&times;</span>
        <button class="btn small danger" id="del-boundary" hidden>&#10005; merge here</button>
      </div>
      <div class="note" id="cut-hint">tap a slice to select &amp; audition · double-tap to split · drag a lug to move a cut</div>
    </div>

    <div class="panel inspector" id="inspector" hidden>
      <h2>slice <span id="i-id" style="color:var(--ember)"></span></h2>
      <div class="row">
        <label class="field">start <input type="number" id="i-start" step="0.001" min="0"></label>
        <label class="field">end <input type="number" id="i-end" step="0.001" min="0"></label>
      </div>
      <div class="row"><label class="field" style="flex:1">gain <input type="range" id="i-gain" min="0" max="1" step="0.01"><span id="i-gain-v" class="chip"></span></label></div>
      <div class="row"><label class="field" style="flex:1">pitch <input type="range" id="i-pitch" min="-24" max="24" step="1"><span id="i-pitch-v" class="chip"></span></label></div>
      <div class="row">
        <button class="btn small" id="i-reverse">reverse: off</button>
        <label class="field">choke <input type="number" id="i-choke" step="1" style="width:58px" placeholder="—"></label>
        <label class="field">pad
          <select id="i-pad"><option value="">—</option>${Array.from({ length: 16 }, (_, i) => `<option>${i + 1}</option>`).join('')}</select>
        </label>
      </div>
      <div class="row">
        <label class="field">attack <input type="number" id="i-attack" step="0.001" min="0" style="width:70px"></label>
        <label class="field">release <input type="number" id="i-release" step="0.001" min="0" style="width:70px"></label>
      </div>
    </div>
  `

  const $ = (id) => el.querySelector('#' + id)
  const wave = $('wave'), strip = $('strip')
  const wctx = wave.getContext('2d'), sctx = strip.getContext('2d')

  // view window in seconds
  let v0 = 0, v1 = 1, zoom = 1
  let selBoundary = null    // index into boundaries[] (between slice i and i+1)
  let undoState = null, redoState = null
  let lastTap = { t: 0, x: 0 }
  let playhead = null       // { sliceId, t0, dur, reverse, start, end }
  let playheadRaf = 0
  const pointers = new Map()
  let pinch0 = null
  let dragging = null       // { boundary } while a lug drag is live
  let stripDrag = null

  const dur = () => store.sourceBuffer?.duration || 1

  function sorted() {
    return [...store.chop.slices].sort((a, b) => a.start - b.start)
  }

  /** Shared boundaries between adjacent slices (end≈start), as absolute times. */
  function boundaries() {
    const s = sorted()
    const out = []
    for (let i = 0; i < s.length - 1; i++) {
      if (Math.abs(s[i].end - s[i + 1].start) < 0.0015) out.push({ t: s[i].end, left: s[i], right: s[i + 1] })
    }
    return out
  }

  // ---- geometry ----
  function fitCanvas(c) {
    const dpr = window.devicePixelRatio || 1
    const rect = c.getBoundingClientRect()
    if (rect.width === 0) return false
    if (c.width !== Math.round(rect.width * dpr)) {
      c.width = Math.round(rect.width * dpr)
      c.height = Math.round(rect.height * dpr)
    }
    return true
  }
  const xOf = (t, W) => ((t - v0) / (v1 - v0)) * W
  const tOf = (x, W) => v0 + (x / W) * (v1 - v0)

  function clampView() {
    const d = dur()
    const span = Math.max(d / 32, Math.min(d, v1 - v0))
    v0 = Math.max(0, Math.min(v0, d - span))
    v1 = v0 + span
    zoom = d / span
  }

  // ---- rendering ----
  function draw() {
    if (!fitCanvas(wave) || !fitCanvas(strip)) return
    const W = wave.width, H = wave.height
    const css = getComputedStyle(document.documentElement)
    const ember = css.getPropertyValue('--ember').trim()
    const ink = css.getPropertyValue('--ink-dim').trim()
    wctx.clearRect(0, 0, W, H)

    const buf = store.sourceBuffer
    // selected slice fill
    const sel = store.chop.slices.find((s) => s.id === store.selectedSliceId)
    if (sel) {
      wctx.fillStyle = 'rgba(232,115,74,0.18)'
      const x0 = xOf(sel.start, W), x1 = xOf(sel.end, W)
      wctx.fillRect(x0, 0, x1 - x0, H)
    }

    if (buf) drawPeaks(wctx, buf, v0, v1, W, H, ink)

    // boundaries + lugs
    const bs = boundaries()
    bs.forEach((b, i) => {
      const x = xOf(b.t, W)
      if (x < -20 || x > W + 20) return
      wctx.strokeStyle = i === selBoundary ? ember : 'rgba(232,115,74,0.55)'
      wctx.lineWidth = i === selBoundary ? 3 : 1.5
      wctx.beginPath(); wctx.moveTo(x, 0); wctx.lineTo(x, H); wctx.stroke()
      // grab lug
      const dpr = window.devicePixelRatio || 1
      wctx.fillStyle = i === selBoundary ? ember : 'rgba(232,115,74,0.75)'
      wctx.beginPath()
      wctx.roundRect(x - 7 * dpr, 0, 14 * dpr, LUG_H * dpr * 0.7, 4 * dpr)
      wctx.fill()
    })

    // playhead sweep
    if (playhead) {
      const el2 = (store.ctx?.currentTime ?? 0) - playhead.t0
      if (el2 >= 0 && el2 <= playhead.dur) {
        const frac = el2 / playhead.dur
        const t = playhead.reverse
          ? playhead.end - frac * (playhead.end - playhead.start)
          : playhead.start + frac * (playhead.end - playhead.start)
        const x = xOf(t, W)
        wctx.strokeStyle = css.getPropertyValue('--ink').trim()
        wctx.lineWidth = 1.5
        wctx.beginPath(); wctx.moveTo(x, 0); wctx.lineTo(x, H); wctx.stroke()
      } else if (el2 > playhead.dur) {
        playhead = null
      }
    }

    drawStrip()
    $('slice-count').textContent = `${store.chop.slices.length} slices · ${fmtDur(dur())}`
    $('zoom-chip').textContent = zoom.toFixed(zoom < 3 ? 1 : 0) + '×'
    $('del-boundary').hidden = selBoundary === null
  }

  function drawStrip() {
    const W = strip.width, H = strip.height
    sctx.clearRect(0, 0, W, H)
    const buf = store.sourceBuffer
    if (buf) drawPeaks(sctx, buf, 0, buf.duration, W, H, 'rgba(154,145,127,0.5)')
    const d = dur()
    sctx.fillStyle = 'rgba(232,115,74,0.25)'
    sctx.strokeStyle = 'rgba(232,115,74,0.8)'
    const x0 = (v0 / d) * W, x1 = (v1 / d) * W
    sctx.fillRect(x0, 0, x1 - x0, H)
    sctx.strokeRect(x0 + 0.5, 0.5, x1 - x0 - 1, H - 1)
  }

  function drawPeaks(g, buf, t0, t1, W, H, color) {
    const data = buf.getChannelData(0)
    const sr = buf.sampleRate
    const mid = H / 2
    g.strokeStyle = color
    g.lineWidth = 1
    g.beginPath()
    for (let x = 0; x < W; x++) {
      const i0 = Math.floor((t0 + ((t1 - t0) * x) / W) * sr)
      const i1 = Math.max(i0 + 1, Math.floor((t0 + ((t1 - t0) * (x + 1)) / W) * sr))
      let lo = 0, hi = 0
      const step = Math.max(1, Math.floor((i1 - i0) / 40))
      for (let i = i0; i < i1 && i < data.length; i += step) {
        const s = data[i]
        if (s < lo) lo = s
        if (s > hi) hi = s
      }
      g.moveTo(x + 0.5, mid - hi * mid * 0.92)
      g.lineTo(x + 0.5, mid - lo * mid * 0.92 + 0.5)
    }
    g.stroke()
  }

  // ---- edits (undoable slice-set ops) ----
  function snapshot() { return JSON.parse(JSON.stringify({ slices: store.chop.slices, pads: store.chop.pads })) }
  function commit(snap) {
    undoState = snap
    redoState = null
    $('undo').disabled = false
    $('redo').disabled = true
    prunePads()
    store.touchChop()
    bindInspector()
    draw()
  }
  function prunePads() {
    const ids = new Set(store.chop.slices.map((s) => s.id))
    for (const [pad, id] of Object.entries(store.chop.pads)) {
      if (!ids.has(id)) delete store.chop.pads[pad]
    }
  }
  $('undo').addEventListener('click', () => {
    if (!undoState) return
    redoState = snapshot()
    store.chop.slices = undoState.slices; store.chop.pads = undoState.pads
    undoState = null
    $('undo').disabled = true; $('redo').disabled = false
    store.touchChop(); bindInspector(); draw()
  })
  $('redo').addEventListener('click', () => {
    if (!redoState) return
    undoState = snapshot()
    store.chop.slices = redoState.slices; store.chop.pads = redoState.pads
    redoState = null
    $('undo').disabled = false; $('redo').disabled = true
    store.touchChop(); bindInspector(); draw()
  })

  function nextSliceId() {
    let n = 0
    for (const s of store.chop.slices) {
      const m = /^s(\d+)$/.exec(s.id)
      if (m) n = Math.max(n, parseInt(m[1], 10))
    }
    return `s${n + 1}`
  }

  function splitAt(t) {
    const s = sorted().find((x) => t > x.start && t < x.end)
    if (!s || t - s.start < MIN_SLICE || s.end - t < MIN_SLICE) return
    const snap = snapshot()
    const right = sliceDefaults({ ...s, id: nextSliceId(), start: round3(t), end: s.end })
    s.end = round3(t)
    store.chop.slices.push(right)
    store.selectedSliceId = s.id
    commit(snap)
  }

  function mergeBoundary(i) {
    const bs = boundaries()
    const b = bs[i]
    if (!b) return
    const snap = snapshot()
    // left keeps its params and extends its end
    b.left.end = b.right.end
    store.chop.slices = store.chop.slices.filter((s) => s.id !== b.right.id)
    selBoundary = null
    store.selectedSliceId = b.left.id
    commit(snap)
  }

  function applyAutoSlice(slices) {
    const snap = snapshot()
    store.chop.slices = slices
    store.chop.pads = autoMapPads(slices)
    store.selectedSliceId = null
    selBoundary = null
    commit(snap)
  }

  $('grid4').addEventListener('click', () => store.sourceBuffer && applyAutoSlice(autoSliceGrid(dur(), 4)))
  $('grid8').addEventListener('click', () => store.sourceBuffer && applyAutoSlice(autoSliceGrid(dur(), 8)))
  $('grid16').addEventListener('click', () => store.sourceBuffer && applyAutoSlice(autoSliceGrid(dur(), 16)))
  $('silence').addEventListener('click', () => store.sourceBuffer && applyAutoSlice(autoSliceSilence(store.sourceBuffer)))
  $('del-boundary').addEventListener('click', () => selBoundary !== null && mergeBoundary(selBoundary))

  // ---- audition + playhead ----
  function audition(slice) {
    const ctx = store.audio()
    if (!store.sourceBuffer) return
    const s = sliceDefaults(slice)
    const when = ctx.currentTime + 0.02
    scheduleHit(ctx, ctx.destination, store.sourceBuffer, s, 1, when)
    const rate = Math.pow(2, s.pitch / 12)
    playhead = { t0: when, dur: (s.end - s.start) / rate, reverse: s.reverse, start: s.start, end: s.end }
    cancelAnimationFrame(playheadRaf)
    const tick = () => { draw(); if (playhead) playheadRaf = requestAnimationFrame(tick) }
    playheadRaf = requestAnimationFrame(tick)
  }

  // ---- pointer interaction on the wave ----
  wave.addEventListener('pointerdown', (e) => {
    store.audio()
    wave.setPointerCapture(e.pointerId)
    const dpr = window.devicePixelRatio || 1
    const rect = wave.getBoundingClientRect()
    const x = (e.clientX - rect.left) * dpr
    const y = (e.clientY - rect.top) * dpr
    pointers.set(e.pointerId, { x, y })

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      pinch0 = { dist: Math.abs(a.x - b.x), v0, v1, mid: tOf((a.x + b.x) / 2, wave.width) }
      dragging = null
      return
    }

    const W = wave.width
    const bs = boundaries()
    // lug hit: top zone, ±18 css px around the boundary
    const hitR = 18 * dpr
    let hit = -1
    bs.forEach((b, i) => {
      const bx = xOf(b.t, W)
      if (Math.abs(bx - x) < hitR && (y < LUG_H * dpr || Math.abs(bx - x) < 8 * dpr)) hit = i
    })
    if (hit >= 0) {
      selBoundary = hit
      dragging = { boundary: hit, snap: snapshot(), moved: false }
      draw()
      return
    }
    dragging = null
  })

  wave.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return
    const dpr = window.devicePixelRatio || 1
    const rect = wave.getBoundingClientRect()
    const x = (e.clientX - rect.left) * dpr
    const y = (e.clientY - rect.top) * dpr
    pointers.set(e.pointerId, { x, y })

    if (pointers.size === 2 && pinch0) {
      const [a, b] = [...pointers.values()]
      const dist = Math.max(10, Math.abs(a.x - b.x))
      const scale = pinch0.dist / dist
      const span0 = pinch0.v1 - pinch0.v0
      const span = span0 * scale
      const mid = pinch0.mid
      const frac = (mid - pinch0.v0) / span0
      v0 = mid - frac * span
      v1 = v0 + span
      clampView()
      draw()
      return
    }

    if (dragging?.boundary !== undefined && dragging.boundary !== null) {
      const bs = boundaries()
      const b = bs[dragging.boundary]
      if (!b) return
      const t = tOf(x, wave.width)
      const lo = b.left.start + MIN_SLICE
      const hi = b.right.end - MIN_SLICE
      const nt = round3(Math.max(lo, Math.min(hi, t)))
      b.left.end = nt
      b.right.start = nt
      dragging.moved = true
      draw()
    }
  })

  function pointerEnd(e) {
    const wasPinch = pointers.size === 2
    pointers.delete(e.pointerId)
    if (wasPinch) { pinch0 = null; return }

    if (dragging) {
      if (dragging.moved) {
        const snap = dragging.snap
        dragging = null
        commit(snap)
      }
      dragging = null
      return
    }

    // tap: select slice / double-tap: split
    const dpr = window.devicePixelRatio || 1
    const rect = wave.getBoundingClientRect()
    const x = (e.clientX - rect.left) * dpr
    const t = tOf(x, wave.width)
    const now = performance.now()
    const isDouble = now - lastTap.t < 320 && Math.abs(x - lastTap.x) < 24 * dpr
    lastTap = { t: now, x }

    if (isDouble) { splitAt(t); return }

    selBoundary = null
    const s = sorted().find((sl) => t >= sl.start && t <= sl.end)
    if (s) {
      store.selectedSliceId = s.id
      bindInspector()
      audition(s)
    }
    draw()
  }
  wave.addEventListener('pointerup', pointerEnd)
  wave.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); pinch0 = null; dragging = null })

  wave.addEventListener('wheel', (e) => {
    e.preventDefault()
    const dpr = window.devicePixelRatio || 1
    const rect = wave.getBoundingClientRect()
    const mid = tOf((e.clientX - rect.left) * dpr, wave.width)
    const span0 = v1 - v0
    const span = span0 * (e.deltaY > 0 ? 1.15 : 0.87)
    const frac = (mid - v0) / span0
    v0 = mid - frac * span
    v1 = v0 + span
    clampView()
    draw()
  }, { passive: false })

  // strip pans
  strip.addEventListener('pointerdown', (e) => {
    strip.setPointerCapture(e.pointerId)
    stripDrag = { x: e.clientX, v0 }
  })
  strip.addEventListener('pointermove', (e) => {
    if (!stripDrag) return
    const rect = strip.getBoundingClientRect()
    const dt = ((e.clientX - stripDrag.x) / rect.width) * dur()
    const span = v1 - v0
    v0 = stripDrag.v0 + dt
    v1 = v0 + span
    clampView()
    draw()
  })
  strip.addEventListener('pointerup', () => { stripDrag = null })
  strip.addEventListener('pointercancel', () => { stripDrag = null })

  // ---- inspector ----
  function selSlice() { return store.chop.slices.find((s) => s.id === store.selectedSliceId) }

  function bindInspector() {
    const s = selSlice()
    const box = $('inspector')
    if (!s) { box.hidden = true; return }
    const d = sliceDefaults(s)
    box.hidden = false
    $('i-id').textContent = s.id
    $('i-start').value = d.start
    $('i-end').value = d.end
    $('i-gain').value = d.gain; $('i-gain-v').textContent = d.gain.toFixed(2)
    $('i-pitch').value = d.pitch; $('i-pitch-v').textContent = (d.pitch > 0 ? '+' : '') + d.pitch + 'st'
    $('i-reverse').textContent = 'reverse: ' + (d.reverse ? 'ON' : 'off')
    $('i-reverse').classList.toggle('toggled', !!d.reverse)
    $('i-choke').value = d.choke ?? ''
    $('i-attack').value = d.attack
    $('i-release').value = d.release
    const pad = Object.entries(store.chop.pads).find(([, id]) => id === s.id)?.[0] || ''
    $('i-pad').value = pad
  }

  function editSel(fn) {
    const s = selSlice()
    if (!s) return
    fn(s)
    store.touchChop()
    draw()
  }

  $('i-start').addEventListener('change', () => editSel((s) => {
    const v = parseFloat($('i-start').value)
    if (isFinite(v)) s.start = round3(Math.max(0, Math.min(v, s.end - MIN_SLICE)))
    $('i-start').value = s.start
  }))
  $('i-end').addEventListener('change', () => editSel((s) => {
    const v = parseFloat($('i-end').value)
    if (isFinite(v)) s.end = round3(Math.max(s.start + MIN_SLICE, Math.min(v, dur())))
    $('i-end').value = s.end
  }))
  $('i-gain').addEventListener('input', () => editSel((s) => {
    s.gain = parseFloat($('i-gain').value); $('i-gain-v').textContent = s.gain.toFixed(2)
  }))
  $('i-pitch').addEventListener('input', () => editSel((s) => {
    s.pitch = parseInt($('i-pitch').value, 10)
    $('i-pitch-v').textContent = (s.pitch > 0 ? '+' : '') + s.pitch + 'st'
  }))
  $('i-reverse').addEventListener('click', () => editSel((s) => {
    s.reverse = !s.reverse
    $('i-reverse').textContent = 'reverse: ' + (s.reverse ? 'ON' : 'off')
    $('i-reverse').classList.toggle('toggled', !!s.reverse)
  }))
  $('i-choke').addEventListener('change', () => editSel((s) => {
    const v = $('i-choke').value.trim()
    if (v === '') delete s.choke
    else s.choke = parseInt(v, 10)
  }))
  $('i-attack').addEventListener('change', () => editSel((s) => {
    const v = parseFloat($('i-attack').value)
    if (isFinite(v) && v >= 0) s.attack = v
  }))
  $('i-release').addEventListener('change', () => editSel((s) => {
    const v = parseFloat($('i-release').value)
    if (isFinite(v) && v >= 0) s.release = v
  }))
  $('i-pad').addEventListener('change', () => {
    const s = selSlice()
    if (!s) return
    const pad = $('i-pad').value
    // one slice per pad: clear any pad currently holding this slice, then assign
    for (const [p, id] of Object.entries(store.chop.pads)) if (id === s.id) delete store.chop.pads[p]
    if (pad) store.chop.pads[pad] = s.id
    store.touchChop()
  })

  // ---- lifecycle ----
  function resetView() {
    v0 = 0; v1 = dur(); zoom = 1
    clampView()
  }

  store.on('source-changed', () => { resetView(); selBoundary = null; bindInspector(); draw() })
  store.on('chop-changed', draw)
  window.addEventListener('resize', draw)

  resetView()
  bindInspector()

  return {
    show() { resetView(); bindInspector(); draw() },
    hide() { cancelAnimationFrame(playheadRaf); playhead = null },
  }
}
