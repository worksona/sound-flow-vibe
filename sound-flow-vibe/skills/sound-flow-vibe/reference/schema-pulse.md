# PULSE — config schema v1 (authoritative)

One file, three consumers (INV-7): this document is the app's parameter reference, the
vibe skill's authoring vocabulary, and the property source for `scripts/verify.mjs`.
If the engine and this file disagree, this file wins until a spec delta says otherwise.

Envelope for sharing/registering: `{ "v": 1, "studio": "pulse", "cfg": { … } }`.
Bare `cfg` objects are what you author; the codec and substrate wrap them.

---

## Fields

| field | type | range / values | default | notes |
|---|---|---|---|---|
| `seed` | uint32 \| string | any | — **(mandatory)** | Feeds `rng(seed)`. ALL stochastic choices — probability gates, noise buffers — draw from it (INV-3). String seeds are FNV-1a hashed. Same seed ⇒ byte-identical render. |
| `bpm` | number | 60–180 | 80 | Tempo. 1 step = 1 beat, so `stepDur = 60 / bpm` seconds. Live: changes land at the **next bar boundary** (bar = 4 steps — see Live performance). Same for `swing`. |
| `swing` | number | 0–0.25 | 0 | Delays the **offbeat subdivisions inside a beat** — the odd retrigs of a ratcheted cell. A step is one beat, so swing needs a subdivision to act on: an unratcheted lane plays dead on the grid no matter the swing, while an `r:2` lane's "and" moves from 1/2 to `1/2 + swing` of the beat (0.11 ⇒ 61%, a pocket shuffle; 0.25 ⇒ 75%, past triplet). Delay = `swing × stepDur × 2/r`, so `r:4` swings its 16ths by half as much in absolute time. **Engine ≤1.1.0 delayed alternate STEPS instead** — that displaced the backbeat itself (~70 ms at 90 bpm / swing 0.11) and read as a limp; fixed in 1.2.0, spec delta 1.9. |
| `steps` | int | 16 or 24 | 24 | Steps per pattern. |
| `scale` | object | — | A-min pentatonic (below) | Pitch table. Melodic voices index into `freqs` via a step cell's `n`. |
| `scale.root` | number (Hz) | 20–2000 | 220 | Tonal center; informative for vibing (bass sub derives from indexed freqs, not root). |
| `scale.freqs` | number[] (Hz) | each 20–4000, 1+ entries | `[220, 264, 297, 330, 396]` | Ordered low→high. `n` out of range wraps modulo length. |
| `rows` | object[] | 1–10 rows, unique ids | Beat Lab kit (below) | Ordered voice lanes. |
| `rows[].id` | string | unique per config | — | Key used by `patterns`. Conventionally same as `voice`. |
| `rows[].voice` | string | one of the 10 voices | — | Which synth the lane triggers. |
| `rows[].level` | number | 0–1 | 0.3 | Lane gain. Keep ≤ 0.6 per lane (Beat Lab headroom convention) — sums clip past that. Live, this drives the row's bus level node directly (heard now). |
| `rows[].pan` | number | −1–1 | 0 | Constant stereo position for the lane. Live: the row's bus pan node (heard now). |
| `rows[].muted` | boolean | — | absent (false) | Mute the lane (engine 1.4.0, spec delta 1.12). **Persists in the config — a USER-DECIDED divergence from MIX**, whose S/M are session-only: a PULSE groove with a muted lane IS a different groove, and shares/renders must carry it. Offline, an inaudible row schedules nothing but still consumes its rng draws, so every other row renders byte-identically. Live, mute is the row bus's last gain (≈15 ms ramp — instant, mid-note, tails silenced). Omit rather than write `false`. |
| `rows[].solo` | boolean | — | absent (false) | Solo the lane; multiple solos union (same persistence ruling as `muted`). Effective audibility: `!muted && (no row has solo \|\| this row has solo)`. |
| `patterns` | object | 1–4 keys, conventionally `"A".."D"` | — **(author it)** | Each pattern maps `rowId → cell[steps]` array. Missing rows are silent in that pattern. |
| `song` | (string \| object)[] | 1+ entries | `["A","A"]` | Playback order. Each entry is a pattern name **or** an alt-every object `{ "p": name, "alt": name, "every": int ≥ 1 }` (below). Total length = `steps × (expanded playthrough count)` beats; `duration = that * 60/bpm` s. |
| `pads` | object[] | 0+ | `[]` | Detuned-pair pad windows, Beat Lab style: each freq spawns a ±0.15% detuned sine pair, 1.2 s attack, alternating ±0.25 pan. |
| `pads[].freqs` | number[] (Hz) | 1–6 entries | — | Chord tones for the window. |
| `pads[].from`, `pads[].to` | int | 0 ≤ from < to ≤ steps | — | Step window *within each pattern* — pads re-fire every time any pattern plays. |
| `drone` | boolean | — | false | Continuous 55 Hz + 110 Hz sine bed under the whole song, Beat Lab style. |

**Default rows** (used when `rows` is omitted): kick 0.42 · hat 0.25 · rim 0.14 · bass 0.35 · pluck 0.30, all pan 0 — the Beat Lab kit. Any config that authors `patterns` for other voices MUST author `rows` too.

## Song entries — alt-every (turnarounds / fills)

A song entry `{ "p": "A", "alt": "F", "every": 4 }` is EXACTLY `every` consecutive
playthroughs: the first `every − 1` play pattern `p`, and on the `every`-th playthrough
pattern `alt` plays **instead of** `p` — a full-pattern substitution, never a tail
splice. So `{"p":"A","alt":"F","every":4}` ≡ `["A","A","A","F"]`, written as one entry
(the studio's arrangement strip renders it as one bracketed run block, `A A A→F`).
Strings and objects mix freely in `song`; `every: 1`
degenerates to just `alt`. Both `p` and `alt` must name existing patterns — there is no
`fill` flag on patterns; any pattern can serve as an alternate. Duration counts every
expanded playthrough. Purely structural: consumes no rng.

## Step cells — three forms

| form | meaning |
|---|---|
| `0` | rest |
| `1` | hit at full velocity, always fires — sugar for `{}` |
| `{ "v": 0–1, "p": 0–1, "n": int, "r": 2\|3\|4 }` | `v` velocity (default 1, scales `level`); `p` probability (default 1, gated per hit by the seeded rng — deterministic for equal seeds); `n` scale index (melodic voices only, default 0); `r` ratchet (default off) |

**Ratchet (`r`)**: the hit retriggers `r` times, spread evenly within the step
(`stepDur / r` apart), each retrig at velocity decaying ×0.8 from the last
(1.0 → 0.8 → 0.64 → 0.512). Melodic voices keep the same note for the whole group.
Deterministic — the ratchet draws no randomness, and `p` rolls **once** for the whole
ratchet group (all `r` retrigs fire or none do).

## Euclidean generator — UI tool only, not a config concept

The studio's per-row ⚙ opens an E(k,n) fill (Bresenham distribution of `k` pulses over
the row's `n = steps` cells, with a rotation slider and an optional "keep existing
velocities" mode). It **writes plain cells into the pattern grid** — configs stay
explicit grids; there is no euclid field anywhere in the schema, and shares/renders
never re-run the generator. Author configs as literal lanes.

## The 10 voices

Melodic voices (`bass`, `pluck`, `keys`) read `n` into `scale.freqs`; the rest ignore `n`.

| voice | sound |
|---|---|
| `kick` | Sine pitch-drop 85→40 Hz over 120 ms, 0.28 s decay — the Beat Lab thump. |
| `snare` | High-passed noise burst + 180 Hz sine body — dry backbeat crack. |
| `clap` | Three staggered noise bursts (~10 ms apart) — hand-clap smear. |
| `hat` | 6 kHz high-passed noise tick, ~50 ms — closed hat. |
| `ohat` | Same noise source, decay ~0.3 s — open hat / sizzle. |
| `rim` | ~20 ms bright noise click, hotter gain — woodblock-ish rimshot. |
| `bass` | Triangle at `freqs[n] / 4` (sub octave), 20 ms attack, 0.9 s decay — the warm low mover. |
| `pluck` | Fast-attack (5 ms) sine at `freqs[n]`, 0.5 s decay — the kalimba-like lead. |
| `keys` | Detuned triangle pair (±0.15%) at `freqs[n]`, soft ~80 ms attack — chorused e-piano pad tone. |
| `noise` | Filter-swept noise wash, ~1 beat long — riser/texture accent. |

## Vibe translation table

Mood words → parameter moves. Compose two or three; don't max everything.

| vibe | moves |
|---|---|
| **lazy / dilla / lofi** | swing 0.12–0.18, bpm 80–92, rim cells `{"p":0.7}`, hat v alternating 1.0/0.6 |
| **driving / techno** | bpm 128–140, kick every 4th step, ohat on the off steps between kicks, swing 0 |
| **sparse / ambient** | density down (few hits per lane), pads on, `drone: true`, keys with `n` from low indices, bpm 60–75 |
| **humanized** | v alternating 1.0/0.7 down the lane, `p: 0.85` on ghost notes |
| **90s boom bap** | clap + snare stacked on the same steps, swing 0.06–0.10, bpm 88–96 |
| **dark / menacing** | drop `scale.freqs` an octave (halve them), `drone: true`, sparse rim, occasional `noise` riser at pattern ends |
| **bouncy / funk** | bass on syncopated steps with varied `n`, pluck answering on the gaps, swing 0.08 |
| **intro / breakdown pattern** | clone the main pattern, set `p` 0.3–0.5 across it, mute kick lane |
| **trap hats** | hat lane sparse (offbeats + a few 16th clusters), ratchets `{"r":2}` / `{"r":3}` on 2–4 cells per pattern — not every cell; bpm 130–150, swing 0 |
| **four-bar loop with a turnaround** | main groove in `A`, a variation bar in `F` (busier last half, ratcheted snare or noise riser), song `[{"p":"A","alt":"F","every":4}]` |

## Perceptual annotations

- **Swing above 0.2 reads as drunk.** 0.08–0.12 is pocket; 0.14–0.18 is head-nod; past 0.2 only on purpose.
- **Swing needs something to swing.** It moves offbeat *subdivisions*, so it is audible only on ratcheted lanes (`r:2` hats are the classic carrier). A pattern of bare quarter-note cells sounds identical at swing 0 and swing 0.25 — if a groove feels stiff, ratchet the hat lane before reaching for more swing.
- **Probability below 0.5 reads as broken — use for intros**, then chain to a solid pattern in `song`.
- **Clap + snare stacked reads as 90s.** Clap alone reads modern; snare alone reads dry/live.
- **ohat on every step washes out the hats** — use it on offbeats or as accents against closed `hat`.
- **Drone under everything reads as warm/cinematic** and glues sparse patterns; skip it for dry, punchy vibes.
- **Pad windows shorter than 4 steps read as stabs, longer than half the pattern read as beds** (the 1.2 s attack needs room to bloom).
- **Kick level above ~0.5 dominates the sum** — bring other lanes down rather than pushing it up.
- **`n` walking upward across a pluck lane reads as a melody; a repeated `n` reads as a pulse.**
- **Ratchets read as trap on hats, as a drum-roll build on snare/rim, and as breakcore on kick** — the ×0.8 velocity decay keeps groups from machine-gunning; more than a handful of `r` cells per pattern reads as glitch.
- **An alt pattern that shares the kick lane with its main reads as a fill; one that drops the kick reads as a breakdown turn.**

## Worked example — "midnight freight" (lazy, dark, rolling)

Slow head-nod at 84 bpm with drunk-adjacent swing, subby bass walking three low scale
tones, a ghosted rim, a pad window blooming over the back half, drone bed underneath.
Sounds like: a freight yard at 2 am — heavy downbeat, hats barely holding on, warm low fog.

```json
{
  "seed": "midnight-freight",
  "bpm": 84,
  "swing": 0.14,
  "steps": 16,
  "scale": { "root": 110, "freqs": [110, 132, 148.5, 165, 198] },
  "rows": [
    { "id": "kick",  "voice": "kick",  "level": 0.45, "pan": 0 },
    { "id": "hat",   "voice": "hat",   "level": 0.20, "pan": 0.2 },
    { "id": "rim",   "voice": "rim",   "level": 0.14, "pan": -0.3 },
    { "id": "bass",  "voice": "bass",  "level": 0.38, "pan": 0 },
    { "id": "keys",  "voice": "keys",  "level": 0.22, "pan": 0.1 }
  ],
  "patterns": {
    "A": {
      "kick": [1,0,0,0, 0,0,{"v":0.8},0, 1,0,0,0, 0,0,0,0],
      "hat":  [0,{"v":0.6},0,{"v":1,"p":0.85}, 0,{"v":0.6},0,1, 0,{"v":0.6},0,{"p":0.85}, 0,{"v":0.6},0,1],
      "rim":  [0,0,0,0, {"p":0.7},0,0,0, 0,0,0,0, {"p":0.7},0,{"v":0.5,"p":0.5},0],
      "bass": [{"n":0},0,0,0, 0,0,{"n":2},0, {"n":0},0,0,{"n":1}, 0,0,0,0],
      "keys": [0,0,0,0, 0,0,0,0, {"n":4,"v":0.7},0,0,0, {"n":2,"v":0.6},0,0,0]
    }
  },
  "song": ["A","A","A","A"],
  "pads": [ { "freqs": [110, 165, 198], "from": 8, "to": 16 } ],
  "drone": true
}
```

Encode it (wraps in the envelope, prints the `#sfa=` link):

```
python3 "$CLAUDE_PLUGIN_ROOT/scripts/encode.py" /path/to/midnight-freight.json --studio pulse --live
```

## Live performance — what lands when (engine 1.4.0 / studio v1.8)

PULSE plays live in **bar-sized chunks**. **A bar is 4 steps** — the grid's q-shading
convention made normative; `steps` ∈ {16, 24} so every pattern is a whole number of
bars (4 or 6). The lookahead scheduler schedules one bar at a time from the engine's
beat-domain `firePlan`, mapping beats→seconds with the bpm/swing read at chunk time.
Live playback is **structurally identical to the offline render** — same hits, same
beat positions, same probability outcomes (one shared rng walk; measured < 0.05 ms).

Three latency classes, by design:

| change | lands | why |
|---|---|---|
| row level / pan / **M** / **S** | **now** (~15–20 ms ramp on the live row bus) | mixer moves are performance, not score — a muted row's already-sounding tails are silenced mid-note; unmute is equally instant |
| `bpm` / `swing` | **next bar boundary** (sample-exact seam — no gap, no overlap) | the beat-domain plan makes the mapping continuous: a tempo change rescales FUTURE beats only, against a running beats-elapsed anchor |
| cells / patterns / `song` (score) | **next pass boundary** (the song loop) | the plan is one rng pass — sequencer truth; mid-pass rebuilds would re-roll probabilities under your feet |

**Pattern cueing (session-view, session-only — never written to the config):** while
playing, clicking a pattern tab or an arrangement block cues that pattern — the target
pulses ('up next'), and at the next **pattern** boundary playback switches to looping
it (each loop is a fresh rng pass of that one pattern). **↩ song** resumes the
arrangement from the slot after where it left, at the next pattern boundary. While
stopped, clicks select for editing exactly as before.

The **live drone** (`drone: true`) runs as one continuous 55+110 Hz pair for the whole
performance — no per-pass restart, so there is no seam at all; offline renders keep
the 1.3.0 loop-safe whole-cycle snap (byte-identical). Pads re-fire per pattern slot
in both hosts.

## Studio interaction — direct manipulation

The interaction law: anything drawn on screen that represents a parameter is directly
grabbable. Configs stay the truth — every gesture below writes the same `cfg` fields an
author would type, then repaints like any other edit.

| gesture | effect |
|---|---|
| **click a cell** | toggle on/off (unchanged). |
| **press a cell + drag ↕** | velocity scrub, continuous `v` 0.2–1.0 (up = louder), live opacity feedback. An off cell turns on at scrub start. Hold **shift mid-drag** for fine (¼ rate). Writes `v` exactly like the shift-click cycle — any 2-decimal value, not just the cycle stops. |
| **press a cell + drag ↔** | paint toggle across the row: the run copies the **first cell's new (toggled) state** — off-run paints 0, on-run paints 1 (cells already on keep their `v`/`p`/`n`/`r`). Fast pattern entry. |
| **shift-click / alt-click / alt+shift-click** | the velocity / probability / ratchet cycles — kept as click fallbacks. |
| **row ⠿ drag** | reorder `cfg.rows` (drop indicator shows the target). Patterns key by row `id`, so lanes carry their cells with them; lane order is organizational — every row still schedules the same audio. |
| **row M / S chips** | write `rows[].muted` / `rows[].solo` (delete on un-toggle — configs stay minimal). Lit M is red, lit S gold; soloed lanes highlight, silenced lanes dim; row LEDs mirror the M/S state. Instant on the live bus while playing. |

**The arrangement strip** replaces the old song-chips row entirely. Each `song` entry
is a timeline block: width ∝ pattern length (expanded playthroughs × steps), a stable
umber-family hue derived from the pattern NAME (renames keep colors honest, reorders
don't shuffle them), the pattern name, and a micro-preview of the pattern's cells as
velocity-scaled density dots per row — the sequencer's answer to MIDI dots in a
region. Alt-every entries render as one bracketed run (`A A A→F`; `A×N→F` past 4).
A playhead sweeps the sounding block on the audio clock (sched-derived, never wall
time); it hides while cueing.

| arrangement gesture | effect |
|---|---|
| **drag a block** | reorder `cfg.song` (drop indicator between blocks). |
| **alt-drag a block** | duplicate the entry at the drop point. |
| **click (stopped)** | open the block popover — `p` / `alt` / `every` fields (make/edit/demote an alt-every run) + remove. |
| **click (playing)** | cue the block's pattern (see Live performance above). |
| **double-click** | jump the grid editor to that pattern. |
| **Delete / Backspace** (focused) | remove the entry (song keeps ≥ 1). |
| **← / →** (focused) | move the block; blocks are tabbable (keyboard-accessible reordering). |
| **+A +B …** | append a pattern to the song. |

Conventions (suite-wide): pointer capture for every gesture, ≥ 12 px hit zones,
cursor affordances (`ns-resize` while scrubbing, `grab` on grips), rAF-throttled
repaint that idles when nothing moves, drags land in the config through the studio's
normal update path.
