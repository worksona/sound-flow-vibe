# LOOM — config schema v1 (authoritative)

One file, three consumers (INV-7): this document is the app's parameter reference, the
vibe skill's authoring vocabulary, and the property source for `scripts/verify.mjs`.
If the engine and this file disagree, this file wins until a spec delta says otherwise.

Envelope for sharing/registering: `{ "v": 1, "studio": "loom", "cfg": { … } }`.
Bare `cfg` objects are what you author; the codec and substrate wrap them.

LOOM is the **loop station**: 4–8 slots sharing one loop window. It is **sample-based**:
the config never carries audio, each slot carries a **clip ref**. The host — studio
page, CLI, or bridge — resolves every ref and injects `cfg.__buffers[ref]` before
rendering (spec §8.2); engines never fetch. Unresolved refs are **silent, never fatal**
(MIX precedent) — a rack with empty or not-yet-filled slots still renders the slots
that do resolve. `__buffers` is host plumbing — never author it, never share it.

Engine `1.1.0` closes the spec §10 "per-slot level/**fx-send**" phrase: optional
`slots[].send` into one shared **space bus** (`cfg.space`). Both are additive —
every pre-1.1 config and share URL renders byte-identically.

---

## Clip refs

| form | meaning |
|---|---|
| `hash:<64-hex>` | exact asset by content hash — pin a specific take |
| `name:<pattern>` | exact name, or glob with `*` (e.g. `name:loom-take-*`) |
| `tag:<value>` | any asset whose `tags[]` contains the value (e.g. `tag:take`) |

Resolution: app → `Library.list()` (IndexedDB); CLI → `Substrate.listAssets()`.
Multi-match sorts by name ascending, same-name ties **freshest-`at` first** (RT-3);
a slot takes one clip, so it uses the **first** match. Recorded takes are always pinned
by `hash:` so a take never silently swaps under you.

## Timing model

```
loopDur = bars × beatsPerBar × 60 / bpm        the shared loop window (seconds)
render  = loops × loopDur + tailSec            what Export / → Library produces
```

Every unmuted slot **tiles** its clip across each of the `loops` window repetitions:

- clip shorter than the window → it **repeats** inside the window (tile grid = the
  clip's wall length; the n-th tile starts at exactly `n × wallLen`);
- clip longer than the window → it **truncates** at `loopDur`;
- `halfSpeed: true` → `playbackRate 0.5` — an octave down, **twice the wall length**
  (the tiling grid uses the wall length, `clipDur / rate`);
- every tile edge — tile-to-tile, truncation, window boundary — carries an **8 ms
  fade in and out** (clamped to half the tile), so the envelope is exactly 0 at every
  seam: click-free by construction, no crossfade needed.

The engine consumes **no randomness** (INV-3): the composite is fully
config-determined. `duration()` is exact without `__buffers` — the window is pure
arithmetic. The composite runs through a fixed 0.9 master gain.

**Measured (v1.7 timing audit).** The tile grid is exact multiplication, not
accumulation: over 211 tiles per window at 137 bpm across two windows, every rendered
tile mark landed within **0.032 ms** (1.5 samples) of `window·loopDur + n·wallLen`, and
`k·wallLen` diverges from a naive `+=` accumulation by **0 ns**. halfSpeed marks land on
the wall grid to **0.021 ms**. The **live** loop is a single `AudioBufferSourceNode` with
`loop = true` — the audio thread wraps the buffer, no JS runs at the seam. Captured on
the audio thread through an AudioWorklet while the main thread burned 120 ms out of every
200 ms: **one** `start()` call for the whole run, inter-mark gaps `500.000 / 500.000 ms`
(min/max), **loop-seam error 0.000 ms**. The one non-exactness is that the live/bounced
window is rounded **up** to a whole sample (`Math.ceil(loopDur × 44100)`), so the sounding
window can be up to one sample long — 19.7 µs at the LOOM default (86 bpm, 8 bars), a
tempo error of **0.9 ppm**.

## The space bus (engine v1.1 — per-slot fx-send)

One **shared damped feedback-delay bus** (the MIX/TAPE `space` pattern), fed per slot
by `slots[].send` (0–1, default 0 = dry) tapped **post-level/pan**, shaped by the
optional top-level `space` object:

```
slot → level → pan ─┬─→ master (0.9) → out
                    └─ ×send → [ delay(time) → lowpass(damp) → ×feedback ─loop→ delay ]
                                          └─→ ×mix → gate → master
```

- The bus is built **only when some resolvable, unmuted slot has `send > 0`** — a
  config without sends builds the exact v1.0 node graph and renders byte-identically
  (additive law; every existing config and URL is unchanged).
- **Tail-gate discipline** (tape.mjs precedent): the feedback tap is gated to 0 at
  `renderEnd − 0.25 s` and the wet output ramps to hard zero by `renderEnd − 0.1 s`,
  so `tailSec` still bounds the ring-out and the final 100 ms are true zeros.
- **Live loop:** live playback loops an offline-rendered window, so the send bus is
  inside the rendered window by construction — the wet tail dies at each window end
  (gated) and restarts with the window. For longer audible tails in an export, raise
  `loops` and/or `tailSec`.

## Fields

| field | type | range / values | default | notes |
|---|---|---|---|---|
| `seed` | uint32 \| string | any | 47 **(mandatory)** | Engine convention (INV-3). LOOM v1 consumes no randomness — the seed names the take. |
| `bpm` | number | 40–220 | 86 | Sets the loop window with `bars`/`beatsPerBar`. |
| `beatsPerBar` | int | 1–12 | 4 | Count-in length and metronome grid. |
| `bars` | int | 1–64 | 8 | **Shared loop length** — every slot conforms to it. |
| `loops` | int | 1–64 | 2 | Times the composite window repeats in a render. Live play always loops one window; `loops` shapes the exported file. |
| `slots` | object[] | 0+ entries, unique ids | demo rack | The rack. Studio default is 6 slots. |
| `slots[].id` | string | unique per config | — | Convention: `"a"`, `"b"`, … Recorded overdubs take the next free letter. |
| `slots[].ref` | string | clip ref (above) | — (empty slot) | Optional — a slot with no `ref` is silent. |
| `slots[].level` | number | 0–1.5 | 1 | Per-slot gain (1.5 = +3.5 dB headroom for quiet takes). |
| `slots[].pan` | number | −1–1 | 0 | Stereo position. |
| `slots[].muted` | boolean | — | false | Slot stays in the config, drops out of the composite. |
| `slots[].halfSpeed` | boolean | — | false | `playbackRate 0.5`: octave down, twice the wall length. |
| `slots[].send` | number | 0–1 | 0 | Post-level/pan tap into the shared space bus (v1.1). 0 = dry (no bus node built). |
| `space` | object | optional, partial | — | Shared space-bus shape (v1.1) — per-field defaults below; omit entirely for the default room. |
| `space.time` | number (s) | 0.01–5 | 0.31 | Delay time of the bus. |
| `space.feedback` | number | 0–1 | 0.32 | Recirculation — gated to 0 near the window end so `tailSec` bounds the ring-out. |
| `space.damp` | number (Hz) | 40–20000 | 3000 | Lowpass in the feedback loop — each repeat gets darker. |
| `space.mix` | number | 0–1 | 1 | Wet level of the bus into the master (sends already scale per slot — leave at 1 unless taming the whole bus). |
| `tailSec` | number (s) | ≥ 0 | 0.25 | Silence appended after the last window (edge fades already end at 0 — the tail is breathing room; with sends it is also where the ring-out lives). |

**Duration law:** `duration = loops × (bars × beatsPerBar × 60/bpm) + tailSec` — exact,
never depends on `__buffers`.

## The record path (studio, RT-8)

The browser studio adds what no CLI can: **mic takes**, quantized to the loop.

1. **⏺** (per-slot, records into that slot) or **⏺ Overdub** (master, layers a NEW slot).
2. One-bar synthesized **count-in** (accented first beat). If the composite is playing,
   the count-in lands on the **next bar of the running loop** — you punch in where the
   music is, rather than waiting out the window. Metronome (◔, default on) clicks every
   beat of the take itself.
3. Capture starts **on that bar** and runs exactly one loop window. The mic stream
   (`getUserMedia`, echo-cancellation off) records via MediaRecorder; on stop the take
   is decoded and **quantized**: trimmed/padded to exactly `loopDur`, then written back
   at the **loop phase it was played at** (below).
4. The take lands in the Library as `loom-take-<n>` (`by: "human"`,
   `tags: ["loom", "take"]`) and the slot's ref is **pinned to its `hash:`**.
5. **Overdub is additive layering**: record while the composite plays; the new take
   becomes a new slot. Honest and simple — no destructive bounce, every layer stays
   individually leveled, muteable, and re-recordable.

### Punch-in phase — a bar is not the loop (v1.7.1, spec delta 1.10)

The count-in lands on the next **bar**, but a take is stored as one **window** and the
engine tiles it from window position 0. Punching in on bar 3 of a 4-bar window therefore
opens the capture window at loop phase 2 bars — and a take written straight to position 0
plays back **rotated by exactly that phase**. Measured in Chrome before the fix: capture
opened at phase `4.000 s` of an `8.000 s` window and replayed at `0.000 s` — a **4000 ms
rotation**, i.e. the overdub landed two bars early, every time, unless you happened to
punch in on the window boundary.

The studio now rotates the captured window back to its phase, so **the take sounds where
you played it**. Acceptance (two punch-ins on different bars against one periodic source,
the marker's position inside the stored take must not move): **3.3 ms** apart with the
rotation, **3996.7 ms** apart without it — the residual is the test source's own loop
drift, not the studio's. Free-running takes (transport stopped) are phase 0 by definition:
a solo take declares its own downbeat. The take-fit legend names the phase whenever it is
non-zero (`…, at loop phase 4.00s`).

### Take latency — the round trip is compensated (v1.7.1, spec delta 1.10)

You play in time with what you **hear**, and you are recorded through an input that is
itself behind. The click scheduled at audio-clock time `T` is audible at `T + outputLatency`;
your note reaches the stream at `T + outputLatency + inputLatency`. Slicing the take at `T`
therefore leaves everything you played sitting late by the whole round trip.

The studio reads the real numbers — `AudioContext.outputLatency` (falling back to
`baseLatency`) plus the input track's `getSettings().latency` — and shifts the slice by
their sum. On the measured host that is **18 ms out + 10 ms in = 28 ms**, about 1/25 of a
beat at 86 bpm: exactly the "my overdubs drag" feeling. The transport bar's **nudge** box
covers the residue no API exposes (MediaRecorder start-up, codec priming): positive pulls
the take **earlier**, negative pushes it later, ±200 ms, remembered per browser (it
describes *this machine's* audio path, never the music — it is deliberately **not** a
config field and never travels in a share URL). The chip beside it reports what the host
claims (`auto 28ms (out 18 + in 10)`), and the take-fit legend reports what was applied
(`…, −28ms latency`). Verified end to end: a `+100 ms` nudge moved the stored take
**106.7 ms** earlier (the 6.7 ms is the test source's drift across the session).

**The RT-8 story:** play pads in CHOP in one tab (`→ Library` captures the
performance), open LOOM in another tab of the same origin, point a slot at
`name:chop-47` — or just loop-record yourself over the boombap groove here. Human
takes enter the library with `by: "human"` provenance and Claude places them in MIX
like any stem. **⬆** on a slot bounces its tiled loop window (level/pan/halfSpeed
baked in) to the library as `loom-<id>-loop` — the loop-ready form of the raw take.

Live transport: the studio offline-renders **one loop window** of the composite and
loop-plays that buffer — what loops live is exactly what exports. Any edit re-renders
(status shows `rendering…`) and swaps in phase-aligned, so the groove never stops
under an overdub.

Studio controls for the space bus (v1.1): every slot row carries a **send** knob next
to lvl/pan (— at 0 keeps the key out of the config), and a compact **space row**
(time / fb / mix) sits in the transport bar. The row writes only non-default fields
into `cfg.space` and drops the key entirely when everything is back at defaults —
shared URLs stay minimal. `damp` has no knob (author it in JSON when you want a
darker or brighter room). Edits to send/space re-render the live loop phase-aligned
like any other edit, and **⬆ slot bounce bakes the slot's send + the space shape in**.

## Vibe translation table

| ask | moves |
|---|---|
| **"build a groove from the library"** | slots with `ref:` per layer — a beat (`name:boombap`), a bed (`name:drift-bed`, `level: 0.4–0.6`), a texture (`tag:loop`). 2–4 slots read as a groove; 6 reads as a wall. |
| **"halftime the beat"** | `halfSpeed: true` on the beat slot — octave down, twice the length, so an 8-bar clip now spans 16 bars of feel; keep `bars` unchanged and it truncates to the window (intentional: the front half of the clip, slowed). |
| **"give the take some room"** | `pan` the layers apart (−0.4 / +0.4), keep the beat at `0` |
| **"the bed is drowning the drums"** | bed slot `level: 0.3–0.5`, or `muted: true` to A/B it |
| **"loop just one bar of it"** | `bars: 1` — everything tiles into one bar; short stabs repeat, long clips truncate to their first bar |
| **"make the export longer"** | `loops: 4` (or 8) — the file repeats the window; the live loop is unchanged |
| **"stack me a vocal round"** | record ⏺ Overdub 3–4 passes — each take lands as a new slot; then thin with `level`/`pan` per pass |
| **"give the take some room / echo"** | `send: 0.2–0.4` on that slot — the default space (0.31 s, fb 0.32, damp 3 kHz) reads as a warm slap-verb |
| **"dub it out"** | `send: 0.6–0.9` on one slot + `space: { time: 0.375, feedback: 0.7 }` (⅜ s ≈ dotted-eighth at 120); keep the beat slot dry so the groove stays tight |
| **"the echo is too bright/washy"** | `space: { damp: 1500 }` darkens each repeat; lower `space.mix` to tame the whole bus at once |

## Perceptual annotations

- **A clip whose length ≈ the window is the sweet spot** — `boombap` (22.3 s) against
  the default window (8 bars @ 86 bpm = 22.33 s) tiles once, seamlessly.
- **Short clips (< 2 s) tile into a pulse** — a one-beat stab in an 8-bar window
  repeats ~32×: rhythmic if the clip length divides the beat, polyrhythmic drift if
  it doesn't. Both are usable; the second one reads as "tape loop art".
- **The 8 ms edge fades are inaudible on sustained material** but read as a soft
  attack on hard transients that sit exactly at a tile edge — nudge `bars`/`bpm` so
  hits land inside tiles, not on seams.
- **`halfSpeed` on speech reads as "slowed + reverb" aesthetic even dry.** On drums it
  reads as halftime; on pads it just gets deeper — cheapest depth move in the rack.
- **`level` above 1 is for quiet mic takes**, not for winning a loudness war — the
  composite runs through a fixed 0.9 master; three slots at 1.5 will clip.
- **Recording latency is compensated, not wished away.** The slice is shifted by the
  host's own reported round trip (28 ms on the measured desktop: 18 out + 10 in), and
  the take reports what it applied. If takes still feel late, raise the **nudge** by
  5–10 ms at a time until a hard transient sits on the click — that residue is your
  interface's, not the loop's. Playing ahead of the click is no longer the fix; it is
  now double compensation.
- **One bus, not one verb per slot:** every send feeds the same space — slots blend in
  a shared room, which is what makes a rack cohere. Feedback near 1 approaches
  self-oscillation but can never run away: the gate cuts recirculation at the window
  end, so exports always end clean. **In the live loop the tail restarts with each
  window** — a dubby tail that "wraps around" the loop needs the tail inside the
  window (shorter `space.time`, higher `feedback`) rather than after it.

## Worked example — "boombap groove, halftimed, with a bed"

The seed-pack groove with the beat halftimed and the ambience tucked left. Loop window
= 8 bars @ 86 bpm = 22.33 s; render = 2 × window + tail ≈ 44.9 s.

```json
{
  "seed": "halftime-groove",
  "bpm": 86,
  "bars": 8,
  "loops": 2,
  "slots": [
    { "id": "a", "ref": "name:boombap", "halfSpeed": true },
    { "id": "b", "ref": "name:drift-bed", "level": 0.45, "pan": -0.3 },
    { "id": "c", "ref": "name:loom-take-*" }
  ],
  "tailSec": 0.25
}
```

Slot `c` picks up your freshest take by glob (name asc, freshest-`at` ties first) —
swap in the `hash:` ref to pin one forever.

Encode it (wraps in the envelope, prints the `#sfa=` link):

```
python3 "$CLAUDE_PLUGIN_ROOT/scripts/encode.py" /path/to/halftime-groove.json --studio loom --live
```

The link is small — the audio rides as refs, resolved from whichever library opens
it. To carry the takes to another machine, ship a bundle (RT-5), or render the
composite with `node scripts/sound-render.mjs` against the substrate (the CLI
resolves the same refs from `sound-state/assets/`).

## Studio interaction — direct manipulation

The interaction law: anything drawn on screen that represents a parameter is directly
grabbable. Every gesture writes `cfg` through the studio's normal edit path
(`compEdited`), so the live loop re-renders and swaps in phase-aligned like any edit.

| gesture | effect |
|---|---|
| **slot ⠿ id drag** | reorder `cfg.slots` (drop indicator between rows). Order is organizational — every slot still tiles identically. |
| **library strip → slot** | the collapsible **library** side strip lists every asset (name + duration, freshest-first). Drag an entry onto a slot row to set that slot's clip — always **hash-pinned** (`ref: "hash:<64-hex>"`), exactly like the picker. |
| **library strip → empty rack space** | drop on the rack background (or the `+ slot` bar) to **append a new slot** with the dragged clip, hash-pinned. |
| **drag on a slot's waveform thumbnail** | level/pan push/pull: **↕ = level** (0–1.5), **↔ = pan** (−1–1), both live with a floating readout chip (`lvl 1.10 · pan L0.3`). **Shift = fine**; **double-click resets** both to defaults. Values follow the minimal-config law — level 1 / pan 0 drop their keys. The row's sliders track the drag and stay as the secondary affordance. |
| **per-slot picker** | unchanged — the select still sets/clears refs. |

Conventions (suite-wide): pointer capture, ≥ 12 px hit zones, cursor affordances
(`grab` on grips and library entries, `move` on thumbnails), rAF-throttled feedback
that idles when nothing moves.

### The arm panel — the step before the take (lib/mic.js, shared with CHOP + VOX)

The **input** row above the transport is the same strip in all three recording studios,
built by `micArm()` in `lib/mic.js`. Recording is not a leap of faith: you arm first, and
everything that can ruin a take is visible before the count-in starts.

| control | what it does |
|---|---|
| **⏺ arm / ⏹ disarm** | opens (closes) the mic. Arming is a normal user gesture, so the permission prompt lands here rather than under a count-in. The session keeps its **own AudioContext**, so stopping the transport never kills the meter, and it stays open between takes. |
| **permission chip** | `mic: not asked` → `mic: armed` → `mic: denied`. `denied` covers every failure to open; the *reason* is the sentence on the status line. |
| **device picker** | every `audioinput` from `enumerateDevices`. Browsers withhold labels until a grant exists, so before arming the list reads `Microphone 1/2…` and fills in with real names afterwards. Changing it re-opens on the new device; it locks while a take is running. |
| **input VU** | the kit `drawVU` on the mic's own `makeVizTap` — an **analyser-only branch**: metering never implies audibility. |
| **too hot** | flashes while the input has peaked at or above **−1 dBFS** within the last second (latched, so a transient overshoot is still seen). |
| **monitor** | routes mic → speakers. **Default OFF**, labelled *headphones only — feedback risk*: the browser exposes no way to detect headphones, so the panel names the risk instead of guessing. |
| **nudge ± ms** (transport bar) | residual take-alignment offset on top of the host's reported round trip (see *Take latency* above). Positive pulls takes **earlier**. Per-browser (`localStorage`), never a config field. The chip beside it shows the auto-detected split (`auto 28ms (out 18 + in 10)`). |

Capture is **RAW by default** — `echoCancellation`, `noiseSuppression` and
`autoGainControl` are all **off**. Those three are voice-call features: echo cancellation
comb-filters anything correlated with the speakers (it eats the loop you are overdubbing
against), noise suppression is a speech gate that swallows cymbal tails and room decay,
and AGC rides the level so layers stop sitting together. Nothing assumes 48 kHz — the
decode reports whatever rate the device actually ran at.

**Silence guard.** After a take, if its peak is under **−50 dBFS** the take is *not*
stored: the panel says `that take was silent — check the input device` and offers
**↻ retry** (discard, count in again) or **keep anyway**. A dead input never lands
quietly in the library.

**Take fit legend.** Every stored take reports its quantization in words —
`take 22.31s → loop 22.33s, padded 0.02s` (or `trimmed …`, or `exact fit`) — so you can
see how much of the window was your playing and how much was the grid.

Errors never reach the console as bare DOMExceptions: `MIC_ERRORS` / `micErrorMessage()`
turn `NotAllowedError` into *"Microphone permission was denied — allow it in your
browser's site settings and try again"*, `NotReadableError` into *"The microphone is in
use by another app — close it and retry"*, and so on.

### Live visualization (lib/viz.js kit)

LOOM loop-plays an offline-rendered window, so live per-slot taps are impossible —
precomputed material + master-bus live viz:

- **Slot thumbnails** — mirrored RMS-envelope fills (`rmsEnvelope`, cached per decoded
  buffer, dpr-crisp). While the composite loops, each unmuted slot shows a gold sweep
  at its own loop position (wraps at the slot's wall length — halfSpeed doubles it)
  plus an activity LED lit from the same envelope sampled at that position × level.
- **Master VU + spectrum** — transport-bar stereo VU (peak-hold, −1 dBFS line) + log
  spectrum via a `makeVizTap` on the looping source; the tap re-points across
  phase-aligned swaps, and all loops idle fully on stop (no background rAF).
- **Count-in flash** — the record count-in beats pulse the ⏺ button and a bar badge
  counts down (`4·3·2·1` at beats/bar 4), UI timers slaved to the audio clock
  (display only — never the capture timing).
- **Record input VU** — lives in the **arm panel** (above) and runs from the moment you
  arm, not just while a take is in flight: a kit VU on the mic session's own
  `makeVizTap` (analyser-only branch — the mic reaches the speakers only through the
  explicit monitor toggle). It stops and clears on disarm — zero background rAF.
