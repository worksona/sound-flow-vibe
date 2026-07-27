# VOX — config schema v1 (authoritative)

One file, three consumers (INV-7): this document is the app's parameter reference, the
vibe skill's authoring vocabulary, and the property source for `scripts/verify.mjs`.
If the engine and this file disagree, this file wins until a spec delta says otherwise.

VOX is the narration studio (spec §10): a script of **keyed lines**, each rendered to a
library take through the bridge's TTS helper, assembled by the engine into one **timeline
stem** (line · pause · gap · line · …). VOX is sample-based: the config carries *references*
to rendered takes, not audio — the host (studio page or CLI) resolves every `ref` against
the library/substrate and injects `cfg.__buffers` before rendering (§8.2). `__buffers` is
never authored and never shared. The OpenAI key lives server-side only: the studio posts to
`bridge.mjs` `/api/tts`, never to OpenAI (spec §10 VOX, P3-02).

Envelope for sharing/registering: `{ "v": 1, "studio": "vox", "cfg": { … } }`.
Bare `cfg` objects are what you author; the codec and substrate wrap them.

---

## Fields

| field | type | range / values | default | notes |
|---|---|---|---|---|
| `seed` | uint32 \| string | any | — **(mandatory)** | Reserved determinism stream (INV-3). VOX v1 consumes no randomness, but the seed names the stem (`vox-<seed>.wav`) and future stochastic features will draw from it. |
| `lines` | object[] | 1+ | the killer-02 script (below) | The script, in spoken order. |
| `lines[].key` | string | non-empty | — **(mandatory)** | Names the rendered take in the library **and** addresses the deck: a `clip/seq` key (e.g. `killer-02/3`) exports to `audio/killer-02/3.m4a` (INV-9). |
| `lines[].text` | string | — | — **(mandatory)** | What TTS speaks. Editing text does **not** touch the take — re-render (⏺) to hear the change. |
| `lines[].voice` | string | `nova` `alloy` `echo` `shimmer` (studio picker; any OpenAI voice validates) | `nova` | OpenAI TTS voice. |
| `lines[].instructions` | string | — | the NARR narrator style (below) | Style prompt for `gpt-4o-mini-tts` — how to read, not what to read. |
| `lines[].ref` | string | `hash:` \| `name:` \| `tag:` clip ref | — | The rendered take. Set by the studio to `name:<key>` after ⏺; pin `hash:<64-hex>` to freeze one exact take. No ref, or a ref with no match ⇒ the line is **skipped silently** but holds its slot (estimated ~14 chars/s, ≥ 1 s) so surrounding timing survives. |
| `lines[].preSec` | number (s) | 0–10 | 0.12 | Silence before the line inside its slot. |
| `lines[].postSec` | number (s) | 0–10 | 0.3 | Silence after the line inside its slot. |
| `gapSec` | number (s) | 0–10 | 0.5 | Silence between consecutive line slots. |
| `tailSec` | number (s) | 0–30 | 0.3 | Silence after the last line — the stem's tail. |

Timeline law (engine `resolveLines`, shared by `duration()` and `schedule()`):
`[preSec] line [postSec] · gapSec · [preSec] line [postSec] · … · tailSec`.
`duration = Σ(pre + lineDur + post) + gap·(n−1) + tail`, where `lineDur` is the resolved
take's duration, or the deterministic text-length estimate when unresolved.

**Default lines**: the killer-02 script **verbatim from `audio/render.sh`** (NARR is
authoritative for spoken lines + seq numbering) — 9 lines, keys `killer-02/0`…`killer-02/8`,
refs `name:killer-02/N` — so a fresh VOX page resolves against the imported corpus and
sounds immediately.

The NARR narrator default (bridge-side, applied when `instructions` is omitted):

> Warm, confident, upbeat product narrator. Clear and articulate, natural pacing, a touch
> of energy — like a polished explainer voiceover. Do not rush the ending.

## The render-then-ref flow

VOX configs are truth for the *script*; takes are build artifacts of the lines (INV-2 in
miniature). The loop, per line:

1. **tts** — POST `http://localhost:3355/api/tts` with `{ text, voice?, instructions? }`
   → `audio/wav` bytes. The bridge reads the key from disk per request (503
   `tts key unavailable` when absent — the studio falls back to draft mode; agents skip
   to draft or report). The key never enters the page and is never logged.
2. **library** — decode → canonical 16-bit wav → `Library.put` named by the line's **key**,
   tags `[narration, vox]`; the studio also pushes it through the bridge so the take lands
   in the substrate (`sound-state/assets/`) immediately.
3. **ref** — the line records `ref: "name:<key>"`. From here it is an ordinary suite clip
   ref: the stem render resolves it, MIX can place it, re-rendering under the same name
   re-resolves on next load (RT-3). Multiple assets sharing a name sort ties by library
   order — pin `hash:` when you must freeze a specific take.

Draft mode (browser `speechSynthesis`) is an audible sketch only: never captured, never a
take, never what renders — the studio marks it DRAFT everywhere.

Agent path (RT-9): the same two POSTs work headlessly — `curl -X POST localhost:3355/api/tts
-d '{"text":"…"}' -H 'Content-Type: application/json' > take.wav`, then `sound-state` import
or a bridge asset PUT, then `sound-render` the stem config.

## Deck export (INV-9)

Keys shaped `clip/seq` map onto the existing deck tree — the exact keyed m4a layout
BEATLAB/NARR decks consume today (manifest `deck_export`):

```
key "killer-02/3"  →  POST /api/deck-export { clip: "killer-02", seq: "3", hash: <take hash> }
                   →  afconvert -f m4af -d aac  →  audio/killer-02/3.m4a
```

`clip` and `seq` must be single path segments (`[A-Za-z0-9_-]+` — traversal refused); seq
forms in the wild: `3`, `s5`, `s5b2`, `automationb0`. The take must already be in the
substrate (the studio's render pushes it; otherwise → Library with the bridge linked). The
deck plays the new file with **zero deck changes** — re-voicing a clip is: change
voice/instructions, ⏺ All takes, ⇥ deck each line.

## Vibe translation table

Mood words → parameter moves. Instructions do the acting; pauses do the pacing.

| vibe | moves |
|---|---|
| **warmer and slower** | `instructions`: "Warm, unhurried narrator. Gentle pace, soft consonants, let every sentence land before moving on." + `postSec` up (0.3 → 0.45–0.6) |
| **longer gap before line N** | that line's `preSec` up (0.12 → 0.6–1.0) — the pause belongs to the line it precedes |
| **radio tight** | `gapSec: 0.25`, `postSec: 0.15` all lines, instructions add "brisk, energetic, no dead air" |
| **movie-trailer gravitas** | `voice: "echo"`, instructions: "Deep, deliberate trailer narrator; weight on every phrase; long dramatic stops." + `gapSec: 0.8` |
| **let the ending land** | last line `postSec: 0.8–1.2`, `tailSec: 1.0+` — matches NARR's "do not rush the ending" |
| **conversational / podcast** | `voice: "alloy"`, instructions: "Relaxed, friendly, like explaining to a colleague — natural hesitations welcome." |
| **bright and light** | `voice: "shimmer"`, instructions add "smiling, upbeat, quick" + `gapSec: 0.35` |
| **punch one line** | give only that line its own `instructions` ("slow down; hit every word") — per-line overrides beat global rewording |
| **breathing room for a bed** | `gapSec: 0.9–1.2` — MIX's duck merge-rule then relaxes between lines instead of holding the floor |

## Perceptual annotations

- **gapSec is the read's tempo.** 0.5 reads as narration, 0.25 as ad copy, 1.0+ as poetry.
  Below ~0.4 s a downstream MIX `duck` holds as one continuous move (its merge rule);
  above it the bed audibly breathes between lines.
- **preSec on a line is emphasis** — 0.6 s of nothing before "80. Critical." does more than
  any instruction string.
- **Instructions beat voice-swapping.** The four voices are timbres; pace, mood, and weight
  all live in `instructions`. Try re-instructing before re-casting.
- **Unresolved lines keep time — but the estimate runs short.** The estimate (~14 chars/s,
  floor 1 s) holds the slot, so a half-rendered script previews with correct overall shape.
  It is an estimate, not a bound, and it is biased short: measured against the 66 imported
  corpus takes whose script text is known, the real takes run at 11.55 chars/s aggregate
  (13.12 with `render.sh`'s 420 ms of padding removed), so the estimate under-runs by a mean
  **0.62 s per line** (median |err| 0.49 s, worst 3.12 s). Filling in a missing take
  therefore pushes every later line that much **later**. Unresolved slots draw dim on the
  strip for exactly this reason — re-check pacing after ⏺ All.
- **Text edits silently stale the take** — the config can't know the take spoke older text.
  Re-render (⏺) after any wording change; the same key overwrites cleanly.

## Worked example — re-voicing killer-02

The P3-06 gate move: same script, new read — trailer-dark instead of product-upbeat.
Refs are omitted, so nothing resolves until ⏺ All takes renders the nine lines; each lands
as `name:killer-02/N`, then ⇥ deck per line rewrites `audio/killer-02/*.m4a` and the
existing deck plays the new voice unchanged (RT-6).

```json
{
  "seed": "killer-02-noir",
  "gapSec": 0.7,
  "tailSec": 1.0,
  "lines": [
    { "key": "killer-02/0", "text": "One person owns 100% of this project.", "voice": "echo",
      "instructions": "Low, deliberate documentary narrator. Grave, unhurried, every word weighed." },
    { "key": "killer-02/1", "text": "That's key-person risk —", "voice": "echo",
      "instructions": "Low, deliberate documentary narrator. Grave, unhurried, every word weighed." },
    { "key": "killer-02/2", "text": "the whole project living in one head.", "voice": "echo",
      "instructions": "Low, deliberate documentary narrator. Grave, unhurried, every word weighed." },
    { "key": "killer-02/3", "text": "Nothing shows on the dashboard…", "voice": "echo",
      "instructions": "Low, deliberate documentary narrator. Grave, unhurried, every word weighed." },
    { "key": "killer-02/4", "text": "…until that head is gone.", "voice": "echo", "preSec": 0.5,
      "instructions": "Almost a whisper. Let the dread sit." },
    { "key": "killer-02/5", "text": "Because our work is stored, it's a number:", "voice": "echo",
      "instructions": "Low, deliberate documentary narrator. Grave, unhurried, every word weighed." },
    { "key": "killer-02/6", "text": "80. Critical. Bus factor of one.", "voice": "echo",
      "preSec": 0.6, "postSec": 0.6,
      "instructions": "Slow down hard. Three separate verdicts, a beat between each." },
    { "key": "killer-02/7", "text": "Evidenced from live state — with the exit attached.", "voice": "echo",
      "instructions": "Low, deliberate documentary narrator. Grave, unhurried, every word weighed." },
    { "key": "killer-02/8", "text": "Visible. Measurable. Closeable. Project state. The project remembers.", "voice": "echo",
      "postSec": 0.9,
      "instructions": "The closing line. Measured, final, do not rush the ending." }
  ]
}
```

Encode it (wraps in the envelope, prints the `#sfa=` link):

```
python3 "$CLAUDE_PLUGIN_ROOT/scripts/encode.py" /path/to/killer-02-noir.json --studio vox --live
```

Remember: the URL alone carries the *script and pacing*; the takes travel via the shared
library (same origin) or a bundle (RT-5). Opening a VOX URL before its takes exist shows
every line `no take` — ⏺ All with a linked bridge, and it speaks.

## Studio interaction — the stem timeline strip

The interaction law: anything drawn on screen that represents a parameter is directly
grabbable. The strip above the script is the **timeline stem itself**, drawn from the
same `resolveLines()` geometry the engine renders — blocks are line slots
(`preSec + take + postSec`) in sequence, width = duration; the space between blocks is
`gapSec`; resolved takes fill solid, unresolved lines show their dim text-length
estimate holding the slot.

| gesture | effect |
|---|---|
| **drag the gap between two blocks** | push/pull the **leading line's `postSec`** (0–10 s, 2 decimals) — pacing under the pointer. The px→seconds scale is pinned at grab time, so the value changes by exactly the dragged amount. **Shift = fine**; a floating chip shows `post 0.45s` live; the numeric field re-syncs on release. |
| **double-click a gap** | reset the leading line's `postSec` to the default (removes the key). |
| **drag a block** | reorder the script — drop indicator shows the insertion point; on release `cfg.lines` is spliced to the new order, exactly as if the JSON were re-authored. |
| **per-line pre/post numeric fields** | stay as the secondary affordance; `gapSec`/`tailSec` sliders redraw the strip live. |

Conventions (suite-wide): pointer capture, ≥ 12 px hit zones (narrow gaps widen to a
12 px handle around their midpoint), cursor affordances (`ew-resize` over gaps,
`grab` over blocks), rAF-throttled redraw that idles when nothing moves.

### Mic takes — your own voice, in the same slot

Every line row carries **⏺ mic** beside the TTS **⏺**. It records the line from the
microphone (free length: ⏺ mic starts, ⏹ stops, the row's chip reads `recording…`) and
stores the result **exactly the way a TTS take is stored**:

```
Library.put(wav, { name: <line key>, studio: 'vox', by: 'human',
                   tags: ['narration', 'vox', 'mic'], durationSec, sampleRate })
line.ref = 'name:<line key>'
```

**Mic takes and TTS takes are interchangeable at the `ref` level.** Same library, same
name (the line's key), same `name:` ref shape, same freshest-first tie-break (RT-3), same
push to the substrate through the bridge. The stem render, `⇥ deck` export to
`audio/<clip>/<seq>.m4a`, MIX placement and every other consumer resolve them identically
and cannot tell — and do not need to tell — which mouth a take came from. The only
difference is provenance you can query: a mic take carries the extra `mic` tag. Re-record
a line and the new take supersedes the old one under the same name; pin `hash:` when you
must freeze one specific reading.

Unlike TTS, **⏺ mic needs no bridge** — recording your own voice is a local act, so the
button stays enabled when the link light is dark. Auto-trim (−45 dBFS, 10 ms margins)
removes the fumble before and after the line.

**The arm panel** (the **input** row) is the shared `micArm()` strip from `lib/mic.js`,
identical to LOOM's and CHOP's: **⏺ arm**, permission chip (`mic: not asked / armed /
denied`), device picker (`Microphone 1/2…` until labels are granted), live input VU,
**too hot** badge at ≥ −1 dBFS, and a **monitor** toggle that is OFF by default and
labelled *headphones only — feedback risk*. Capture is RAW (echo cancellation, noise
suppression and AGC all off). A take whose peak is under −50 dBFS is **not** stored: the
panel offers **↻ retry** or **keep anyway**. Mic errors arrive as sentences
(`micErrorMessage`), never as bare DOMExceptions.

### Live visualization (lib/viz.js kit)

- **Master VU + spectrum** — suite transport-bar convention: everything audible
  (take auditions and the stem transport) routes through a tapped master gain
  (`makeVizTap`) feeding a stereo VU (peak-hold, −1 dBFS line) and a 36-bar log
  spectrum, right-aligned in the transport bar. Rebuilt per AudioContext; the loops
  idle fully and the canvases clear whenever nothing is sounding (zero background rAF).
- **Row light + progress** — a take audition lights its script row (`.sounding`) and
  sweeps a slim bottom progress bar, audio-clock driven; it self-idles when the take
  ends. Browser-voice **drafts** have no WebAudio graph to meter, but their utterance
  `onstart`/`onend` events light the same row treatment so a draft is never invisible.
- **Stem playhead** — stem playback sweeps an ink playhead across the timeline strip
  (audio-clock driven, `vizLoop`), and stop (`space`/Escape) also cancels any
  speaking draft.
- **The transport ends on the audio clock, not a timer** (spec delta 1.9). A fresh
  `AudioContext`'s clock does not start when the constructor returns — the output device
  takes ~90–130 ms to open (measured, macOS/Chrome). A wall-clock `setTimeout(duration +
  150 ms)` therefore always fired early and closed the context **158–222 ms before the
  stem had finished sounding**; the stem now stops when `currentTime − t0 ≥ duration`,
  overshooting by one frame (2–7 ms measured) instead of truncating. The timer survives
  only as a wide backstop for a backgrounded tab, where rAF is throttled.
