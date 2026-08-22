# COMPOSING — the multi-studio flow

How to build a **whole track from one sentence**. One studio is a sound; the suite is a
production. This file is the chain: what renders in what order, how the pieces find each
other, and how one edit re-renders everything downstream.

Read the per-studio `schema-*.md` for vocabulary. Read this for the *assembly*.

Repo root everywhere below: `<your Sound Flow checkout>`.

---

## 1. The canonical chain

```
   DRIFT  ──►  bed stem   ─┐
                           │      ┌─ optional TAPE character pass on any stem
   PULSE  ──►  beat stem  ─┤      │  (aged / lo-fi / stretched / slowed)
                           ├──────┴───►  MIX  ──►  master
   VOX    ──►  vo stem    ─┤      │       (tracks + clips + intents + master bus)
   or corpus narration    ─┘      └─ optional STOMP character pass on a *voice* stem
                           ▲         (vocoder / pitch / ring / pedals)
   CIRCUIT / CHOP / LOOM / PRISM feed the same slot: any studio's render is
   just another named asset, and MIX places assets.
```

Everything upstream of MIX produces **one named asset per stem**. MIX consumes those names.
That is the whole architecture: *studios make stems, MIX makes tracks.*

Which studio fills which slot:

| slot in a track | usual studio | alternates |
|---|---|---|
| bed / atmosphere | DRIFT | TAPE-stretched anything; CIRCUIT pad; PRISM `harmonic` of a loop |
| beat / groove | PULSE | LOOM (layered loops); CHOP (sliced break); PRISM `percussive` |
| melody / hook / bass | CIRCUIT | PULSE melodic lanes (`bass`/`pluck`/`keys`) |
| voice | VOX | the imported corpus (`tag:narration`, `killer-0N/*`, `deck12/s*`, `launch/s*`) |
| character / grit | TAPE | — (TAPE is a *pass over* a stem, never a source) |
| voice character | STOMP | robot / vocoder / pitched / pedalled voice — also a *pass over* a stem, never a source. TAPE ages the tape, STOMP changes the speaker. |
| the assembly | MIX | LOOM for a pure loop-station piece with no arrangement |

---

## 2. Dependency order — what must render before what

Renders are strictly bottom-up. A config can only reference audio that already exists as an
asset, because `sound-render.mjs` resolves clip refs against `Substrate.listAssets()` and
**exits 2 with the unresolved list** if a ref matches nothing.

```
1. pure-synthesis stems   PULSE · CIRCUIT · DRIFT        (no refs — render any time, any order)
2. voice takes            VOX lines via the bridge TTS   (or reuse imported corpus assets)
3. derived stems          TAPE / PRISM / CHOP / LOOM     (need their source asset from 1 or 2)
4. assembly-level stems   VOX timeline stem              (needs its line takes)
5. the mix                MIX                            (needs every stem it references)
```

TAPE and PRISM can chain arbitrarily deep (`boombap → boombap-harmonic → boombap-harmonic-taped`)
— each link is a render, and each link must land before the next config runs.

**Sanity check before rendering a MIX:** every `ref` in it resolves.

```bash
cd <your Sound Flow checkout>
node -e "
const { Substrate } = await import('./src/lib/state.mjs')
const { readFileSync } = await import('node:fs')
const env = JSON.parse(readFileSync(process.argv[1], 'utf8'))
const s = new Substrate(process.env.SF_STATE_ROOT || undefined), assets = s.listAssets()
const refs = new Set(); (function walk(n){ if (typeof n === 'string') { if (/^(hash|name|tag):/.test(n)) refs.add(n); return }
  if (Array.isArray(n)) return n.forEach(walk); if (n && typeof n === 'object') for (const [k,v] of Object.entries(n)) if (!k.startsWith('__')) walk(v) })(env.cfg ?? env)
const re = p => new RegExp('^' + p.replace(/[.*+?^\${}()|[\]\\\\]/g, '\\\\\$&').replace(/\\\\\*/g, '[\\\\s\\\\S]*') + '\$')
for (const r of [...refs].sort()) {
  const [, kind, spec] = r.match(/^(hash|name|tag):([\\s\\S]*)\$/)
  const m = kind === 'hash' ? assets.filter(a => a.hash === spec)
          : kind === 'name' ? assets.filter(a => re(spec).test(a.name))
          : assets.filter(a => (a.tags || []).includes(spec))
  console.log((m.length ? '✓' : '✗') + ' ' + r + ' → ' + m.length + ' match(es)' + (m.length ? ': ' + m.slice(0,3).map(a => a.name).join(', ') + (m.length > 3 ? ' …' : '') : ''))
}" /path/to/mix-envelope.json
```

---

## 3. Naming discipline — the thing that makes the chain work

MIX (and LOOM, TAPE, CHOP, PRISM) reference audio by **name**, and names are resolved at every
load and every render. Five laws:

1. **Give every stem a stable, project-scoped name**, and reuse it forever:
   `--name demo30-bed`, `--name demo30-beat`, `--name demo30-master`. The name is the contract
   between the stem config and the mix config. Prefix by project so two tracks never collide.
2. **Re-rendering under the same name supersedes.** Same-name ties resolve **freshest-`at`
   first** on every host, so `node scripts/sound-render.mjs CFG-0007 --check --to-substrate
   --name demo30-bed` re-pointing `name:demo30-bed` is the *entire* update mechanism (RT-3).
   The old asset stays in the substrate under its own content hash — nothing is destroyed, it
   is simply no longer freshest.
3. **`layout: "spread"` takes ALL matches, not the freshest one.** Real trap:
   `name:killer-02/*` matches **18** assets in this substrate (nine keys × two takes — the
   legacy import and the re-voiced set), so a spread would lay out 18 slots including
   duplicates. `tag:revoiced` matches exactly the **9** fresh ones. For spreads, select a set
   that is one-take-per-line: a clean folder (`name:killer-01/*` → 10 unique lines) or a tag.
4. **Pin with `hash:` when a take must never move** — a delivered master, a reference stem, a
   human mic take. Everything else stays a `name:` so the chain keeps updating.
5. **Register the configs you intend to maintain.** A render from a `CFG-`/`MIX-` id stamps
   `config: CFG-NNNN` on the sidecar; a render from a loose JSON file does not, and is
   therefore invisible to `Substrate.stale()` and to the orchestrator. Loose files are fine for
   auditions; anything another config references should be registered.

Names in this substrate you can build against today (`node -e "import('./src/lib/state.mjs')
.then(m=>{const s=new m.Substrate();console.log(s.listAssets().map(a=>a.name).join('\n'))})" | sort -u`):

| name(s) | what |
|---|---|
| `boombap` | 22.326 s PULSE break, analysed 86 bpm (authored 172, half-time) |
| `boombap-aged` | 45.651 s TAPE pass over it (`rate 0.5` → double length) |
| `drift-bed` | 96 s DRIFT ambient bed, loop-safe |
| `pulse-default` | 72 s PULSE default pattern |
| `loom-groove` · `circuit-bell` · `chop-smoke` · `killer01-scored` | prior gate renders |
| `killer-01/0…9` | 10 narration lines, one take each — the safe spread set |
| `killer-02/0…8` | 9 lines, **two takes each**; `tag:revoiced` selects the fresh nine |
| `deck12/s*` · `deck3/s*` · `launch/s*` · `feat/*` · `killer-03…08/*` | the rest of the 117-line corpus |

---

## 4. Registering the chain, and re-rendering it after an edit

Register each config once, then never think about propagation again.

```bash
cd <your Sound Flow checkout>
SF=./src/lib/state.mjs

# stem configs → CFG-NNNN
ENV="$(cat demo30-bed.json)"  node -e "import('$SF').then(({Substrate})=>{const s=new Substrate();console.log(s.writeConfig(JSON.parse(process.env.ENV)))})"
ENV="$(cat demo30-beat.json)" node -e "import('$SF').then(({Substrate})=>{const s=new Substrate();console.log(s.writeConfig(JSON.parse(process.env.ENV)))})"

# the mix → MIX-NNNN (allocate first, then write under that id)
ENV="$(cat demo30-mix.json)"  node -e "import('$SF').then(({Substrate})=>{const s=new Substrate();const id=s.allocId('MIX');s.writeConfig(JSON.parse(process.env.ENV),{id});console.log(id)})"
```

**After an edit — don't re-run the chain by hand, let the staleness computation be the plan:**

```bash
node scripts/orchestrate.mjs --dry-run   # show the worklist, change nothing
node scripts/orchestrate.mjs --once      # do it
```

Measured, on a facility where only the bed config was patched:

```
## ⓪ verify
- verify green (all checks passed)
## ② stale assets
- would re-render CFG-0001 → name "demo30-bed" (drift)
## ③ mixes stale by ingredient
- would re-render MIX-0001 "demo30-master" — newer ingredients: name:demo30-bed → demo30-bed
```

Step ② re-renders the stem **under its own name**; step ③ then sees that the mix's
`name:demo30-bed` ref now resolves to a newer asset than the mix's own render, and re-renders
the mix — in the same pass, in dependency order. Nothing told it to. That is the payoff for
laws 1, 2 and 5 above.

The orchestrator aborts on a red `verify.mjs` (step ⓪) and refuses to author configs — patching
is this skill's job, rendering is its job.

---

## 5. Delivering a composed track

```bash
# a link to the arrangement (the audio rides in the library / substrate)
python3 scripts/encode.py demo30-mix.json --live        # envelope in, #sfa= URL out
# → https://sound-flow.netlify.app/mix/#sfa=jZIxT8MwEIX_y81OlaQtAo9sbOyog9tcUgs7Cfalpary33lOSiQYCpvP9n3v-Z2vdCJdKIoyVLYjTd5-kqJD3ZC-UmSusFex79Y5tve9x-08x4qNxFcOzyaQ3qA2IeKoVCTBHN6xfruSTc17IBQ1xraks0cocYvtfFVuFfFHUnHdmTQ6j7Y54k45Qt_ZfmYErgFpjWc928hmoJHJt8BzsVZgdD1pCQMrqk3FL1ArVuW4G9XiAy2LkZ_ixWr7p-jUnVTX91XzSXWnyLbCrcxAufQMYjyzc8CICQ3LEo7x3dDKlGMSeFIUbOTnKdJNIjs3F2V6zY0lxv5CLQ4LBNOdpuHEKdkaRjGnbJPfBVT_6N99T3DhVOzMJYGs5_R85FLj3-zxDW5l-lNYPSBjb6JwSN2NG-brGIWz3kI3K8Zx_AI

# the master as a file
node scripts/sound-render.mjs MIX-0001 --check -o ~/Desktop/demo30-master.wav

# everything (arrangement + every stem + the master) as one portable .sfa
node scripts/bundle.mjs export demo30.sfa --name 'demo30-*' --configs
node scripts/bundle.mjs import demo30.sfa            # on any other machine / substrate root
```

Bridge-only deliveries (start it with `/sound-bridge`):

```bash
# m4a instead of wav
curl -s --data-binary @demo30-master.wav 'http://localhost:3355/api/encode?format=m4a' -o demo30-master.m4a

# a keyed deck line (INV-9) — audio/<clip>/<seq>.m4a, played by the existing decks unchanged
curl -s -X POST http://localhost:3355/api/deck-export -H 'Content-Type: application/json' \
  -d '{"clip":"killer-02","seq":"3","hash":"<64-hex asset hash>"}'
```

Then shortlink the `#sfa=` URL on **a47l.com** via the shortlink MCP and deliver the short link
plus 2–3 knobs. Anything beyond a shortlink (blog, repo, public post) is the user's call.

---

## 6. Worked example A — a 30-second product-demo score

*"Score my 30-second product demo — warm, modern, builds to the reveal at the end."*

Music only, two stems, one mix. MIX at 100 bpm × 12 bars = 28.8 s + the fixed 1.5 s tail =
**30.300 s**. The reveal is a `swell` into bar 9; both tracks `tail` out over the last two bars.

**Stem 1 — DRIFT bed (`demo30-bed`).** 8 bars at 60 bpm = a 32 s loop-safe window, so it tiles
under the mix seamlessly. Two chord windows, keys + shimmer, warm drone.

```json
{ "v": 1, "studio": "drift", "cfg": {
  "seed": "demo30-bed",
  "bpm": 60, "beatsPerBar": 4, "bars": 8,
  "scale": { "root": 196, "freqs": [196, 220, 261.6, 293.7, 349.2] },
  "journey": [
    { "chord": [130.8, 196, 246.9, 293.7], "bars": 4 },
    { "chord": [174.6, 220, 261.6, 329.6], "bars": 4 }
  ],
  "drone": { "on": true, "freqs": [65.4, 130.8], "level": 0.1 },
  "rules": [
    { "voice": "keys",    "mode": "prob", "p": 0.12, "n": 8, "octave": 0, "level": 0.09, "decay": 1.8 },
    { "voice": "shimmer", "mode": "prob", "p": 0.06, "n": 8, "octave": 1, "level": 0.06, "decay": 2.6 }
  ],
  "space": { "echo": 0.35 },
  "tailSec": 0
} }
```

**Stem 2 — PULSE beat (`demo30-beat`).** 100 bpm, 16 steps, two playthroughs = 19.2 s = exactly
8 bars of the mix grid, so loop tiles land on downbeats. Note `"pads": []` — mandatory, because
the default pads span steps 0–24 and this config narrows `steps` to 16.

```json
{ "v": 1, "studio": "pulse", "cfg": {
  "seed": "demo30-beat",
  "bpm": 100, "swing": 0.06, "steps": 16,
  "scale": { "root": 196, "freqs": [196, 220, 261.6, 293.7, 349.2] },
  "rows": [
    { "id": "kick", "voice": "kick", "level": 0.4 },
    { "id": "hat",  "voice": "hat",  "level": 0.18, "pan": 0.15 },
    { "id": "rim",  "voice": "rim",  "level": 0.12, "pan": -0.25 },
    { "id": "bass", "voice": "bass", "level": 0.3 }
  ],
  "patterns": {
    "A": {
      "kick": [1,0,0,0, 0,0,{"v":0.7},0, 1,0,0,0, 0,0,0,0],
      "hat":  [0,{"v":0.55},0,1, 0,{"v":0.55},0,1, 0,{"v":0.55},0,1, 0,{"v":0.55},0,{"v":0.8,"p":0.8}],
      "rim":  [0,0,0,0, {"v":0.8},0,0,0, 0,0,0,0, {"v":0.8},0,0,0],
      "bass": [{"n":0},0,0,0, 0,0,{"n":2},0, {"n":0},0,0,{"n":1}, 0,0,0,0]
    }
  },
  "song": ["A","A"],
  "pads": [],
  "drone": false
} }
```

**The mix (`demo30-master`).** Bed from bar 1, beat enters at bar 3, swell into the reveal at
bar 9, both tails from bar 11.

```json
{ "v": 1, "studio": "mix", "cfg": {
  "seed": "demo30",
  "bpm": 100, "beatsPerBar": 4, "bars": 12,
  "tracks": [
    { "id": "bed", "gain": -8, "send": 0.25, "eq": { "low": 2, "high": -2 },
      "clips": [{ "ref": "name:demo30-bed", "at": 1, "to": 13, "loop": true, "fadeIn": 1.2 }] },
    { "id": "beat", "gain": -5, "eq": { "low": 1.5 },
      "clips": [{ "ref": "name:demo30-beat", "at": 3, "to": 13, "loop": true, "fadeIn": 0.2 }] }
  ],
  "intents": [
    { "type": "swell", "target": "bed",  "amount": 4, "at": 9, "riseBars": 4, "fallBars": 2 },
    { "type": "tail",  "target": "beat", "at": 11, "overBars": 2, "floor": -40 },
    { "type": "tail",  "target": "bed",  "at": 11, "overBars": 2, "floor": -40 }
  ],
  "send": { "type": "delay", "time": 0.3, "feedback": 0.3, "mix": 0.6 },
  "master": { "glue": 0.35, "limit": -1 }
} }
```

**Run it, in order:**

```bash
cd <your Sound Flow checkout>
node scripts/sound-render.mjs demo30-bed.json  --check --to-substrate --name demo30-bed
node scripts/sound-render.mjs demo30-beat.json --check --to-substrate --name demo30-beat
node scripts/sound-render.mjs demo30-mix.json  --check --to-substrate --name demo30-master
python3 scripts/encode.py demo30-mix.json --live
```

Measured output:

```
rendered drift 87f056e6 → d2611fd5… (32.000s)   ✓ check   → demo30-bed
rendered pulse 3184a26b → a589b1c2… (19.200s)   ✓ check   → demo30-beat
resolved 2 refs → 2 buffers
rendered mix   70948dba → f4bed5df… (30.300s)   ✓ check   → demo30-master
```

Analysis: `demo30-master · 30.300s · peak -10.27 dBFS · rms -27.63 · 85 onsets` — duration is
exactly `12·4·60/100 + 1.5`, peak leaves 10 dB of headroom (this is a bed under a voiceover, not
a loudness-war master; raise `master.glue` and the track gains if it must stand alone).

Knobs to offer: *busier bed* (`rules[0].p` 0.12 → 0.2) · *harder reveal* (`swell.amount` 4 → 7) ·
*more room* (`send.mix` 0.6 → 0.85, bed `send` 0.25 → 0.4).

---

## 7. Worked example B — a three-minute ambient piece

*"Three minutes of ambient, warm and slightly worn, that fades out at the end."*

DRIFT ×2 (a low bed, a glassy upper) → TAPE character pass on the bed → MIX with a ride, a
swell and a long tail. MIX at 60 bpm × 45 bars = 180 s + 1.5 = **181.500 s**.

**`amber-bed`** — the 3-minute DRIFT window (45 bars at 60 bpm = 180 s exactly, loop-safe):

```json
{ "v": 1, "studio": "drift", "cfg": {
  "seed": "amber-hour",
  "bpm": 60, "beatsPerBar": 4, "bars": 45,
  "scale": { "root": 164.8, "freqs": [164.8, 196, 220, 246.9, 293.7] },
  "journey": [
    { "chord": [110, 164.8, 196, 246.9], "bars": 9 },
    { "chord": [98, 146.8, 196, 293.7], "bars": 9 },
    { "chord": [123.5, 164.8, 220, 293.7], "bars": 6 }
  ],
  "drone": { "on": true, "freqs": [55, 110], "level": 0.11 },
  "rules": [
    { "voice": "pluck", "mode": "euclidean", "k": 2, "n": 8, "octave": 0, "level": 0.1, "decay": 1.4 },
    { "voice": "bass",  "mode": "prob", "p": 0.08, "n": 4, "octave": 0, "level": 0.1, "decay": 2.2 }
  ],
  "space": { "echo": 0.4 },
  "tailSec": 0
} }
```

**`amber-air`** — a 60 s glass layer, one chord, one shimmer rule, heavy echo. 60 s = 15 mix
bars exactly, so it tiles three times with no drift:

```json
{ "v": 1, "studio": "drift", "cfg": {
  "seed": "amber-air",
  "bpm": 60, "beatsPerBar": 4, "bars": 15,
  "scale": { "root": 164.8, "freqs": [329.6, 392, 440, 493.9, 587.3] },
  "journey": [ { "chord": [329.6, 392, 493.9], "bars": 15 } ],
  "drone": { "on": false, "freqs": [55, 110], "level": 0.1 },
  "rules": [
    { "voice": "shimmer", "mode": "prob", "p": 0.06, "n": 8, "octave": 1, "level": 0.06, "decay": 3.2 }
  ],
  "space": { "echo": 0.55 },
  "tailSec": 0
} }
```

**`amber-bed-aged`** — the TAPE pass. No `rate`, no `stretch`, so the length is unchanged
(`180 + tailSec 2 = 182 s`): slow wow, vinyl dust, a whole-clip darkening sweep, a little
saturation, and the mandatory trim (TAPE has no limiter).

```json
{ "v": 1, "studio": "tape", "cfg": {
  "seed": "amber-aged",
  "source": { "ref": "name:amber-bed" },
  "chain": [
    { "fx": "wobble",  "depthMs": 3, "rateHz": 0.4 },
    { "fx": "vinyl",   "amount": 0.35 },
    { "fx": "lowpass", "from": 9000, "to": 4200, "q": 0.7 },
    { "fx": "drive",   "amount": 0.25 },
    { "fx": "gain",    "db": -2 }
  ],
  "tailSec": 2.0
} }
```

**`amber-hour-master`** — the assembly. The air rides up through the middle on an `exp` curve
(anticipation), the bed swells at bar 28, and everything tails to −60 over the last nine bars.

```json
{ "v": 1, "studio": "mix", "cfg": {
  "seed": "amber-hour",
  "bpm": 60, "beatsPerBar": 4, "bars": 45,
  "tracks": [
    { "id": "bed", "gain": -4, "send": 0.2,
      "clips": [{ "ref": "name:amber-bed-aged", "at": 1, "fadeIn": 3, "fadeOut": 0.5 }] },
    { "id": "air", "gain": -12, "pan": 0.25, "send": 0.4, "eq": { "low": -4 },
      "clips": [{ "ref": "name:amber-air", "at": 1, "to": 46, "loop": true, "fadeIn": 4 }] }
  ],
  "intents": [
    { "type": "ride",  "target": "air", "amount": 4, "from": 10, "to": 28, "curve": "exp" },
    { "type": "swell", "target": "bed", "amount": 3, "at": 28, "riseBars": 10, "fallBars": 6 },
    { "type": "tail",  "target": "bed", "at": 37, "overBars": 9, "floor": -60 },
    { "type": "tail",  "target": "air", "at": 37, "overBars": 9, "floor": -60 }
  ],
  "send": { "type": "delay", "time": 0.6, "feedback": 0.5, "mix": 0.7 },
  "master": { "glue": 0.15, "limit": -1 }
} }
```

**Run it, in order** — note `amber-bed` must land before the TAPE config can resolve it:

```bash
cd <your Sound Flow checkout>
node scripts/sound-render.mjs amber-bed.json       --check --to-substrate --name amber-bed
node scripts/sound-render.mjs amber-air.json       --check --to-substrate --name amber-air
node scripts/sound-render.mjs amber-bed-aged.json  --check --to-substrate --name amber-bed-aged
node scripts/sound-render.mjs amber-mix.json       --check --to-substrate --name amber-hour-master
python3 scripts/encode.py amber-mix.json --live
```

Measured output:

```
rendered drift 618781b7 → daaf5afb… (180.000s)  ✓ check  → amber-bed
rendered drift 8e86bdbe → e8fca170… ( 60.000s)  ✓ check  → amber-air
resolved 1 ref  → 1 buffer
rendered tape  6b36a1f0 → f1c55a12… (182.000s)  ✓ check  → amber-bed-aged
resolved 2 refs → 2 buffers
rendered mix   247afdfa → 166a364c… (181.500s)  ✓ check  → amber-hour-master
```

Analysis: `amber-hour-master · 181.500s · peak -9.99 dBFS · rms -19.98` — 3:01.5, healthy
headroom, RMS 10 dB above example A because ambient material is sustained rather than transient.
`analyze` also reports `bpm 150 (conf 0.543)` on this piece: **ignore it** — a beatless bed at
60 bpm cannot have a 150 bpm grid, it is the confidence trap the PRISM schema documents. Never
`✎ write tags` a bpm onto ambient material.

Knobs: *emptier* (`amber-bed` rules `p` down, `k` 2 → 1) · *colder* (drop the `drive`, raise the
`lowpass` sweep target) · *longer* (`bars` 45 → 90 on both the DRIFT bed and the MIX, and the
`ride`/`swell`/`tail` bars scale with it).

---

## 8. Worked example C — a beat-driven clip with narration ducked under it

*"Put my killer-02 narration over a beat, radio-tight, voice on top."*

PULSE beat → TAPE grit pass → corpus narration spread across the timeline → MIX with a duck.
MIX at 88 bpm × 16 bars = 43.636 s + 1.5 = **45.136 s**.

**`bulletin-beat`** — 88 bpm boom-bap with a turnaround every fourth playthrough
(`{"p":"A","alt":"F","every":4}` ≡ `["A","A","A","F"]`, a ratcheted snare fill in `F`):

```json
{ "v": 1, "studio": "pulse", "cfg": {
  "seed": "bulletin",
  "bpm": 88, "swing": 0.09, "steps": 16,
  "scale": { "root": 110, "freqs": [110, 130.8, 146.8, 164.8, 196] },
  "rows": [
    { "id": "kick",  "voice": "kick",  "level": 0.42 },
    { "id": "snare", "voice": "snare", "level": 0.26 },
    { "id": "clap",  "voice": "clap",  "level": 0.16, "pan": 0.2 },
    { "id": "hat",   "voice": "hat",   "level": 0.16, "pan": -0.2 },
    { "id": "bass",  "voice": "bass",  "level": 0.32 }
  ],
  "patterns": {
    "A": {
      "kick":  [1,0,0,0, 0,0,{"v":0.75},0, 0,0,1,0, 0,0,0,0],
      "snare": [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      "clap":  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      "hat":   [{"v":0.7},0,{"v":0.5},0, {"v":0.7},0,{"v":0.5},0, {"v":0.7},0,{"v":0.5},0, {"v":0.7},0,{"v":0.5,"p":0.7},0],
      "bass":  [{"n":0},0,0,{"n":0,"v":0.6}, 0,0,{"n":3},0, {"n":0},0,0,0, {"n":2},0,0,0]
    },
    "F": {
      "kick":  [1,0,0,0, 0,0,{"v":0.75},0, 0,0,1,0, 0,0,0,0],
      "snare": [0,0,0,0, 1,0,0,0, 0,0,0,0, {"v":0.9,"r":3},0,{"v":0.7,"r":2},0],
      "clap":  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      "hat":   [{"v":0.7},0,{"v":0.5},0, {"v":0.7},0,{"v":0.5},0, {"v":0.7},0,{"v":0.5},0, 0,0,0,0],
      "bass":  [{"n":0},0,0,{"n":0,"v":0.6}, 0,0,{"n":3},0, {"n":0},0,0,0, {"n":4},0,{"n":2},0]
    }
  },
  "song": [{ "p": "A", "alt": "F", "every": 4 }],
  "pads": [],
  "drone": false
} }
```

**`bulletin-beat-aged`** — TAPE grit. Order is the sound: drive feeds the crush, the lowpass
softens the fizz, vinyl lands on top, gain trims the result.

```json
{ "v": 1, "studio": "tape", "cfg": {
  "seed": "bulletin-aged",
  "source": { "ref": "name:bulletin-beat" },
  "chain": [
    { "fx": "drive",   "amount": 0.3 },
    { "fx": "crush",   "bits": 11 },
    { "fx": "lowpass", "from": 8500, "q": 0.7 },
    { "fx": "vinyl",   "amount": 0.3 },
    { "fx": "gain",    "db": -2 }
  ],
  "tailSec": 0.5
} }
```

**The voice.** Two routes, and the choice matters:

- **`layout: "spread"` of the individual lines in MIX** — each line is its own clip, so the duck
  **breathes between lines** (the duck compiler merges intervals closer than its release, so
  tight reads still duck as one gesture). Use this when the beat should come back up between
  sentences. `tag:revoiced` is the correct selector here — `name:killer-02/*` would match all
  **18** takes (see naming law 3).
- **A VOX timeline stem** — VOX assembles line · pause · gap · line into one asset, MIX places
  one clip, and the duck holds for the whole read. Use this when the pacing is the point and the
  bed should stay under the whole VO. Authoring a *new* script means rendering takes through the
  bridge TTS first (`/sound-bridge start`, then VOX `⏺ All takes` or `POST /api/tts` per line);
  refs to existing takes need no bridge at all:

```json
{ "v": 1, "studio": "vox", "cfg": {
  "seed": "bulletin-vo",
  "gapSec": 0.75, "tailSec": 1.0,
  "lines": [
    { "key": "killer-02/0", "text": "One person owns 100% of this project.", "ref": "name:killer-02/0" },
    { "key": "killer-02/1", "text": "That's key-person risk —", "ref": "name:killer-02/1" },
    { "key": "killer-02/2", "text": "the whole project living in one head.", "ref": "name:killer-02/2" },
    { "key": "killer-02/6", "text": "80. Critical. Bus factor of one.", "ref": "name:killer-02/6", "preSec": 0.6, "postSec": 0.6 },
    { "key": "killer-02/8", "text": "Visible. Measurable. Closeable. Project state. The project remembers.", "ref": "name:killer-02/8", "postSec": 0.9 }
  ]
} }
```

(`name:killer-02/0` resolves freshest-`at` first, so it picks the re-voiced take, not the legacy
import — naming law 2 doing its job on someone else's audio.)

**`bulletin-master`** — the spread route, radio-tight duck at −9 dB with a fast attack:

```json
{ "v": 1, "studio": "mix", "cfg": {
  "seed": "bulletin",
  "bpm": 88, "beatsPerBar": 4, "bars": 16,
  "tracks": [
    { "id": "beat", "gain": -6, "eq": { "low": 1.5, "high": -1 },
      "clips": [{ "ref": "name:bulletin-beat-aged", "at": 1, "to": 17, "loop": true, "fadeIn": 0.05, "fadeOut": 1.2 }] },
    { "id": "vox", "gain": 0, "send": 0.12, "eq": { "high": 2.5, "low": -2 },
      "clips": [{ "ref": "tag:revoiced", "at": 2, "to": 17, "layout": "spread" }] }
  ],
  "intents": [
    { "type": "duck", "target": "beat", "by": "vox", "amount": -9, "attack": 0.04, "release": 0.28, "floorHold": 0.05 },
    { "type": "tail", "target": "beat", "at": 15, "overBars": 2, "floor": -60 }
  ],
  "send": { "type": "delay", "time": 0.34, "feedback": 0.3, "mix": 0.5 },
  "master": { "glue": 0.45, "limit": -1 }
} }
```

**Run it, in order:**

```bash
cd <your Sound Flow checkout>
node scripts/sound-render.mjs bulletin-beat.json      --check --to-substrate --name bulletin-beat
node scripts/sound-render.mjs bulletin-beat-aged.json --check --to-substrate --name bulletin-beat-aged
node scripts/sound-render.mjs bulletin-vo.json        --check --to-substrate --name bulletin-vo   # only for the stem route
node scripts/sound-render.mjs bulletin-mix.json       --check --to-substrate --name bulletin-master
python3 scripts/encode.py bulletin-mix.json --live
```

Measured output:

```
rendered pulse c6e2a317 → b187057d… (43.636s)  ✓ check  → bulletin-beat
resolved 1 ref  → 1 buffer
rendered tape  b6935360 → b7a6cad0… (44.136s)  ✓ check  → bulletin-beat-aged
resolved 5 refs → 5 buffers
rendered vox   dfb4dcc3 → 6d7f3d73… (28.680s)  ✓ check  → bulletin-vo
resolved 2 refs → 10 buffers          # tag:revoiced (9 lines) + the aged beat
rendered mix   a3935fd9 → 2530b05e… (45.136s)  ✓ check  → bulletin-master
```

Analysis:

```
bulletin-beat       · 43.636s · peak  -7.68 dBFS · rms -31.65 · 39 onsets
bulletin-beat-aged  · 44.136s · peak  -6.28 dBFS · rms -26.85 · 39 onsets   # TAPE kept every hit
bulletin-vo         · 28.680s · peak  -1.29 dBFS · rms -22.62
bulletin-master     · 45.136s · peak  -2.70 dBFS · rms -24.68
```

The onset count surviving the TAPE pass unchanged (39 → 39) is the check that `crush`+`lowpass`
didn't smear the transients away — this is the kind of thing to measure instead of claiming.

Knobs: *duck harder* (`amount` −9 → −12, broadcast) · *let the beat breathe between lines*
(`release` 0.28 → 0.5, or VOX `gapSec` up) · *voice further forward* (vox `eq.high` 2.5 → 4,
beat `eq.high` −1 → −3).

---

## 9. Rehearsing without touching the facility

Every command above writes to the real substrate. To try a chain first, point one at a scratch
root — `SF_STATE_ROOT` is honoured by `sound-render.mjs`, `bundle.mjs`, `orchestrate.mjs`, and
`state.mjs` itself:

```bash
export SB=/tmp/sf-scratch
node -e "import('./src/lib/state.mjs').then(({Substrate})=>{new Substrate('$SB').init()})"
node scripts/bundle.mjs export /tmp/corpus.sfa --name 'killer-01/*'      # from the real substrate
SF_STATE_ROOT=$SB node scripts/bundle.mjs import /tmp/corpus.sfa          # into the scratch one
SF_STATE_ROOT=$SB node scripts/sound-render.mjs demo30-bed.json --check --to-substrate --name demo30-bed
SF_STATE_ROOT=$SB node scripts/orchestrate.mjs --dry-run
```

Every number quoted in this document was produced that way.

---

## 10. Pre-flight checklist for a composed track

1. Schema read for **every** studio in the chain, this run.
2. One `seed` per config; project-prefixed, stable stem names chosen up front.
3. Configs partial and minimal — plus the defaults that a narrowed field orphans
   (PULSE `pads: []` under `steps: 16`; CIRCUIT `patch`/`phrase` authored whole).
4. Render order bottom-up; every ref resolves before the config that uses it runs.
5. `--check` on every render. No exceptions for anything that reaches a mix or a user.
6. Durations match the schema arithmetic; peaks in range; onsets non-zero on rhythmic stems.
7. Configs registered (`CFG-`/`MIX-`) if the track is going to be edited again.
8. `node scripts/verify.mjs` green before and after.
9. Encode → shortlink → deliver link + what it is + 2–3 knobs.
10. Say what you could not verify: it was analysed, not heard.
