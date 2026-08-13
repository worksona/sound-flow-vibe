// WAV encode (16-bit PCM) / metadata-free decode via the audio stack.
// Assets are stored as WAV blobs: directly exportable, hash-stable, decodable anywhere.

export function encodeWav(channels, sampleRate) {
  const ch = channels.length
  const frames = channels[0].length
  const bytesPerSample = 2
  const blockAlign = ch * bytesPerSample
  const dataSize = frames * blockAlign
  const buf = new ArrayBuffer(44 + dataSize)
  const dv = new DataView(buf)
  const wstr = (off, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)) }

  wstr(0, 'RIFF'); dv.setUint32(4, 36 + dataSize, true); wstr(8, 'WAVE')
  wstr(12, 'fmt '); dv.setUint32(16, 16, true)
  dv.setUint16(20, 1, true)                 // PCM
  dv.setUint16(22, ch, true)
  dv.setUint32(24, sampleRate, true)
  dv.setUint32(28, sampleRate * blockAlign, true)
  dv.setUint16(32, blockAlign, true)
  dv.setUint16(34, 16, true)
  wstr(36, 'data'); dv.setUint32(40, dataSize, true)

  let off = 44
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < ch; c++) {
      const x = Math.max(-1, Math.min(1, channels[c][f]))
      dv.setInt16(off, x < 0 ? x * 0x8000 : x * 0x7fff, true)
      off += 2
    }
  }
  return new Blob([buf], { type: 'audio/wav' })
}

export function bufferToWav(audioBuffer) {
  const channels = []
  for (let c = 0; c < audioBuffer.numberOfChannels; c++)
    channels.push(audioBuffer.getChannelData(c))
  return encodeWav(channels, audioBuffer.sampleRate)
}
