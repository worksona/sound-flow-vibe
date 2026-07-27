---
name: sound-flow-vibe
description: Author Sound Flow configs from natural language across all nine studios — PULSE (beats), CIRCUIT (synth patches/melodies), DRIFT (ambient beds), CHOP (slicing/pads), LOOM (loop layering), VOX (narration), PRISM (analysis/separation), TAPE (texture/lo-fi/stretch), MIX (arrangement/ducking/master) — and compose them into whole tracks. Given a described sound, pick the studio, read its schema, author a minimal seeded config, render or encode it into a shareable #sfa= URL, shortlink it on a47l.com, and hand back a clickable link plus the knobs to turn next. Trigger on /sound-flow-vibe, "make me a beat", "vibe a bed", "score this", "give me a patch", "chop this", "build me a track", "put a bed under this narration", or any request to generate, render, remix, or share a Sound Flow link, config, pattern, stem, or mix.
---

## Before you start — what you need

This plugin is self-contained for **authoring and sharing**: describe a sound, get a
playable link. It bundles the `#sfa=` codec, so nothing else is required.

| you want to… | you need |
|---|---|
| author a config and get a share link | this plugin only — the studios are live at https://sound-flow.netlify.app |
| play, tweak by hand, record, export audio | a browser — open the link, everything is in the page |
| render headless, keep a substrate, run the orchestrator | the Sound Flow **app repo** (private); those commands are marked *(app repo)* below |

Encode with the bundled codec:

```bash
python3 "$CLAUDE_PLUGIN_ROOT/scripts/encode.py" /path/to/config.json --studio pulse --live
```


# Sound Flow Vibe

The front door of the suite. Turn a sentence into a **config**, a config into **audio**, and audio
into a **link** — for one studio, or for a whole track across several.

Nine studios, one config law, one substrate. Everything below is real and runnable at
`<your Sound Flow checkout>` (deployed: https://sound-flow.netlify.app).

---

## 1. STUDIO ROUTER — read the ask, pick the studio

| the ask sounds like | studio | schema file |
|---|---|---|
| beat, drums, groove, kit, boom bap, trap hats, "make me a beat" | **PULSE** | `reference/schema-pulse.md` |
| synth patch, melody, arp, bass line, bell, lead, acid, "give me a patch" | **CIRCUIT** | `reference/schema-circuit.md` |
| ambient, bed, drone, pad, wash, "something under this", long loop | **DRIFT** | `reference/schema-drift.md` |
| slice this, pads, kit from a sample, chop it, stutter, MPC | **CHOP** | `reference/schema-chop.md` |
| layer loops, jam, stack takes, loop station, overdub | **LOOM** | `reference/schema-loom.md` |
| narration, voice-over, script, "read this", re-voice a clip | **VOX** | `reference/schema-vox.md` |
| what tempo is this, onsets, split on silence, bar-chop, take the drums off, stems from a file | **PRISM** | `reference/schema-prism.md` |
| lo-fi, aged, dusty, underwater, slowed, stretched, vinyl, "give it character" | **TAPE** | `reference/schema-tape.md` |
| arrange, mix, duck the bed under the voice, master, "the whole thing together" | **MIX** | `reference/schema-mix.md` |

**More than one of these in one sentence** ("score this demo", "build me a track", "beat with a
bed and my narration over it") is the **composition flow** — read
[`reference/composing.md`](reference/composing.md) and drive the chain from there.

Engines today: pulse 1.1.0 · circuit 1.0.0 · drift 1.0.0 · chop 1.0.0 · loom 1.1.0 · vox 1.0.0 ·
prism 1.1.0 · tape 1.1.0 · mix 1.2.1.

**Pure-synthesis studios** (PULSE, CIRCUIT, DRIFT) reproduce from a URL alone — no audio travels.
**Sample-based studios** (CHOP, LOOM, VOX, PRISM, TAPE, MIX) carry **clip refs**
(`hash:<64-hex>` · `name:<glob>` · `tag:<value>`) resolved by the host against the library
(browser IndexedDB) or substrate (`sound-state/assets/`); the URL carries the *arrangement*, the
audio rides in the library or a `.sfa` bundle.

---

## 2. THE WORKFLOW

### 1 — Read the schema FIRST, every run
`reference/schema-<studio>.md` is the authoritative vocabulary: fields, ranges, enum values, the
vibe-translation table, the perceptual annotations. **Never invent a voice, an fx, an intent type,
or a param.** If it isn't in the schema, it isn't in the suite.

### 2 — Interpret the vibe
Map the user's words through the schema's vibe-translation table. Compose two or three moves;
don't max everything. The perceptual annotations are the guardrails ("swing above 0.2 reads as
drunk", "duck −6 polite / −8 produced / −12 broadcast", "p above 0.3 stops reading as ambient").

### 3 — Author a MINIMAL partial config
Only set what the vibe demands — engine `defaults()` fill the rest. `seed` is **mandatory** in
every config; a memorable string (`"midnight-freight"`) doubles as the config's name and drives
every stochastic choice.

Two merge traps, both real:

- **Merge is TOP-LEVEL** (`{...defaults(), ...cfg}`, suite-wide, §18 delta 1.2). CIRCUIT's `patch`
  and `phrase` are therefore **atomic** — author the whole object or omit the key.
- **Narrowing a dimension orphans the defaults that depend on it.** PULSE `steps: 16` without
  `pads: []` fails validation, because the default pads span 0–24. Same shape of trap wherever a
  default indexes another field.

### 4 — Register (when the chain matters)
```bash
cd <your Sound Flow checkout>
ENV="$(cat cfg.json)" node -e "import('./src/lib/state.mjs').then(({Substrate})=>{const s=new Substrate();console.log(s.writeConfig(JSON.parse(process.env.ENV)))})"
# → CFG-0007        (mixes: allocId('MIX') first, then writeConfig(env, {id}))
```
Route every substrate write through `/sound-state` (INV-6). **Registering is what makes an asset
maintainable:** a render from a `CFG-`/`MIX-` id stamps `config: CFG-NNNN` on the sidecar, so
`Substrate.stale()` sees it and the orchestrator re-renders it when the config changes. A render
from a loose file carries **no** `config` field and is invisible to that machinery. One-off
auditions can stay loose; anything another config references should be registered.

### 5 — Render agent-side (the ear-proxy)
```bash
node scripts/sound-render.mjs CFG-0007 --check --to-substrate --name demo30-bed   # (app repo)
node scripts/sound-render.mjs /path/to/envelope.json --check -o /tmp/audition.wav   # (app repo)
```
- Input is a `CFG-NNNN`/`MIX-NNNN` id, or a JSON file that is an **envelope**
  `{v:1, studio, cfg}` (or a bare cfg carrying a `studio` field). There is **no `--studio` flag**
  here — passing one exits 2, and so does a bare cfg with no way to name its engine.
- **Always `--check`.** Three gates: re-render byte-identical (INV-3 on this host), non-silent
  (peak > 1e-4) and clip-free (|sample| ≤ 1.0), duration == `engine.duration(cfg)` ± 1 sample.
- Clip refs anywhere in the config resolve against `Substrate.listAssets()` and inject as
  `cfg.__buffers` — unresolved refs exit 2 with the list. Never author `__buffers`.
- Render whenever the user should hear it, whenever a stem feeds another config, and always
  before delivering a sample-based link.

### 6 — Encode to a share URL
```bash
python3 scripts/encode.py /path/to/envelope.json --live          # envelope: no --studio needed
python3 scripts/encode.py /path/to/bare-cfg.json --studio pulse --live
python3 scripts/encode.py cfg.json --code                        # paste-able code for Share ▾ → Load
python3 scripts/encode.py --decode '<url|code>'                  # the reverse
```
`--live` targets https://sound-flow.netlify.app/<studio>/; default targets the local `apps/` file
URL; `--base <URL>` for anything else (e.g. a running bridge on `http://localhost:3355`).

### 7 — Shortlink
Shorten the `#sfa=` URL on **a47l.com** via the shortlink MCP (`shortlink_create`). Deliver the
short link; keep the long one as the fallback when the MCP is unavailable.

### 8 — Deliver
- the clickable link (opens the studio with the thing loaded),
- one line on what you built,
- **2–3 knobs** they can ask you to turn ("more swing", "darker bed", "duck harder"),
- for sample-based studios: which refs it needs, and that `⬇ Bundle` / `bundle.mjs export` carries
  the audio to another machine.

### 9 — Iterate by config-diff, never by rewrite
On follow-ups, patch the previous config — from the conversation, from the registered CFG, or by
decoding whatever the user pasted. Change only the params their ear-words point at, re-render,
re-encode, re-shortlink. If a stem changed, re-render the chain (see composing.md §"After an edit").

---

## 3. WHEN THE BRIDGE IS NEEDED

`scripts/bridge.mjs` on `localhost:3355` (start it with `/sound-bridge`). Everything else works
without it. It is **required** for:

| need | surface |
|---|---|
| VOX takes (TTS) | `POST /api/tts` `{text, voice?, instructions?}` → wav bytes; key stays server-side; 503 when absent |
| deck m4a (INV-9) | `POST /api/deck-export` `{clip, seq, hash}` → `audio/<clip>/<seq>.m4a` (macOS afconvert) |
| m4a export | `POST /api/encode?format=m4a`, raw wav body → `audio/mp4` bytes (`soundFlow.exportM4a()`) |
| browser ⇄ substrate sync | studios' link-light; renders made in the page land in `sound-state/` |
| a true in-browser render | `node scripts/drive.mjs <cfg|CFG-id>` (Playwright; the 90 % path is sound-render) |

---

## 4. VERIFY BY ANALYSIS, NOT BY EAR

`--check` is the first gate. For anything beyond it, measure with PRISM's pure-math `analyze()`:

```bash
cd <your Sound Flow checkout>
node -e "
const [{Substrate},{analyze}] = await Promise.all([import('./src/lib/state.mjs'), import('./src/engines/prism.mjs')])
const s = new Substrate(process.env.SF_STATE_ROOT || undefined)
for (const n of process.argv.slice(1)) {
  const a = s.listAssets().filter(x => x.name === n).sort((x,y) => (y.at||'') < (x.at||'') ? -1 : 1)[0]
  if (!a) { console.log(n + ' — NOT FOUND'); continue }
  const { channels, sampleRate } = s.readAsset(a.hash)
  const r = analyze(channels, sampleRate)
  console.log(n + ' ' + a.hash.slice(0,8) + ' · ' + r.durationSec.toFixed(3) + 's · peak ' + r.loudness.peak +
    ' dBFS · rms ' + r.loudness.rms + ' · bpm ' + r.bpm.value + ' (conf ' + r.bpm.confidence + ') · ' + r.onsets.length + ' onsets')
}" boombap drift-bed
# boombap   d823c106 · 22.326s · peak -5.11  dBFS · rms -28.61 · bpm 86    (conf 0.261) · 27 onsets
# drift-bed 98253b7e · 96.000s · peak -13.22 dBFS · rms -23.40 · bpm 117.5 (conf 0.484) · 854 onsets
```

What each number is good for:

- **duration** — the hard one. It must equal the arithmetic the schema documents (MIX
  `bars·beatsPerBar·60/bpm + 1.5`, DRIFT `window + tailSec`, LOOM `loops·window + tailSec`,
  TAPE `(len−trims)/rateProduct × stretchFactor + tailSec`). A mismatch is a config bug.
- **peak** — headroom. `--check` already refuses > 1.0; masters landing above ≈ −1 dBFS mean the
  limiter is working overtime, below ≈ −14 dBFS means the mix is thin. Narration stems run hot
  (≈ −1); music beds sit ≈ −6 to −10.
- **rms / lufsApprox** — relative loudness between stems. Compare stems to each other, never to a
  streaming target: `lufsApprox` is BS.1770 **without K-weighting**, a proximity, not a meter.
- **onsets** — did the pattern actually fire? A beat that authored 39 hits and analyses 39 onsets
  is intact; 0 onsets on a beat is a silent lane.
- **bpm** — only believe it on dense beat-driven material with `confidence > ~0.2`, and only for
  audio you did **not** author. Measured: `boombap` reports 86 @ 0.26 (its authored 172 is
  half-time — see the schema's octave rule); a sparse 88 bpm PULSE beat reports 98.6 @ 0.009; the
  60 bpm `drift-bed` reports 117.5 @ 0.484 — high confidence, meaningless number. You already know the bpm of anything
  you wrote — use `analyze` on imported and human-supplied audio.
- **silences** — VOX/CHOP pacing, and PRISM `silence-split` boundaries.

`node scripts/verify.mjs` is the suite-level gate (determinism × every engine, codec round-trip,
analysis gates, substrate, loop-seam checks). It must be green before rendering on top of the
engines; the orchestrator runs it as step ⓪ and aborts the pass when it's red.

---

## 5. RULES

- **Only what the schema lists.** Voices, fx, intent types, enum values, ranges — every `[min,max]`
  respected. `place` is authoring sugar: rewrite it into `tracks[].clips` before shipping.
- **Seeds are mandatory.** Equal seeds render byte-identically on the Node host (INV-3). Changing
  the seed re-rolls the dice without touching the notes — it is a composition knob, and it's free.
- **Keep configs partial and minimal.** Don't emit defaults you didn't choose. Delete keys that
  return to their default rather than writing the default back.
- **Levels.** PULSE per-lane `level` ≤ 0.6 (kick dominates past ~0.5); DRIFT rule levels 0.08–0.14
  over a ~0.035/tone pad bed; TAPE has **no limiter** — end hot chains with `gain: -1..-6`; MIX
  `limit: -1` is safety, not loudness. Clipped renders fail `--check`.
- **Remix input (RT-2 / RT-4).** If the user pastes a `#sfa=` URL, an a47l.com link, a bare code,
  raw JSON, or a `CFG-NNNN`/`MIX-NNNN` id — **decode/read it first**
  (`encode.py --decode`, `/sound-state` for ids) and patch from their actual current state, never
  from memory.
- **Additive-only config changes.** Never change an engine's `defaults()`; never repurpose a field.
  New values and new optional keys only, so every existing config and share URL keeps rendering
  identically (§18 delta 1.7/1.8).
- **All substrate writes route through `/sound-state`** (INV-6). No hand-written ids, sidecars,
  `state.json` edits, or activity-log appends.
- **Publishing leaves the machine.** Shortlinking a delivery link is part of the job; posting to a
  blog, a repo, or anywhere public is the user's call (§13.3).
- Open the link in a browser only if the user asks.

---

## 6. WHAT THIS SKILL CANNOT DO

Honest limits. Say them out loud when they matter rather than bluffing.

- **It cannot hear.** There is no listening step anywhere in this pipeline. Every claim about a
  render is an inference from numbers — determinism, peak, RMS, duration, onset count, silence
  map — plus the schema's perceptual annotations, which are *documented* correlations, not
  perception. "Sounds like a freight yard at 2 am" is a design intent, not a measurement.
- **Timbre and taste are human calls.** Does this groove? Is the swing in the pocket or drunk? Is
  the FM bell warm or clangy? Is that duck polite or gasping? Is the narrator's read right? Build
  the version the schema says matches the words, deliver the link, and ask.
- **bpm detection is weak on what it's weak on.** Sparse or ambient material returns confident-
  looking nonsense (measured above). Don't tag `meta.bpm` from a low-confidence estimate on
  ambient audio — MIX `conform` will happily play the clip at the wrong rate.
- **HPSS is sustained-vs-transient, not instrument-aware.** It will not pull vocals out of a mix or
  split two pitched instruments. It pulls drums off a loop well; say that, not "stem separation".
- **Mic takes need a human** (RT-8's last mile): LOOM `⏺`/`⏺ Overdub` and CHOP `⏺ Sample` are
  `getUserMedia` paths with no agent equivalent. Claude can place, level, and process a human's
  take, and can render everything else headlessly — it cannot perform one.
- **Some paths need the environment, not the skill:** TTS needs the bridge *and* a working key;
  m4a and deck exports need the bridge *and* macOS `afconvert`; `drive.mjs` needs Playwright and a
  Chrome. Without them, report the gap — don't fake the artifact.
- **Never compare fresh browser render hashes to CLI hashes.** Browser `OfflineAudioContext` wobbles
  ~1 float32 ULP; cross-host equality uses the §14 oracle (equal length + max |Δ| < 1e-6 +
  analysis fingerprint), never PCM-hash equality.
- **It does not decide to publish.** Shortlinks are delivery; anything beyond that is approval-gated.

---

## 7. REFERENCES

- Multi-studio composition: [`reference/composing.md`](reference/composing.md)
- Per-studio vocabulary: `reference/schema-{pulse,circuit,drift,chop,loom,vox,prism,tape,mix}.md`
- Sibling skills: `/sound-state` (all persistence) · `/sound-render` (headless renders) ·
  `/sound-bridge` (serving + sync + TTS + m4a) · `/sound-orchestrator` (re-render the chain)
- Law: `SOUND-FLOW-SPEC.md` §5 (invariants), §8.2 (engine contract + buffer injection), §9 (RT
  loops), §10 (studios), §14 (testing oracle), §18 (deltas — 1.8 current).
