// CAPTURE — the arm panel + free-length sampling, per the CHOP/LOOM arm-panel spec:
// RAW capture (EC/NS/AGC off), device picker, live VU off an analyser-only tap,
// too-hot badge on any peak ≥ −1 dBFS in the last second, monitor default OFF
// (headphones only — feedback risk), −45 dBFS auto-trim, and the −50 dBFS silence
// guard: a wrong input device costs you a sentence, not a mystery.

import { store } from '../state.js'
import { autoTrim, isSilentTake, errorSentence } from '../lib/mic.js'
import { encodeWav } from '../lib/wav.js'
import { putAsset, nextName, decodeAsset, requestPersistence } from '../lib/library.js'
import { autoSliceGrid, autoMapPads } from '../engine/chop.js'

let wakeLock = null
let meterTimer = null
let pendingTake = null // { channels, sampleRate } held while the silence guard asks

export function initCapture(el) {
  el.innerHTML = `
    <div class="panel">
      <h2>input</h2>
      <div class="row">
        <button class="btn" id="arm">&#9210; arm</button>
        <span class="chip" id="mic-state">mic: not asked</span>
        <span class="chip bad" id="too-hot" hidden>too hot</span>
      </div>
      <div class="row">
        <select id="devices" title="input device"><option value="">default input</option></select>
      </div>
      <div class="row">
        <div class="vu"><i id="vu-bar"></i></div>
        <button class="btn small" id="monitor" title="headphones only — feedback risk">monitor: off</button>
      </div>
      <div class="note bad" id="mic-error" hidden></div>
    </div>

    <div class="panel">
      <h2>sample</h2>
      <button class="rec-big" id="rec">&#9679; rec</button>
      <div class="note" id="rec-note" style="text-align:center">press to record — free length, press again to stop</div>
      <div class="row" id="guard-row" hidden>
        <span class="note bad" id="guard-msg"></span>
        <button class="btn small" id="retry">&#8635; retry</button>
        <button class="btn small" id="keep">keep anyway</button>
      </div>
    </div>

    <div class="panel">
      <h2>current source</h2>
      <div class="note" id="source-info">no source yet — record a take or import one on the share screen</div>
      <div class="row">
        <button class="btn small" id="audition" disabled>&#9654; play</button>
        <span class="chip" id="source-dur"></span>
      </div>
    </div>
  `

  const $ = (id) => el.querySelector('#' + id)
  const armBtn = $('arm'), micState = $('mic-state'), tooHot = $('too-hot')
  const devSel = $('devices'), vuBar = $('vu-bar'), monBtn = $('monitor')
  const micErr = $('mic-error'), recBtn = $('rec'), recNote = $('rec-note')
  const guardRow = $('guard-row'), guardMsg = $('guard-msg')

  let monitorOn = false
  let auditionHandle = null

  function refreshMicUi() {
    const mic = store.mic
    micState.textContent = 'mic: ' + (mic?.state ?? 'not asked')
    micState.className = 'chip' + (mic?.armed ? ' ok' : mic?.state === 'denied' ? ' bad' : '')
    armBtn.classList.toggle('toggled', !!mic?.armed)
    armBtn.innerHTML = mic?.armed ? '&#9210; disarm' : '&#9210; arm'
    micErr.hidden = !mic?.micErrorMessage
    micErr.textContent = mic?.micErrorMessage || ''
    recBtn.classList.toggle('recording', !!mic?.recording)
    recBtn.innerHTML = mic?.recording ? '&#9632; stop' : '&#9679; rec'
  }

  async function refreshDevices() {
    if (!store.mic) return
    try {
      const devices = await store.mic.listDevices()
      const cur = devSel.value
      devSel.innerHTML = '<option value="">default input</option>' +
        devices.map((d) => `<option value="${d.deviceId}">${d.label}</option>`).join('')
      devSel.value = store.mic.deviceId || cur || ''
    } catch { /* enumeration can fail pre-permission; labels arrive after arming */ }
  }

  async function arm() {
    const ctx = store.audio()
    store.mic.onUpdate = refreshMicUi
    try {
      await store.mic.arm(devSel.value || undefined)
      await requestPersistence()
      await refreshDevices()
      startMeter()
      await keepAwake()
    } catch { /* sentence already surfaced via micErrorMessage */ }
    refreshMicUi()
    updateClockChip(ctx)
  }

  function disarm() {
    store.mic?.disarm()
    stopMeter()
    releaseWake()
    vuBar.style.width = '0%'
    tooHot.hidden = true
    refreshMicUi()
  }

  function startMeter() {
    stopMeter()
    meterTimer = setInterval(() => {
      if (!store.mic?.armed) return
      const { peak, tooHot: hot } = store.mic.meter()
      vuBar.style.width = Math.min(100, Math.round(peak * 130)) + '%'
      tooHot.hidden = !hot
    }, 60)
  }
  function stopMeter() { if (meterTimer) { clearInterval(meterTimer); meterTimer = null } }

  async function keepAwake() {
    try { wakeLock = await navigator.wakeLock?.request('screen') } catch { /* optional */ }
  }
  function releaseWake() { wakeLock?.release().catch(() => {}); wakeLock = null }

  armBtn.addEventListener('click', () => (store.mic?.armed ? disarm() : arm()))
  devSel.addEventListener('change', () => { if (store.mic?.armed) arm() })
  monBtn.addEventListener('click', () => {
    monitorOn = !monitorOn
    store.mic?.setMonitor(monitorOn)
    monBtn.textContent = 'monitor: ' + (monitorOn ? 'ON (headphones!)' : 'off')
    monBtn.classList.toggle('toggled', monitorOn)
  })

  recBtn.addEventListener('click', async () => {
    const ctx = store.audio()
    guardRow.hidden = true
    if (store.mic?.recording) {
      const take = store.mic.stopRecording()
      refreshMicUi()
      if (!take || !take.channels[0]?.length) return
      handleTake(take)
      return
    }
    try {
      // arm-on-demand: pressing rec without arming first still works
      if (!store.mic?.armed) await arm()
      if (!store.mic?.armed) return
      await store.mic.startRecording()
      recNote.textContent = 'recording… press again to stop'
    } catch (err) {
      micErr.hidden = false
      micErr.textContent = errorSentence(err)
    }
    refreshMicUi()
    updateClockChip(ctx)
  })

  async function handleTake(take) {
    if (isSilentTake(take.channels)) {
      pendingTake = take
      guardMsg.textContent = 'that take was silent — check the input device'
      guardRow.hidden = false
      recNote.textContent = 'press to record — free length, press again to stop'
      return
    }
    await storeTake(take)
  }

  $('retry').addEventListener('click', () => { pendingTake = null; guardRow.hidden = true; recBtn.click() })
  $('keep').addEventListener('click', async () => {
    if (pendingTake) await storeTake(pendingTake, { trimmed: false })
    pendingTake = null
    guardRow.hidden = true
  })

  async function storeTake(take, { trimmed = true } = {}) {
    const channels = trimmed ? autoTrim(take.channels, take.sampleRate) : take.channels
    const blob = encodeWav(channels, take.sampleRate)
    const name = await nextName('field-take')
    const rec = await putAsset({
      blob, name, tags: ['field', 'sample'], by: 'human',
      dur: channels[0].length / take.sampleRate, sr: take.sampleRate, ch: channels.length,
    })
    const buffer = await decodeAsset(rec, store.audio())
    store.setSource(rec, buffer)
    // fresh source starts sliced: the CHOP default grid-8, auto-mapped to the pads
    store.chop.slices = autoSliceGrid(buffer.duration, 8)
    store.chop.pads = autoMapPads(store.chop.slices)
    store.touchChop()
    recNote.textContent = `saved ${rec.name} — ${fmtDur(rec.dur)} · sliced grid-8, head to cut`
    refreshSource()
  }

  function refreshSource() {
    const info = $('source-info'), dur = $('source-dur'), btn = $('audition')
    if (!store.sourceAsset) {
      info.textContent = 'no source yet — record a take or import one on the share screen'
      dur.textContent = ''
      btn.disabled = true
      return
    }
    info.textContent = `${store.sourceAsset.name} · ${(store.sourceAsset.tags || []).join(', ')}`
    dur.textContent = fmtDur(store.sourceAsset.dur)
    btn.disabled = false
  }

  $('audition').addEventListener('click', () => {
    const ctx = store.audio()
    if (auditionHandle) { auditionHandle.stop(); auditionHandle = null; $('audition').innerHTML = '&#9654; play'; return }
    if (!store.sourceBuffer) return
    const src = new AudioBufferSourceNode(ctx, { buffer: store.sourceBuffer })
    src.connect(ctx.destination)
    src.start()
    auditionHandle = { stop: () => { try { src.stop() } catch {} } }
    $('audition').innerHTML = '&#9632; stop'
    src.onended = () => { auditionHandle = null; $('audition').innerHTML = '&#9654; play' }
  })

  store.on('source-changed', refreshSource)
  refreshSource()
  refreshMicUi()

  return {
    show() { if (store.mic?.armed) startMeter() },
    hide() { stopMeter() },
  }
}

function updateClockChip(ctx) {
  const chip = document.getElementById('clock-state')
  if (chip && ctx) chip.textContent = `clock: ${ctx.state} @ ${ctx.sampleRate / 1000}k`
}

export function fmtDur(sec) {
  if (sec == null) return ''
  return sec >= 10 ? sec.toFixed(1) + 's' : sec.toFixed(2) + 's'
}
