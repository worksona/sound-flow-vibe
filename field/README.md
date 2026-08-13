# FIELD — Sound Flow's mobile capture studio

Sample it where you hear it. FIELD is the capture front-end of the Sound Flow
family: a mobile-first PWA that records raw takes, slices them CHOP-style,
plays them on a 16-pad bank, loops them through a LOOM window, and shares the
result — as a WAV through the native share sheet, or as an `#sfa=` link that
opens straight in the desktop studios.

**It speaks the config law.** FIELD's kit is a CHOP config; its loop rack is a
LOOM config. Both share as standard v1 envelopes through the spec 8.1 codec
(`base64url(raw-deflate(minified JSON))`, mutually decodable with the app
repo's `codec.mjs` and sound-flow-vibe's `encode.py` — verified both ways).
Clip refs, the library convention (`hash:` pinning, `name:` globs, `tag:`
matching, name-asc + freshest-`at` resolution), and the engines' timing laws
all follow the authoritative schema docs in
`../sound-flow-vibe/skills/sound-flow-vibe/reference/`. This is a clean-room
second implementation: where the schema speaks, it wins.

## The four screens

| screen | what it does |
|---|---|
| **CAPTURE** | the arm panel — RAW capture (echo cancellation / noise suppression / AGC all off), device picker, live VU, too-hot badge (peak ≥ −1 dBFS), monitor toggle (default off — feedback risk), free-length ⏺ off a lossless AudioWorklet tap, −45 dBFS auto-trim, −50 dBFS silence guard ("that take was silent — check the input device"), screen wake-lock while armed |
| **CUT** | the CHOP waveform editor, touch-first — draggable slice delimiters with fat lugs (30 ms minimum), double-tap split, merge at a selected cut, pinch zoom 1×–32×, pan strip, auto-slice (grid-4/8/16, on-silence) as one undoable action, per-slice gain / pitch / reverse / attack / release / choke / pad |
| **PLAY** | the 16-pad bank (velocity by hit position; hardware keys `asdfghjk`/`erty`/`cvbn`), ⏺ performance capture off the **audio clock** (1 ms grid, optional 1/8–1/16 quantize applied at capture-stop), timeline lane, → library bounce; plus the LOOM loop rack — slots tile into a bars×bpm window with click-free 8 ms edge fades, live play loops one offline-rendered window (what loops live is exactly what exports) |
| **SHARE** | the library (content-hashed WAV assets in IndexedDB, persistence requested), WAV export via `navigator.share` files / download fallback, audio import, and `#sfa=` chop/loom links |

## Run

    npm install && npm run dev     # → http://localhost:5180 (use --host for a phone on your LAN)

The mic needs a secure context: `localhost` works; a phone on your LAN needs
https (or a tunnel). Build with `npm run build` — the output is static and
relative-based, deployable at any path.

## What travels where

Share **links** carry the arrangement (the config), never audio — that's the
design. The audio itself moves as WAV through the share sheet, and a take
referenced by `hash:` in a shared config resolves on any device whose library
holds that asset (import the WAV there and the pin matches by content).

## Status

Incubating inside the sound-flow repo as a self-contained app (own
`package.json`, no coupling to the marketplace) — built to be extracted to its
own repo unchanged. Not yet wired: substrate sync, the space bus (`slots[].send`
— configs FIELD authors are dry, which renders identically by the additive law),
and LOOM's count-in/overdub record path.
