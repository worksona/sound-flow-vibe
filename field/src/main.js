// FIELD — Sound Flow's mobile capture studio.
// capture → cut → play → share, all speaking the CHOP/LOOM config law.

import './style.css'
import { store } from './state.js'
import { initCapture } from './ui/capture.js'
import { initCut } from './ui/cut.js'
import { initPlay } from './ui/play.js'
import { initShare } from './ui/share.js'
import { resolveRef, decodeAsset } from './lib/library.js'

const screens = {
  capture: initCapture(document.getElementById('screen-capture')),
  cut: initCut(document.getElementById('screen-cut')),
  play: initPlay(document.getElementById('screen-play')),
  share: initShare(document.getElementById('screen-share')),
}

let active = 'capture'

function showTab(name) {
  if (!(name in screens)) return
  screens[active]?.hide?.()
  document.getElementById('screen-' + active).hidden = true
  document.querySelector(`.tab[data-tab="${active}"]`)?.classList.remove('active')
  active = name
  document.getElementById('screen-' + active).hidden = false
  document.querySelector(`.tab[data-tab="${active}"]`)?.classList.add('active')
  screens[active]?.show?.()
}

for (const btn of document.querySelectorAll('.tab')) {
  btn.addEventListener('click', () => showTab(btn.dataset.tab))
}

// restore the persisted chop source from the library on boot
async function restoreSource() {
  const ref = store.chop.source?.ref
  if (!ref) return
  const matches = await resolveRef(ref).catch(() => [])
  if (!matches.length) return
  // decode lazily on the first gesture — the AudioContext can't exist yet
  const once = async () => {
    document.removeEventListener('pointerdown', once)
    const ctx = store.audio()
    try {
      const buf = await decodeAsset(matches[0], ctx)
      store.sourceAsset = matches[0]
      store.sourceBuffer = buf
      store.emit('source-changed')
    } catch { /* asset unreadable — user records fresh */ }
  }
  document.addEventListener('pointerdown', once)
}
restoreSource()

// PWA shell
if ('serviceWorker' in navigator && !location.hostname.match(/^(localhost|127\.)/)) {
  navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => {})
}
