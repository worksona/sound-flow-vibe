# DRIFT — config schema v1 (authoritative)

One file, three consumers (INV-7): this document is the app's parameter reference, the
vibe skill's authoring vocabulary, and the property source for `scripts/verify.mjs`.
If the engine and this file disagree, this file wins until a spec delta says otherwise.

Envelope for sharing/registering: `{ "v": 1, "studio": "drift", "cfg": { … } }`.
Bare `cfg` objects are what you author; the codec and substrate wrap them.

DRIFT is pure synthesis — a URL alone reproduces the audio, no bundle needed.

---

## The loop-safety contract (the headline)

The render window is `bars * beatsPerBar * (60 / bpm)` seconds, and **nothing rings
past it** — silence at the seam is constructed, not faded on afterward:

- every note envelope is clamped so attack + decay ends by `window − 60 ms`; notes
  that cannot fit are dropped by the planner;
- pads decay to zero by their chord window's end; the drone releases to zero by
  `window − 60 ms`;
- the echo stops being **fed** 2×delayTime (~0.62 s) before the window ends, and its
  wet **output** ramps to zero before the seam — recirculating feedback is inaudible;
- every envelope then pins gain to exact 0 with `setValueAtTime`.

The final 60 ms are digital zero and the render begins from silence, so a
window-length render **loops seamlessly with no crossfade** — chain it back-to-back,
tile it in MIX with `loop: true`, or let the studio's live transport re-invoke it.
`tailSec` appends authored silence *after* the window (for one-shot beds that should
breathe at the end); it never extends any envelope. `duration = window + tailSec`.

Determinism: one `rng(seed)` stream, consumed in fixed order **bar → rule-index →
slot** inside `planNotes()` (exported — the studio's activity strip is drawn from the
same plan the audio plays). A `prob` rule draws once per slot (gate) plus once per
fired note (pitch); a `euclidean` rule draws once per fired slot (pitch).

## Fields

| field | type | range / values | default | notes |
|---|---|---|---|---|
| `seed` | uint32 \| string | any | — **(mandatory)** | Feeds `rng(seed)`. ALL note choices draw from it (INV-3). Same seed ⇒ byte-identical render; a new seed is a whole new drift over the same bones. |
| `bpm` | number | 30–180 | 60 | Drives **bar length only** (`barDur = beatsPerBar * 60 / bpm`) — DRIFT has no backbeat to speed up. |
| `beatsPerBar` | int | 1–12 | 4 | Bar geometry. |
| `bars` | int | 1–512 | 24 | The loop-safe render window. 24 bars at 60 bpm / 4 beats = 96 s. |
| `scale` | object | — | A pentatonic (below) | Pitch table the **rules** fire from (the journey has its own chords). |
| `scale.root` | number (Hz) | 20–2000 | 220 | Tonal center; informative for vibing. |
| `scale.freqs` | number[] (Hz) | each > 0, 1+ entries | `[220, 264, 297, 330, 396]` | Rule notes pick uniformly (seeded) from this list, shifted by the rule's `octave`. |
| `journey` | object[] | 1+ windows | Am9 ↔ Fmaj7 ×6 bars | Chord windows, **cycled to fill `bars`** (last window truncated). Each chord tone spawns a ±0.15% detuned sine pair, slow 1.2–2.5 s attack, alternating ±0.25 pan — exactly Beat Lab style. Pads decay to zero by their window's end. |
| `journey[].chord` | number[] (Hz) | 1+ positive | — | Chord tones for the window. |
| `journey[].bars` | int | ≥ 1 | — | Window length before the journey cycles. |
| `drone` | object | — | `{on: true, freqs: [55, 110], level: 0.1}` | Continuous sine bed. First freq at `level`, the rest at `level × 0.3`. Rises ~2 s, releases to zero before the seam. Never echoed. |
| `rules` | object[] | 0+ | pluck E3/8 + keys p0.12 | The generative voices. Each rule scans every bar's `n` slots and fires notes from `scale.freqs`. |
| `rules[].voice` | string | `pluck` \| `keys` \| `bass` \| `shimmer` | — | Timbre (below). |
| `rules[].mode` | string | `euclidean` \| `prob` | — | `euclidean`: slot fires iff `(slot * k) % n < k` — standard bresenham, rotation 0, same pattern every bar (pitches still drift). `prob`: each slot fires with probability `p` (seeded — different every bar, same every render). |
| `rules[].k` | int | 1–n | — (euclidean) | Pulses per bar. |
| `rules[].n` | int | 1–64 | — **(required)** | Slots per bar (both modes). `n: 8` at 60 bpm/4 = one slot per half-beat. |
| `rules[].p` | number | 0–1 | — (prob) | Fire probability per slot. |
| `rules[].octave` | int | −1 \| 0 \| 1 | 0 | Register shift: multiplies the picked freq by 2^octave. |
| `rules[].level` | number | 0–1 | — **(required)** | Note gain. Keep the sum of rule levels ≤ ~0.4 over the pad bed. |
| `rules[].decay` | number (s) | 0.05–30 | per-voice | Envelope decay; clamped near the seam. Defaults: pluck 0.9 · keys 1.6 · bass 1.4 · shimmer 2.4. |
| `rules[].muted` | boolean | — | absent (= false) | **Mixer mute for this rule** (engine 1.1.0, see the mixer contract below). Offline: the rule schedules nothing. Absent ⇒ byte-identical to pre-1.1.0 renders. |
| `drone.muted` | boolean | — | absent (= false) | Mixer mute for the drone. `on: false` is the *structural* off (composition); `muted: true` is the *mixer* off (instant live, still "in the song"). |
| `padsMuted` | boolean | — | absent (= false) | Mixer mute for the journey pads (the pads ARE the journey's sound; the chords stay authored, they just don't play). |
| `space` | object | — | `{echo: 0.25}` | The room. |
| `space.echo` | number | 0–1 | 0.25 | **Send level** into a damped feedback delay (~0.31 s, lowpass 2600 Hz, fb 0.42). Only rule notes are sent — pads and drone stay dry. Gated to silence at the seam (contract above). |
| `tailSec` | number (s) | 0–60 | 0 | Authored silence appended after the window. Leave 0 for loops. |

## The mixer (engine 1.1.0)

DRIFT's channels are each **rule**, the **drone**, and the **pads** (the journey
chords). Each carries an optional mute — `rules[].muted`, `drone.muted`,
`padsMuted` — all additive, all defaulting to absent/false.

**Mute state persists in the config — a user decision.** This deliberately diverges
from MIX, whose solo/mute are session-only listening state: a DRIFT bed is often
*published* with a channel resting (a version of the drift without its drone is a
different piece, and the share URL should carry that). Absent keys ⇒ the config
renders byte-identically to its pre-1.1.0 form (verified against the pinned fixture
and the `drift-bed` gallery hash).

**Offline semantics** (CLI, export, `→ Library`): a muted element schedules nothing.
The rng discipline is untouched — `planNotes()` still consumes the muted rule's draws
in the fixed bar → rule-index → slot order, so **muting a rule never resprinkles the
others** (measured: `planNotes` output is byte-identical with and without muted
flags; a muted rule's onsets vanish from the render and the remaining onset count
equals the other rules' plan exactly).

**Live semantics** (studio playback): every element schedules regardless of mute and
routes through a persistent per-channel gain bus (per-rule dry + echo-send tap,
drone, pads). Mute/unmute is a 15 ms gain ramp on the bus — instant, mid-note, both
directions (unmuting mid-window reveals the already-sounding material, DAW-style).
Rule **level** sliders and the drone **level** slider ride the same buses, so level
moves are heard NOW while still writing the config (measured: mute → −60 dBFS in
32 ms dry; a muted rule's echo *tail* keeps ringing ~0.7 s at `echo: 0.2` — the send
is killed with the channel, the room rings out, by design). Score edits (rules,
density, journey, bpm) stay next-loop — sequencer truth.

**No solo.** An ambient bed with two or three rules doesn't need one — mute the
others; the M chips are one click each. (Considered and dropped deliberately: solo
state on a generative bed reads as composition, and composition belongs in the keys
that persist.)

## The 4 voices

| voice | sound |
|---|---|
| `pluck` | Fast-attack (8 ms) sine, alternating ±0.3 pan per note — the kalimba-like mover. |
| `keys` | Detuned triangle pair (±0.25%), soft 60 ms attack — chorused e-piano tone. |
| `bass` | Triangle **one octave below** the picked freq, 20 ms attack — the warm floor. Never echoed. |
| `shimmer` | Wide detuned sine pair (±0.4%) **one octave above**, slow 350 ms swell — air and glass. |

## Vibe translation table

Mood words → parameter moves. Compose two or three; don't max everything.

| vibe | moves |
|---|---|
| **warmer** | rules `octave: -1`, `drone.level` up to 0.12–0.16, add/boost a `bass` rule |
| **moodier** | minor journey (lower/darken the chords), density down (`k` down, `p` down), keep pluck sparse |
| **glassy** | add a `shimmer` rule with `octave: 1`, `space.echo` up to 0.4–0.6 |
| **six minutes of slow drift** | `bars: 90` at 60 bpm (= 360 s); stretch `journey[].bars` so chords still breathe |
| **busier / arpy** | `n: 16`, euclidean `k: 5–7`, decay short (0.4–0.6) — reads as a broken arpeggio |
| **emptier / vast** | one rule only, `p: 0.05–0.08`, `space.echo: 0.5`, long decays, drone on |
| **brighter** | raise `scale.freqs` an octave (double them) or shimmer + echo; drone level down |
| **grounded / heavy** | `bass` rule euclid 2/4 with `decay: 2`, drone `freqs: [41.2, 82.4]` (low E) |

## Perceptual annotations

- **`p` above 0.3 stops reading as ambient** — the keys start sounding like a player, not weather. 0.08–0.15 is drift; 0.2 is intentional.
- **Euclidean k/n is felt as a pulse even without drums** — E3/8 reads as a slow heartbeat; E5/16 reads as rain.
- **Chord windows shorter than 4 bars read as changes, longer than 8 bars read as places.** The pad attack (up to 2.5 s) needs room to bloom either way.
- **echo above 0.6 smears pitch** — the damped feedback stacks fifths into fog. Beautiful at 0.5 with sparse pluck; mud with dense keys.
- **Rules an octave apart never fight** — stack pluck at 0 and shimmer at +1, or keys at 0 and bass (inherently −1); same-octave stacks blur.
- **The seed is a composition knob**, not a formality: with `p` rules the whole note narrative reorders per seed. Roll seeds until the opening bar sits right — it's free.
- **`bpm` is bar-geometry, not energy** — halving bpm doubles every window; to feel *slower* at the same length, lower density instead.
- **Levels: the pad bed sits ~0.035/tone.** Rule levels 0.08–0.14 float over it; 0.2+ reads as a lead instrument.

## Worked example — "glacier chapel" (vast, glassy, six minutes)

Slow Em→Cmaj7→G journey over 96 bars at 60 bpm (384 s), one sparse pluck heartbeat,
shimmer an octave up through heavy echo, low E drone. Sounds like: standing inside
blue ice while someone rings glass bells very far away.

```json
{
  "seed": "glacier-chapel",
  "bpm": 60,
  "beatsPerBar": 4,
  "bars": 96,
  "scale": { "root": 164.8, "freqs": [164.8, 196, 220, 246.9, 293.7] },
  "journey": [
    { "chord": [164.8, 196, 246.9, 293.7], "bars": 12 },
    { "chord": [130.8, 164.8, 196, 246.9], "bars": 12 },
    { "chord": [98, 146.8, 196, 246.9], "bars": 8 }
  ],
  "drone": { "on": true, "freqs": [41.2, 82.4], "level": 0.12 },
  "rules": [
    { "voice": "pluck", "mode": "euclidean", "k": 2, "n": 8, "octave": 0, "level": 0.1, "decay": 1.2 },
    { "voice": "shimmer", "mode": "prob", "p": 0.07, "n": 8, "octave": 1, "level": 0.07, "decay": 3 }
  ],
  "space": { "echo": 0.55 },
  "tailSec": 0
}
```

Encode it (wraps in the envelope, prints the `#sfa=` link):

```
python3 "$CLAUDE_PLUGIN_ROOT/scripts/encode.py" /path/to/glacier-chapel.json --studio drift --live
```

## Studio interaction — direct manipulation

The interaction law: anything drawn on screen that represents a parameter is directly
grabbable. Configs stay the truth — every gesture writes the same `cfg` fields an
author would type, then redraws the strip from `planNotes()` like any other edit.

| gesture | effect |
|---|---|
| **journey chip ⠿ drag** | reorder `cfg.journey` — the journey order **is** the chord progression, so this is a compositional move. Drop indicator between chips; flow-wrap aware. |
| **drag a chord boundary ↔ in the strip's journey band** | the seam between adjacent chord windows (accent tick in the band) drags ew — moving **bars from one chord to its neighbor**: writes the two `journey[].bars` fields (integer bars, min 1 each, pair total preserved). The bars axis is gridded, so every position is snapped — shift adds nothing beyond the mandatory grid (spec delta 1.8). Chip number-inputs sync live; the strip redraws from `planNotes()`. A single-chord journey has no bars to trade, so its cycle seams don't grab. Double-click a seam = reset: the pair re-splits evenly. |
| **rule row ⠿ drag** | reorder `cfg.rules`. **Rule order is the rng-consumption order** (bar → rule-index → slot), so a reorder resprinkles the texture — *same seed, new sprinkle*. Allowed and intentional; the grip tooltip carries the warning. |
| **drag ↕ on a rule's strip lane** | density push/pull, mode-appropriate: a `prob` rule scales `p` (0–1, 2 decimals, continuous → **shift = fine**), a `euclidean` rule scales `k` (1–`n`, inherently integer-snapped; shift slows travel for precision). Push up = denser, pull down = sparser. The strip redraws live from the engine's own note plan, so the dots are always the notes the audio will play. Rule-row inputs re-sync on release. |
| **M chip** (each rule row · drone · pads) | mixer mute — writes `rules[].muted` / `drone.muted` / `padsMuted` (deleted when false, so untouched configs stay clean). Instant through the live buses mid-playback; lit red when engaged; the strip dims a muted rule's lane and its sparks stop. |
| **level sliders** (rule rows · drone) | write `rules[].level` / `drone.level` as always — and while playing, the same move rides the channel bus so it is heard immediately (15 ms ramp), not next loop. |

Conventions (suite-wide, spec delta 1.8): pointer capture, ≥ 12 px hit zones (each
lane is 24 px tall), `ns-resize` cursor over lanes / `ew-resize` over journey seams /
`grab` on grips, **shift = snap on gridded axes, fine on continuous axes**,
rAF-throttled redraw that idles when nothing moves. Sliders and numeric fields survive
as the secondary affordance; numeric entry remains the primary affordance only for
musical constants (bars, bpm, beats/bar, seed).
