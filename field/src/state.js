// App state — one AudioContext, one chop cfg, one loom cfg, an event bus.
// Configs persist to localStorage; audio persists to the IndexedDB library.

import { CHOP_DEFAULTS } from './engine/chop.js'
import { LOOM_DEFAULTS } from './engine/loom.js'
import { Mic } from './lib/mic.js'

const LS_KEY = 'field-state-v1'

function freshChop() {
  return {
    seed: CHOP_DEFAULTS.seed,
    source: null,          // { ref: 'hash:…' } once a take exists
    slices: [],
    pads: {},
    performance: [],
    tailSec: CHOP_DEFAULTS.tailSec,
  }
}

function freshLoom() {
  return {
    seed: LOOM_DEFAULTS.seed,
    bpm: LOOM_DEFAULTS.bpm,
    beatsPerBar: LOOM_DEFAULTS.beatsPerBar,
    bars: 4,
    loops: LOOM_DEFAULTS.loops,
    slots: [],             // { id, ref, level, pan, muted, halfSpeed }
    tailSec: LOOM_DEFAULTS.tailSec,
  }
}

class Store extends EventTarget {
  constructor() {
    super()
    this.ctx = null
    this.mic = null
    this.chop = freshChop()
    this.loom = freshLoom()
    this.sourceBuffer = null   // decoded AudioBuffer of chop.source
    this.sourceAsset = null    // library record of chop.source
    this.selectedSliceId = null
    this.load()
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })) }
  on(type, fn) { this.addEventListener(type, fn) }

  /** Audio clock lives behind a user gesture (iOS). Call from any pointer handler. */
  audio() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' })
      this.mic = new Mic(this.ctx)
      this.emit('audio-ready')
    }
    if (this.ctx.state === 'suspended') this.ctx.resume()
    return this.ctx
  }

  setSource(asset, buffer, { keepSlices = false } = {}) {
    this.sourceAsset = asset
    this.sourceBuffer = buffer
    this.chop.source = { ref: `hash:${asset.hash}` }
    if (!keepSlices) {
      this.chop.slices = []
      this.chop.pads = {}
      this.chop.performance = []
      this.selectedSliceId = null
    }
    this.save()
    this.emit('source-changed')
  }

  touchChop() { this.save(); this.emit('chop-changed') }
  touchLoom() { this.save(); this.emit('loom-changed') }

  save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ chop: this.chop, loom: this.loom }))
    } catch { /* private mode etc — non-fatal */ }
  }

  load() {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (!raw) return
      const data = JSON.parse(raw)
      if (data.chop) this.chop = { ...freshChop(), ...data.chop }
      if (data.loom) this.loom = { ...freshLoom(), ...data.loom }
    } catch { /* corrupt state falls back to fresh */ }
  }

  resetChop() {
    this.chop = freshChop()
    this.sourceAsset = null
    this.sourceBuffer = null
    this.selectedSliceId = null
    this.save()
    this.emit('source-changed')
  }
}

export const store = new Store()
