// CHOP engine — schema-conformant playback and offline render of a chop cfg.
// The authoritative reference is reference/schema-chop.md in sound-flow-vibe:
// playbackRate = 2^(pitch/12); attack clamps to half the played length; release ends
// exactly at the slice's natural end; a later event whose slice shares a choke group
// truncates an earlier one at its t with a 5 ms anti-click fade; duration law:
//   duration = max over events of (t + sliceLen/2^(pitch/12)) + tailSec

export const CHOP_DEFAULTS = { seed: 47, tailSec: 0.5 }

export function sliceDefaults(s) {
  return {
    gain: 1, pitch: 0, reverse: false, attack: 0.003, release: 0.05,
    ...s,
  }
}

function clampWindow(slice, sourceDur) {
  const start = Math.max(0, Math.min(slice.start, sourceDur))
  const end = Math.max(start, Math.min(slice.end, sourceDur))
  return { start, end }
}

export function sliceWallLen(slice, sourceDur) {
  const s = sliceDefaults(slice)
  const { start, end } = clampWindow(s, sourceDur ?? Infinity)
  return (end - start) / Math.pow(2, s.pitch / 12)
}

export function chopDuration(cfg, sourceDur) {
  const tail = cfg.tailSec ?? CHOP_DEFAULTS.tailSec
  const byId = new Map((cfg.slices || []).map((s) => [s.id, s]))
  let max = 0
  for (const ev of cfg.performance || []) {
    const slice = byId.get(cfg.pads?.[ev.pad])
    if (!slice) continue
    max = Math.max(max, ev.t + sliceWallLen(slice, sourceDur))
  }
  return max + tail
}

// ---- window buffers (cached per slice geometry, reversed variants included) ----

const winCache = new Map() // key -> AudioBuffer

function windowKey(srcBuf, s) {
  return `${srcBuf.length}:${srcBuf.sampleRate}:${s.start}:${s.end}:${s.reverse ? 1 : 0}`
}

function windowBuffer(srcBuf, slice) {
  const s = sliceDefaults(slice)
  const key = windowKey(srcBuf, s)
  if (winCache.has(key)) return winCache.get(key)
  const { start, end } = clampWindow(s, srcBuf.duration)
  const sr = srcBuf.sampleRate
  const i0 = Math.floor(start * sr)
  const i1 = Math.min(srcBuf.length, Math.ceil(end * sr))
  const len = Math.max(1, i1 - i0)
  const out = new AudioBuffer({ length: len, numberOfChannels: srcBuf.numberOfChannels, sampleRate: sr })
  for (let c = 0; c < srcBuf.numberOfChannels; c++) {
    const src = srcBuf.getChannelData(c)
    const dst = out.getChannelData(c)
    if (s.reverse) {
      for (let i = 0; i < len; i++) dst[i] = src[i1 - 1 - i]
    } else {
      dst.set(src.subarray(i0, i1))
    }
  }
  winCache.set(key, out)
  return out
}

export function clearWindowCache() { winCache.clear() }

// ---- scheduling ----

/**
 * Schedule one slice hit into ctx at absolute time when (audio-clock seconds).
 * effectiveEnd (optional, absolute) truncates with the 5 ms choke fade.
 * Returns { stop(atTime) } for live cut-off.
 */
export function scheduleHit(ctx, dest, srcBuf, slice, velocity, when, effectiveEnd) {
  const s = sliceDefaults(slice)
  const { start, end } = clampWindow(s, srcBuf.duration)
  const winLen = end - start
  if (winLen <= 0) return null
  const rate = Math.pow(2, s.pitch / 12)
  const wallLen = winLen / rate
  const lvl = Math.max(0, Math.min(1, velocity)) * s.gain

  const src = new AudioBufferSourceNode(ctx, { buffer: windowBuffer(srcBuf, s), playbackRate: rate })
  const env = new GainNode(ctx, { gain: 0 })
  src.connect(env).connect(dest)

  const atk = Math.min(s.attack, wallLen / 2)
  const rel = Math.min(s.release, wallLen)
  const tEnd = when + wallLen

  env.gain.setValueAtTime(0, when)
  env.gain.linearRampToValueAtTime(lvl, when + atk)
  // linear fade-out ending exactly at the natural end
  env.gain.setValueAtTime(lvl, Math.max(when + atk, tEnd - rel))
  env.gain.linearRampToValueAtTime(0, tEnd)

  let stopAt = tEnd + 0.01
  if (effectiveEnd !== undefined && effectiveEnd < tEnd) {
    // choke: 5 ms anti-click fade at the truncation point
    const lvlAt = envLevelAt(effectiveEnd - when, lvl, atk, rel, wallLen)
    env.gain.cancelScheduledValues(effectiveEnd)
    env.gain.setValueAtTime(lvlAt, effectiveEnd)
    env.gain.linearRampToValueAtTime(0, effectiveEnd + 0.005)
    stopAt = effectiveEnd + 0.006
  }
  src.start(when)
  src.stop(stopAt)
  return {
    node: src,
    stop(at) {
      const t = Math.max(ctx.currentTime, at ?? ctx.currentTime)
      const lvlAt = envLevelAt(t - when, lvl, atk, rel, wallLen)
      env.gain.cancelScheduledValues(t)
      env.gain.setValueAtTime(lvlAt, t)
      env.gain.linearRampToValueAtTime(0, t + 0.005)
      try { src.stop(t + 0.006) } catch { /* already stopped */ }
    },
  }
}

function envLevelAt(dt, lvl, atk, rel, wallLen) {
  if (dt <= 0) return 0
  if (dt >= wallLen) return 0
  if (dt < atk) return lvl * (dt / atk)
  const relStart = Math.max(atk, wallLen - rel)
  if (dt > relStart) return lvl * (1 - (dt - relStart) / (wallLen - relStart))
  return lvl
}

/** Precompute per-event effective ends from choke groups (later event truncates earlier). */
export function chokeEnds(cfg, sourceDur) {
  const byId = new Map((cfg.slices || []).map((s) => [s.id, sliceDefaults(s)]))
  const evs = (cfg.performance || [])
    .map((ev, i) => ({ ...ev, i, slice: byId.get(cfg.pads?.[ev.pad]) }))
    .filter((e) => e.slice)
    .sort((a, b) => a.t - b.t || a.i - b.i)
  const ends = new Map() // event index -> absolute-relative effective end (from t0)
  for (let a = 0; a < evs.length; a++) {
    const ea = evs[a]
    if (ea.slice.choke === undefined) continue
    for (let b = a + 1; b < evs.length; b++) {
      const eb = evs[b]
      if (eb.t <= ea.t) continue
      if (eb.slice.choke === ea.slice.choke) {
        ends.set(ea.i, eb.t)
        break
      }
    }
  }
  return ends
}

/** Schedule a whole performance at t0 (absolute ctx time). Returns handles + duration. */
export function scheduleChop(ctx, dest, cfg, srcBuf, t0) {
  const byId = new Map((cfg.slices || []).map((s) => [s.id, s]))
  const ends = chokeEnds(cfg, srcBuf.duration)
  const handles = []
  ;(cfg.performance || []).forEach((ev, i) => {
    const slice = byId.get(cfg.pads?.[ev.pad])
    if (!slice) return
    const effEnd = ends.has(i) ? t0 + ends.get(i) : undefined
    const h = scheduleHit(ctx, dest, srcBuf, slice, ev.v ?? 1, t0 + ev.t, effEnd)
    if (h) handles.push(h)
  })
  return { handles, duration: chopDuration(cfg, srcBuf.duration) }
}

/** Offline render of the performance to an AudioBuffer. */
export async function renderChop(cfg, srcBuf) {
  const dur = Math.max(0.05, chopDuration(cfg, srcBuf.duration))
  const sr = srcBuf.sampleRate
  const octx = new OfflineAudioContext(srcBuf.numberOfChannels, Math.ceil(dur * sr), sr)
  scheduleChop(octx, octx.destination, cfg, srcBuf, 0)
  return octx.startRendering()
}

// ---- auto-slice ----

export function autoSliceGrid(sourceDur, n) {
  const slices = []
  for (let i = 0; i < n; i++) {
    slices.push(sliceDefaults({
      id: `s${i + 1}`,
      start: round3((sourceDur * i) / n),
      end: round3((sourceDur * (i + 1)) / n),
    }))
  }
  return slices
}

/** Split on silence: regions under threshold dBFS for at least holdMs become boundaries. */
export function autoSliceSilence(srcBuf, { thresholdDb = -40, holdMs = 80, minSliceMs = 60 } = {}) {
  const thr = Math.pow(10, thresholdDb / 20)
  const sr = srcBuf.sampleRate
  const hold = Math.round((holdMs / 1000) * sr)
  const data = srcBuf.getChannelData(0)
  const bounds = [0]
  let silentRun = 0
  let inSilence = false
  for (let i = 0; i < data.length; i++) {
    if (Math.abs(data[i]) < thr) {
      silentRun++
      if (!inSilence && silentRun >= hold) inSilence = true
    } else {
      if (inSilence) {
        const cut = i / sr
        if (cut - bounds[bounds.length - 1] >= minSliceMs / 1000) bounds.push(round3(cut))
      }
      silentRun = 0
      inSilence = false
    }
  }
  if (srcBuf.duration - bounds[bounds.length - 1] < minSliceMs / 1000 && bounds.length > 1) bounds.pop()
  bounds.push(round3(srcBuf.duration))
  const slices = []
  for (let i = 0; i < bounds.length - 1; i++) {
    slices.push(sliceDefaults({ id: `s${i + 1}`, start: bounds[i], end: bounds[i + 1] }))
  }
  return slices
}

/** Auto-map the first 16 slices to pads 1–16. */
export function autoMapPads(slices) {
  const pads = {}
  slices.slice(0, 16).forEach((s, i) => { pads[String(i + 1)] = s.id })
  return pads
}

export function round3(x) { return Math.round(x * 1000) / 1000 }
