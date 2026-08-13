// The arm panel's engine — the same strip CHOP/LOOM/VOX carry, mobile edition.
// Capture is RAW: echo cancellation, noise suppression and AGC all OFF — all three are
// voice-call processing that mangles music. Every failure surfaces as a written-out
// sentence (micErrorMessage), never a bare DOMException.

const TOO_HOT_LIN = Math.pow(10, -1 / 20)    // −1 dBFS
const SILENT_LIN = Math.pow(10, -50 / 20)    // −50 dBFS silence guard
const TRIM_LIN = Math.pow(10, -45 / 20)      // −45 dBFS auto-trim

const WORKLET_SRC = `
class FieldRecorder extends AudioWorkletProcessor {
  constructor() { super(); this.armed = true }
  process(inputs) {
    const input = inputs[0]
    if (input && input.length) {
      this.port.postMessage(input.map((c) => c.slice(0)))
    }
    return true
  }
}
registerProcessor('field-recorder', FieldRecorder)
`

export function errorSentence(err) {
  const name = err?.name || ''
  if (name === 'NotAllowedError') return 'the browser refused the microphone — check the site permission in your browser settings'
  if (name === 'NotFoundError') return 'no microphone was found on this device'
  if (name === 'NotReadableError') return 'the microphone is busy — another app may be holding it'
  if (name === 'OverconstrainedError') return 'that input device is gone — pick another from the list'
  if (name === 'SecurityError') return 'microphone needs a secure page (https or localhost)'
  return `the microphone failed: ${err?.message || err}`
}

export class Mic {
  constructor(ctx) {
    this.ctx = ctx
    this.stream = null
    this.sourceNode = null
    this.analyser = null
    this.monitorGain = null
    this.state = 'not asked' // not asked | armed | denied
    this.deviceId = null
    this.micErrorMessage = null
    this.recentPeaks = []    // [t, peak] pairs for the too-hot window
    this.workletReady = false
    this.recording = null    // { node, chunks: Float32Array[][], t0 }
    this.onUpdate = null
  }

  async arm(deviceId = this.deviceId) {
    this.disarm()
    this.micErrorMessage = null
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        },
      })
    } catch (err) {
      this.state = err?.name === 'NotAllowedError' ? 'denied' : this.state
      this.micErrorMessage = errorSentence(err)
      this.onUpdate?.()
      throw err
    }
    this.deviceId = this.stream.getAudioTracks()[0]?.getSettings?.().deviceId || deviceId
    this.state = 'armed'
    this.sourceNode = this.ctx.createMediaStreamSource(this.stream)
    // analyser-only tap for the VU — nothing routes to the speakers unless monitor is on
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 2048
    this.sourceNode.connect(this.analyser)
    this.monitorGain = this.ctx.createGain()
    this.monitorGain.gain.value = 0
    this.sourceNode.connect(this.monitorGain)
    this.monitorGain.connect(this.ctx.destination)
    this.onUpdate?.()
  }

  disarm() {
    if (this.recording) this.stopRecording()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.sourceNode?.disconnect()
    this.analyser?.disconnect()
    this.monitorGain?.disconnect()
    this.stream = this.sourceNode = this.analyser = this.monitorGain = null
    if (this.state === 'armed') this.state = 'not asked'
    this.onUpdate?.()
  }

  get armed() { return this.state === 'armed' && !!this.stream }

  setMonitor(on) {
    // default OFF — headphones only, feedback risk
    if (this.monitorGain) this.monitorGain.gain.value = on ? 1 : 0
  }

  async listDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices()
    let n = 0
    return devices.filter((d) => d.kind === 'audioinput').map((d) => ({
      deviceId: d.deviceId,
      label: d.label || `Microphone ${++n}`,
    }))
  }

  /** Current peak 0..1 off the analyser tap; also feeds the too-hot window. */
  meter() {
    if (!this.analyser) return { peak: 0, tooHot: false }
    const buf = new Float32Array(this.analyser.fftSize)
    this.analyser.getFloatTimeDomainData(buf)
    let peak = 0
    for (let i = 0; i < buf.length; i++) {
      const a = Math.abs(buf[i])
      if (a > peak) peak = a
    }
    const now = this.ctx.currentTime
    this.recentPeaks.push([now, peak])
    while (this.recentPeaks.length && this.recentPeaks[0][0] < now - 1) this.recentPeaks.shift()
    const tooHot = this.recentPeaks.some(([, p]) => p >= TOO_HOT_LIN)
    return { peak, tooHot }
  }

  async ensureWorklet() {
    if (this.workletReady) return
    const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }))
    await this.ctx.audioWorklet.addModule(url)
    URL.revokeObjectURL(url)
    this.workletReady = true
  }

  /** Free-length take: press to start. PCM lands lossless off the worklet. */
  async startRecording() {
    if (!this.armed) await this.arm()
    await this.ensureWorklet()
    const node = new AudioWorkletNode(this.ctx, 'field-recorder', { numberOfOutputs: 0 })
    const chunks = []
    node.port.onmessage = (e) => chunks.push(e.data)
    this.sourceNode.connect(node)
    this.recording = { node, chunks, t0: this.ctx.currentTime }
    this.onUpdate?.()
  }

  /** Press to stop. Returns { channels: Float32Array[], sampleRate } or null if silent. */
  stopRecording() {
    const rec = this.recording
    if (!rec) return null
    this.recording = null
    this.sourceNode?.disconnect(rec.node)
    rec.node.port.onmessage = null
    const nCh = rec.chunks[0]?.length || 1
    const total = rec.chunks.reduce((n, c) => n + (c[0]?.length || 0), 0)
    const channels = []
    for (let c = 0; c < nCh; c++) {
      const out = new Float32Array(total)
      let off = 0
      for (const chunk of rec.chunks) { out.set(chunk[c] || chunk[0], off); off += chunk[0].length }
      channels.push(out)
    }
    this.onUpdate?.()
    return { channels, sampleRate: this.ctx.sampleRate }
  }
}

/** Peak of a take, linear. */
export function takePeak(channels) {
  let peak = 0
  for (const ch of channels)
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i])
      if (a > peak) peak = a
    }
  return peak
}

export function isSilentTake(channels) {
  return takePeak(channels) < SILENT_LIN
}

/** Auto-trim leading/trailing silence at −45 dBFS, with a 10 ms guard margin. */
export function autoTrim(channels, sampleRate) {
  const n = channels[0].length
  let start = 0, end = n
  outer1: for (; start < n; start++) {
    for (const ch of channels) if (Math.abs(ch[start]) >= TRIM_LIN) break outer1
  }
  outer2: for (; end > start; end--) {
    for (const ch of channels) if (Math.abs(ch[end - 1]) >= TRIM_LIN) break outer2
  }
  const guard = Math.round(sampleRate * 0.01)
  start = Math.max(0, start - guard)
  end = Math.min(n, end + guard)
  if (end <= start) return channels
  return channels.map((ch) => ch.slice(start, end))
}
