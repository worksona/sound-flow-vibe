// PLAY — the 16-pad bank + performance capture + the LOOM loop rack.
// Pads: velocity by hit position (top = 1.0, bottom = 0.4); hardware keys a s d f g h j k /
// e r t y / c v b n fire pads 1–16 at 1.0 (shift = 0.6), only when no input has focus.
// ⏺ capture writes event times from the AUDIO clock — ctx.currentTime − recT0, never
// performance.now() — with the origin latched only after the clock is confirmed running.
// Times store to 3 decimals (1 ms grid); optional 1/8 / 1/16 quantize at a bpm is applied
// at capture-stop with the raw timing kept in memory until then.
// The loop rack is LOOM: slots tile into a bars×bpm window, live play loops one
// offline-rendered window — what loops live is exactly what exports.

import { store } from '../state.js'
import { sliceDefaults, scheduleHit, scheduleChop, renderChop, chopDuration, round3, sliceWallLen } from '../engine/chop.js'
import { renderLoomWindow, renderLoomFull, playLoomWindow, loomLoopDur } from '../engine/loom.js'
import { bufferToWav } from '../lib/wav.js'
import { putAsset, nextName, listAssets, resolveRefToBuffer } from '../lib/library.js'

const PAD_KEYS = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'e', 'r', 't', 'y', 'c', 'v', 'b', 'n']

export function initPlay(el) {
  el.innerHTML = `
    <div class="panel">
      <h2>pads</h2>
      <div class="padgrid" id="pads"></div>
    </div>

    <div class="panel">
      <h2>performance</h2>
      <div class="row">
        <button class="btn primary" id="p-capture">&#9210; capture</button>
        <button class="btn" id="p-play">&#9654; play</button>
        <button class="btn small" id="p-clear">clear</button>
        <span class="chip" id="p-count"></span>
      </div>
      <div class="row">
        <label class="field">quantize
          <select id="p-quant"><option value="">off</option><option value="8">1/8</option><option value="16">1/16</option></select>
        </label>
        <label class="field">bpm <input type="number" id="p-bpm" min="40" max="220" value="120"></label>
        <button class="btn small" id="p-bounce">&#8594; library</button>
      </div>
      <canvas class="lane" id="lane"></canvas>
    </div>

    <div class="panel">
      <h2>loop &middot; loom window</h2>
      <div class="row">
        <label class="field">bpm <input type="number" id="l-bpm" min="40" max="220"></label>
        <label class="field">bars <input type="number" id="l-bars" min="1" max="64"></label>
        <label class="field">beats <input type="number" id="l-beats" min="1" max="12"></label>
        <label class="field">loops <input type="number" id="l-loops" min="1" max="64"></label>
      </div>
      <div id="slots"></div>
      <div class="row">
        <select id="l-add-asset"><option value="">add slot from library…</option></select>
      </div>
      <div class="row">
        <button class="btn primary" id="l-play">&#9654; loop</button>
        <button class="btn small" id="l-save">&#8613; save render</button>
        <span class="chip" id="l-dur"></span>
      </div>
      <div class="note" id="l-note"></div>
    </div>
  `

  const $ = (id) => el.querySelector('#' + id)
  const padsEl = $('pads'), lane = $('lane')
  const lctx = lane.getContext('2d')

  let capturing = null   // { recT0, raw: [{pad,t,v}] }
  let playing = null     // { handles, t0, dur }
  let liveHits = new Map() // choke group -> handle (live choke behavior)
  let loopHandle = null
  let laneRaf = 0

  // ---- pads ----
  function buildPads() {
    padsEl.innerHTML = ''
    for (let i = 1; i <= 16; i++) {
      const pad = document.createElement('div')
      pad.className = 'pad'
      pad.dataset.pad = String(i)
      pad.innerHTML = `<span class="pad-n">${i}</span><span class="pad-key">${PAD_KEYS[i - 1]}</span><span class="pad-slice"></span>`
      padsEl.appendChild(pad)
      pad.addEventListener('pointerdown', (e) => {
        e.preventDefault()
        const rect = pad.getBoundingClientRect()
        const frac = (e.clientY - rect.top) / rect.height // top = 1.0, bottom = 0.4
        const v = Math.max(0.4, Math.min(1, 1 - frac * 0.6))
        hitPad(String(i), v)
      })
    }
    refreshPadLabels()
  }

  function refreshPadLabels() {
    for (const pad of padsEl.children) {
      const id = store.chop.pads[pad.dataset.pad]
      pad.querySelector('.pad-slice').textContent = id || ''
      pad.classList.toggle('assigned', !!id)
    }
  }

  function hitPad(padNo, v) {
    const ctx = store.audio()
    const sliceId = store.chop.pads[padNo]
    const slice = store.chop.slices.find((s) => s.id === sliceId)
    if (!slice || !store.sourceBuffer) return
    const s = sliceDefaults(slice)
    const when = ctx.currentTime + 0.005

    // live choke: a new hit in the group truncates the sounding one at its t
    if (s.choke !== undefined) {
      liveHits.get(s.choke)?.stop(when)
    }
    const h = scheduleHit(ctx, ctx.destination, store.sourceBuffer, s, v, when)
    if (s.choke !== undefined && h) liveHits.set(s.choke, h)

    flashPad(padNo, v, sliceWallLen(s, store.sourceBuffer.duration))

    if (capturing) {
      capturing.raw.push({ pad: padNo, t: round3(Math.max(0, when - capturing.recT0)), v: Math.round(v * 100) / 100 })
      $('p-count').textContent = `${(store.chop.performance?.length || 0)}+${capturing.raw.length} events`
    }
  }

  function flashPad(padNo, v, durSec) {
    const pad = padsEl.querySelector(`[data-pad="${padNo}"]`)
    if (!pad) return
    pad.classList.add('lit')
    pad.style.opacity = String(0.55 + v * 0.45)
    setTimeout(() => { pad.classList.remove('lit'); pad.style.opacity = '' }, Math.min(2000, durSec * 1000))
  }

  // hardware keys, keyboard hits are 1.0, shift = 0.6; only when no input has focus
  window.addEventListener('keydown', (e) => {
    if (e.repeat || el.hidden) return
    const tag = document.activeElement?.tagName
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
    const idx = PAD_KEYS.indexOf(e.key.toLowerCase())
    if (idx < 0) return
    hitPad(String(idx + 1), e.shiftKey ? 0.6 : 1)
  })

  // ---- capture ----
  $('p-capture').addEventListener('click', async () => {
    const ctx = store.audio()
    if (capturing) {
      // stop: quantize at capture-stop, raw kept in memory until now
      const quant = $('p-quant').value
      const bpm = parseFloat($('p-bpm').value) || 120
      let events = capturing.raw
      if (quant) {
        const grid = (60 / bpm) / (parseInt(quant, 10) / 4)
        events = events.map((ev) => ({ ...ev, t: round3(Math.round(ev.t / grid) * grid) }))
      }
      store.chop.performance = [...(store.chop.performance || []), ...events]
      capturing = null
      $('p-capture').classList.remove('lit')
      $('p-capture').innerHTML = '&#9210; capture'
      store.touchChop()
      drawLane()
      return
    }
    // latch the origin only after the clock is confirmed running
    await ctx.resume()
    capturing = { recT0: ctx.currentTime, raw: [] }
    $('p-capture').classList.add('lit')
    $('p-capture').innerHTML = '&#9632; stop capture'
    startLaneSweep(() => capturing ? store.ctx.currentTime - capturing.recT0 : null)
  })

  $('p-clear').addEventListener('click', () => {
    store.chop.performance = []
    store.touchChop()
    drawLane()
  })

  // ---- playback through the same engine schedule() — no separate audition path ----
  $('p-play').addEventListener('click', () => {
    const ctx = store.audio()
    if (playing) { stopPerf(); return }
    if (!store.sourceBuffer || !(store.chop.performance || []).length) return
    const t0 = ctx.currentTime + 0.05
    const { handles, duration } = scheduleChop(ctx, ctx.destination, store.chop, store.sourceBuffer, t0)
    playing = { handles, t0, dur: duration }
    $('p-play').innerHTML = '&#9632; stop'
    // flash pads as blocks fire
    for (const ev of store.chop.performance) {
      const slice = store.chop.slices.find((s) => s.id === store.chop.pads[ev.pad])
      if (!slice) continue
      setTimeout(() => flashPad(ev.pad, ev.v ?? 1, sliceWallLen(slice, store.sourceBuffer.duration)),
        Math.max(0, (t0 + ev.t - ctx.currentTime) * 1000))
    }
    startLaneSweep(() => {
      if (!playing) return null
      const t = store.ctx.currentTime - playing.t0
      if (t > playing.dur) { stopPerf(); return null }
      return t
    })
  })

  function stopPerf() {
    playing?.handles.forEach((h) => h.stop())
    playing = null
    $('p-play').innerHTML = '&#9654; play'
    drawLane()
  }

  // ---- timeline lane ----
  function fitLane() {
    const dpr = window.devicePixelRatio || 1
    const rect = lane.getBoundingClientRect()
    if (!rect.width) return false
    lane.width = Math.round(rect.width * dpr)
    lane.height = Math.round(rect.height * dpr)
    return true
  }

  function drawLane(sweepT) {
    if (!fitLane()) return
    const W = lane.width, H = lane.height
    lctx.clearRect(0, 0, W, H)
    const evs = [...(store.chop.performance || []), ...(capturing?.raw || [])]
    const srcDur = store.sourceBuffer?.duration
    const total = Math.max(2, chopDuration(store.chop, srcDur), ...(capturing?.raw || []).map((e) => e.t + 0.5), sweepT ?? 0)
    const rowH = H / 4
    for (const ev of evs) {
      const slice = store.chop.slices.find((s) => s.id === store.chop.pads[ev.pad])
      if (!slice) continue
      const row = Math.floor((parseInt(ev.pad, 10) - 1) / 4) // p1–4 / p5–8 / p9–12 / p13–16
      const x = (ev.t / total) * W
      const w = Math.max(3, (sliceWallLen(slice, srcDur) / total) * W)
      lctx.fillStyle = `rgba(232,115,74,${0.25 + 0.75 * (ev.v ?? 1)})`
      lctx.fillRect(x, row * rowH + 2, w, rowH - 4)
    }
    if (sweepT != null) {
      const x = (sweepT / total) * W
      lctx.strokeStyle = '#e8e2d9'
      lctx.beginPath(); lctx.moveTo(x, 0); lctx.lineTo(x, H); lctx.stroke()
    }
  }

  function startLaneSweep(getT) {
    cancelAnimationFrame(laneRaf)
    const tick = () => {
      const t = getT()
      drawLane(t ?? undefined)
      if (t != null) laneRaf = requestAnimationFrame(tick)
    }
    laneRaf = requestAnimationFrame(tick)
  }

  // ---- bounce the kit take to the library ----
  $('p-bounce').addEventListener('click', async () => {
    if (!store.sourceBuffer || !(store.chop.performance || []).length) return
    $('p-bounce').disabled = true
    try {
      const buf = await renderChop(store.chop, store.sourceBuffer)
      const name = await nextName('field-kit')
      await putAsset({
        blob: bufferToWav(buf), name, tags: ['field', 'chop', 'render'], by: 'human',
        dur: buf.duration, sr: buf.sampleRate, ch: buf.numberOfChannels,
      })
      $('p-count').textContent = `bounced → ${name}`
      refreshAssetPicker()
    } finally { $('p-bounce').disabled = false }
  })

  // ---- loop rack (LOOM) ----
  const slotLetters = 'abcdefgh'

  function bindLoomFields() {
    $('l-bpm').value = store.loom.bpm
    $('l-bars').value = store.loom.bars
    $('l-beats').value = store.loom.beatsPerBar
    $('l-loops').value = store.loom.loops
    $('l-dur').textContent = `window ${loomLoopDur(store.loom).toFixed(2)}s`
  }

  for (const [id, key, lo, hi] of [['l-bpm', 'bpm', 40, 220], ['l-bars', 'bars', 1, 64], ['l-beats', 'beatsPerBar', 1, 12], ['l-loops', 'loops', 1, 64]]) {
    $(id).addEventListener('change', () => {
      const v = parseFloat($(id).value)
      if (isFinite(v)) store.loom[key] = Math.max(lo, Math.min(hi, key === 'bpm' ? v : Math.round(v)))
      bindLoomFields()
      store.touchLoom()
      restartLoopIfLive()
    })
  }

  function renderSlots() {
    const box = $('slots')
    box.innerHTML = ''
    for (const slot of store.loom.slots) {
      const row = document.createElement('div')
      row.className = 'slot'
      row.innerHTML = `
        <span class="s-id">${slot.id}</span>
        <span class="s-name">${slot.ref?.replace(/^hash:(.{8}).*/, 'hash:$1…') ?? '(empty)'}</span>
        <input type="range" min="0" max="1.5" step="0.05" value="${slot.level ?? 1}" title="level" style="width:70px">
        <button class="btn small ${slot.halfSpeed ? 'toggled' : ''}" data-a="half" title="half speed">&frac12;</button>
        <button class="btn small ${slot.muted ? 'toggled' : ''}" data-a="mute">m</button>
        <button class="btn small danger" data-a="del">&#10005;</button>
      `
      const [lvl] = row.querySelectorAll('input')
      lvl.addEventListener('input', () => { slot.level = parseFloat(lvl.value); store.touchLoom() })
      lvl.addEventListener('change', restartLoopIfLive)
      row.querySelector('[data-a="half"]').addEventListener('click', (e) => {
        slot.halfSpeed = !slot.halfSpeed
        e.target.classList.toggle('toggled', slot.halfSpeed)
        store.touchLoom(); restartLoopIfLive()
      })
      row.querySelector('[data-a="mute"]').addEventListener('click', (e) => {
        slot.muted = !slot.muted
        e.target.classList.toggle('toggled', slot.muted)
        store.touchLoom(); restartLoopIfLive()
      })
      row.querySelector('[data-a="del"]').addEventListener('click', () => {
        store.loom.slots = store.loom.slots.filter((s) => s !== slot)
        store.touchLoom(); renderSlots(); restartLoopIfLive()
      })
      box.appendChild(row)
    }
  }

  async function refreshAssetPicker() {
    const assets = await listAssets()
    const sel = $('l-add-asset')
    sel.innerHTML = '<option value="">add slot from library…</option>' +
      assets.map((a) => `<option value="${a.hash}">${a.name} (${a.dur?.toFixed(1)}s)</option>`).join('')
  }

  $('l-add-asset').addEventListener('change', async () => {
    const hash = $('l-add-asset').value
    if (!hash) return
    const used = new Set(store.loom.slots.map((s) => s.id))
    const id = [...slotLetters].find((l) => !used.has(l))
    if (!id) { $('l-note').textContent = 'rack is full (8 slots)'; return }
    // recorded takes are always pinned by hash: so a take never silently swaps
    store.loom.slots.push({ id, ref: `hash:${hash}`, level: 1, pan: 0, muted: false, halfSpeed: false })
    $('l-add-asset').value = ''
    store.touchLoom()
    renderSlots()
    restartLoopIfLive()
  })

  async function resolveSlotBuffers() {
    const ctx = store.audio()
    const map = new Map()
    for (const slot of store.loom.slots) {
      if (!slot.ref) continue
      const buf = await resolveRefToBuffer(slot.ref, ctx).catch(() => null)
      if (buf) map.set(slot.id, buf) // unresolved refs are silent, never fatal
    }
    return map
  }

  async function startLoop() {
    const ctx = store.audio()
    $('l-note').textContent = 'rendering…'
    const buffers = await resolveSlotBuffers()
    if (!buffers.size) { $('l-note').textContent = 'no resolvable slots — add one from the library'; return }
    const windowBuf = await renderLoomWindow(store.loom, buffers, ctx.sampleRate)
    loopHandle?.stop()
    loopHandle = playLoomWindow(ctx, windowBuf)
    $('l-play').innerHTML = '&#9632; stop'
    $('l-play').classList.add('lit')
    $('l-note').textContent = `looping ${loomLoopDur(store.loom).toFixed(2)}s window · ${buffers.size} slot(s)`
  }

  function stopLoop() {
    loopHandle?.stop()
    loopHandle = null
    $('l-play').innerHTML = '&#9654; loop'
    $('l-play').classList.remove('lit')
    $('l-note').textContent = ''
  }

  // any edit re-renders and swaps in — the groove never stops under an edit
  let restartQueued = false
  function restartLoopIfLive() {
    if (!loopHandle || restartQueued) return
    restartQueued = true
    setTimeout(async () => { restartQueued = false; if (loopHandle) await startLoop() }, 150)
  }

  $('l-play').addEventListener('click', () => (loopHandle ? stopLoop() : startLoop()))

  $('l-save').addEventListener('click', async () => {
    const ctx = store.audio()
    $('l-save').disabled = true
    try {
      const buffers = await resolveSlotBuffers()
      if (!buffers.size) { $('l-note').textContent = 'no resolvable slots to render'; return }
      const buf = await renderLoomFull(store.loom, buffers, ctx.sampleRate)
      const name = await nextName('field-loop')
      await putAsset({
        blob: bufferToWav(buf), name, tags: ['field', 'loom', 'render'], by: 'human',
        dur: buf.duration, sr: buf.sampleRate, ch: buf.numberOfChannels,
      })
      $('l-note').textContent = `saved ${name} — ${buf.duration.toFixed(2)}s`
      refreshAssetPicker()
    } finally { $('l-save').disabled = false }
  })

  // ---- lifecycle ----
  buildPads()
  bindLoomFields()
  renderSlots()
  refreshAssetPicker()

  store.on('chop-changed', () => { refreshPadLabels(); drawLane() })
  store.on('source-changed', () => { refreshPadLabels(); drawLane() })
  store.on('loom-changed', bindLoomFields)

  function updateCount() {
    $('p-count').textContent = `${(store.chop.performance || []).length} events`
  }
  store.on('chop-changed', updateCount)
  updateCount()

  return {
    show() { refreshPadLabels(); drawLane(); refreshAssetPicker(); bindLoomFields(); renderSlots() },
    hide() { stopPerf(); stopLoop(); cancelAnimationFrame(laneRaf) },
  }
}
