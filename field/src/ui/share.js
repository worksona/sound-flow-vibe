// SHARE — the library, WAV export via the native share sheet, and #sfa= links.
// Share URLs carry the ARRANGEMENT (the config), never audio: a chop/loom link opens
// in the desktop studio, which resolves the clip refs against its own library.
// Audio itself travels as WAV through the share sheet or a download.

import { store } from '../state.js'
import { listAssets, deleteAsset, renameAsset, putAsset, decodeAsset, nextName } from '../lib/library.js'
import { shareUrl } from '../lib/codec.js'
import { bufferToWav } from '../lib/wav.js'
import { fmtDur } from './capture.js'
import { autoSliceGrid, autoMapPads } from '../engine/chop.js'

export function initShare(el) {
  el.innerHTML = `
    <div class="panel">
      <h2>share the arrangement</h2>
      <div class="row">
        <button class="btn" id="link-chop">&#128279; chop link</button>
        <button class="btn" id="link-loom">&#128279; loom link</button>
      </div>
      <div class="note">links open in the desktop studios — they carry the config, not the audio; move the take itself as a WAV below</div>
      <div class="note ok" id="link-note" hidden></div>
    </div>

    <div class="panel">
      <h2>library</h2>
      <div class="row">
        <label class="btn small" style="display:inline-flex;align-items:center">
          import audio <input type="file" id="import" accept="audio/*" hidden>
        </label>
        <span class="chip" id="lib-count"></span>
      </div>
      <div id="assets"></div>
    </div>
  `

  const $ = (id) => el.querySelector('#' + id)
  let playHandle = null

  async function refresh() {
    const assets = await listAssets()
    $('lib-count').textContent = `${assets.length} asset${assets.length === 1 ? '' : 's'}`
    const box = $('assets')
    box.innerHTML = assets.length ? '' : '<div class="note">nothing yet — record a take on the capture screen</div>'
    for (const a of assets) {
      const row = document.createElement('div')
      row.className = 'asset'
      if (store.sourceAsset?.hash === a.hash) row.classList.add('selected')
      row.innerHTML = `
        <button class="btn small" data-a="play">&#9654;</button>
        <span class="a-name">${a.name}</span>
        <span class="a-meta">${fmtDur(a.dur)} · ${(a.tags || []).join(',')}</span>
        <button class="btn small" data-a="use" title="load as chop source">use</button>
        <button class="btn small" data-a="share" title="share WAV">&#8599;</button>
        <button class="btn small danger" data-a="del">&#10005;</button>
      `
      row.querySelector('[data-a="play"]').addEventListener('click', async (e) => {
        const ctx = store.audio()
        if (playHandle) { playHandle.stop(); playHandle = null; return }
        const buf = await decodeAsset(a, ctx)
        const src = new AudioBufferSourceNode(ctx, { buffer: buf })
        src.connect(ctx.destination)
        src.start()
        playHandle = { stop: () => { try { src.stop() } catch {} } }
        src.onended = () => { playHandle = null }
      })
      row.querySelector('[data-a="use"]').addEventListener('click', async () => {
        const ctx = store.audio()
        const buf = await decodeAsset(a, ctx)
        store.setSource(a, buf)
        store.chop.slices = autoSliceGrid(buf.duration, 8)
        store.chop.pads = autoMapPads(store.chop.slices)
        store.touchChop()
        refresh()
      })
      row.querySelector('[data-a="share"]').addEventListener('click', () => shareWav(a))
      row.querySelector('[data-a="del"]').addEventListener('click', async () => {
        if (!confirm(`delete ${a.name}? this cannot be undone`)) return
        await deleteAsset(a.hash)
        refresh()
      })
      row.querySelector('.a-name').addEventListener('click', async () => {
        const name = prompt('rename asset', a.name)
        if (name && name !== a.name) { await renameAsset(a.hash, name); refresh() }
      })
      box.appendChild(row)
    }
  }

  async function shareWav(asset) {
    const file = new File([asset.blob], asset.name + '.wav', { type: 'audio/wav' })
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: asset.name })
        return
      } catch (err) {
        if (err?.name === 'AbortError') return // user closed the sheet
      }
    }
    // fallback: download
    const url = URL.createObjectURL(asset.blob)
    const link = document.createElement('a')
    link.href = url
    link.download = asset.name + '.wav'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  $('import').addEventListener('change', async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const ctx = store.audio()
    try {
      const buf = await ctx.decodeAudioData(await file.arrayBuffer())
      // normalize to WAV so hashing and export are stable regardless of input codec
      const base = file.name.replace(/\.[^.]+$/, '') || await nextName('field-import')
      await putAsset({
        blob: bufferToWav(buf), name: base, tags: ['field', 'import'], by: 'human',
        dur: buf.duration, sr: buf.sampleRate, ch: buf.numberOfChannels,
      })
      refresh()
    } catch {
      alert('could not decode that file as audio')
    }
    e.target.value = ''
  })

  async function copyLink(studio) {
    const note = $('link-note')
    let cfg
    if (studio === 'chop') {
      if (!store.chop.source) { note.hidden = false; note.textContent = 'no chop config yet — record and slice first'; return }
      cfg = { ...store.chop }
    } else {
      if (!store.loom.slots.length) { note.hidden = false; note.textContent = 'no loom slots yet — add one on the play screen'; return }
      cfg = { ...store.loom }
    }
    const url = await shareUrl(studio, cfg)
    let copied = false
    try { await navigator.clipboard.writeText(url); copied = true } catch { /* clipboard may need permission */ }
    if (!copied && navigator.share) {
      try { await navigator.share({ url, title: `sound flow ${studio}` }); copied = true } catch { /* closed */ }
    }
    note.hidden = false
    note.textContent = copied ? `${studio} link copied — opens at sound-flow.netlify.app/${studio}/` : url
  }

  $('link-chop').addEventListener('click', () => copyLink('chop'))
  $('link-loom').addEventListener('click', () => copyLink('loom'))

  store.on('source-changed', refresh)
  refresh()

  return {
    show() { refresh() },
    hide() { playHandle?.stop(); playHandle = null },
  }
}
