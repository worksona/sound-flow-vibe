# CIRCUIT — config schema v1 (authoritative)

One file, three consumers (INV-7): this document is the app's parameter reference, the
vibe skill's authoring vocabulary, and the property source for `scripts/verify.mjs`.
If the engine and this file disagree, this file wins until a spec delta says otherwise.

Envelope for sharing/registering: `{ "v": 1, "studio": "circuit", "cfg": { … } }`.
Bare `cfg` objects are what you author; the codec and substrate wrap them.

**Partial-config law (§18 1.2):** merge is TOP-LEVEL — `{...defaults(), ...cfg}` on every
host. `patch` and `phrase` are therefore **atomic**: author the whole object (start from
the defaults block below and tweak) or omit the key entirely. A config that authors only
`{ "patch": { "filter": … } }` loses the oscillators and fails validation — on purpose.

CIRCUIT is pure synthesis: the URL alone reproduces the phrase (no `__buffers`, no bundle).

---

## The monitor path (engine 1.1.0 — mixer parity)

CIRCUIT is **one voice + one phrase**, so its mixer is the *monitor path*, not
multitrack:

- **One persistent live context + master bus.** Keyboard audition and phrase
  playback both route through a single master gain that survives transport stops
  (stopping the transport kills its scheduled voices through the voice registry
  instead of closing the context — a ringing audition note survives a transport
  stop, and vice versa).
- **⊘ master mute** (transport bar) ramps that bus 0.8 → 0 in 15 ms — instant,
  mid-note, tails included (measured: −60 dBFS in 27 ms, back in 11 ms).
- **Deliberately NOT persisted in the config** — the asymmetry vs PULSE is a user
  decision: PULSE persists `rows[].muted`/`rows[].solo` because its rows are
  channels of a shared composition; CIRCUIT's ⊘ silences one voice's monitor —
  there is nothing to share, so the config schema is untouched and no `muted` key
  exists here.
- **Live patch moves reach already-sounding voices.** `filter.cutoff`, `filter.q`,
  `filter.type`, `filter.keytrack`, `osc1.level`, `osc2.level` and `fm.index` apply
  to sounding voices via `setTargetAtTime` (τ 10 ms) through the engine's voice
  registry (`playNote` `opts.onVoice`, observer-only — offline renders are
  byte-identical with or without it). Measured on a held note: cutoff 900 → 12 kHz
  is audible (brightness midpoint) 16 ms after the gesture. Caveat: a live cutoff
  move replaces the sounding voice's remaining filter-envelope ramps (the voice
  holds the new base until its release); the next note runs the full envelope at
  the new values. Envelope/LFO/wave/glide edits stay next-note — synthesis truth.

---

## Fields

| field | type | range / values | default | notes |
|---|---|---|---|---|
| `seed` | uint32 \| string | any | 47 **(mandatory)** | Feeds `rng(seed)`. Only the `random` arp pattern draws from it (1 draw per step, fixed order) — every other phrase is randomness-free. Same seed ⇒ byte-identical render. |
| `bpm` | number | 40–200 | 96 | Tempo. Note `t`/`dur` are in beats; 1 beat = `60/bpm` s. |
| `scale.root` | number (Hz) | 20–2000 | 220 | Keytrack reference: a note at `root` hears `filter.cutoff` exactly; others shift by `(note/root)^keytrack`. |
| `scale.freqs` | number[] (Hz) | each > 0, 1+ entries | `[220, 264, 330, 396, 495]` (A C E G B — Am9 tones) | Ordered low→high. Index law everywhere (grid, notes, arp): `n` wraps modulo length, **each full wrap shifts one octave** (`n = len` ⇒ `freqs[0]×2`, `n = −1` ⇒ `freqs[len−1]÷2`). |
| `patch` | object | — | hollow FM bell (below) | The whole voice. Atomic on merge — see law above. |
| `phrase` | object | — | Am9 up-arp, 4 bars | What plays the voice. Atomic on merge. |
| `tailSec` | number (s) | 0–60 | 2.5 | Silence budget after the phrase window for releases to ring into. The engine clamps the effective tail to **≥ `ampEnv.r` + 0.1** — a release can never overrun the render, and the last 20 ms are always digital zero. |

### `patch.osc1` (carrier) · `patch.osc2`

| field | type | range | default (osc1 / osc2) | notes |
|---|---|---|---|---|
| `wave` | string | `saw` \| `square` \| `triangle` \| `sine` | `sine` / `sine` | |
| `octave` | int | −2–2 | 0 / 0 | Frequency × 2^octave. |
| `detune` | number (cents) | −50–50 | 0 / 0 | Constant detune. ±4–10 on paired saws = classic chorus width. |
| `level` | number | 0–1 | 0.8 / 0 | Mix into the filter. osc2 at level 0 is silent (fm off). |
| `ratio` (osc2 only) | number \| null | 0.25–16 or null | null | When set, osc2 freq = note × ratio (overrides `octave`) — fixed-interval partner osc. |

### `patch.fm` — 2-op FM

| field | type | range | default | notes |
|---|---|---|---|---|
| `on` | boolean | — | true | **On ⇒ osc2 becomes the modulator** (its `wave` applies; `octave/detune/level/ratio` are ignored): modulator freq = note × `ratio`, and its output — scaled to `index` Hz of deviation — feeds osc1.frequency. The osc2 audio path is bypassed. |
| `ratio` | number | 0.5–8 | 3.01 | Modulator : carrier. Integers = harmonic (organ/brass); just-off integers (2.01, 3.01) = slowly beating bell partials; far-off (1.41, 2.37) = clangorous. |
| `index` | number (Hz) | 0–400 | 180 | Modulation depth. 0 = pure carrier; 60–150 = warm; 150–250 = bell; above 250 reads metallic. |

### `patch.filter`

| field | type | range | default | notes |
|---|---|---|---|---|
| `type` | string | `lowpass` \| `highpass` \| `bandpass` | `lowpass` | |
| `cutoff` | number (Hz) | 20–18000 | 4200 | Base cutoff before keytrack/envelope/LFO. |
| `q` | number | 0.3–12 | 0.7 | Resonance. Voice gain auto-compensates by 1/√q above 1, so cranking q squelches without clipping. |
| `envAmt` | number | 0–1 | 0.25 | Scales the filter-envelope excursion: peak cutoff = base × 2^(4·envAmt) — up to +4 octaves at 1. 0 = envelope does nothing. |
| `keytrack` | number | 0–1 | 0.6 | Base cutoff shifts by `(note/scale.root)^keytrack`. 1 = brightness constant up the keyboard; 0 = fixed cutoff (high notes duller). |

### `patch.ampEnv` · `patch.filterEnv` — ADSR (per note, scheduled ramps)

| field | type | range | default (amp / filter) | notes |
|---|---|---|---|---|
| `a` | number (s) | 0–5 | 0.004 / 0.002 | Attack (clamped into the gate). |
| `d` | number (s) | 0–10 | 1.6 / 0.9 | Decay toward sustain. |
| `s` | number | 0–1 | 0 / 0.2 | Sustain level (amp: × peak; filter: fraction of the excursion in octaves). |
| `r` | number (s) | 0.01–20 | 2.4 / 1.5 | Release from gate end, clamped to end 20 ms before the render does, pinned to exact 0. |

### `patch.lfo` · `patch.glide`

| field | type | range | default | notes |
|---|---|---|---|---|
| `lfo.wave` | string | the 4 waves | `sine` | |
| `lfo.rate` | number (Hz) | 0.05–20 | 0.3 | |
| `lfo.target` | string | `pitch` \| `cutoff` \| `amp` \| `none` | `none` | Per-voice, phase locked to note onset (deterministic). pitch: ±depth×100 cents on every osc (FM ratio survives vibrato); cutoff: ±depth×base/2 Hz; amp: tremolo swinging [1−depth, 1]. |
| `lfo.depth` | number | 0–1 | 0 | |
| `glide` | number (s) | 0–0.3 | 0 | Portamento: each note slides from the previous note's pitch (time order) over `glide` s. 0.04–0.08 = acid slur; 0.2+ = sirens. |

### `phrase`

| field | type | range | default | notes |
|---|---|---|---|---|
| `mode` | string | `notes` \| `arp` | `arp` | Which sub-object plays. The inactive one may be omitted (`notes` defaults to `[]`). |
| `bars` | int | 1–64 | 4 | Phrase window = `bars × beatsPerBar` beats; gates are clamped to it. |
| `beatsPerBar` | int | 1–12 | 4 | |
| `notes` | object[] | — | `[]` | notes mode: `{ "t": beats ≥ 0, "dur": beats > 0, "n": int −24–96, "v": 0–1? }`. `n` uses the scale index law; `v` defaults 1. Notes starting outside the window are skipped; overlaps are allowed (poly). |
| `arp.chord` | int[] | 1+ entries, each −24–96 | `[0,1,2,3,4]` | Scale degrees, sorted ascending internally. |
| `arp.pattern` | string | `up` \| `down` \| `updown` \| `random` | `up` | `updown` ping-pongs without doubling endpoints. `random` draws per step from the seed — deterministic. |
| `arp.rate` | number | 0.25 \| 0.5 \| 1 | 1 | Beats per step (1/16, 1/8, 1/4). |
| `arp.octaves` | int | 1–3 | 2 | Chord repeats shifted `+len` per octave before ordering. |
| `arp.gate` | number | 0.1–1 | 0.9 | Note length as a fraction of the step. Short gate + long release still rings — bells want 0.8+, staccato wants ≤ 0.3 with short `r`. |

## Direct manipulation (studio)

The studio draws these parameters as grabbable graphs; every drag writes the same
config fields documented above (through the studio's normal update path) and the
compact sliders beneath each graph stay live in both directions. Conventions
everywhere: pointer capture, ≥12 px hit zones, shift = fine (pointer motion at ~15%),
double-click a handle = reset it to the defaults, cursors telegraph the axis
(`ew-resize` / `ns-resize` / `grab`).

- **ADSR graphs** (amp env, filter env): the envelope drawn as its A-D-S-R shape with
  three handles — attack apex (x = `a`), decay/sustain knee (x = `d`, y = `s`),
  release end (x = `r`) — plus the sustain plateau itself, draggable vertically
  (y = `s`). The x axis is log-ish (`log1p(v/v0)` warped) so millisecond attacks stay
  grabbable next to 10-second decays.
- **Filter response strip**: log 40 Hz–16 kHz, an *approximate* normalized 2nd-order
  magnitude curve (not biquad-exact — corner/slope/bump are steering-accurate). One
  handle at the cutoff corner: x = `cutoff` (log), y = `q` through the bump law
  `q = 10^(dB/20)` — the handle height IS the resonance bump. A dashed ghost curve
  shows the filter-envelope peak at the engine's excursion law `cutoff × 2^(4·envAmt)`;
  dragging the ghost's handle along x sets `envAmt = log2(f/cutoff)/4` (the ghost
  corner follows the pointer). At `envAmt` 0 the ghost handle parks 12 px right of the
  main handle so it stays grabbable.
- **LFO XY pad**: x = `lfo.rate` (log 0.05–20 Hz), y = `lfo.depth` (up = deeper).
  Pointer-down anywhere on the pad moves the handle there.
- **Grid velocity push/pull**: press an active note cell and drag ↑↓ to push its `v`
  continuously through 0.05–1 (opacity tracks it live; shift = fine). A plain click
  still toggles the cell; shift-click still cycles 1.0 → 0.7 → 0.4.

Numeric entry remains only for the musical constants (bpm, seed, bars, beats/bar,
tail, root, scale Hz list).

## Vibe translation table

Mood words → parameter moves. Compose two or three; don't max everything.

| vibe | moves |
|---|---|
| **hollow bell / music box** | the defaults, verbatim: sine carrier, `fm.on` ratio 3.01 index 180, ampEnv s 0 with long d + r, slow `up` arp over 2 octaves |
| **acid line** | osc1 `saw` octave −1, `lowpass` q **8+**, cutoff 400–900, envAmt **0.7–0.9**, snappy envelopes (d ≈ 0.15, s ≤ 0.3, r ≈ 0.1), glide 0.05, **notes mode 16ths** (dur 0.25) with a few octave jumps (`n` +5/len) |
| **warm pad** | **detuned saws**: osc1 saw detune −6, osc2 saw detune +6 level 0.7, fm off, **slow attack** (a 0.4–0.8, s 0.8, r 1.5+), `lowpass` cutoff ~1800 **envAmt 0.2**, q 0.5, arp off-feel: rate 1, gate 1, or long notes-mode chords |
| **chiptune** | osc1 `square`, **no fm**, osc2 level 0, tight envelopes (a 0.002, d 0.06, s 0.6, r 0.05), filter open (cutoff 8000+, envAmt 0), **arp `updown` rate 0.25**, octaves 2–3, gate 0.5 |
| **organ / brass** | fm on with integer ratio (2 or 3), index 80–140, s 0.8, medium attack for brass swell (a 0.06) |
| **dark drone floor** | notes mode: one long note per bar at n −len, glide 0.15, lfo target `cutoff` rate 0.15 depth 0.4 |
| **vibrato lead** | lfo target `pitch` rate 5–6 depth 0.05–0.1, glide 0.03, notes mode with dur 0.5–1 |
| **broken machine** | arp `random`, rate 0.25, octaves 3, bandpass q 6, lfo target `amp` rate 8 depth 0.8 |

## Perceptual annotations

- **fm index above 250 reads metallic** — 150–250 is the bell sweet spot; keep below 120 for anything meant to sit under a mix.
- **q above 10 self-oscillates — use for acid only**, and keep envAmt high so the whistle sweeps instead of parking on one frequency. (Gain compensation keeps it clip-free, not polite.)
- **fm ratio just off an integer (3.01 vs 3) is what makes a bell breathe** — the partials beat at the offset rate. Exact integers sound static/organ-like.
- **envAmt below 0.15 is felt, not heard**; 0.4+ is an audible sweep; 0.8+ with high q is the acid squelch.
- **Sustain 0 turns any patch percussive** — the gate stops mattering and d + r shape everything.
- **Gate is articulation, release is space**: shortening gate with r ≥ 0.5 reads as the same note in a bigger room, not staccato. For true staccato cut both.
- **Glide over 0.1 on 16th notes smears pitch identity** — at rate 0.25 keep glide ≤ 0.06.
- **Detuned-pair width (±6¢) collapses if both oscs also carry octave offsets** — keep the pair at the same octave for pad chorus.
- **`updown` at rate 0.25 over 3 octaves is instant Autumn-leaves chiptune**; the same notes at rate 1 read as a harp.
- **keytrack 0 makes high arp notes duller** — usually wrong for bells (use 0.5+), right for basses that shouldn't fizz.

## Worked example — "basement acid" (dark, squelchy, rolling)

A2-rooted minor-pentatonic 16th line at 132, saw an octave down into a resonant lowpass
(q 9, envAmt 0.85), snappy envelopes, a touch of glide. Sounds like: a 303 in a concrete
stairwell — rubber-band lows, whistling sweeps on the accents.

```json
{
  "seed": "basement-acid",
  "bpm": 132,
  "patch": {
    "osc1": { "wave": "saw", "octave": -1, "detune": 0, "level": 0.9 },
    "osc2": { "wave": "saw", "octave": -1, "detune": 0, "level": 0, "ratio": null },
    "fm": { "on": false, "ratio": 2, "index": 0 },
    "filter": { "type": "lowpass", "cutoff": 700, "q": 9, "envAmt": 0.85, "keytrack": 0.3 },
    "ampEnv": { "a": 0.003, "d": 0.18, "s": 0.25, "r": 0.12 },
    "filterEnv": { "a": 0.003, "d": 0.14, "s": 0.1, "r": 0.1 },
    "lfo": { "wave": "sine", "rate": 0.3, "target": "none", "depth": 0 },
    "glide": 0.06
  },
  "scale": { "root": 110, "freqs": [110, 130.8, 146.8, 164.8, 196] },
  "phrase": {
    "mode": "notes",
    "notes": [
      { "t": 0,    "dur": 0.25, "n": 0 }, { "t": 0.5,  "dur": 0.25, "n": 0, "v": 0.6 },
      { "t": 1,    "dur": 0.25, "n": 3 }, { "t": 1.5,  "dur": 0.25, "n": 0, "v": 0.6 },
      { "t": 2,    "dur": 0.5,  "n": 5 }, { "t": 2.75, "dur": 0.25, "n": 4, "v": 0.7 },
      { "t": 3,    "dur": 0.25, "n": 0 }, { "t": 3.5,  "dur": 0.25, "n": 7, "v": 0.8 }
    ],
    "bars": 2, "beatsPerBar": 4
  },
  "tailSec": 0.3
}
```

Encode it (wraps in the envelope, prints the `#sfa=` link):

```
python3 "$CLAUDE_PLUGIN_ROOT/scripts/encode.py" /path/to/basement-acid.json --studio circuit --live
```
