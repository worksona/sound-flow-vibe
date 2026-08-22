# STOMP — config schema v1 (authoritative)

One file, three consumers (INV-7): this document is the app's parameter reference, the
vibe skill's authoring vocabulary, and the property source for `scripts/verify.mjs`.
If the engine and this file disagree, this file wins until a spec delta says otherwise.

Envelope for sharing/registering: `{ "v": 1, "studio": "stomp", "cfg": { … } }`.
Bare `cfg` objects are what you author; the codec and substrate wrap them.

STOMP is the **pedalboard**: an ordered `board` of fx blocks over **one input**, with a
**vocoder** as one of the blocks. It is the suite's first live surface — the same board
that renders a clip in the CLI runs on a microphone in the browser — and it stays lawful
because the mic is a *studio mode*, never a config value (see "The live rule" below).

---

## Which studio am I reaching for?

The suite now has three surfaces that touch a voice. They are not interchangeable:

| you want to… | reach for | because |
|---|---|---|
| put a voice (or anything) through pedals, live or on a clip | **STOMP** | a board is a *stream* processor: no source in it, so a mic can feed it |
| age, resample, stretch, or slow down a finished clip | **TAPE** | `rate`/`stretch`/`vinyl` are *source-stage* — they need a buffer, not a stream |
| speak a written script and get keyed takes/deck m4a | **VOX** | VOX authors *text*; it never hears you |

The overlap is deliberate and shared, not copied: STOMP's `drive` `crush` `wobble`
`lowpass` `highpass` `space` `gain` are **the same builders TAPE runs**
(`src/lib/fx-chain.mjs`), same names, same params, same sound. Authoring one teaches the
other. What STOMP cannot do is TAPE's three source-stage moves — `rate`, `stretch`,
`vinyl` are rejected by `validate` with a message saying so, because a pedal has a
stream and those need a buffer.

---

## The live rule (why a realtime studio still obeys INV-2/3/10)

**`input.ref` always names a clip. The microphone is never in the config.**

- The **studio** may substitute the live mic for the clip while you monitor — that is a
  monitoring mode, exactly like LOOM's, and it changes nothing the config records.
- `input.live: true` is a *preference* ("open this board armed"), not a source. Offline
  hosts read it and ignore it.
- So: a share link always opens with audio on a cold library, `duration()` is always
  defined, the render is always deterministic, and **Claude renders any board over any
  library clip with no browser and no microphone** (INV-10).

**Capturing a live take (RT-13).** Press ⏺ and the **dry** mic take lands in the library
as an ordinary asset; the studio repoints `input.ref` at it. Config + that asset
re-render offline to exactly what you heard. That is the whole round trip — no new
machinery, no gesture timeline, and the take is an ordinary suite clip that MIX can
place and CHOP can slice.

---

## Fields

| field | type | range / values | default | notes |
|---|---|---|---|---|
| `seed` | uint32 \| string | any | 47 **(mandatory)** | INV-3. Consumed only by the vocoder's carrier noise, drawn from `rng(seed)` in board order (noise first within a block). Same seed ⇒ same take, byte-exact on the Node host. |
| `input` | object | — | — **(author it)** | The one clip the board processes. |
| `input.ref` | string | `hash:` · `name:` · `tag:` clip ref | `"name:killer-01/3"` | Resolved by the host, injected as `__buffers[ref]`. A narration line by default, so a fresh page sounds like a voice through a vocoder. |
| `input.gainDb` | number (dB) | −24–24 | 0 | Input trim, ahead of everything. Drive-into-the-board lives here. |
| `input.live` | boolean | — | `false` | Studio preference: open armed on the mic. **Never a source** — see the live rule. |
| `board` | object[] | 0+ blocks | the default board (below) | **Array order = signal order.** Repeats allowed (two drives, two spaces…). Empty board = the input at `output` level. |
| `output.gainDb` | number (dB) | −24–24 | 0 | Final trim. STOMP has no limiter by design — add a `comp` block if you want one. |
| `output.blend` | number | 0–1 | 1 | The whole board against the untouched input. `1` = board only, `0` = bypass, `0.5` = parallel-processing. The pedalboard-wide blend knob. |
| `tailSec` | number (s) | 0–10 | 0.6 | Silence appended after the input ends — where `space` rings out. Offline only; live has no end. |

**Duration law:** `duration = inputClipLength + tailSec`. A pedalboard never changes the
length of what you play — that is precisely what makes it stream-safe, and why TAPE's
length-changing moves are not here.

---

## The board table

### The shared seven (identical to TAPE — `src/lib/fx-chain.mjs`)

| fx | params | range | what it sounds like |
|---|---|---|---|
| `drive` | `amount` | 0–1 | tanh saturation blended with identity: `0` is a true no-op, 0.2–0.4 is warmth, 0.6 is obvious grind, 1 is fuzz. Also tames peaks — the safety valve before a hot `space`. |
| `crush` | `bits` | 3–16 | Staircase quantize, `2^bits` levels. 12+ is subtle grit, 8 is "old sampler", 6 is fizzy, 3–4 is destroyed. Quiet material crushes harder — drive before crush to feed it. |
| `wobble` | `depthMs`, `rateHz`, `mix?` | 0–12 ms, 0.1–8 Hz, 0–1 (=1) | Pitch instability off a modulated 15 ms delay. Shallow+fast (1–2 ms / 6 Hz) is flutter; deep (8–12 ms) is seasick. `mix` **1 (default) is a vibrato** — fully wet, so the pitch itself moves; **below 1 the dry rejoins and it is a chorus**. Omitting `mix` builds the exact graph TAPE has always built, which is why every shipped TAPE render is byte-identical across this addition. |
| `lowpass` / `highpass` | `from`, `to?`, `q?` | 20–20000 Hz, q 0.3–8 | Filter at `from`. `q` above ~2 whistles at the cutoff. **`to` sweeps only offline** — it ramps across the render window, and a live board has no window, so live it stays static at `from`. Documented divergence, not a silent one. |
| `space` | `time`, `feedback`, `damp`, `mix` | 0.01–5 s, 0–1, 40–20000 Hz, 0–1 | Feedback delay with damping in the loop: 0.02–0.08 s reads as a metallic room, 0.1–0.5 as slap, 1+ as canyon. Offline the feedback is gated so `tailSec` bounds the ring-out; live it rings until you stop. |
| `gain` | `db` | −24–24 | Clean level trim between blocks. |
| `space`/`drive` order | — | — | drive **before** space reads warm (saturated signal in a clean room); space before drive reads blown-out — the dub move. |

`rate`, `stretch` and `vinyl` are **rejected** here with a message pointing at TAPE.

### STOMP's own four

| fx | params | range | what it sounds like |
|---|---|---|---|
| `vocoder` | see below | — | Your articulation on someone else's pitch. The marquee block — but one block, and it obeys board order like any other. |
| `pitch` | `semitones`, `windowMs?`, `mix?` | −24–24 (0, or 0.25 st minimum), 20–200 ms (=80), 0–1 (=1) | Crossfaded two-tap delay line: the **1980s pedal**, by construction. Correct pitch, unity level, and the characteristic crossfade shimmer. Fractional shifts are allowed, but a non-zero shift must be at least **0.25 st** — the sweep period is `windowMs` divided by `abs(1 − ratio)`, so a vanishing shift needs an unbounded LFO buffer; `validate` says so rather than silently bypassing. Small shifts (±1–3) thicken; −12 is the monster; +12 is the chipmunk. `windowMs` trades warble (short) against echo-y smear (long); 60–100 is the usable band. `mix` below 1 gives you the detune/harmonizer sound. **No formant correction** — a shifted voice moves its formants with it, which is what makes ±12 read as a cartoon rather than a person. That is the honest limit of plain nodes. |
| `ring` | `hz`, `mix?` | 0.1–4000 Hz, 0–1 (=1) | The input multiplied by a sine. Below ~20 Hz it is tremolo; 50–500 Hz is the Dalek clangour; above that it is inharmonic metal. `mix` 0.3–0.5 keeps the words readable. |
| `comp` | `thresholdDb?`, `ratio?`, `attack?`, `release?`, `kneeDb?` | −60–0 (=−20), 1–20 (=4), 0–1 s (=0.006), 0–1 s (=0.18), 0–40 (=12) | A real compressor node. On a live board put it **first** to even out mic distance before the vocoder, or **last** as the safety net STOMP otherwise lacks. |

### `vocoder` params

| param | type | range | default | notes |
|---|---|---|---|---|
| `bands` | int | 4–32 | 16 | Log-spaced bandpass pairs. 8 is coarse and vintage, 16 is the classic, 24–32 is articulate and expensive (each band is 6 nodes). |
| `lo` / `hi` | Hz | 40–2000 / 800–16000 | 140 / 6500 | The ladder's ends. `hi` must be ≥ 1.5×`lo`. Narrowing the span concentrates the effect; widening it thins it. |
| `follow` | Hz | 2–80 | 14 | Envelope-follower cutoff — how fast a band opens. Low (4–8) is smooth and laggy; high (25–40) is spitty and consonant-forward. |
| `sens` | number | 0.5–40 | 8 | Envelope→gain scaling. Raise it if the effect is shy, lower it if bands slam shut. |
| `carrier.type` | string | `saw` `square` `triangle` `sine` `pulse` | `saw` | What gets shaped. `saw` is the classic (dense harmonics = every band has something to open); `sine` barely vocodes — there is nothing in the upper bands to gate. |
| `carrier.notes` | int[] | midi 12–108, max 8 | `[36, 43, 48]` | The chord the output sings. C2–G2–C3 is a fifth stack: neutral, always in key. This is the pitch you hear — **not** the speaker's. |
| `carrier.detuneCents` | number | 0–50 | 7 | Doubles each note detuned ±cents. 5–12 is thickness; 25+ is seasick. |
| `carrier.noise` | number | 0–1 | 0.08 | Seeded noise mixed into the carrier — restores breath and helps consonants. A fixed 2 s loop, so it is identical live and offline. |
| `sibilance` | number | 0–1 | 0.4 | A highpassed copy of the **voice** joined to the wet sum. Consonants live above the top band; a vocoder without this is unintelligible. 0.3–0.5 is speech, 0 is full robot. |
| `makeupDb` | dB | −12–36 | 14 | The band ladder loses a lot of level. Default lands the stock board at −2.9 dBFS peak. |
| `mix` | number | 0–1 | 1 | Vocoded against the dry voice **at this block**. 0.7 is the "intelligible robot" setting. |

*Why the carrier is not a borrowed CIRCUIT patch (GRV-5 asks):* a vocoder carrier has no
envelope and no filter of its own — the bands **are** its filter, and it never stops. There
is no voice there to borrow, so STOMP builds oscillators directly. When GROOVE lands and
needs a real synth voice, that is when `lib/voices-synth.mjs` earns its extraction.

---

## The default board

```json
{ "v": 1, "studio": "stomp", "cfg": {
  "seed": 47,
  "input": { "ref": "name:killer-01/3", "gainDb": 0, "live": false },
  "board": [
    { "fx": "highpass", "from": 90 },
    { "fx": "vocoder", "bands": 16, "lo": 140, "hi": 6500, "follow": 14, "sens": 8,
      "carrier": { "type": "saw", "notes": [36, 43, 48], "detuneCents": 7, "noise": 0.08 },
      "sibilance": 0.4, "makeupDb": 14, "mix": 1 },
    { "fx": "drive", "amount": 0.18 },
    { "fx": "space", "time": 0.14, "feedback": 0.32, "damp": 4200, "mix": 0.25 },
    { "fx": "gain", "db": -2 }
  ],
  "output": { "gainDb": 0, "blend": 1 },
  "tailSec": 0.6
} }
```

Measured on the Node host (`killer-01/3`, a 2.85 s narration line): peak **−1.98 dBFS**,
RMS **−15.7 dBFS**, voice→output envelope correlation **r = 0.745**, **36.2 dB** between
voice-loud and voice-silent frames, and the carrier chord tones lifted **+35.7 / +38.5 /
+9.6 dB** over dry against **+18.4 / +3.2 dB** for tones outside the chord. That is the
numeric definition of "it vocodes" — the output tracks your articulation and sings the
carrier's pitch, not yours. Regressions should be caught against those figures.

`name:killer-01/3` is deliberately a **seed-pack** asset (`apps/demo/manifest.json`), so a
share link opened on a cold library seeds itself and plays. Pointing the default at any
asset outside the seed pack reintroduces the v1.10 silent-link break (delta 1.13).

---

---

## The preset shelf — three banks, 25 boards

Presets ship in the engine as `STOMP_PRESETS` (grouped by `STOMP_BANKS`) — **not** in the
studio page, because a preset that only exists as a button is one the agent cannot reach
(INV-10). The studio draws them as stompboxes, `stompApplyPreset(cfg, id)` applies one, and
`verify.mjs` renders every one of them twice and asserts audible / clip-free / deterministic
/ distinct.

A preset replaces `board`, plus `output` and `tailSec` where the sound needs it. It never
touches `input` or `seed`: **the pedal changes, the material does not.**

### Compounding — pedals stack

`stompApplyPreset` *replaces* the board; **`stompStackPreset(cfg, id)` appends to it**, which is
how a real board works: several pedals on at once, each landing downstream of the last.

```js
let c = defaults()                    // ROBOT, 5 blocks
c = stompStackPreset(c, 'fuzz')       // → 10 blocks: robot into fuzz
c = stompStackPreset(c, 'cathedral')  // → 14 blocks: …into a cathedral
```

Both calls merge the preset's `output`/`tailSec` the same way, so a stacked reverb still brings its
own ring-out. Order is the only thing that separates two stacks of the same pedals — `fuzz` then
`cathedral` is a fuzz *in* a room; `cathedral` then `fuzz` is a room *through* a fuzz.

In the studio these are the same shelf buttons: click stomps a pedal on, click again **bypasses**
it (its blocks leave the signal path but keep their edits and their slot), shift-click **solos** it
(the `stompApplyPreset` gesture). A board built by stacking is a plain board — nothing about the
config records which preset a block came from, so a share link round-trips normally and the studio
re-derives the lit pedals by matching runs of blocks back to `STOMP_PRESETS`.

⚠ **Stacking compounds level, not just character.** Three gain-y pedals in series will clip: the
`--check` gate refuses the render (`clipping (peak 1.36 > 1.0)` — observed for ROBOT+FUZZ+CATHEDRAL).
Trim with a `gain` block, a `comp` last, or `output.gainDb` before you ship the render.

**VOICE** — vocoder voices; your articulation on someone else's pitch.

| id | name | what it is |
|---|---|---|
| `robot` | ROBOT | The stock board — 16 bands over a detuned saw on a C–G–C stack. `defaults()` *is* this preset, derived not copied. |
| `daft` | DAFT | Compressed in, 22 bands, four-note stack, heavy detune, sibilance pulled back. Tight and glossy. |
| `dalek` | DALEK | Coarse 12-band square vocoder into a 32 Hz `ring` and a 7-bit `crush`. |
| `choir` | CHOIR | Slow follower (5 Hz), 24 bands, a chord an octave up, half a second of room. Words become a pad. |
| `demon` | DEMON | `pitch −12` **before** the bands, so the shift changes what articulates. Low stack, dark, driven. |
| `whisper` | WHISPER | Carrier is almost all noise — breath instead of pitch, consonants pushed forward. |
| `alien` | ALIEN | A bright pulse carrier up high, then a 210 Hz ring on the way out. |
| `talkbox` | TALKBOX | Narrow band span, fast follower — the honk of a tube rather than a rack unit. |

**PEDALS** — the standard stompbox set: gain, dynamics, modulation, pitch.

| id | name | what it is |
|---|---|---|
| `boost` | BOOST | Clean level with the mud trimmed off. The always-on pedal at the front. |
| `overdrive` | OVERDRIVE | A mid hump and gentle clipping — the green box. |
| `distortion` | DISTORTION | Tighter and brighter than the fuzz; more gain, scooped lows. |
| `fuzz` | FUZZ | Sustain-and-shout: `drive 0.85`, dark tone stack, squashed out. |
| `sustainer` | SUSTAINER | Hard fast compression and nothing else. The grey box. |
| `chorus` | CHORUS | `wobble` at half mix — a detuned copy swimming under the dry. |
| `vibrato` | VIBRATO | The same delay line fully wet: no dry to anchor it, so the pitch itself moves. |
| `tremolo` | TREMOLO | A 5.5 Hz sine on the amplitude — `ring` slowed to a crawl. |
| `octaver` | OCTAVER | A sub octave under the dry signal — the OC-2 move. |
| `harmonizer` | HARMONIZER | A fifth above, half blended. The crossfade shimmer is the pedal, not a bug. |

**SPECIAL FX** — character boxes: places, machines and damage.

| id | name | what it is |
|---|---|---|
| `telephone` | TELEPHONE | Band-limited 420 Hz–2.8 kHz, driven, 9-bit. |
| `spaceecho` | SPACE ECHO | Tape delay with the flutter left in. RE-201 lineage. |
| `slapback` | SLAPBACK | One repeat 90 ms behind — thickness, not delay. |
| `cathedral` | CATHEDRAL | A 1.2 s dark room fed back on itself. Far too much, which is the point. |
| `ringmod` | RING MOD | A 300 Hz sine multiplied straight in. No key, all metal. |
| `bitcrush` | BITCRUSH | 4-bit destruction with the aliasing left in the top. |
| `underwater` | UNDERWATER | Everything above 700 Hz gone, the rest swaying. |

Every board is trimmed by measurement against **two** inputs — a narration line and a
sustained 440 Hz tone — and lands at **−2.8 to −3.6 dBFS** peak on speech while staying
clip-free on the tone. Switching boards is not a volume jump. From the CLI:

```bash
node -e "import('./src/engines/stomp.mjs').then(m=>console.log(JSON.stringify({v:1,studio:'stomp',cfg:m.stompApplyPreset(m.defaults(),'dalek')})))" > board.json
node scripts/sound-render.mjs board.json --check -o dalek.wav
```

### Three tuning lessons on record

**`comp` FIRST is input conditioning; `comp` LAST is not a limiter.** CHOIR was the one
preset that clipped, and only on a *sustained* input: 24 bands with a slow follower stay
open under a steady tone in a way speech never does, so it came out **6.6 dB hotter than a
narration line at every trim setting** — a structural gap no `gain` can close. Moving the
`comp` to the **front** closed it to **0.6 dB**. Reaching for a `comp` at the END made it
worse: measured on the Node host, `DynamicsCompressorNode` applies auto-makeup and *raised*
the peak 2.3 dB. It is a compressor on both hosts, never a limiter, and Chrome and Node
disagree about it more than about any other node.

**A noise carrier is far hotter than a tonal one.** WHISPER (`carrier.noise: 0.92`) needed
**13 dB less makeup** than its tonal siblings: noise puts energy in *every* band at once so
every band stays open, where a saw's harmonics thin out with frequency and never do. Retune
`makeupDb` whenever `carrier.noise` moves, and trim at the source rather than with a deep
negative `gain` — a board that runs hot internally can clip before it reaches the trim.

**Fewer bands is louder, not quieter.** Band Q is derived from the spacing, so dropping
`bands` widens each filter and passes more energy — CHOIR at 12 bands measured 1.6 dB
*hotter* than at 24. Re-trim whenever you change the band count.

---

## Realtime: the knobs move the sound while it plays

STOMP is a pedal, not a renderer, and the studio behaves like one: **nothing stops and
restarts to hear an edit.** Both transports — ▶ Play (the input clip, looped) and ● Live
(the microphone) — feed the same engine graph, and `build()` hands the host a live handle:

```js
const h = build(cfg, ctx, inputNode, dest, t0, { gated: false })
h.setBlock(2, 'amount', 0.6)   // → true: retuned the running graph
h.setBlock(1, 'bands', 24)     // → false: structural, the host must re-patch
h.setInput('gainDb', -3)
h.setOutput('blend', 0.5)
```

Continuous params ride a **12 ms `setTargetAtTime` ramp** on the real AudioParam — no
zipper, no click, audible inside a frame. `STOMP_LIVE_PARAMS` lists what a running graph
absorbs; `STOMP_STRUCTURAL` lists what it cannot:

| fx | live | structural |
|---|---|---|
| `vocoder` | `makeupDb` `mix` `sibilance` `sens` `follow` | `bands` `lo` `hi` `carrier` |
| `pitch` | `mix` | `semitones` `windowMs` (they set the LFO buffers' *length*) |
| `ring` | `hz` `mix` | — |
| `comp` | all five | — |
| `space` | `time` `feedback` `damp` `mix` | — |
| `lowpass` / `highpass` | `from` `q` | `to` (a sweep needs a render window) |
| `wobble` | `depthMs` `rateHz` `mix` | crossing `mix` 1 → below (adds the dry path) |
| `gain` | `db` | — |

`STOMP_HOST_LIVE` (`drive.amount`, `crush.bits`) is a third category: these swap a
**WaveShaper curve**, not an AudioParam. Chrome allows the reassignment and they are
realtime; `node-web-audio-api` throws `cannot assign curve twice`, so `set()` returns
false and the host rebuilds. Never assume — always branch on the return value.

**When a change IS structural, only the fx graph is rebuilt**, under a 30 ms crossfade. The
*source* lives outside the graph (`source → srcTap → per-graph feed → board → fade → bus`),
so even a re-patch never restarts the clip or drops the mic.

`⬇ Export` and `→ Library` still render **offline**, and that render remains the
deterministic truth. Live and offline differ in exactly the two documented places: filter
`to` sweeps (static live) and `space` ring-out (bounded offline by `tailSec`).

---

## Mobile

One responsive faceplate, no phone-only view — the same page, the same config, the same
gestures. What the ≤780 px pass actually changes:

- **Board rows become a labelled grid** (`label · value · slider`) instead of one wrapping
  flex line. A wrapped row of unlabelled sliders is unreadable at 375 px.
- **Every control clears ~44 px.** Range inputs default to a ~16 px box — the media query
  grows the box (the track stays centred, so this is hit area, not restyle); checkboxes ship
  at 13 px and get a 44 px label wrapper; the `⋮⋮` drag handle gets real padding.
- **Text inputs go to 16 px.** Below that, iOS zooms the whole page on focus and leaves the
  user scrolled sideways. Note the specificity: the base rules are `.ctrl input[type=text]`,
  so a bare `input[type=text]` in the media query never wins.
- **Nothing depends on hover.** Preset descriptions live in `title` *and* print under the
  shelf, because a touch device cannot open a tooltip.
- Drag, scrub and reorder needed no work: every gesture already uses pointer events with
  `touch-action: none`, so a finger and a mouse take the same path.

The media block sits **last in the stylesheet** on purpose — at equal specificity a later
rule wins, and an earlier media query silently loses to the base rules that follow it.


## Vibe translation

| you say | you get |
|---|---|
| **"robot voice"** | preset `robot` (= the default board) |
| **"Daft Punk"** | preset `daft` |
| **"Dalek"** | preset `dalek` |
| **"choir pad"** | preset `choir` |
| **"demon"** | preset `demon` |
| **"telephone"** | preset `telephone` — no vocoder at all |
| **"breathy / whispered"** | preset `whisper` |
| **"chorus / widen it"** | preset `chorus` — `wobble` `mix: 0.5` |
| **"too much reverb"** | preset `cathedral` |
| **"a fifth above"** | preset `harmonizer` |
| **"just a bit of thickness"** | `pitch` `semitones: -1` `mix: 0.35` — the shifted copy sits under the dry voice. For movement finer than 0.25 st, `wobble` `depthMs: 1.5` `rateHz: 5`. |
| **"make it intelligible"** | raise `sibilance` to 0.5, `follow` to 25, drop `vocoder.mix` to 0.75 |
| **"leave the words alone but make it huge"** | `output.blend: 0.6` — the board runs in parallel with the dry voice |

## Perceptual annotations

- **A vocoder is a gate, not a filter.** If the output drones during silences, `sens` is
  too high or the input is noisy — put a `comp` first and lower `sens`, don't chase it
  with `mix`.
- **Board order is the sound.** `pitch` before `vocoder` changes what articulates;
  `pitch` after changes what sings. They are different instruments.
- **The vocoder eats level.** It is 16 gated bands summing what is left of a voice.
  `makeupDb` is not optional — expect +10 to +20.
- **Live and offline differ in exactly two documented places**: filter `to` sweeps
  (static live) and `space` ring-out gating (bounded offline). Everything else — the
  vocoder's noise loop included — is identical by construction.

## Direct manipulation (studio)

Suite conventions (spec delta 1.8): pointer capture, ≥12 px hit zones, **shift = fine on
continuous axes**, double-click = reset, cursors telegraph the axis.

- **Drag-reorder** the `⋮⋮` handle on any block — order IS the signal path. Drag well
  outside the list to remove.
- **Value push/pull**: every param readout scrubs on a vertical drag, 150 px = full
  documented range, shift = 10 % fine. Hz params scrub logarithmically.
- **Every edit rebuilds the live graph under a 30 ms crossfade** — no click, and what
  you hear is always exactly the current config (INV-2, live).

## CLI

```bash
node scripts/sound-render.mjs <CFG-file|CFG-id> --check -o out.wav
python3 scripts/encode.py board.json --studio stomp --live
```
