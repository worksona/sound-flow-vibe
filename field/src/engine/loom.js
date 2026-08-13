// LOOM engine — the loop station's timing model, per reference/schema-loom.md:
//   loopDur = bars × beatsPerBar × 60/bpm
//   render  = loops × loopDur + tailSec
// Every unmuted slot tiles its clip across the window on an exact multiplication grid
// (tile n starts at exactly n × wallLen — never accumulated), every tile edge carries
// an 8 ms fade in/out (clamped to half the tile) so the envelope is 0 at every seam.
// halfSpeed = playbackRate 0.5 (octave down, twice the wall length). Master gain 0.9.
// Live play loops ONE offline-rendered window on a single AudioBufferSourceNode with
// loop=true — the audio thread wraps the buffer, no JS runs at the seam.
// The window is rounded UP to a whole sample (Math.ceil(loopDur × sr)).
// v1 of this engine builds the dry graph only (no cfg.space sends) — a config without
// sends builds the exact v1.0 node graph, which is all FIELD authors.

export const LOOM_DEFAULTS = { seed: 47, bpm: 86, beatsPerBar: 4, bars: 8, loops: 2, tailSec: 0.25 }

const EDGE_FADE = 0.008
const MASTER = 0.9

export function loomLoopDur(cfg) {
  const c = { ...LOOM_DEFAULTS, ...cfg }
  return (c.bars * c.beatsPerBar * 60) / c.bpm
}

export function loomDuration(cfg) {
  const c = { ...LOOM_DEFAULTS, ...cfg }
  return c.loops * loomLoopDur(c) + c.tailSec
}

function slotDefaults(slot) {
  return { level: 1, pan: 0, muted: false, halfSpeed: false, ...slot }
}

/**
 * Offline-render one loop window of the composite.
 * buffersBySlotId: Map(slot.id -> AudioBuffer). Unresolved slots are silent, never fatal.
 */
export async function renderLoomWindow(cfg, buffersBySlotId, sampleRate = 44100) {
  const loopDur = loomLoopDur(cfg)
  const frames = Math.ceil(loopDur * sampleRate)
  const octx = new OfflineAudioContext(2, frames, sampleRate)
  const master = new GainNode(octx, { gain: MASTER })
  master.connect(octx.destination)

  for (const rawSlot of cfg.slots || []) {
    const slot = slotDefaults(rawSlot)
    if (slot.muted) continue
    const clip = buffersBySlotId.get(slot.id)
    if (!clip) continue

    const rate = slot.halfSpeed ? 0.5 : 1
    const wallLen = clip.duration / rate
    if (wallLen <= 0) continue

    const level = new GainNode(octx, { gain: slot.level })
    const pan = new StereoPannerNode(octx, { pan: slot.pan })
    level.connect(pan).connect(master)

    // exact multiplication grid: tile n starts at n × wallLen
    for (let n = 0; n * wallLen < loopDur; n++) {
      const t = n * wallLen
      const tileDur = Math.min(wallLen, loopDur - t)
      if (tileDur <= 0) break
      const fade = Math.min(EDGE_FADE, tileDur / 2)
      const src = new AudioBufferSourceNode(octx, { buffer: clip, playbackRate: rate })
      const env = new GainNode(octx, { gain: 0 })
      src.connect(env).connect(level)
      env.gain.setValueAtTime(0, t)
      env.gain.linearRampToValueAtTime(1, t + fade)
      env.gain.setValueAtTime(1, Math.max(t + fade, t + tileDur - fade))
      env.gain.linearRampToValueAtTime(0, t + tileDur)
      src.start(t, 0, tileDur * rate + 0.001)
    }
  }
  return octx.startRendering()
}

/** Full export: the rendered window repeated `loops` times + tailSec of silence. */
export async function renderLoomFull(cfg, buffersBySlotId, sampleRate = 44100) {
  const c = { ...LOOM_DEFAULTS, ...cfg }
  const windowBuf = await renderLoomWindow(c, buffersBySlotId, sampleRate)
  const loopDur = windowBuf.length / sampleRate
  const frames = Math.ceil((c.loops * loopDur + c.tailSec) * sampleRate)
  const octx = new OfflineAudioContext(2, frames, sampleRate)
  for (let n = 0; n < c.loops; n++) {
    const src = new AudioBufferSourceNode(octx, { buffer: windowBuf })
    src.connect(octx.destination)
    src.start(n * loopDur)
  }
  return octx.startRendering()
}

/**
 * Live transport: loop the rendered window on one looping source.
 * What loops live is exactly what exports.
 */
export function playLoomWindow(ctx, windowBuf, dest = ctx.destination) {
  const src = new AudioBufferSourceNode(ctx, { buffer: windowBuf, loop: true })
  src.connect(dest)
  src.start()
  return {
    stop() {
      try { src.stop() } catch { /* already stopped */ }
      src.disconnect()
    },
  }
}
