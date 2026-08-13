// Sound Flow share codec (spec 8.1): config JSON <-> #sfa= code.
// Transform: base64url(raw-deflate(minified JSON)), '=' padding stripped.
// Mutually decodable with the app repo's codec.mjs and sound-flow-vibe's encode.py:
// deflate bytes may differ per zlib build, but decode(encode(x)) == x across all.

const STUDIO_BASE = 'https://sound-flow.netlify.app/{studio}/'

const te = new TextEncoder()
const td = new TextDecoder()

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream))
  return new Uint8Array(await out.arrayBuffer())
}

function toB64url(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(code) {
  const pad = '='.repeat((4 - (code.length % 4)) % 4)
  const s = atob(code.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const bytes = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i)
  return bytes
}

export async function encodeSfa(envelope) {
  const raw = te.encode(JSON.stringify(envelope))
  const packed = await pipe(raw, new CompressionStream('deflate-raw'))
  return toB64url(packed)
}

export async function decodeSfa(codeOrUrl) {
  let s = codeOrUrl
  if (s.includes('#sfa=')) s = s.split('#sfa=')[1]
  s = s.split('&')[0] // tolerate trailing hash params like &auto=render
  const raw = await pipe(fromB64url(s), new DecompressionStream('deflate-raw'))
  const env = JSON.parse(td.decode(raw))
  if (env?.v !== 1 || !env.studio || !env.cfg) throw new Error('not a v1 sfa envelope')
  return env
}

export async function shareUrl(studio, cfg) {
  const code = await encodeSfa({ v: 1, studio, cfg })
  return STUDIO_BASE.replace('{studio}', studio) + '#sfa=' + code
}
