# MIX — config schema v1 (authoritative)

One file, three consumers (INV-7): this document is the app's parameter reference, the
vibe skill's authoring vocabulary, and the property source for `scripts/verify.mjs`.
If the engine and this file disagree, this file wins until a spec delta says otherwise.

MIX is the hub (spec §10): tracks of **library clip references** on a bars grid, per-track
gain/pan/EQ/send, a shared delay bus, declarative **intents** compiled to automation, and a
glue-comp + limiter master. MIX is sample-based: the config carries *references*, not audio —
the host (studio page or CLI) resolves every ref against the library/substrate and injects
`cfg.__buffers` before rendering (§8.2). `__buffers` is never authored and never shared.

Envelope for sharing/registering: `{ "v": 1, "studio": "mix", "cfg": { … } }`.
Bare `cfg` objects are what you author; the codec and substrate wrap them.

---

## Fields

| field | type | range / values | default | notes |
|---|---|---|---|---|
| `seed` | uint32 \| string | any | — **(mandatory)** | Reserved determinism stream (INV-3). MIX v1 consumes no randomness, but the seed names the mix (`mix-<seed>.wav`) and future stochastic features will draw from it. |
| `bpm` | number | 60–180 | 84 | Tempo of the bars grid. `barDur = beatsPerBar * 60 / bpm` seconds. |
| `beatsPerBar` | int | 1–12 | 4 | Grid meter. |
| `bars` | int | 1–512 | 32 | Song length in bars. `duration = bars * beatsPerBar * 60/bpm + 1.5` s (fixed tail for delay/fades). |
| `tracks` | object[] | 1+, unique ids | worked-session trio (below) | Ordered lanes, top to bottom on the timeline. |
| `tracks[].id` | string | unique per config | — | Referenced by `intents`. |
| `tracks[].gain` | number (dB) | −60–12 | 0 | Track gain. This is the AudioParam that intents automate. |
| `tracks[].muted` | bool | — | false | Authored mute: the track renders pinned at −120 dB (inaudible, graph still built) and receives **no** gain automation. The studio's S/M buttons are view-only and never write this field — `muted` is for configs that ship with a lane parked (alt takes, reference stems). |
| `tracks[].pan` | number | −1–1 | 0 | Constant stereo position (StereoPanner). |
| `tracks[].eq` | object | — | none | 3-band EQ, created only when set: `low` shelf 200 Hz, `mid` peak 1 kHz Q 0.8, `high` shelf 4 kHz. Each band a dB gain −24–24; omit a band to skip its node. The studio's **eq** popover is a mini frequency-response strip (log 40 Hz–16 kHz) with three drag handles — see Timeline interaction. |
| `tracks[].send` | number | 0–1 | 0 | Post-gain tap level into the shared delay bus. |
| `tracks[].automation` | object[] | 0+ points | none | **Manual automation lane (v1.2):** hand-drawn gain points `{ bar, db }` — `bar` 1–`bars`+1 (fractional ok), `db` −60–12, a **dB offset relative to the track gain**. Compiles to the same piecewise-linear envelope stream the intents use and **sums with them** (see the automation section below). |
| `tracks[].clips` | object[] | 0+ | — | Clip placements (below). |
| `intents` | object[] | 0+ | — | Declarative mix moves compiled to automation: `duck` \| `ride` \| `swell` \| `tail` (below). All intents on one track **compose**: their dB offsets sum, then convert to linear once (see the composition rule). `place` is authoring sugar only — see below. |
| `send` | object | — | `{time:0.3, feedback:0.35, mix:1}` | The one shared bus: `type:"delay"` — DelayNode `time` (0–5 s) + feedback loop (0–0.95) through a 3 kHz damping lowpass; `mix` (0–1) scales the wet return into the master. |
| `master.glue` | number | 0–1 | 0.3 | Bus compressor amount: threshold −18 dB, ratio `1 + 3*glue`, attack 10 ms, release 180 ms. 0 ≈ transparent (but see the master-bus lookahead note — 0 is not zero *latency*). |
| `master.limit` | number (dBFS) | −24–0 | −1 | Hard limiter ceiling: ratio 20, knee 0, attack 2 ms, release 50 ms → destination. |

### Master-bus lookahead — the one constant offset in a MIX render

`DynamicsCompressorNode` is a lookahead compressor: it delays its own output by a fixed
amount, and MIX's master runs **two** of them (glue → limiter). Measured with an impulse
at a known time: **Chrome 6.000 ms each → 12.000 ms total**; the Node CLI host
(`node-web-audio-api`) **8.000 ms each → 16.000 ms total**. Neither `glue: 0` nor
`limit: 0` removes it — the nodes still exist.

Three consequences worth knowing, in order of how much they matter:

1. **Inside a mix, nothing moves.** The delay is on the master bus, so it is identical for
   every clip on every track. Measured with clips at bars 1 / 5 / 9 at 96 bpm: each onset
   sat `+11.995 ms` from its authored time and the **differentials were 10.000000 s and
   10.000000 s** against the authored 10 s. The arrangement is exact; the whole file is
   simply shifted.
2. **A MIX bounce re-imported as a clip lands ~12 ms late.** The render begins with that
   much silence, so placing `mix-<seed>` at bar N in another MIX or in a LOOM slot puts it
   ~12 ms behind material rendered natively. Trim it (`trimStart: 0.012`) or nudge `at`
   when layering a bounce against a fresh stem.
3. **The offset is host-dependent, so a MIX render is not byte-identical across hosts.**
   The same config rendered in the browser and by `scripts/sound-render.mjs` differs by
   4 ms of leading silence. Determinism claims for MIX hold **per host**, not across them.

**Default tracks** (used when `tracks` is omitted): the §04 worked-session shape — `bed`
(−6 dB, send 0.25, looped `name:drift-bed`), `pulse` (−3 dB, looped `name:pulse-47`),
`vox` (0 dB, high-shelf +2, `name:killer-01/*` spread over bars 5–29) with `bed` and
`pulse` ducked under `vox`. The vox track resolves against the imported corpus immediately;
bed/pulse light up once same-named renders land in the library.

## Clip refs — how configs reference audio

A clip's `ref` is a string, one of three forms. Resolution order: app → `Library.list()`
(IndexedDB); CLI → `Substrate.listAssets()`. Multi-match results sort by **name ascending**.
Contexts taking one clip use the **first match**; `layout:"spread"` uses **all matches** in order.

| form | meaning | live examples against the corpus |
|---|---|---|
| `hash:<64-hex>` | exact asset, content-addressed — survives renames | `hash:01a8be2cc6ecda9adae4d0df37946900e802282b23847ce287e0e05763ab1f73` (killer-01/9) |
| `name:<pattern>` | exact name, or glob with `*` | `name:deck12/s5b2` (one line) · `name:killer-01/*` (every killer-01 line, /1 /2 /3 … in order) · `name:deck12/s*` (all deck12 segments) |
| `tag:<value>` | any asset whose `tags[]` contains the value | `tag:killer-01` (that clip's folder) · `tag:narration` (all 117 imported lines) |

Unresolved refs are **never fatal**: the timeline draws them dashed at a nominal 4 bars,
renders proceed with those clips silent, and the status line lists what's missing. Name/tag
refs re-resolve at every load — this is RT-3: re-render an upstream stem under the same
name and the mix picks up the fresh asset next render. Same-name ties resolve
**freshest-`at` first** on every host.

**↻ Take fresh (studio):** the toolbar's ↻ button re-runs ref resolution against the
Library *now* — mid-session, no reload. The status line reports every ref that resolved
to a different hash (`↻ fresh: name:drift-bed → 3f2a91bc…`) or `↻ all refs current`;
the timeline redraws and the next play/export renders with the fresh set. This is the
§10 "re-resolve stale refs with one-click take fresh" — the click is the human-speed
twin of what load-time resolution and the orchestrator's re-render chain do already.

## Clip placement

| field | type | range | default | notes |
|---|---|---|---|---|
| `ref` | string | ref forms above | — **(mandatory)** | What to place. |
| `at` | number (bar) | 1–`bars` | 1 | Start bar, **1-based**. |
| `to` | number (bar) | > `at`, ≤ `bars`+1 | — | Region end (exclusive — `to:33` on a 32-bar song means "through bar 32"). Used by `loop` and `spread`; on a plain clip it truncates. |
| `layout` | `"spread"` | — | — | Multi-match refs distributed **evenly between `at` and `to`** (default: song end): N matches → N slots of equal width, match k starts on slot k. Tails run naturally (uncapped). |
| `loop` | bool | — | false | Tile the (trimmed) buffer from `at` until `to` or song end; last tile truncated. Per-tile fades double as seam click-guards. |
| `gain` | number (dB) | −60–12 | 0 | Clip gain, pre-EQ. **Studio: ⌥-drag the block vertically, or `⌥←`/`⌥→`.** |
| `fadeIn` / `fadeOut` | number (s) | ≥ 0 | 0.005 / 0.01 | Linear ramps at each placement's edges. **Studio: the two top-corner fade handles** (drawn as a wedge over the waveform). |
| `trimStart` / `trimEnd` | number (s) | ≥ 0 | 0 | Shave the buffer's head/tail before placement (buffer seconds, pre-conform). **Studio: the two inner edges**; what was cut shows as a dimmed stub outside the block that drags back out. |
| `conform` | bool | — | false | **Auto-conform (P4):** play the clip at `playbackRate = bpm / clipBpm`, where `clipBpm` is the resolved asset's `meta.bpm` (stamp it with PRISM **✎ write tags**). A 172 bpm break in an 86 bpm mix runs at rate 0.5 — twice the wall time; tile geometry and audio both scale, and loop/spread tiling uses the conformed length. Spread clips conform per match. Missing bpm on either side ⇒ the clip plays unconformed and the region is flagged `conformSkipped: true` (silent skip, never fatal). Vibe: *"drop in this break at our tempo"* → `conform: true`. |

> ⚠️ **`conform` inherits any error in the clip's `meta.bpm` — and PRISM's confidence
> runs the WRONG WAY (measured, delta 1.10).** The detector is exact to ≤0.3 % in 22 of
> 24 synthetic cases, but its *highest* confidences land on its *wrong* answers:
> half-tempo reads scored 0.970 and 0.987, a beatless drone reported 171.4 bpm at
> confidence **1.000**, while every correct answer scored 0.498–0.812. So a high score is
> not evidence — it is often the opposite. This matters here more than anywhere else in
> the suite: a half-tempo tag conforms the clip at **2×** for the whole mix, which is the
> loudest possible failure, and `conformSkipped` only fires on a *missing* bpm, never a
> wrong one. Before conforming: sanity-check the tag against the clip's known tempo (or
> against `duration ÷ bars`), distrust confidence above ~0.9 on rhythmic material, and
> never conform a pad, drone or narration clip — set `meta.bpm` by hand instead.


## Intents — `duck` · `ride` · `swell` · `tail`

The full spec-§10 intent set. Every intent is a **piecewise-linear dB-offset envelope**
over time — 0 before its first breakpoint, its last value **held** after its last one
(rides and tails persist to song end). The compiler (`compileIntents(cfg, resolved)` —
pure, exported, tested) sums all envelopes targeting one track and emits **one**
automation stream per track on its gain AudioParam. Bars map to seconds as
`t(bar) = (bar − 1) · barDur`; breakpoints landing before 0 clamp — earlier points drop
and the envelope enters at its interpolated value at t = 0.

**Measured (v1.7 timing audit).** Every emitted point time was asserted against
`t(bar) = (bar − 1) · barDur` at 90 bpm 4/4: duck's four-point sequence (`t1`,
`t1 + attack`, `b + floorHold`, `+ release`), ride start/end and its `curve:"exp"`
quarter points, swell rise/apex/fall, tail start/land, and automation-lane points
including fractional bars and the prepended hold-before point — **all exact, |Δ| < 1e-9 s**.
Clip geometry likewise: bars 1/5/9 exact, `layout:"spread"` slots exact,
a 172 bpm break `conform`ed into an 86 bpm mix produced rate `0.5`, a tile wall length
equal to 2 bars at 86, and rendered onsets on every beat with **no outlier at the tile
seam** (inter-onset spread ±0.03 ms, all of it the test source's own sample rounding).
Loop tiling over 174 tiles showed **0.000 ms** of accumulated tile-start drift and
**0.000 ms** of seam gap/overlap.

**The composition rule.** Per target track: dB offsets from all its intents **sum**, are
sampled at the union of their breakpoint times (**time-ascending**), and convert to
linear exactly **once** per emitted point — `v = dbToLin(track.gain + Σ offsets)`.
Emission flags: the first point is `setValueAtTime`; a point whose value equals its
predecessor's is a hold pin (`setValueAtTime`); everything else is
`linearRampToValueAtTime`. Two rides on one track therefore add in dB (+4 and −2
overlapping ⇒ net +2 where both hold); a duck landing mid-ride dips *from the ridden
level*. Tracks with `muted: true` compile to **no** automation.

**Grabbable in the studio (v1.2.1):** every drawn intent curve carries **one handle**
at its characteristic point — duck: the floor mid-duck · ride: the end level · swell:
the apex · tail: the landed floor. Vertical-dragging the handle edits the intent's
`amount` (`floor` for tail), clamped to its schema range, with a live dB readout; the
curve re-derives on every frame. The geometry comes from the engine's own pure helpers
(`intentHandle` → where the handle sits, `intentParamFromOffset` → dragged dB offset
back to the parameter, `duckMergedIntervals` → the compiler's own merge law), so the
handle, the curve, and the audio can never disagree. A duck whose `by` track has
nothing sounding yet has no handle (there is no floor to grab).

### `duck`

`{ "type": "duck", "target": <trackId>, "by": <trackId>, "amount": <dB, negative>, "attack": 0.05, "release": 0.3, "floorHold": 0.05 }`

Whenever the `by` track has a clip sounding, the `target` track's gain dips by `amount` dB.
Each resolved clip interval `[a, b]` on the `by` track (`b` = placement end including trims
and fades) contributes the offset breakpoints (with `t1 = max(0, a − 0.005)`):

```
(t1, 0) → (t1 + attack, amount) → (b + floorHold, amount) → (b + floorHold + release, 0)
```

Intervals merge before emission when they overlap **or** when the next starts before the
previous curve has fully released — a spread of narration lines with small gaps ducks as
one continuous move instead of pumping. A duck **alone** on its track emits exactly the
long-documented sequence (`base = dbToLin(gain)`, `floor = dbToLin(gain + amount)`):

```
setValueAtTime(base,  t1)                    // pin pre-duck value just before the clip
linearRampToValueAtTime(floor, t1 + attack)
setValueAtTime(floor, b + floorHold)         // hold the floor past the clip end
linearRampToValueAtTime(base,  b + floorHold + release)
```

Acceptance (spec §10): this curve within 1 ms.

### `ride`

`{ "type": "ride", "target": <trackId>, "amount": <dB, −12–12>, "from": <bar>, "to": <bar, > from>, "curve": "linear" }`

Mix-automation "ride the fader": a gain offset ramped in over `[from, to]` and **held**
to the end of the song. Offset breakpoints:

```
(t(from), 0) → (t(to), amount)                                  // curve "linear" (default)
(t(from), 0) → (t(from) + u·span, amount·u²) for u = ¼, ½, ¾    // curve "exp": slow start,
             → (t(to), amount)                                  //   accelerating finish
```

Multiple rides on one track compose additively in dB (the composition rule) — stack a
long +3 bed ride with a short −2 dip rather than editing clip gains.

### `swell`

`{ "type": "swell", "target": <trackId>, "amount": <dB, −24–24>, "at": <bar>, "riseBars": <n, > 0>, "fallBars": <n, default riseBars> }`

Up-and-back envelope centered work: ramp up over `riseBars` **into** `at`, back down over
`fallBars`. Offset breakpoints:

```
(t(at) − riseBars·barDur, 0) → (t(at), amount) → (t(at) + fallBars·barDur, 0)
```

Negative `amount` swells *down* (a breath, not a bloom). A rise reaching before bar 1
clamps: the envelope enters at t = 0 already mid-rise.

### `tail`

`{ "type": "tail", "target": <trackId>, "at": <bar>, "overBars": <n, > 0>, "floor": -60 }`

The outro tool: fade the track to `floor` — an **absolute** dB level (−120–0, default
−60) — across `[at, at + overBars]`, held after. Offset breakpoints (the offset is
`floor − track.gain`, so the track *lands at* `floor` dB regardless of its gain):

```
(t(at), 0) → (t(at) + overBars·barDur, floor − gain)
```

## Manual automation lanes — `tracks[].automation`

`"automation": [{ "bar": 3, "db": -12 }, { "bar": 5.5, "db": 0 }]`

Hand-drawn gain points, the escape hatch when no intent says what your ear wants. Each
point is `{ bar, db }`: `bar` 1–`bars`+1 (**fractional ok** — 5.5 is mid-bar 5), `db`
−60–12, a **dB offset relative to the track gain** — the same convention every intent
envelope uses. The engine (`automationEnv(cfg, track)` — pure, exported) converts the
points, sorted by bar, into a piecewise-linear dB-offset envelope with **hold** semantics
outside the authored range:

- **before the first point** the envelope holds the *first* value (unlike intents, which
  are 0 before their first breakpoint — a lane that starts at −12 starts the *song* at −12);
- **after the last point** it holds the *last* value (like rides and tails);
- two points on the same bar are an instant step (pre → post, like an `attack: 0` duck).

**Composition:** the automation envelope joins the track's intent envelopes as one more
term in the exact composition rule above — offsets **sum in dB** at the union of
breakpoint times and convert to linear once. A duck landing on an automated lane dips
*from the drawn level*; drawn moves and intent moves never fight, they add. Tracks with
`muted: true` take no automation, same as intents. Empty array = no envelope.

**Studio lane (fully direct, v1.2.1):** the **A** button in each track header opens a
slim lane under the track. Everything drawn there is grabbable:

- **Handles** (6 px gold dots, 14 px hit zones) drag freely in **both axes** — time
  (bar, fractional) and level (dB). Free drag is fine-grained (0.01 bar / 0.1 dB);
  **⇧ = bar snap + 0.5 dB steps**. A live `bar · dB` readout follows the drag.
- **The line itself is grabbable**: pull anywhere on the segment between two points and
  both endpoints ride together by the same dB — *move the line within its space*. Hold
  **⌥ to tilt** instead (only the endpoint nearer the grab moves). The flat hold runs
  before the first and after the last point drag their single endpoint.
- **An empty lane needs no points first**: dragging anywhere in it creates a flat
  two-point line at the drag level spanning the track's **visible clip range** (no
  clips → the whole song) — a track gets its level line by grabbing where it should be.
- **Click** on the line (or lane space) adds a point there; **double-click** a handle
  removes it.

Points and the resulting curve draw in gold; the curve is computed by the engine's own
`automationEnv`, so **lane == audio** — hold-before and hold-after are visible, and the
dashed line marks offset 0 (the track's own gain). The lane is view state; the points
travel in the config (a load re-opens lanes that carry points). Vibe: *"pull the bed
down 12 from bar 3, back up by 5"* → `automation: [{bar:3, db:-12}, {bar:5, db:0}]` —
but prefer an intent when one fits (intents say *why*; automation says *exactly this*).

### `place` — authoring sugar (vibe layer only)

`place` requests ("place the break under the second verse") are **not** an engine intent:
the vibe skill rewrites them into `tracks[].clips` entries (a ref + `at`/`to`/`loop`/
`layout`) before the config ships. The engine's `validate()` rejects `place` — and any
unknown intent type — with an error naming the supported set
(`"duck" | "ride" | "swell" | "tail"`). If you find yourself authoring `place` JSON,
author the clip instead.

## Timeline interaction (studio)

The studio timeline is directly editable — the interaction law is **push-and-pull, not
set-numbers**: anything drawn that represents a parameter is grabbable. Every gesture
below writes the same config fields you author by hand (through the studio's normal
update path), so drag-then-Copy-JSON round-trips. Conventions throughout: pointer
capture, ≥ 12 px hit zones (handles: 6 px gold dots, 14 px hit), cursor affordances
(grab / ns-resize / ew-resize / col-resize / nwse-resize / crosshair), live redraw while
dragging, **double-click = remove/reset** per context, live dB/seconds readouts on every
pull, and **persistent affordances** — a manipulable thing looks manipulable at rest, it
does not wait for a hover.

**⇧ polarity** follows spec §18 delta 1.8 and depends on the axis: on **gridded** axes
(bars, steps, semitones) ⇧ = **SNAP** — the bar grid in an automation drag, the finer
bar→beat grid step in a keyboard nudge; on **continuous** axes (dB, Hz, seconds,
velocity) ⇧ = **FINE** — 0.5 → 0.1 dB, 10 → 1 ms. Numeric *entry* remains only for
musical constants (bpm, bars, seed, beats/bar, from-bar) and for `ref`, which is a name
rather than a quantity. Seconds and dB are **not** musical constants: fades, trims and
every gain are drag-first, and the inspector's number fields are a precision readout
behind the gesture, never the primary interface.

### The clip block — zone split, handles, nudge

A clip block is a **fully visual object**: nothing about a clip needs a typed number.
The affordances are **persistent, not hover-only** — every resolved block carries a grip
glyph (a 2×3 dot cluster at its left) at rest, and a **selected** block additionally
shows both edge grips, the two inner trim ticks and the two fade corner handles. An
unselected block reveals the same set on hover, and retracts it when the pointer leaves.
A one-line hint under the timeline names every gesture.

**Zone split** on a block `[x0…x1] × [y…y+h]`, evaluated in this order (first match wins):

| # | zone | where | gesture → field |
|---|---|---|---|
| ① | **fade handles** | top **12 px**, within 9 px of the handle x (blocks ≥ 24 px wide) | horizontal drag → `fadeIn` / `fadeOut` (seconds) |
| ② | **trim stubs** | the dimmed hatched ghosts **outside** the block (selected clip only) | horizontal drag → `trimStart` / `trimEnd`, pulling material back out |
| ③ | **inner 8 px** | `[x0+8, x0+16)` and `(x1-16, x1-8]` (blocks ≥ 44 px wide) | horizontal drag → `trimStart` / `trimEnd` — shave the **source** |
| ④ | **outer 8 px** | `[x0, x0+8)` / `(x1-8, x1]` (blocks ≥ 24 px wide) | drag → move the block's edge in **time**: left = `at` (holding `to`), right = `to` |
| ⑤ | **body** | everything else | drag → move (`at`, bar snap; `to` rides along), ⌥+vertical → `gain` |

The mnemonic: **outer 8 px moves an edge in TIME, inner 8 px shaves the SOURCE.** A clip
that cannot be extended (no `to`, not `loop`/`spread`) has nothing for the outer right
edge to do, so on those the outer right edge trims the tail instead. Narrow blocks
(< 24 px) stay plain move targets — no zone is ever smaller than the pointer.

- **Drag a clip block** horizontally → moves `at` (bar snap, clamped 1–`bars`; a clip
  with `to` keeps its length — both ends shift). Live bar readout while dragging.
- **⌥ + vertical-drag a clip block** → **clip gain** (`clips[].gain`), 0.2 dB per px,
  clamped −60–12, live dB readout at the pointer; a gain landing on 0 leaves the config
  clean (field deleted).
- **Drag a clip's outer right edge** (loop/spread clips, or any clip with `to`) → sets
  `to`, bar-snapped; a loop-to-end clip picks up an explicit `to` on first resize.
- **Drag a clip's outer left edge** → moves `at` while `to` stays put (the length
  changes), clamped so `at` can never pass `to`.
- **Fade handles** (top-left / top-right corners) ride the top edge at the end of each
  slope, so the handle x *is* the fade length. Horizontal drag sets `fadeIn`/`fadeOut` in
  seconds, clamped to the block's own duration; the ramp draws as a **wedge knocked out
  of the block over the waveform**, so the fade is legible at a glance. Seconds are a
  CONTINUOUS axis ⇒ free drag rounds to 10 ms, **⇧ = fine (1 ms)**. **Double-click a fade
  handle resets it to 0** (written explicitly — `null`/absent still means the engine
  defaults 0.005 / 0.01).
- **Trim handles** are the inner edges — grabbing just *inside* the block shaves the
  source. The trimmed-away material draws as a **dimmed hatched stub outside** the block,
  which is itself draggable: pull the stub outward to restore what was cut. Drags land in
  **buffer seconds** (the wall-clock pixel delta is divided back by the conform `rate`),
  clamped to `0 … srcDur − otherTrim − 0.05`. Free drag rounds to 10 ms, **⇧ = fine
  (1 ms)**. **Double-click a trim handle deletes the field.**
  *These stubs show SOURCE extent, not timeline position:* MIX anchors a block at `at`,
  so pulling the head trim back out lengthens the block **to the right**.
- **Drag a clip onto another lane** → moves the clip between tracks (drop decides).

**Keyboard nudge** (with a clip selected; the `input,select,textarea` guard means typing
in a field never nudges):

| keys | effect | axis rule |
|---|---|---|
| `←` / `→` | `at` ∓ **1 bar** | gridded |
| `⇧←` / `⇧→` | `at` ∓ **1 beat** (`1/beatsPerBar` bar) | gridded ⇒ **⇧ = finer GRID STEP**, not a free value |
| `⌥←` / `⌥→` | `gain` ∓ **1 dB** | continuous |
| `⇧⌥←` / `⇧⌥→` | `gain` ∓ **0.1 dB** | continuous ⇒ **⇧ = FINE value** |
| `↑` / `↓` | move the clip to the previous / next **track** | — |
| `⌫` / `Del` | remove the clip | — |

Note the **⇧ polarity split** — it is the suite law (spec §18 delta 1.8) read correctly,
not an inconsistency: on a *gridded* axis (`at`, in bars) ⇧ means *snap finer*, so it
subdivides bar → beat; on a *continuous* axis (`gain` in dB, fades and trims in seconds)
⇧ means *fine value*. A clip carrying `to` keeps its length under every nudge (both ends
ride). Everything clamps to the config's legal range: `at` to 1–`bars` (and further, so
`at + length ≤ bars+1`), `gain` to −60–12; a gain landing on 0 deletes the field.
- **Gain grip** — the slim strip on every lane's **left edge** is a push/pull track
  fader: absolute y ↦ dB (+12 at the band top … −24 at the bottom, the header slider's
  range), live readout, header slider syncs on release. The slider survives as the
  secondary affordance.
- **S / M per track header** → solo / mute, **studio-only view state**: render-time the
  studio folds them into `muted` (mute ⇒ −120 dB; non-empty solo set mutes every
  non-solo track), so play *and* export audition them — but `getConfig()`/share never
  carry them, and a config load clears them. Authored `tracks[].muted` is the config
  path and shows as a lit M.
- **Intent envelopes** draw over their target lanes in gold (dB offset vs the track's
  gain, +12 top … −24 bottom): ride/swell/tail as weighted curves, duck as a thin
  computed line under the `by` track's actual tiles. The curves come from the engine's
  own `compileIntents` — what you see is the emitted automation. **Each curve carries
  one drag handle** at its characteristic point (duck floor · ride end · swell apex ·
  tail floor) — vertical drag edits the intent's `amount`/`floor` directly, clamped to
  its schema range, live dB label while dragging (see the intents section).
- **A per track header** → opens the track's **automation lane** — fully direct: handles
  drag in both axes, the line between points drags as a segment (both endpoints together;
  ⌥ tilts the nearer one), an empty lane creates its flat two-point line right under the
  drag, click adds, double-click removes (full detail in the automation section). Points
  write `tracks[].automation`, so drawing-then-Copy-JSON round-trips like everything else.
- **eq per track header** → a mini **frequency-response strip** (log 40 Hz–16 kHz) with
  three drag handles — low shelf 200 Hz / mid peak 1 kHz / high shelf 4 kHz, vertical
  = dB ±24 (free 0.1, ⇧ 0.5), double-click resets a band to 0. Values land in
  `tracks[].eq` with the usual hygiene (band at 0 deleted, empty `eq` deleted). The
  drawn response is a simple shelving/peak *approximation* — cosmetic-accurate, not
  filter-exact; the audio is the engine's three biquads.
- **↻ Take fresh** (toolbar) → re-resolves every ref against the Library now and
  reports which clips picked up a different hash (see the clip-refs section).
- **⬇ Bundle** (toolbar) → one `.sfa` of the whole session (see the bundle section).
- **Clip inspector** (click a clip) — explicitly the **SECONDARY** surface: a readout &
  precision panel behind the gestures above, labelled as such and styled quieter (dashed,
  unfilled). It carries ref picker, at/to, loop, spread, **conform** toggle
  (`clips[].conform` — auto-conform to mix bpm via the asset's PRISM-tagged `meta.bpm`),
  gain, fades and trims, and stays **two-way synced**: canvas drags and keyboard nudges
  refresh it live, typed entry lands in the config immediately.
  Every numeric value additionally carries a **push/pull scrub readout** beside its input
  (the same convention as tape.html): vertical drag, **4 px of travel per step**,
  **⇧ = the fine step** (bar → beat on the gridded axes; 0.5 → 0.1 dB, 10 → 1 ms on the
  continuous ones), **double-click = reset** — or *clear*, for the optional `to`. Only
  `ref` stays a plain text input plus library picker: it is a **name, not a quantity**,
  so there is nothing to push or pull.

### Live visualization (lib/viz.js kit)

MIX plays an offline-rendered buffer, so live per-track taps are impossible — the
honest design is **precomputed material + master-bus live viz**:

- **Clip waveforms** — resolved clip blocks carry DAW-style mirrored RMS-envelope
  fills (`rmsEnvelope`, cached per asset hash; sliced per tile so trims are honored
  and a looped clip repeats its envelope per tile; slices normalize against the full
  asset's peak). Label rides above the waveform; unresolved clips stay dashed.
- **Master VU + spectrum** — the transport bar's stereo VU (peak-hold, −1 dBFS line)
  and log spectrum are a `makeVizTap` on the played buffer's source. Loops start with
  the transport and stop fully on stop/end (no background rAF).
- **Playhead** — 8 px ember gradient trail; during playback the page auto-scrolls to
  keep the timeline in view unless the user scrolled themselves in the last 2 s. The
  position is `playOffset + (ctx.currentTime − playT0)` — a **direct read of the audio
  clock every frame**, not an integration, so it can neither accumulate nor be thrown
  off by a stalled main thread. (`performance.now()` appears in this path only as the
  auto-scroll's own 500 ms/2 s debounce, which positions no audio. Over a 20 s run with
  the main thread burning 120 ms out of every 200 ms, the two clocks diverged by 4.5 ms —
  that is the error the audio-clock read avoids.)
- **Track activity LEDs** — each header carries an LED lit from a **precomputed**
  per-track envelope (pure math from `resolvePlacements` + the asset envelopes, scaled
  by clip + track gain, mutes zeroed — an approximation that ignores fades/EQ/intents;
  never used for audio), sampled at the playhead.

## ⬇ Bundle — the session as one `.sfa` (RT-5)

The toolbar's **⬇ Bundle** button emits `<mixname>.sfa` (`mix-<seed>.sfa`) — a
store-only zip (`lib/bundle.js`) that reproduces the whole session anywhere, no shared
library required. Contents:

| path | what |
|---|---|
| `manifest.json` | `buildManifest` shape: every asset below with full provenance meta, plus the config under id `MIX-local`. |
| `configs/MIX-local.json` | The mix config in **envelope form** `{ v:1, studio:"mix", cfg }` — exactly what Copy JSON / paste-back speaks. |
| `assets/<hash>.wav` | Every **resolved** clip asset, straight from the Library blobs (spread refs contribute all matches, freshest-`at` resolution — unresolved refs are skipped and named in the status line). |
| `assets/<masterHash>.wav` | The **rendered master**, produced through the exact engine path play/export uses, listed in the manifest as `<mixname>-master` with `configHash` (delta 1.6 law) + `engineVersion` provenance. |

Import it via the suite shell's bundle drop (or `scripts/bundle.mjs import`) on any
machine: the assets land under their content hashes, the config's refs resolve, the mix
sounds — and the master rides along as the reference render. Save-picker where the
browser offers one, anchor download otherwise.

## Vibe translation table

Mood words → parameter moves. Compose two or three; don't max everything.

| vibe | moves |
|---|---|
| **sit the bed under the voice** | `duck` bed by vox, `amount: -8` (the canonical move; −6 gentle, −12 broadcast-hard) |
| **radio edit / broadcast tight** | duck with tighter envelope: `attack: 0.02, release: 0.12, floorHold: 0.02` — snaps down, returns fast |
| **wall of sound** | `master.glue: 0.6, master.limit: -0.8` — dense, loud, forward |
| **airy / open** | `master.glue: 0.1`, sends up (`send: 0.3–0.4` on sparse tracks), `send.mix: 0.6` |
| **voice up front** | vox `eq: {high: 2–4}`, bed `eq: {high: -3}` — presence by subtraction too |
| **warm bed** | bed `eq: {low: 2, high: -2}`, gain −6 to −9 |
| **dubby / spacey** | `send.time: 0.45–0.6, feedback: 0.55`, vox `send: 0.25` — tails bloom between lines |
| **dry / documentary** | all `send: 0`, `master.glue: 0.15`, no eq moves — let the room in the recordings speak |
| **cinematic entrance** | bed alone bars 1–4, everything else `at: 5`; first vox clip `fadeIn: 0.5` |
| **let it breathe** | `spread` the vox over fewer bars than the song (`at: 5, to: 29`) so the bed opens and closes the piece |
| **drop in this break at our tempo** | `conform: true` on the clip — PRISM-tagged `meta.bpm` on the asset does the rest (rate = mix bpm / clip bpm) |
| **bring the bed up through the middle eight** | `{ "type": "ride", "target": "bed", "amount": 3, "from": 17, "to": 25 }` — ramps in over the section and stays up (+2 subtle, +6 featured) |
| **breathe into the drop** | `{ "type": "swell", "target": "bed", "amount": 4, "at": 17, "riseBars": 4, "fallBars": 2 }` — up into the moment, quicker back down; negative `amount` for an inhale-dip instead |
| **let it die out** | `{ "type": "tail", "target": "bed", "at": 25, "overBars": 8 }` — fades to −60 dB across the last stretch; tail every track for a full outro |
| **exactly this move, no vocabulary fits** | `tracks[].automation` points — `[{"bar":11,"db":0},{"bar":11.5,"db":-9},{"bar":13,"db":0}]` is a hand-drawn dip no intent spells; it still sums with any intents on the track |

## Perceptual annotations

- **Duck −6 reads as polite, −8 as produced, −12 as broadcast.** Past −15 the bed audibly gasps.
- **Release under 0.15 s pumps** on beds with sustained content — use the fast release only on percussive beds ("radio edit").
- **The merge rule is your friend:** narration lines < ~0.4 s apart duck as one gesture. If the bed surges between every sentence, lengthen `release` rather than editing clips.
- **Glue above 0.7 audibly breathes** with the kick of a pulse track; 0.3 is invisible glue.
- **Limiter at −1 dBFS is safety, not loudness** — push `glue` and track gains for density, not `limit` toward 0.
- **Spread slots are starts, not cages:** long lines overlap the next slot. If lines collide, widen `at`–`to` or trim the source.
- **Send on the vox (0.1–0.15) with a 0.3 s delay** reads as "produced podcast"; on the bed it reads as wash.
- **Rides are held, swells return.** Use `ride` for a new level that stays ("verse two is bigger"), `swell` for a moment that passes. Stacking both on one track is the idiom — they sum in dB.
- **`tail` beats fadeOut for outros:** clip `fadeOut` is per-placement (a looped clip fades every tile seam); `tail` fades the *track*, across tiles, and holds the floor through the delay tail.
- **Ride `curve: "exp"` reads as anticipation** — most of the move lands late. Use it into a drop; plain linear for background corrections.
- **Automation is for the move you can point at, intents for the move you can name.** A drawn lane holds its first value from bar 1 — author an explicit `{bar:1, db:0}` when you want the track to *start* at its plain gain and move later.

## Worked example — the §04 worked session

Narration spread over a bed and a pulse, both ducked under the voice — the demo mix the
suite scores its own clips with. `vox` resolves against the imported corpus today;
`bed`/`pulse` resolve once stems named `drift-bed` / `pulse-47` are rendered to the library
(until then they draw dashed and render silent — the mix still plays the voice).

```json
{
  "seed": "worked-session",
  "bpm": 84,
  "beatsPerBar": 4,
  "bars": 32,
  "tracks": [
    { "id": "bed", "gain": -6, "send": 0.3,
      "clips": [{ "ref": "name:drift-bed", "at": 1, "to": 33, "loop": true }] },
    { "id": "pulse", "gain": -4, "eq": { "low": 1.5 },
      "clips": [{ "ref": "name:pulse-47", "at": 5, "to": 29, "loop": true, "fadeIn": 0.2, "fadeOut": 1.5 }] },
    { "id": "vox", "gain": 0, "send": 0.12, "eq": { "high": 2 },
      "clips": [{ "ref": "name:killer-01/*", "at": 5, "to": 29, "layout": "spread" }] }
  ],
  "intents": [
    { "type": "duck", "target": "bed", "by": "vox", "amount": -8 },
    { "type": "duck", "target": "pulse", "by": "vox", "amount": -6, "attack": 0.04, "release": 0.25 }
  ],
  "send": { "type": "delay", "time": 0.3, "feedback": 0.35, "mix": 0.8 },
  "master": { "glue": 0.3, "limit": -1 }
}
```

Encode it (wraps in the envelope, prints the `#sfa=` link):

```
python3 "$CLAUDE_PLUGIN_ROOT/scripts/encode.py" /path/to/worked-session.json --studio mix --live
```

Remember: the URL alone carries the *arrangement*; the audio travels via the shared
library (same origin) or a bundle (RT-5). Opening a mix URL in a browser whose library
lacks the refs shows the full timeline dashed — import the bundle and it sounds. The
studio's **⬇ Bundle** button packs arrangement *and* audio *and* the rendered master
into that one `.sfa`.
