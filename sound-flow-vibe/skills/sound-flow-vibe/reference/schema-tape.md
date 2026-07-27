# TAPE — config schema v1 (authoritative)

One file, three consumers (INV-7): this document is the app's parameter reference, the
vibe skill's authoring vocabulary, and the property source for `scripts/verify.mjs`.
If the engine and this file disagree, this file wins until a spec delta says otherwise.

Envelope for sharing/registering: `{ "v": 1, "studio": "tape", "cfg": { … } }`.
Bare `cfg` objects are what you author; the codec and substrate wrap them.

TAPE is **sample-based**: the config never carries audio, it carries a **clip ref** to
one source asset and a **chain** of tape moves run over it. The resampled result lands
in the library as a new asset whose provenance (configHash) links it to its dry source.
The host — studio page, CLI, or bridge — resolves the ref and injects
`cfg.__buffers[ref]` before rendering (spec §8.2); engines never fetch. `__buffers` is
host plumbing — never author it, never share it.

**Engine v1.1:** granular `stretch` (time-stretch without repitch) and `vinyl`
(seeded crackle + rumble) are in. The grains are plain BufferSources with gain-ramp
envelopes — **no worklet, no capability flag, no Playwright path**: stretch renders on
all three hosts like every other fx. `rate` remains the coupled speed+pitch move;
`stretch` changes time only.

---

## Clip refs

| form | meaning |
|---|---|
| `hash:<64-hex>` | exact asset by content hash — pin a specific take |
| `name:<pattern>` | exact name, or glob with `*` (e.g. `name:killer-01/*`) |
| `tag:<value>` | any asset whose `tags[]` contains the value (e.g. `tag:import`) |

Resolution: app → `Library.list()` (IndexedDB); CLI → `Substrate.listAssets()`.
Multi-match sorts by name ascending; TAPE's `source.ref` takes one clip, so it uses the
**first** match. The corpus stems `name:boombap` (22.3 s beat) and `name:pulse-default`
(72 s ambient) are the natural TAPE fodder, alongside any narration line or your own
renders.

## Fields

| field | type | range / values | default | notes |
|---|---|---|---|---|
| `seed` | uint32 \| string | any | 47 **(mandatory)** | Engine convention (INV-3). Consumed by `stretch` grain jitter and `vinyl` crackle, drawn from `rng(seed)` in fixed order (stretch grains first, then vinyl entries in chain order). Wobble/rumble phase is fixed at t0; curves are pure. Same seed ⇒ same take, byte-exact on the Node host. |
| `source` | object | — | — **(author it)** | The one clip the chain processes. |
| `source.ref` | string | clip ref (above) | `"name:boombap"` | Resolved by the host, injected as `__buffers[ref]`. |
| `trimStart` | number (s) | ≥ 0 | 0 (omit) | Cut from the head of the source before processing. |
| `trimEnd` | number (s) | ≥ 0 | 0 (omit) | Cut from the tail of the source before processing. |
| `chain` | object[] | 0+ fx entries | "age it" demo (below) | **Array order = signal order.** Each entry is one fx (table below). Repeats allowed (two spaces, two filters…). Empty chain = the trimmed source untouched. |
| `tailSec` | number (s) | ≥ 0 | 1.0 | Ring-out room after the source ends (space echoes, wobble smear). The engine gates the chain over the final ~250 ms so the render always ends in true silence — `tailSec` **bounds** the tail. |

**Duration law:** `duration = (sourceLength − trimStart − trimEnd) / rateProduct × stretchFactor + tailSec`
where `rateProduct` multiplies every `rate` entry in the chain (`0.5` ⇒ twice as long)
and `stretchFactor` multiplies every `stretch` entry's `factor` (1 when none). Rate and
stretch **multiply durations**: `rate 0.5` + `stretch 2` is 4× the trimmed length.
Without `__buffers`, `duration()` returns just `tailSec` — hosts always inject before
sizing an offline render.

## The fx table

| fx | params | range | what it sounds like |
|---|---|---|---|
| `rate` | `value` | 0.25–4 | The tape-speed move: pitch and time coupled. `0.5` = half speed, octave down, twice as long; `2` = double speed, octave up. Position in the chain doesn't matter — every `rate` entry multiplies into one playback rate on the source. |
| `stretch` | `factor`, `grainMs?`, `overlap?`, `jitterMs?` | 0.25–4, 40–200 ms (=90), 0.25–0.75 (=0.5), 0–25 ms (=8) | Granular time-stretch: output duration ×`factor`, **pitch unchanged**. `2` = twice as long at the same pitch, `0.5` = compressed to half. Classic overlap-add: grains every `grainMs×(1−overlap)` of output time, each reading `sourceTime = outTime/factor` (+ seeded jitter), triangle envelope (attack = release = grainMs/2). Source-stage like `rate` (below); grain params come from the first `stretch` entry, factors multiply. |
| `wobble` | `depthMs`, `rateHz` | 0–12 ms, 0.1–8 Hz | Pitch instability off a modulated 15 ms delay. Slow+shallow (2 ms / 0.5 Hz) = warped-record wow; fast+shallow (1–2 ms / 6 Hz) = flutter; deep (8–12 ms) = seasick. LFO phase starts at t0 — deterministic. |
| `crush` | `bits` | 3–16 | Staircase quantize, `2^bits` levels (integers read cleanest). 12+ is subtle grit, 8 is "old sampler", 6 is fizzy, 3–4 is destroyed. Quiet material crushes harder than loud — drive before crush to feed it. |
| `drive` | `amount` | 0–1 | tanh saturation blended with identity: `0` is a true no-op, 0.2–0.4 is tape warmth, 0.6 is obvious grind, 1 is fuzz. Also tames peaks — a safety valve before hot spaces. |
| `lowpass` / `highpass` | `from`, `to?`, `q?` | 20–20000 Hz, q 0.3–8 | Filter at `from`; give `to` and it sweeps exponentially from → to **over the whole render**. `q` (default 0.7) above ~2 whistles at the cutoff — the acid move. Lowpass darkens; highpass thins to a telephone/radio band. |
| `space` | `time`, `feedback`, `damp`, `mix` | 0.01–5 s, 0–1, 40–20000 Hz, 0–1 | Feedback delay with a damping lowpass in the loop — short times (0.02–0.08) read as a metallic room, 0.1–0.5 as slap/echo, 1+ as canyon. `damp` darkens each repeat. Feedback is gated near the render end so `tailSec` bounds the ring-out. `mix` 0 = dry, 1 = only echoes. |
| `gain` | `db` | −24–24 | Clean level trim. End chains with a small negative trim when drive/space/q have pushed the peak up — TAPE has no limiter by design. |
| `vinyl` | `amount` | 0–1 | Record character **added** at its chain position: seeded sparse crackle (~30 ticks/s, highpassed at 1.8 kHz) mixed at `amount×0.06`, plus a gentle 30 Hz rumble at `amount×0.02`. The dry signal passes untouched. Deterministic (crackle placement from the seed) and cheap. Fx **after** vinyl process the dust too — vinyl before `lowpass` darkens the crackle; vinyl last keeps it crisp on top. |

## Direct manipulation (studio)

The chain editor is push-and-pull, not set-numbers; every gesture writes the same
`chain` fields documented above and invalidates the wet cache like any other edit.
Conventions: pointer capture, ≥12 px hit zones, **shift = snap on gridded axes, fine
on continuous axes** (suite-wide, spec delta 1.8 — TAPE's drags are all continuous, so
shift is always fine here), double-click = reset or clear per context, cursors
telegraph the axis.

- **Trim edges** (waveform): the trim-shading boundaries on the `#wave` strip are
  draggable edges — left edge writes `trimStart`, right edge writes `trimEnd`
  (ew-resize affordance, 12 px zones, a line + top lug telegraph the grab). Clamped so
  `trimStart + trimEnd ≤ source duration − 50 ms`; shading and the output-duration
  line redraw live; shift = fine (10 % travel); double-click an edge resets that trim
  to 0. The numeric trim fields stay as synced secondaries, both ways.
- **Drag-reorder**: grab the `⋮⋮` handle at a row's left and drag — a drop-indicator
  line tracks the insertion point; release to splice `chain` (order IS the signal
  path). Drag the row well outside the list (≳48 px past its edge) and the ghost flips
  to `✕ release to remove`; drop removes the fx. The `×` button remains as the
  secondary affordance; the old ↑↓ buttons are gone.
- **Sweep strip** (`lowpass` / `highpass` rows): a log 20 Hz–20 kHz frequency strip
  with a filled handle at `from` and, when a sweep is authored, a hollow handle at
  `to`, joined by the sweep line. Drag either handle along x = its frequency
  (log-correct). Hold ⌥/alt while dragging vertically = `q` on the same gesture (the
  stem on each handle draws q). Double-click the to-handle to drop the sweep (the
  filter goes static at `from`); double-click from to reset it. Scrubbing an empty
  `to` readout starts the sweep at `from`.
- **Value push/pull**: every fx param readout (including the Hz numbers) scrubs on a
  vertical drag — 150 px of travel = the full documented range, shift = 10 % fine,
  clamped and step-quantized. Hz params (`from`/`to`/`damp`) scrub on a log scale.
  Sliders and number inputs stay, synced both ways. Params a config omitted display
  the fx default (what the engine uses) until touched.

## Chain-order guidance

The chain is a physical signal path — order is the sound:

- **drive before space reads warm** (saturated signal echoing in a clean room);
  space before drive reads blown-out (the echoes themselves distort — great for dub).
- **crush after lowpass reads softer** — the filter removes the highs that make
  quantize fizz sizzle. Crush before lowpass keeps the grit but rounds it.
- **highpass first, everything after** is the "cheap speaker" frame: thin the signal
  before you damage it.
- **wobble before space** smears pitch into the echoes (classic tape echo);
  wobble after space wobbles the whole wet mix — woozier, less vintage.
- **`rate` and `stretch` are exempt — they are source-stage fx.** Both apply **before
  the node chain** regardless of where they sit: `rate` sets the one playback rate,
  `stretch` replaces the single source with the grain layer (grains still play at the
  rate product, so `rate` keeps repitching and `stretch` keeps time-only). Every other
  fx then processes the already-stretched signal. Keep both first by convention so the
  chain reads top-down. Combining them multiplies durations (`rate 0.5` + `stretch 2`
  = 4× the trimmed length).
- **Grain-count cap: 4000.** Grains = `stretchedDuration / (grainMs×(1−overlap))`.
  A 22.3 s source at factor 4 / grainMs 90 / overlap 0.5 is ~1983 grains — fine; long
  sources at small grains and high overlap can blow past the cap. `validate()` flags it
  once the host has injected `__buffers`; `schedule()` refuses outright. Fix: raise
  `grainMs`, lower `overlap`, lower `factor`, or trim the source.
- **`gain` last** is the master trim; `gain` mid-chain is a drive/crush feed control.

## Vibe translation table

Mood words → chains. Compose two or three moves; don't max everything.

| vibe | moves |
|---|---|
| **age it / dusty / worn** | the defaults: `rate 0.5` → `wobble 6/0.8` → `lowpass 12000→1800` → `space 0.31/0.35 damp 3000 mix 0.25` → `gain -1` |
| **underwater** | `lowpass from 800, q 1.2` + `wobble depthMs 10, rateHz 0.4` — deep slow wobble under a closed filter; add `space mix 0.4, damp 1200` for pressure |
| **blown out** | `drive 0.8` + `crush 6` — in that order; `gain -6` after to keep the export clip-free |
| **vhs / camcorder** | `wobble 3/5` (flutter) → `lowpass 9000` → `crush 10` → `gain -1` |
| **radio / phone** | `highpass 400` → `lowpass 3000, q 1.5` → `drive 0.3` |
| **dub echo** | `space 0.375/0.65 damp 2500 mix 0.5` with `tailSec 3` — the echo is the point; drive *after* the space to melt the repeats |
| **riser / sweep-up** | `highpass from 40 to 4000` over the whole clip — build tension by thinning |
| **slowed + reverb** | `rate 0.7` → `space 0.8/0.5 damp 4000 mix 0.35`, `tailSec 2.5` |
| **chipmunk accent** | `rate 2` and nothing else — use on one narration line, not a whole bed |
| **slow it to amber** | `stretch factor 2, grainMs 120` — twice the time, same pitch, big soft grains; add `lowpass 8000` for the honey |
| **dusty 45** | `vinyl 0.5` + `wobble 2/0.6` — surface noise over a lazy wow; `lowpass 10000` seals the era |
| **paulstretch-ish** | `stretch factor 4, grainMs 200, overlap 0.7` with `tailSec 2` — maximal smear, pads from anything; feed it a single hit |

## Perceptual annotations

- **`rate` under 0.4 on speech reads as "demon"; 0.5 reads as "screwed".** On beats,
  0.5 halves the tempo — a 84 bpm boombap becomes a 42 bpm crawl. Plan mix placements
  around the doubled length. `rate` is exact in both dimensions (measured: a 440 Hz
  sine renders at 220.000 / 880.000 / 110.000 Hz at rate 0.5 / 2 / 0.25, and the
  rendered length matches the duration law to the sample) — unlike `stretch`, it moves
  transients with no smear at all, so when repitching is acceptable it is the
  rhythmically honest way to change length.
- **Wobble depth above ~8 ms stops reading as tape and starts reading as broken.**
  The rate matters more than the depth: < 1 Hz = wow (drift), > 4 Hz = flutter (nervous).
- **Crush is level-dependent** — it quantizes amplitude, so a −12 dB signal at 8 bits
  sounds like a hot signal at 6. Feed it with `drive` or a mid-chain `gain +6` for
  consistent grit.
- **A sweeping filter is motion; a static filter is a place.** `to` makes the clip go
  somewhere over its whole length — one sweep per clip is a statement, two is mush.
- **`space.time` locks to tempo when `time = 60/bpm × subdivision`**, where the
  subdivision is the note's length **in quarter notes** (quarter = 1, eighth = 0.5,
  dotted eighth = 0.75, sixteenth = 0.25). At 84 bpm a quarter is `60/84 = 0.714`:
  **0.714 (quarter) · 0.536 (dotted eighth — the dub classic) · 0.357 (eighth) ·
  0.179 (sixteenth)**. *(Delta 1.10: this list used to label 0.357 "quarter" and 0.179
  "eighth" — one subdivision too fast in both cases. Dial a "quarter-note" dub delay
  from the old table and you got double-time echoes. `space.time` itself is exact —
  measured echo spacing tracks `time` to **< 0.09 ms** at 0.02–1.0 s, single-click
  probe, feedback 0.7.)*
- **Tempo-lock `space.time` to the tempo you are LEFT with, not the source tempo.**
  `rate` and `stretch` act at the source; `space` is a node in the chain, so its delay
  is in OUTPUT seconds. After the source stage the material's tempo is
  `bpm × rateProduct ÷ stretchFactor` — so an 84 bpm break at `rate 0.5` is playing at
  42 bpm and its quarter is `60/42 = 1.429 s`, not 0.714. Same for `wobble.rateHz`:
  it is genuine cycles per second of the OUTPUT (measured 0.798 / 0.501 / 4.004 /
  8.015 Hz for authored 0.8 / 0.5 / 4 / 8, and `depthMs` genuine ± ms around the 15 ms
  base: p‑p 12.00 / 23.99 / 3.97 / 19.95 ms for authored depths 6 / 12 / 2 / 10).
- **A `to` sweep really does span the whole render window, tail included** — measured
  against an exponential law on sine probes 500 Hz–8 kHz through `lowpass 12000→200`:
  the −3 dB crossings track `from·(to/from)^(t/D)` to **≤ 33 ms over an 8 s render**
  (0.4 %), with `D` = the FULL duration incl. `tailSec`, not the source length. So on
  a 4 s source with `tailSec 4` the filter is only halfway through its travel when the
  source ends. Shorten `tailSec`, or aim `to` past where you want to land.
- **Feedback above 0.7 with mix above 0.5 will dominate the source.** The tail gate
  keeps it bounded, but inside the clip it's a wash — that's either the point or a mess.
- **`grainMs` under 60 smears transients** — drum hits lose their front edge and read
  as pads. That's the paulstretch charm on sustained material and mush on beats; keep
  90–140 when the groove should survive the stretch.
- **Where a stretched hit actually lands (measured, delta 1.10).** The source traversal
  is exactly linear — a click train stretched ×2 over 39 s of output showed **zero
  cumulative drift** (first-vs-last offset 9.9 ms, oscillating, not growing; ×1.37 →
  6.7 ms; ×0.5 → bounded and wrapping). What overlap-add *does* do is smear each
  transient across one grain, and the smear is one-sided: a source hit at `ts` is
  replayed by every grain whose read window contains it, so its copies span
  `[ts·factor − grainMs·(factor−1), ts·factor]`. The **leading edge** — what the ear
  hears as the hit — therefore arrives `grainMs × (factor − 1)` EARLY, ± one hop of
  grid jitter (`grainMs × (1−overlap) × (1 − 1/factor)`). Measured at defaults
  (grainMs 90, overlap 0.5): factor 2 → −64.9 … −84.5 ms; factor 1.37 → −20.2 …
  −30.7 ms; factor 0.5 (compression) → +5.1 … +40.1 ms. **Consequences:** stretching a
  beat shifts its felt downbeat by tens of ms and jitters it — if the groove has to
  survive, cut `grainMs` (halving it halves both terms) and raise `overlap` toward
  0.75 (which only shrinks the jitter, not the lead). For a pad, none of this matters.
- **`overlap` 0.5 and 0.75 are the only ripple-free values.** The grain envelope is a
  triangle; overlap-add is constant only when `grainMs/hop` is an integer, i.e.
  overlap = 1 − 1/k. Measured envelope-sum ripple: **0.00 dB at 0.5 and 0.75**, 1.34 dB
  at 0.6, 1.94 dB at 0.4 and at 2/3, 3.52 dB at 1/3, 4.44 dB at 0.3, **6.02 dB at
  0.25** — an amplitude tremolo at the hop rate (14.8 Hz at grainMs 90 / overlap 0.25),
  which on sustained material reads as an unwanted machine pulse. Use 0.5 (default) or
  0.75; treat anything else as a texture effect, not a neutral setting.
- **`jitter 0` sounds robotic — leave a little.** Perfectly regular grain reads
  produce a metallic comb/AM buzz at the hop rate. 4–10 ms of seeded jitter breaks the
  lattice; above ~15 ms the timeline starts to blur.
- **Stretch renders cost what they output** — wet render time scales with `factor`
  (a ×4 stretch renders 4× the audio). Preview a trimmed window (`trimStart`/`trimEnd`)
  before committing a long source at high factors.
- **`vinyl` reads strongest against quiet passages** — crackle at `amount 0.3` vanishes
  under a dense beat but carries a sparse pad. Pair with `lowpass` after it to age the
  dust itself; keep `amount` under ~0.7 unless the noise IS the point.
- **The chain has no limiter.** High q, drive≥0.6 into space, or `gain` above +6 can
  push peaks past 0 dBFS; the CLI `--check` will flag clipping. End with `gain` −1..−6.

## Worked example — "age it" (the spec's worked session, and the studio defaults)

Half-speed the 22.3 s boombap stem, add slow wobble, darken it with a whole-clip sweep
from bright to muffled, sit it in a small damped room, trim a dB. The render is 45.6 s
(22.3/0.5 + 1) and lands in the library as `boombap-taped`, provenance-linked to its
dry source.

```json
{
  "seed": 47,
  "source": { "ref": "name:boombap" },
  "chain": [
    { "fx": "rate", "value": 0.5 },
    { "fx": "wobble", "depthMs": 6, "rateHz": 0.8 },
    { "fx": "lowpass", "from": 12000, "to": 1800 },
    { "fx": "space", "time": 0.31, "feedback": 0.35, "damp": 3000, "mix": 0.25 },
    { "fx": "gain", "db": -1 }
  ],
  "tailSec": 1.0
}
```

Encode it (wraps in the envelope, prints the `#sfa=` link):

```
python3 "$CLAUDE_PLUGIN_ROOT/scripts/encode.py" /path/to/age-it.json --studio tape --live
```

Render it headless (resolves `name:boombap` from the substrate, stores the wet asset
with full provenance):

```
node scripts/sound-render.mjs /path/to/age-it.json --check --to-substrate --name boombap-taped
```

The link is small — the audio rides as `name:boombap`, resolved from whichever library
opens it. To pin an exact take across machines, swap in its `hash:` ref, or ship the
asset alongside via a bundle (RT-5).
