// The asset library — Sound Flow's browser-side substrate: IndexedDB, content-hashed
// WAV blobs, clip-ref resolution per the studio convention:
//   hash:<64-hex>   exact asset by content hash
//   name:<pattern>  exact name or glob with *
//   tag:<value>     any asset whose tags[] contains value
// Multi-match sorts name ascending; same-name ties freshest-`at` first (RT-3).

const DB_NAME = 'field-library'
const STORE = 'assets'

let dbPromise = null

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE, { keyPath: 'hash' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

function tx(mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode)
    const out = fn(t.objectStore(STORE))
    t.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : out)
    t.onerror = () => reject(t.error)
  }))
}

export async function sha256hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Store a WAV blob as an asset. Returns the full record (existing one on hash collision). */
export async function putAsset({ blob, name, tags = [], by = 'human', dur, sr, ch }) {
  const hash = await sha256hex(await blob.arrayBuffer())
  const existing = await getAsset(hash)
  if (existing) return existing
  const rec = { hash, name, tags, by, at: new Date().toISOString(), dur, sr, ch, blob }
  await tx('readwrite', (s) => s.put(rec))
  return rec
}

export async function getAsset(hash) {
  return tx('readonly', (s) => s.get(hash))
}

export async function listAssets() {
  const all = await tx('readonly', (s) => s.getAll())
  return all.sort((a, b) => (a.at < b.at ? 1 : -1)) // newest first for browsing
}

export async function deleteAsset(hash) {
  return tx('readwrite', (s) => s.delete(hash))
}

export async function renameAsset(hash, name, tags) {
  const rec = await getAsset(hash)
  if (!rec) return null
  if (name !== undefined) rec.name = name
  if (tags !== undefined) rec.tags = tags
  await tx('readwrite', (s) => s.put(rec))
  return rec
}

function globToRegExp(pattern) {
  const esc = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp('^' + esc + '$')
}

/** Resolve a clip ref to matching asset records (spec resolution order). */
export async function resolveRef(ref) {
  const all = await tx('readonly', (s) => s.getAll())
  let matches = []
  if (ref.startsWith('hash:')) {
    matches = all.filter((a) => a.hash === ref.slice(5))
  } else if (ref.startsWith('name:')) {
    const pat = ref.slice(5)
    if (pat.includes('*')) {
      const re = globToRegExp(pat)
      matches = all.filter((a) => re.test(a.name))
    } else {
      matches = all.filter((a) => a.name === pat)
    }
  } else if (ref.startsWith('tag:')) {
    const tag = ref.slice(4)
    matches = all.filter((a) => (a.tags || []).includes(tag))
  }
  // name ascending; same-name ties freshest-at first (RT-3)
  matches.sort((a, b) => a.name === b.name ? (a.at < b.at ? 1 : -1) : (a.name < b.name ? -1 : 1))
  return matches
}

/** Resolve a ref to one decoded AudioBuffer (first match), or null. */
export async function resolveRefToBuffer(ref, ctx) {
  const matches = await resolveRef(ref)
  if (!matches.length) return null
  return decodeAsset(matches[0], ctx)
}

const bufferCache = new Map() // hash -> AudioBuffer

export async function decodeAsset(rec, ctx) {
  if (bufferCache.has(rec.hash)) return bufferCache.get(rec.hash)
  const buf = await ctx.decodeAudioData(await rec.blob.arrayBuffer())
  bufferCache.set(rec.hash, buf)
  return buf
}

/** Next free numeric suffix for a name family, e.g. nextName('field-take') -> 'field-take-3'. */
export async function nextName(prefix) {
  const all = await tx('readonly', (s) => s.getAll())
  let max = 0
  const re = new RegExp('^' + prefix + '-(\\d+)$')
  for (const a of all) {
    const m = re.exec(a.name)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `${prefix}-${max + 1}`
}

/** Ask the browser to persist IndexedDB so phones don't evict takes. */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist()
  } catch { /* not fatal */ }
  return false
}
