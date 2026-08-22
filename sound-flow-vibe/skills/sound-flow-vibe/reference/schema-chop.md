# CHOP — config schema v1 (authoritative)

One file, three consumers (INV-7): this document is the app's parameter reference, the
vibe skill's authoring vocabulary, and the property source for `scripts/verify.mjs`.
If the engine and this file disagree, this file wins until a spec delta says otherwise.

Envelope for sharing/registering: `{ "v": 1, "studio": "chop", "cfg": { … } }`.
Bare `cfg` objects are what you author; the codec and substrate wrap them.

CHOP is **sample-based**: the config never carries audio, it carries a **clip ref**.
Share URLs stay small; whoever loads the config needs the referenced asset in their
library (browser IndexedDB) or substrate (`sound-state/assets/`). The host — studio
page, CLI, or bridge — resolves the ref and injects `cfg.__buffers[ref]` before
rendering (spec §8.2); engines never fetch. `__buffers` is host plumbing — never
author it, never share it.

---

## Clip refs

| form | meaning |
|---|---|
| `hash:<64-hex>` | exact asset by content hash — pin a specific take |
| `name:<pattern>` | exact name, or glob with `*` (e.g. `name:killer-01/*`) |
| `tag:<value>` | any asset whose `tags[]` contains the value (e.g. `tag:import`) |

Resolution: app → `Library.list()` (IndexedDB); CLI → `Substrate.listAssets()`.
Multi-match sorts by name ascending; CHOP's `source.ref` takes one clip, so it uses the
**first** match. (MIX `layout:"spread"` is the context that consumes all matches.)
The 117 imported corpus narrations resolve by name (`name:killer-01/9`, `name:deck12/s5b2`)
or by their clip-folder tag (`tag:killer-01`, `tag:deck12`).

## Fields

| field | type | range / values | default | notes |
|---|---|---|---|---|
| `seed` | uint32 \| string | any | 47 **(mandatory)** | Engine convention (INV-3). CHOP v1 consumes no randomness — playback is fully config-determined — but the seed is required and names the take. |
| `source` | object | — | — **(author it)** | The one source clip this kit slices. |
| `source.ref` | string | clip ref (above) | `"name:killer-01/9"` | Resolved by the host, injected as `__buffers[ref]`. |
| `slices` | object[] | 0+ entries, unique ids | demo grid-8 | Windows into the source, in **seconds**. Windows may overlap; order is free. |
| `slices[].id` | string | unique per config | — | Key used by `pads`. Convention: `"s1"`, `"s2"`, … |
| `slices[].start`, `slices[].end` | number (s) | 0 ≤ start < end | — | Seconds into the source. Windows past the real source end clamp at render time. |
| `slices[].gain` | number | 0–1 | 1 | Per-slice level, multiplied by the event's `v`. |
| `slices[].pitch` | number | −24–24 semitones | 0 | `playbackRate = 2^(pitch/12)` — repitching changes slice wall-time (−12 plays half speed, twice as long). |
| `slices[].reverse` | boolean | — | false | Plays a pre-reversed copy of the window. |
| `slices[].attack` | number (s) | ≥ 0 | 0.003 | Linear fade-in. Clamped to half the played length. |
| `slices[].release` | number (s) | ≥ 0 | 0.05 | Linear fade-out ending exactly at the slice's natural end. |
| `slices[].choke` | int | any | — (none) | Choke group: a **later** performance event whose slice shares the group truncates this one at its `t` (5 ms anti-click fade). Classic use: open/closed-hat behavior, or monophonic vocal chops. |
| `pads` | object | keys `"1".."16"` → slice id | demo pads 1–8 | The keyboard-shaped bank, home row first: pads 1–8 = `a s d f g h j k` (home row, the primary bank), pads 9–12 = `e r t y` (top-row cluster above the middle), pads 13–16 = `c v b n` (bottom-row cluster below). Unassigned pads are silent. In-app: drag a slice from the waveform onto a pad to assign; right-click / long-press clears; ⌗ auto-map assigns the first 16 slices to pads 1–16 (home row fills first, then the top cluster, then the bottom). Each pad shows its key (big), number, assigned slice id, and a mini waveform of the slice window. |
| `performance` | object[] | 0+ events | demo 8 hits | The take. Each event fires its pad's slice. Shown on the studio's timeline lane as colored blocks (x = `t`, width = the slice's audible length, row = pad row, opacity = `v`) — see *Studio interaction*. |
| `performance[].pad` | string | `"1".."16"` | — | Must be an assigned pad. |
| `performance[].t` | number (s) | ≥ 0 | — | Seconds from clip start, stored to **3 decimals** (1 ms grid). The studio's ⏺ capture writes these from the audio clock — `ctx.currentTime − recT0`, never `performance.now()` or the DOM event timestamp — with the origin latched only after the clock is confirmed running (see *⏺ Capture* below). Optionally quantized to 1/8 or 1/16 at a bpm, applied at capture-stop with the raw timing kept in memory until then. Blocks drag horizontally on the lane; drags respect the quantize toggle. |
| `performance[].v` | number | 0–1 | 1 | Hit velocity, multiplies `slices[].gain`. In-app: click height on a pad sets it (top = 1.0, bottom = 0.4); keyboard hits are 1.0, shift = 0.6. Rendered as block opacity on the lane. |
| `tailSec` | number (s) | ≥ 0 | 0.5 | Silence after the last slice rings out. |

**Duration law:** `duration = max over events of (t + sliceLength/2^(pitch/12)) + tailSec`
(slice windows clamped to the real source length). An event-less config renders `tailSec`
of silence. Without `__buffers`, `duration()` returns the unclamped (safe, upper-bound)
estimate — hosts always inject before sizing an offline render.

## Studio interaction

The studio is a full visual editor over this schema; everything below writes the plain
config fields above — a config authored by hand and one made in the app are the same thing.

**Waveform editor** (the hero: ~180 px canvas + a zoom strip). Slice boundaries are
draggable delimiters — a vertical line with a grab lug at the top. Dragging a shared
boundary moves `slices[i].end` and `slices[i+1].start` **together**, clamped to a 30 ms
minimum slice. **Double-click** the wave to split the slice under the cursor (new id
`s<n>`, inherits the split slice's params). **Click a lug** to select the delimiter,
then Delete/⌫ (or its ✕ chip) merges the two adjacent slices — the left slice keeps its
params and extends its `end`. **Click inside a slice** to select it: the region fills
translucent ember, it auditions (again on Space), and the inspector binds to it —
id, start/end (numeric, same clamping as a drag), gain, pitch, reverse, attack, release,
choke, and which pad it sits on. Wheel/pinch zooms 1×–32× around the cursor; the strip
below pans; a seconds ruler tracks the view. The auto-slice toolbar (grid-N, split on
silence) **replaces** the slice set as a single undoable action — ⌘Z is a one-level
undo/redo of the slice set.

**Pads.** A keyboard-mirroring cluster of 16 pads in three staggered rows, favoring the
home row: pads 1–8 sit on `a s d f g h j k` (the visually dominant, slightly taller home
row), pads 9–12 on `e r t y` (top-row cluster offset left-ish above the middle), pads
13–16 on `c v b n` (bottom-row cluster offset right-ish below) — the screen mirrors the
physical keys. Hit position sets velocity (top = 1.0, bottom = 0.4; keyboard = 1.0,
shift = 0.6). Hits flash the pad ember (scaled by velocity) and flash the slice's
waveform region; sounding pads stay lit until their slice (or its choke) ends. Drag a
slice from the waveform onto a pad to (re)assign it. Keys only fire when no input field
has focus; the timeline lane still groups events in four logical rows by pad number
(p1–4 / p5–8 / p9–12 / p13–16).

**⏺ Sample** records a new *source* from the mic (free length: press to start, press to
stop). The take is auto-trimmed of leading/trailing silence at −45 dBFS, lands in the
library as `chop-sample-<n>` (`by: human`, tags `[chop, sample]`), and becomes the loaded
source as a pinned `hash:` ref — auto-slice from there.

**The arm panel** (the **input** row, `micArm()` in `lib/mic.js` — byte-for-byte the same
strip LOOM and VOX carry) is the step before sampling: **⏺ arm** opens the mic, a
permission chip reads `mic: not asked / armed / denied`, a **device picker** lists every
input (labelled `Microphone 1/2…` until the browser grants labels), a live **VU** meters
the input from an analyser-only tap, a **too hot** badge flashes on any peak ≥ −1 dBFS in
the last second, and a **monitor** toggle (default **OFF**, *headphones only — feedback
risk*) can route the mic to the speakers. Capture is RAW — echo cancellation, noise
suppression and AGC all off, because all three are voice-call processing that mangles
music (see the LOOM schema's arm-panel section for the full reasoning). Pressing ⏺ Sample
without arming first still works: it arms, then records.

**Silence guard.** If a take's peak is under −50 dBFS it is *not* stored — the panel says
`that take was silent — check the input device` and offers **↻ retry** or **keep anyway**.
A wrong input device costs you a sentence, not a mystery. Every mic failure surfaces as a
written-out sentence (`micErrorMessage`), never a bare DOMException.

**⏺ Capture + timeline lane.** While capturing, pad hits append live to the timeline
lane under the waveform; a playhead sweeps during capture and playback, and blocks flash
as they fire (playback runs through the same engine `schedule()` — no separate audition
path). The main waveform gets its own playhead too: on any audition (click, pad hit,
key) an ink line sweeps that slice's source region start→end at its pitch-adjusted rate
(`2^(pitch/12)`; reverse sweeps end→start), and during performance playback/capture it
tracks the most recently fired slice off the same audio clock as the lane playhead —
the two never disagree; retriggers jump it, and it disappears when the slice rings out.
On the lane: click a block to select/edit it (pad, `t`, `v` in the inspector).
**Dragging a block moves it on both axes** (suite conventions, spec delta 1.8):
horizontally it moves `t` — snapping to the quantize grid when the toggle is on, and
**shift mid-drag forces the snap** even when it's off (the lane's time axis is gridded
at the quantize bpm; 1/16 default) — and **vertically, crossing row groups reassigns
the event's pad within the target group's 4 pads**, keeping its column (p2 dropped a
row down becomes p6; diagonal drags do both at once). The block's color and label
follow the new pad live; only assigned pads accept (an event on an empty pad would
fail `validate()`), so dragging into an unassigned slot leaves the pad unchanged.
Delete removes the selected block, double-click empty space adds an event for the
last-touched pad, and *clear take* empties `performance`. Quantize (off / 1/8 / 1/16
at a bpm) applies at capture-stop, non-destructively — raw times are kept in memory
until then. The grid is `60/bpm ÷ 2` for 1/8 and `60/bpm ÷ 4` for 1/16 — an eighth is
half a beat, a sixteenth a quarter of one — anchored at the capture origin, and snapped
times land on it to within the 1 ms storage grid (±0.33 ms measured at 90 bpm 1/16,
which is pure `toFixed(3)` rounding and does not accumulate).
Slice-boundary lug drags on the waveform are a continuous seconds axis, so
there **shift = fine** (10 % travel).

**The slice envelope is drawn, and drawn things are grabbable** (spec delta 1.14).
Selecting a slice paints its envelope along the bottom 28 px of the waveform — the
attack ramp, a plateau at the slice's `gain`, the release ramp — over the slice's own
region, so it reads against the audio it shapes. All three are dragged *there*:

| gesture | effect |
|---|---|
| **drag the attack knee ↔** | `attack` (0 … half the slice length). **Shift = fine** (10 % travel); a chip shows `attack 0.031s` live. |
| **drag the release knee ↔** | `release`, measured back from the slice end — dragging the knee left lengthens it. |
| **drag the plateau ↕** | `gain` (0–1). The plateau's height *is* the gain, so the picture and the number cannot disagree. |
| **double-click any of the three** | resets it (removes the key: `attack` → 0.003, `release` → 0.05, `gain` → 1). |
| **← / →** with a slice selected | nudge `attack` by 0.005 s (**shift = fine**, 0.001 s). |
| **↑ / ↓** with a slice selected | nudge `gain` by 0.05. |
| **← / →** with a **delimiter** selected | move that boundary by 0.01 s (shift = 0.001 s) through `setSliceEdge` — the same shared-boundary clamping the lug drag uses. |
| **← / →** with an **event** selected | move it in time by 0.01 s; **shift = SNAP** to the quantize grid (a gridded axis). |
| **↑ / ↓** with an **event** selected | nudge its velocity `v` by 0.05. |

The envelope band owns its 28 px: a knee stays grabbable where a delimiter line crosses
it (the lug at the top is the delimiter's documented grab point, and it is untouched).

**Every inspector number is a synced scrubbable readout, not the interface** (delta
1.14). `start`, `end`, `pitch`, `attack`, `release` and an event's `t` all scrub on a
vertical drag on the field itself (shift = fine; `pitch` steps in whole semitones —
a gridded axis is always on its grid), double-click resets where a default exists, and
typing is untouched: a press without movement focuses the field exactly as before.
`choke` stays a plain typed field — it is a group **identifier**, not a quantity, and
`grid-N` and the quantize `bpm` stay typed for the same reason (musical constants).

**⏺ Capture arms the clock before it anchors** (spec delta 1.9). An `AudioContext`'s
`currentTime` is *not* running when the constructor returns: the output device has to
open first, and measured on macOS/Chrome against a real CoreAudio sink the clock sits
frozen for **92–128 ms** and is still **127–179 ms behind wall time at 600 ms**, after
which it tracks real time at ~0.998×. A capture origin latched off that cold clock
compresses the head of the take — pad hits played exactly 500 ms apart were captured
with a first interval of **256 ms (−244 ms)**, and every take started on a fresh context
(the first of a session, and every one after a transport stop, which closes the context)
had that limp baked in. ⏺ therefore shows **… arming** until the clock is measurably
advancing at real-time rate, then latches `recT0` and starts accepting hits: ~4 ms on a
warm context, ~215 ms cold. A second press while arming cancels. After the fix the same
500 ms rhythm captures to within **2–6 ms idle and 2–4 ms under main-thread contention**
(120 ms burn every 200 ms), and captured → rendered → detected onsets agree to 0.00 ms.
Playback needs no arming: a cold clock delays the whole take uniformly and the playheads
read the same clock, so nothing shifts *relative to* anything. The transport does end on
the audio clock, though — the old wall-clock `setTimeout(duration + 150 ms)` was closing
the context **66–146 ms before the take finished sounding**.

**Export all chops.** Two one-click bulk exports next to Export/→ Library, each slice
offline-rendered through the engine as a single-slice config (`slices: [slice]`,
`pads: {"1": id}`, one `t: 0` full-velocity event, `tailSec` = slice release + 0.05 —
the same live==render law as everything else): **→ Library (all slices)** puts one
asset per slice named `<sourceName>-<sliceId>` (meta: `studio: chop`, `by: human`,
tags `[chop, slice, <sourceName>]`, configHash of the merged single-slice cfg,
engineVersion, durationSec, sampleRate; canonical-PCM hash), mirroring each to a linked
bridge; **⬇ Export all (.sfa)** renders the same set and saves one bundle
`<sourceName>-chops.sfa` (`manifest.json` + `assets/<hash>.wav`, store-zip per RT-5).

## Slicing recipes

| ask | moves |
|---|---|
| **"slice the deck12 narration on sentence gaps"** | `source.ref: "name:deck12/s5b2"` (or the wanted line). In-app: **✂ split on silence**, threshold ≈ 0.02 (20 ms RMS windows; gaps under 150 ms don't split, regions under 100 ms are dropped). By hand: put `start` ~20 ms before each phrase onset, `end` ~50 ms after it decays. Breathy/quiet voice → threshold 0.010–0.015; roomy recording → 0.03–0.05. |
| **"chop it into 8 even pads"** | grid-8: `start = i·dur/8`, `end = (i+1)·dur/8`, pads `"1".."8"` → `s1..s8`. |
| **"just give me the first word"** | one slice, tight window, pad `"1"`, one event at `t: 0`. |
| **"drum-machine the vocal"** | silence-split, then keep only the punchy slices; assign kicks of the phrase to pads 1–4, tails to 5–8. |

## Vibe translation table

Mood words → parameter moves. Compose two or three; don't max everything.

| vibe | moves |
|---|---|
| **choppy / stutter** | dense `performance` (events 60–120 ms apart) re-hitting one or two short slices (0.08–0.2 s windows), `release: 0.02`, occasional `v: 0.6` ghosts |
| **lofi chop** | `pitch: -2..-5` on most slices, `release: 0.15–0.3` so tails overlap and smear, `gain: 0.7–0.85`, hits slightly off-grid (±20 ms) |
| **halftime / screwed** | `pitch: -12` everywhere, events at double spacing — slices play twice as long, plan `t`s around the stretched wall-time |
| **tape-rewind accent** | one `reverse: true` slice, `pitch: -3`, placed right before a downbeat hit of the forward version |
| **tight / drumline** | put every slice in one `choke` group — each hit cuts the last, monophonic MPC feel |
| **glitch fill** | 3–5 events inside 0.5 s cycling pads with alternating `reverse`, `v` descending 1.0 → 0.4 |
| **stately / narration intact** | silence-split slices played in order at their natural spacing, `release: 0.1`, no pitch — a re-timed read |

## Perceptual annotations

- **Windows under ~80 ms read as clicks, not words** — even with the 3 ms default attack. Keep vocal chops ≥ 100 ms.
- **`pitch` below −7 on speech reads as "demon"; −2..−5 reads as "tape".** Above +5 reads as chipmunk — use for one accent, not a whole take.
- **Overlapping releases glue a chop; tight releases (≤ 0.02 s) read as gated/stuttered.**
- **A choke group makes everything monophonic** — the truncation fade is 5 ms, so back-to-back hits stay clean but pads outside the group still ring over it.
- **Reverse reads as an upbeat.** A reversed slice landing right before its forward twin is the classic tape-flip; scattered reverses read as glitch.
- **Repitching changes length**: a −12 slice takes 2× its window in wall-time — leave room in `t` spacing or the next hit overlaps (or choke it).
- **Event density above ~8 hits/s stops reading as rhythm and starts reading as texture.**

## Worked example — "torn narration" (stutter intro, then the line lands)

Slices the corpus narration `killer-01/9` (5 s) on its speech gaps, stutters the first
phrase as a hatted intro, then lets the remaining phrases play out in order, slightly
tape-pitched. Every hit is in choke group 1, so each chop cuts the last — monophonic,
tight, MPC-style.

```json
{
  "seed": "torn-narration",
  "source": { "ref": "name:killer-01/9" },
  "slices": [
    { "id": "s1", "start": 0.10, "end": 0.92, "pitch": -2, "release": 0.08, "choke": 1 },
    { "id": "s2", "start": 1.05, "end": 2.30, "pitch": -2, "release": 0.12, "choke": 1 },
    { "id": "s3", "start": 2.48, "end": 3.60, "pitch": -2, "release": 0.12, "choke": 1 },
    { "id": "s4", "start": 3.72, "end": 4.90, "pitch": -3, "release": 0.20, "choke": 1 },
    { "id": "s1r", "start": 0.10, "end": 0.92, "pitch": -2, "reverse": true, "gain": 0.8, "choke": 1 }
  ],
  "pads": { "1": "s1", "2": "s2", "3": "s3", "4": "s4", "5": "s1r" },
  "performance": [
    { "pad": "1", "t": 0.00, "v": 1 },
    { "pad": "1", "t": 0.22, "v": 0.7 },
    { "pad": "1", "t": 0.44, "v": 0.5 },
    { "pad": "5", "t": 0.66, "v": 0.8 },
    { "pad": "1", "t": 1.50 },
    { "pad": "2", "t": 2.60 },
    { "pad": "3", "t": 4.10 },
    { "pad": "4", "t": 5.40 }
  ],
  "tailSec": 0.6
}
```

Encode it (wraps in the envelope, prints the `#sfa=` link):

```
python3 "$CLAUDE_PLUGIN_ROOT/scripts/encode.py" /path/to/torn-narration.json --studio chop --live
```

The link is small — the audio rides as `name:killer-01/9`, resolved from whichever
library opens it. To pin an exact take across machines, swap in its `hash:` ref, or
ship the asset alongside via a bundle (RT-5).
