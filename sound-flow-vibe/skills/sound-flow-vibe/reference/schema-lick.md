# LICK — config schema v1 (authoritative)

One file, three consumers (INV-7): the app's parameter reference, the vibe skill's
authoring vocabulary, and the property source for `scripts/verify.mjs`. If the engine
and this file disagree, this file wins until a spec delta says otherwise.

**Router note:** LICK is the *guitar* studio — a fretboard, tab, strums, bends. For a
synth melody or arp reach for **CIRCUIT**; for a drum groove, **PULSE**. If the ask has
strings, frets, chords-as-shapes, strumming, or the word "guitar" in it, it is LICK.

Envelope: `{ "v": 1, "studio": "lick", "cfg": { … } }`. Bare `cfg` objects are what you
author; the codec and substrate wrap them.

**Partial-config law (§18 1.2):** merge is TOP-LEVEL — `{...defaults(), ...cfg}` on
every host. `voice`, `room`, `notes` and `strums` are **atomic**: author the whole
key or omit it. Authoring `"notes": []` silences the lick and keeps the strums;
omitting `notes` keeps the default lick.

LICK is pure synthesis: the URL alone reproduces the take (no `__buffers`, no bundle).

---

## The instrument, in one paragraph

Every note is a physically modelled plucked string (Karplus-Strong, ported from
guitarza): a burst of seeded noise circulating through a tuned delay loop and a
lowpass — the loop length is the pitch, the lowpass is the string's decay. Chords are
*rolled*, not triggered: the pick crosses the strings over 5–38 ms, down-strums lean on
the bass strings, up-strums on the treble. Everything is heard through a body EQ and a
synthesised room. All jitter — timing, brightness, excitation — comes from `rng(seed)`:
same URL, same take, byte for byte (LCK-6).

## Fields

| field | type | range / values | default | notes |
|---|---|---|---|---|
| `seed` | uint32 \| string | any | `"porch-light"` **(mandatory)** | Feeds `rng(seed)`. Exactly 2 draws per pluck, fixed walk order (LCK-6). |
| `bpm` | number | 50–180 | 92 | `stepDur = 60/bpm/4` — the grid is 16ths, bar = 16 steps (LCK-3). |
| `bars` | int | 1–8 | 2 | Loop length. Total steps = `bars × 16`. |
| `swing` | number | 0–0.6 | 0.08 | Delays odd steps by `swing × stepDur`. |
| `humanize` | number | 0–1 | 0.55 | Scales what the seeded jitter does (±5 ms timing, brightness, stroke variation). `0` = machine take, same draw count. |
| `tuning` | string | `standard` `drop-d` `open-g` `open-d` `dadgad` `half-down` | `standard` | String 0 = LOW E (LCK-2). |
| `capo` | int | 0–7 | 0 | Raises every open string. Frets stay absolute (0 = behind the capo). |
| `tone` | string | `steel` `electric` `nylon` | `steel` | The guitarza presets. `steel`/`nylon` run the body resonator; `electric` is direct. |
| `voice` | object | — | see below | The playing hand. Atomic on merge. |
| `room` | object | — | see below | The space. Atomic on merge. |
| `level` | number | 0–1 | 0.85 | Master gain before the tail gate. |
| `notes` | array | — | the demo lick | Tab cells. Atomic on merge. |
| `strums` | array | — | the demo pocket | Strum lane. Atomic on merge. |

### `voice`

| field | range | default | maps onto the model as |
|---|---|---|---|
| `pick` | 0–1 | 0.6 | Attack hardness — shifts pluck damping (harder = brighter, more pick in the note). |
| `bright` | 0–1 | 0.5 | String damping — brighter also rings a touch longer. |
| `ring` | 0–1 | 0.7 | How long a string sounds before it is let go: 0 ≈ 0.2 s staccato, 1 = full natural decay (~2.5 s). |
| `palmMute` | 0–1 | 0 | Darkens the loop and shortens the ring — chug at 1. A hand position, not a per-cell mark. |

### `room`

| field | values / range | default | notes |
|---|---|---|---|
| `kind` | `dry` `room` `hall` `plate` | `room` | Synthesised IRs (fixed seeds — never drawn from `cfg.seed`). |
| `amount` | 0–1 | 0.28 | Equal-power wet/dry — turning the room up does not drop the level. |
| `width` | 0–1 | 0.6 | Scales per-string stereo placement (low strings left, high right — sitting behind the guitar). |

### `notes[]` — tab cells

`{ "t": 18, "s": 5, "f": 3, "v": 0.9, "art": "b" }`

| field | type | range | notes |
|---|---|---|---|
| `t` | int | 0 … `bars×16 − 1` | Step index (16ths from the top of the loop). |
| `s` | int | 0–5 | String, **0 = low E** … 5 = high e. |
| `f` | int | 0–24 | Fret. 0 = open. |
| `v` | number? | 0–1 | Velocity; default 0.8. |
| `art` | string? | `h p b ~ / \ x` | See articulation table. Omit for a plain pick. |

### Articulation (LCK-4)

| art | name | what the engine does | vibe words |
|---|---|---|---|
| `h` | hammer-on | quieter, pick transient damped away | "hammer", legato up |
| `p` | pull-off | as `h`, slightly softer | "pull-off", legato down |
| `b` | bend | holds, then rises a whole step (+200 ¢) | "bend it", "cry" |
| `~` | vibrato | ±22 ¢ triangle at 5.5 Hz after a 90 ms settle | "vibrato", "shake it" |
| `/` | slide up | starts a whole step low, lands on pitch in 90 ms | "slide into" |
| `\` | slide down | the mirror — starts high | "fall into" |
| `x` | dead note | percussive chick, ~120 ms | "chick", "scratch", funk mute |

Two notes on the same string steal each other: the earlier one hands over with a 45 ms
fade ending at the new onset (LCK-9). Use that — a hammer-on is `f:0` then `f:2 art:h`
on the SAME string one step apart.

### `strums[]` — the strum lane

`{ "t": 0, "chord": "Em", "dir": "D", "v": 0.85 }`
`{ "t": 8, "frets": [null, 3, 2, 0, 1, 0], "dir": "U" }`

| field | type | notes |
|---|---|---|
| `t` | int | Step index, same domain as notes. |
| `chord` | string? | Symbol → shape: the open table first (`C Cmaj7 C7 D Dm D7 Dm7 Dmaj7 E Em E7 Em7 Emaj7 G G7 Gmaj7 A Am A7 Am7 Amaj7 B7 Asus4 Dsus4 Esus4 Gsus4`), else a movable E/A-family barre for qualities `maj min 7 m7 maj7 dim 5 sus4` (so `F#m`, `Bb7`, `C#m7` all voice). |
| `frets` | (int\|null)[6]? | Literal shape low→high, `null` = string not played. Wins over `chord` when both given. |
| `dir` | `"D"` \| `"U"` | Down leans bass, up leans treble; roll time is pick travel (LCK-5). |
| `v` | number? | 0–1, default 0.8. |

One of `chord`/`frets` is required. A strum and a note on the same step are both
played (the note usually decorates the top of the chord — steal law applies per string).

## Duration law

`duration = bars × 16 × stepDur + tail`, where `tail = ring-out + room decay + 0.2 s`
— **computed, not authored**. Ring-out follows `voice.ring`/`palmMute`; room decay is
0 / 1.1 / 2.6 / 1.7 s for dry/room/hall/plate. The render always ends in true silence
(tail gate). Default config ≈ 9.0 s.

## Vibe translation table

| the ask | author |
|---|---|
| "campfire strumming" | `tone: steel`, strums only — `D · D · U · D U` per bar (t 0,4,6,8,10 with `dir` D D U D U), `swing 0.1`, `humanize 0.7` |
| "slow blues lick" | `bpm 60–70`, notes on s3–s5 with `b` and `~` on the long ones, `room: hall, amount 0.35` |
| "palm-muted chug" | `tone: electric`, `voice.palmMute 0.8`, low-string 8th notes (every even step, s0–s1), `room.amount 0.1` |
| "spanish feel" | `tone: nylon`, `Am E7 Dm` strums, quick `/` slides, `humanize 0.8` |
| "funk scratch" | `x` dead notes on the offbeats between short up-strums, `voice.ring 0.3` |
| "open-tuning drone" | `tuning: open-g` or `dadgad`, strum `frets` of mostly 0s, `voice.ring 1`, `room: hall` |
| "put a capo on it" | `capo: N` — shapes stay, everything sounds N semitones up |

Perceptual annotations: `pick` above 0.8 gets glassy on `steel`; `palmMute` under 0.3
reads as "slightly tight", over 0.7 as "chug"; `hall` + `ring 1` smears fast licks —
drop `room.amount` when notes are 16ths; bends read best on strings 3–5 above fret 2.

## Worked example — a two-bar Em porch lick

```json
{ "v": 1, "studio": "lick", "cfg": {
  "seed": "porch-light", "bpm": 92, "bars": 2, "swing": 0.08, "humanize": 0.55,
  "tuning": "standard", "capo": 0, "tone": "steel",
  "voice": { "pick": 0.6, "bright": 0.5, "ring": 0.7, "palmMute": 0 },
  "room": { "kind": "room", "amount": 0.28, "width": 0.6 },
  "level": 0.85,
  "strums": [
    { "t": 0,  "chord": "Em",    "dir": "D", "v": 0.85 },
    { "t": 4,  "chord": "Em",    "dir": "D", "v": 0.7 },
    { "t": 6,  "chord": "Em",    "dir": "U", "v": 0.6 },
    { "t": 8,  "chord": "Cadd9", "frets": [null, 3, 2, 0, 3, 3], "dir": "D", "v": 0.8 },
    { "t": 12, "chord": "Cadd9", "frets": [null, 3, 2, 0, 3, 3], "dir": "U", "v": 0.65 },
    { "t": 16, "chord": "Em",    "dir": "D", "v": 0.8 },
    { "t": 26, "chord": "D",     "dir": "D", "v": 0.75 }
  ],
  "notes": [
    { "t": 13, "s": 4, "f": 3, "v": 0.7,  "art": "h" },
    { "t": 14, "s": 5, "f": 0, "v": 0.75 },
    { "t": 15, "s": 4, "f": 0, "v": 0.7 },
    { "t": 18, "s": 5, "f": 3, "v": 0.9,  "art": "b" },
    { "t": 20, "s": 5, "f": 0, "v": 0.75 },
    { "t": 21, "s": 4, "f": 3, "v": 0.8,  "art": "p" },
    { "t": 22, "s": 4, "f": 0, "v": 0.7 },
    { "t": 23, "s": 3, "f": 2, "v": 0.8,  "art": "~" },
    { "t": 30, "s": 0, "f": 0, "v": 0.7 }
  ]
} }
```

(That IS `defaults()` — the fixture pins it.)
