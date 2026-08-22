# PRISM — config schema v1 (authoritative)

One file, three consumers (INV-7): this document is the app's parameter reference, the
vibe skill's authoring vocabulary, and the property source for `scripts/verify.mjs`.
If the engine and this file disagree, this file wins until a spec delta says otherwise.

PRISM is the decompose & analyze studio (spec §10): it points a lens at ONE library
asset — bpm estimate, onset map, silence map, loudness, and a **spectral view** (STFT
heatmap, studio-only — see below; closes the spec §10 "spectral view" phrase) — and
then acts on what it sees:
**write tags** (stamp the detected bpm onto the asset's meta so MIX can auto-conform it),
**silence-split** and **bar-chop** (render each segment back through the engine as a new
derived asset), and **separate** (median-filter HPSS — harmonic/percussive components as
two derived assets, engine v1.1). PRISM is sample-based: the config carries a
*reference*; the host resolves it and injects `cfg.__buffers[source.ref]` before
rendering (§8.2). Analysis AND HPSS are pure math on Float32 channels — no AudioContext,
no worklet, identical in every host (the last analysis gap from the v1 spec is closed;
`meta.engineVersion` is now `1.1.0`).

Envelope for sharing/registering: `{ "v": 1, "studio": "prism", "cfg": { … } }`.

---

## Fields

| field | type | range / values | default | notes |
|---|---|---|---|---|
| `seed` | uint32 \| string | any | 47 **(mandatory)** | Reserved determinism stream (INV-3). PRISM v1 consumes no randomness — analysis and cuts are pure functions of the samples. |
| `source.ref` | string | `hash:<64-hex>` \| `name:<pattern>` \| `tag:<value>` | `name:boombap` | The ONE asset under the lens. Multi-match refs resolve name-ascending, same-name ties freshest-`at` first (RT-3); PRISM takes the **first match**. |
| `action` | string | `passthrough` \| `silence-split` \| `bar-chop` \| `harmonic` \| `percussive` | `passthrough` | Which segment set `schedule()` renders back-to-back (below). `harmonic`/`percussive` render that HPSS component of the WHOLE source — duration unchanged. New values are additive: every pre-1.1 config and share URL renders identically (partial-merge safe). |
| `bpm` | number | 60–180 | — (auto) | Grid override for `bar-chop`. Omit to use the analyzed bpm. |
| `offset` | number (s) | ≥ 0 | 0 | Slides the bar grid right (wrapped into the first bar length). A wrapped offset > 0 makes a lead-in segment `[0, offset)` before bar 1. Draggable on the studio waveform. |
| `silenceDb` | number (dBFS) | −90–−6 | −38 | Silence threshold for the RMS envelope (10 ms hop, 20 ms window). |
| `minGapSec` | number (s) | 0.05–5 | 0.35 | A quiet run must last at least this long to count as a silence. |
| `segments` | int[] | segment indices ≥ 0 | — (all) | Narrows the action's segment set — `segments: [3]` renders only the fourth segment. This is how the studio (and any agent) renders ONE derived asset per config; out-of-range indices are dropped. |
| `tailSec` | number (s) | ≥ 0 | 0 | Silence appended after the last segment. 0 keeps passthrough byte-transparent. |

## Actions — what renders

`schedule()` plays the selected segment set **back-to-back, raw cuts, no envelope** —
derived assets go through the normal render pipeline (provenance, hashing, staleness).

- **`passthrough`** — one segment: the whole source. With `tailSec: 0` on an untouched
  44.1 kHz source the render re-quantizes to the **same canonical PCM** and dedupes to
  the source's own hash (verified against the boombap stem).
- **`silence-split`** — the non-silent spans (complement of the silence map), spans
  < 50 ms dropped. A source with no detected silences yields one whole-source segment.
- **`bar-chop`** — cuts at `barBounds(bpm, duration, offset)` (4/4 bars of
  `4 * 60/bpm` s); bpm = `cfg.bpm` override, else the analyzed value; no detectable
  grid at all falls back to one whole-source segment. Leading/trailing partial bars
  are kept as segments.
  **The grid does not drift (measured, delta 1.10):** bar `n` lands at
  `offset + n × barDur` to within **≤ 49.8 µs**, which is exactly the r4 output
  rounding quantum (±50 µs) and not accumulation — the raw accumulator stays within
  **0.11 ns of the closed form over an hour** (2610 bars at 174 bpm). Verified at
  60/84/86/174/180 and 61.3 bpm with offsets 0 / 0.37 / 1.234. The chopped segment set
  is also exactly closed: segments sum to the source duration to **0.00 µs** with
  **0.00 µs** of inter-segment gap, so a chop-and-reassemble is sample-tight.
  What *does* move is the bpm the grid is built from — see the confidence regime below.
- **`harmonic` / `percussive`** — one whole-source segment whose SAMPLES are the HPSS
  component (below). `tailSec` appends silence as usual; `segments` is meaningless here
  (the set has one entry). **Cost guard: sources over 120 s are refused** —
  `validate()` errors when the host has injected `__buffers`, and `schedule()`/`hpss()`
  throw regardless. The math is O(n log n) STFTs plus O(n · 17) medians: expect a few
  seconds per minute of audio in-browser (the studio chunks it so the tab stays alive);
  offline/CLI hosts are the natural home for batch separation.

## analyze() — the measurement contract

`analyze(channels, sampleRate, opts?)` (exported; pure math) returns:

| field | shape / range | how |
|---|---|---|
| `bpm.value` | 60–180 (0.1 resolution) or `null` | Autocorrelation of a 10 ms-hop **onset-energy envelope** (positive energy flux of a 20 ms RMS window), lag-constrained to 60–180 bpm, parabolic sub-hop refinement. |
| `bpm.confidence` | 0–1 | Normalized autocorrelation of the onset-energy envelope **at the chosen lag** — how periodic the envelope is there, and nothing else. **It is not a correctness score. Read the confidence regime below before you trust it.** |
| `onsets` | seconds[], ascending | Energy-flux peaks over mean + 1.5σ with a **50 ms refractory**. Reported on the 10 ms envelope grid and **systematically 10–20 ms EARLY** — see the detector-bias note below. |
| `silences` | `[{start, end}]` seconds | RMS envelope frames under `silenceDb` merged into runs ≥ `minGapSec`. Edges are quantized to the same 10 ms grid — measured ±10 ms against exactly-known burst edges (−8 … +6 ms over a 4-span probe). |
| `loudness.peak` | dBFS ≤ 0 (floor −120) | Max absolute sample, all channels. |
| `loudness.rms` | dBFS (floor −120) | Whole-file RMS, all channels. |
| `loudness.lufsApprox` | LUFS-ish (floor −120) | BS.1770 integrated form **without K-weighting** — a proximity (±~1 LU), not a meter. |
| `durationSec` | seconds | Source length. |

**Octave rule (documented per acceptance):** the FASTER octave wins whenever its
autocorrelation peak retains ≥ 0.72 of the slower peak's score, halving repeatedly while
that holds. On the corpus **boombap stem (authored at 172 bpm) the SLOWER octave wins —
analyze reports 86.0** — because the drum pattern is half-time: the envelope has
essentially zero correlation at the 172 bpm period (measured ac ≈ −0.02 vs 0.26 at the
86 period). 86 is within ±3 of 172's /2 octave, which the acceptance admits; tag
whichever octave you want MIX to conform against, or override `bpm` before tagging.

### The onset detector's bias — subtract 15 ms (measured, delta 1.10)

`onsets` is **10–20 ms early, always**, and it is early by construction, not by luck.
The RMS envelope has a 10 ms hop and a **20 ms (2-hop) window**, so a transient at time
`T` first raises the frame whose window *starts* at `floor(T/hop) − 1`; that frame index
is what gets reported. Reported time is therefore exactly `(floor(T/0.01) − 1) × 0.01`:

| authored transient | reported | lag |
|---|---|---|
| 0.500, 1.000, 1.500 … (on the grid) | 0.49, 0.99, 1.49 … | **−10.0 ms** |
| +3 ms off grid | 0.49, 0.99 … | −13.0 ms |
| +5 ms off grid | 0.49, 0.99 … | −15.0 ms |
| +7 ms off grid | 0.49, 0.99 … | −17.0 ms |
| irrational spacing (0.4137 apart) | — | −11.1 … −18.5 ms |

Over 30 probes: **mean −13.9 ms, range −10.0 … −18.5 ms** (the true bound is −10 … −20).
Two consequences worth internalising:

- **Absolute onset times need +15 ms** before you compare them to anything authored
  (a PULSE grid, a MIX `at`, a bar line). The studio's onset ticks on the waveform and
  spectrogram inherit the same 10–20 ms lead.
- **Differentials are exact.** Inter-onset intervals cancel the bias completely —
  a 400.0 ms authored spacing measures **400.0 ms** on every interval. Any timing claim
  made with this detector should be phrased as a differential; that is how the delta 1.9
  swing defect was measured, and it is why the residual there (3.3 ms) was believable.

### bpm confidence — the regime where it can and cannot be trusted (measured, delta 1.10)

Against synthetic references with a real accent hierarchy (kick 1&3, snare 2&4, hats on
8ths at −12 dB, 8 bars each), `analyze().bpm` is **exact to ≤ 0.3 % in 22 of 24 cases**
across 60–180 bpm, including swung, sparse (no hats) and humanised (±12 ms) variants.
The two failures were exact-half reads (160 → 80.0, 174 → 87.0). But:

> **Confidence runs the WRONG WAY across that set.** Confidence when the answer was
> exact: **0.498 – 0.812** (mean 0.702). Confidence when the answer was half-tempo:
> **0.970 and 0.987**. A beatless 110 Hz drone with slow AM reports **171.4 bpm at
> confidence 1.000** — a pure artifact of the RMS window aliasing the tone, with the
> highest possible score. A white-noise bed reports 63.2 @ 0.928.

That is not a bug in the number — it is what the number *is*. Confidence measures how
periodic the envelope is at the chosen lag, and an envelope is *most* periodic at a
machine-regular **pattern** period (usually 2 beats → half-tempo) or on material with no
transients at all. Practical regime:

| confidence | what it actually means | what to do |
|---|---|---|
| **> 0.95** | the envelope is nearly perfectly periodic — almost always a 2-beat pattern lag (half-tempo) or a non-percussive artifact | **suspect it.** Check the ×2 octave. Never auto-conform. |
| **0.50 – 0.85** | the healthy band for real drum material — where all 22 exact reads landed | plausible; still eyeball the grid overlay |
| **0.30 – 0.50** | uneven pulse or human timing. A synthetic 90 bpm track with its backbeat displaced 70 ms reads **81.3 @ 0.410** — the detector is *right* that the pulse is uneven, and the number is a compromise between the two interval lengths | fix the timing, don't conform to the compromise |
| **< 0.30** | barely periodic. Most of the real corpus lives here — `boombap` reads **86.0 @ 0.261**, and it is not wrong | the number is unverified, not necessarily wrong. Verify it by eye before using it |

Corroborating field numbers from the corpus: `boom-overtime` rendered **before** the
delta 1.9 swing fix analyses at **81.1 bpm @ conf 0.369**; the same config **after** the
fix analyses at **89.9 @ conf 0.642** against 90 authored. Evening out the pulse nearly
doubled the confidence — that ratio is the one signal in this detector that tracks
rhythmic health.

Two more hard limits:

- **The range is clamped 60–180 bpm.** A 45 bpm source reports 180.0 @ 0.000; a 200 bpm
  source reports 100.0 (½×). Nothing outside the window can ever be reported.
- **Metric level is ambiguous without accents.** On unaccented isochronous click trains
  only 5 of 11 tempi landed on the authored beat (60 → 120.0 @ 0.999, 90 → 60.0 @ 0.995,
  180 → 120.0 @ 0.991). Candidate lags are quantized to the 10 ms envelope hop, so a
  beat period that does not sit near a 10 ms multiple scores worse at the beat lag than
  at some longer lag that does. Parabolic refinement recovers sub-hop *precision*
  (≤ 0.3 % where the octave was right); it cannot fix the *choice* of octave.

> ⚠ **`conform` inherits every one of these errors, silently.** MIX `clips[].conform`
> plays a clip at `playbackRate = mixBpm / clipBpm` using the `meta.bpm` PRISM stamped
> on the asset. A half-tempo read makes the clip play at **2× speed**; a 2/3 read makes
> it play at 1.5×; a beatless bed tagged 171.4 gets resampled by whatever ratio that
> implies. Nothing errors — `conformSkipped` only fires when a bpm is *missing*, never
> when it is *wrong*. **There is no confidence floor that makes auto-conform safe**,
> because the worst errors in this suite carried the highest confidences. The rule:
> **conform only against a bpm you authored or verified**, not one you merely detected.
> Verify by turning on the PRISM bar-grid overlay and checking that the grid still sits
> on the hits **eight bars in** — a half-tempo or 2/3 read separates visibly by then.
> When you know the tempo, set `cfg.bpm` (bar-chop) or overwrite `meta.bpm` via
> **✎ write tags** before any MIX config sets `conform: true`.

## hpss() — the separation contract (engine v1.1)

`hpss(channels, sampleRate, opts?)` (exported; pure math) →
`{ harmonic: Float32Array[], percussive: Float32Array[] }`, one array per input
channel, same length as the input. `hpssSteps(...)` is the identical computation as a
generator yielding `{phase, channel, done, total}` progress markers between fixed work
chunks — the studio drives it across the event loop; both drivers are bit-identical.

The method (median-filter HPSS, Fitzgerald 2010):

1. **STFT** per channel — radix-2 FFT, periodic-Hann window 2048, hop 512.
2. **Median filtering** of the magnitude spectrogram: harmonic-enhanced = median
   across **time** (kernel 17 frames ≈ 0.20 s) per bin — sustained partials are
   horizontal ridges; percussive-enhanced = median across **frequency** (kernel
   17 bins ≈ 366 Hz) per frame — transients are vertical lines.
3. **Wiener-style soft masks** (p = 2): `mh = H²/(H²+P²)`, and `mp = 1 − mh`
   **exactly**, so the two masked spectra sum to the original spectrum.
4. **ISTFT** ×2 — overlap-add with window-sum normalization.

Because the masks are exact complements and the ISTFT is linear,
**harmonic + percussive reconstructs the source** to float precision (measured
residual ≈ −71 dB on the acceptance fixture; the contract floor is −35 dB).

**Neither component is time-shifted (measured, delta 1.10).** An STFT/ISTFT framing
error would delay one component by a window — this one does not: cross-correlation lag
of `harmonic` and of `percussive` against the source is **0 samples** on a probe of
sustained tones plus 2 Hz transients, the harmonic component's zero crossings sit within
**1.7–9.1 µs** of the source's, and percussive transient peaks land within **0–2.7 ms**
of the source's (peak-picking noise on a noise burst, not an offset). Reconstruction is
**−151 dB in the interior**; the only samples that miss are **indices 1–11** — 0.25 ms
at the very head, where the periodic-Hann window sum is ~0 and the `w > 1e-9` guard
leaves them under-normalized (max residual 4.5e-2 there). Engine renders of the
`harmonic` / `percussive` actions are the exact source length, to the sample.
Deterministic: pure float math in fixed order, no randomness — INV-3 holds trivially,
and two renders of an hpss config are byte-identical on the Node host.

**Quality expectations — read this honestly.** Median HPSS separates
*sustained-vs-transient energy*, not musical stems. A 220 Hz pad and a bass guitar
both land in `harmonic`; a snare, a consonant, and a vinyl crackle all land in
`percussive`; a distorted guitar chug smears across both. What it is reliably good
for: pulling the drums off a loop (percussive) so the tonal bed (harmonic) can be
processed separately, de-clicking sustained material, isolating transients for
layering. What it will not do: separate vocals from instruments, split two pitched
instruments, or produce release-quality stems. On the acceptance fixture (220 Hz sine
+ noise bursts) the harmonic output dominates the 200–240 Hz band by > 10⁵:1 and the
percussive output preserves the authored onset count — that is the honest ceiling:
clean when the material is cleanly sustained-vs-transient, approximate otherwise.

## Spectral view — the studio's STFT heatmap (studio-only)

The **◩ spectral view** button toggles a real spectrogram of the current source —
no config field, no engine change (`meta.engineVersion` stays `1.1.0`): it is pure
studio instrumentation, so every existing config and share URL is untouched.

- **Computation:** STFT with the ENGINE's own FFT (radix-2, periodic-Hann 2048,
  hop 512 — the same tables HPSS uses; nothing reimplemented), mono mixdown of all
  channels, magnitude per bin. **Chunked** across the event loop exactly like the
  HPSS driver — the status line shows `spectral · N%` and the tab never freezes —
  and **cached per source hash**, so re-toggling and overlay redraws are instant
  (the heatmap itself is kept as an offscreen canvas; grid drags just re-blit).
- **Geometry:** a **full-source, unzoomed strip** placed below the two-band
  harmonic/percussive energy strip. That placement was chosen over coupling to the
  waveform's x-axis/zoom because PRISM's waveform is itself full-source and
  unzoomed — the two x-axes align 1:1 with zero sync machinery. Horizontal = time
  (whole source), vertical = frequency, **log-spaced 40 Hz (bottom) → 16 kHz (top)**.
- **Color:** magnitude in dB, −70..0 relative to the source's peak bin, mapped onto
  the umber identity ramp `bg → panel2 → ember → gold → ink` (LUT built from the live
  theme variables, so it follows dark/light).
- **Overlays:** once Analyze has run, onset ticks (top edge) and the bar grid at the
  detected/overridden bpm (slid by `offset`, including via waveform drag) draw over
  the heatmap, honoring the same `onsets` / `grid` checkboxes as the waveform.
- **Column ↔ time alignment (fixed in delta 1.10).** Every overlay on this page —
  waveform, playhead, onset ticks, bar grid — maps `t → t/durationSec × W`. The heatmap
  used to map `x → frame index`, but STFT frame `t` reads samples `[t·hop, t·hop+N)`
  and its energy is centred **half a window later**, at `t·hop + N/2`. The whole
  spectrogram was therefore drawn `N/(2·sr) = 23.2 ms` EARLY against everything drawn
  on top of it. Measured end-to-end in the page with 30 ms 4 kHz bursts at 0.5/1.5/
  2.5/3.5 s: **−20.1 … −22.1 ms (−6.0 … −6.6 px at W ≈ 1190)** before, **+1.4 … +6.8 ms
  (+0.4 … +2.0 px)** after — the residual is the estimator's own width, the arithmetic
  replica lands at +0.3 ms. Columns now invert the centre relation: the column at source
  sample `s` shows frame `(s − N/2)/hop`. **Studio-only** — no engine change, no config
  field, no rendered audio affected; `meta.engineVersion` stays `1.1.0`.
- **Playheads read the audio clock.** The audition playhead is drawn from
  `AudioContext.currentTime − t0` (never `performance.now()`), on both the waveform and
  the heatmap, from one shared `drawPlayhead()` and one shared source-time → x mapping,
  and the start time and the anchor come from a single clock read. Under 120 ms
  main-thread burns, `currentTime` and `performance.now()` were measured to agree to
  **≤ 4.5 ms over 8 s** in Chrome, so a stalled frame makes the playhead *pause*, never
  slide out of sync.

Reading it: harmonic material shows as horizontal ridges, percussive hits as vertical
lines — the spectral view is literally the picture the HPSS medians operate on, which
makes it the honest way to predict how well ⌁ separate will do before running it.

## Studio interaction — direct manipulation

Suite conventions (spec delta 1.8): pointer capture, ≥12 px hit zones, cursors
telegraph the axis, **shift = snap on gridded axes, fine on continuous axes**,
double-click = reset. Every gesture writes the same `cfg` fields an author would type;
numeric fields stay as synced secondaries.

| gesture | effect |
|---|---|
| **drag the waveform ↔** | slides the **bar grid**: writes `offset` (grab/grabbing cursor when a grid is drawn; a clean click < 4 px stays the segment audition). Shift = fine (offset is continuous seconds). |
| **drag the silence threshold line ↕** | the `silenceDb` threshold is drawn at its waveform amplitude, mirrored top/bottom like a gate window (dashed, labelled). Dragging (ns-resize) maps the pointer back to dBFS, clamped to the schema range −90..−6 — 1 dB steps plain, **shift = fine 0.1 dB**. The `sil` numeric field syncs live, and the silence map recomputes through the normal analyze path, debounced ~150 ms during the drag (segment shading follows). Double-click the line resets to −38. |
| **drag the gap gauge ↔** | `minGapSec` is drawn to scale as a red bracket along the bottom of the waveform — **as long as the shortest silence that counts**, on the same time axis as the audio, so you size it *against* the silences it is filtering rather than guessing a number. Its right end is the grip (ew-resize, ±6 px); shift = fine; double-click resets to 0.35. Typed-only before spec delta 1.14. |
| **drag the render-bar seam ↔** | the slim bar under the waveform is the render's real length — the source block, then the **tail** block. Dragging the seam left grows `tailSec` (shift = fine, double-click = 0). `tailSec` had no picture at all before delta 1.14. |
| **click a segment** | auditions it (translucent highlight). |
| **← / →** | slide the bar grid: `offset` ± 0.01 s (**shift = fine**, 0.001 s). |
| **↑ / ↓** | move the silence threshold: `silenceDb` ± 1 dB (shift = 0.1 dB). |
| **⌥← / ⌥→** | nudge the gap gauge: `minGapSec` ± 0.05 s (shift = 0.01 s). |
| **the `offset` / `tail` / `sil` / `gap` fields** | demoted to synced scrubbable readouts: a vertical drag on the field scrubs it (shift = fine), double-click resets it, typing is untouched. `bpm` (override) and `seed` stay plain typed fields — musical **constants**, not quantities with a home on screen. |

## The auto-conform story — PRISM tags bpm → MIX conforms

End to end, no human gesture required (INV-10):

1. **PRISM analyzes** the break/stem and **✎ write tags** stamps the asset:
   `meta.bpm = <rounded bpm>` plus tag `bpm:<v>` (old `bpm:*` tags replaced). In the
   studio this is `Library.updateMeta(hash, {bpm, tags})` — blob untouched, hash pinned —
   and the enriched meta is pushed to the bridge when linked, so the substrate sidecar
   carries the same bpm.
2. **Hosts carry meta bpm into `__buffers` entries** (mix.html resolveBuffers +
   sound-render.mjs both inject `bpm` alongside `channels/sampleRate/durationSec`).
3. **MIX clip `conform: true`** plays the clip at
   `playbackRate = mix.bpm / entry.bpm` — geometry (tile duration × 1/rate) and audio
   both scale. A 172 bpm clip in an 86 bpm mix runs at rate 0.5, twice the wall time.
   Missing bpm on either side ⇒ the clip plays unconformed and the region is flagged
   `{conformSkipped: true}` — silent skip, never fatal.

> ⚠ **Step 1 is the weak link, and steps 2–3 propagate it without complaint.** The
> detected bpm can be half, double, 3/2 or 2/3 of the beat you would tap, and — measured
> — the *most confident* reads in this suite were the wrong ones (0.970/0.987 on
> half-tempo, 1.000 on a beatless drone). `conformSkipped` fires only on a MISSING bpm,
> never on a wrong one, so a bad tag silently resamples the clip by the wrong ratio for
> the whole mix. **Before ✎ write tags, confirm the number** against the bar-grid
> overlay eight bars in, or type the tempo you authored. See "bpm confidence — the
> regime where it can and cannot be trusted" above. INV-10 buys you no gesture; it does
> not buy you a correct tempo.

## Derived assets — what apply writes

Each segment renders through `schedule()` with `segments: [k]` and lands via
`Library.put` with full provenance:

- names: `<src>-part-N` (silence-split) / `<src>-bar-N` (bar-chop), N 1-based
- `studio: "prism"`, `tags: ["derived", "<src>"]`, `configHash` = sha256 of the
  stableStringified MERGED config (spec delta 1.3), `engineVersion`, `by`, `at`
- pushed to the bridge when linked, so they appear in the substrate too

**Separate** (`→ Library ×2` in the studio) writes BOTH components in one gesture:
`<src>-harmonic` and `<src>-percussive`, `tags: ["derived", "hpss", "<src>"]`, each
with the configHash of the merged config carrying the matching action
(`action: "harmonic"` / `action: "percussive"`) — so either asset is reproducible
from its config alone through any host, and staleness/dedupe work as for parts/bars.

## Vibe translation table

| vibe | moves |
|---|---|
| **what tempo is this?** | `action: passthrough` + Analyze — read `bpm.value` and believe it only with confidence > ~0.2 |
| **cut this narration into lines** | `action: silence-split` — corpus defaults (−38 dB, 0.35 s) split speech at breath pauses |
| **looser cuts / keep the breaths** | `silenceDb: -45` (only deeper silence counts) or `minGapSec: 0.6` (only long pauses split) |
| **surgical / split every gap** | `silenceDb: -32, minGapSec: 0.15` — expect many small parts |
| **chop this break to bars** | `action: bar-chop` — then drag the grid (offset) until downbeats sit on the lines |
| **the grid is late/early** | nudge `offset` by ±0.02–0.05 s; the first grid line is the anchor |
| **it detected the half-time feel** | override `bpm` to the double (e.g. detected 86, set 172) before tagging/chopping |
| **make it MIX-ready at our tempo** | Analyze → ✎ write tags → in MIX set the clip `conform: true` ("drop in this break at our tempo") |
| **just the drop** | after analyzing, `segments: [i]` with the bar index you auditioned |
| **take the drums off this loop** | `action: percussive` (or ⌁ Run HPSS → ▶ percussive to audition first) |
| **just the tonal bed / pad under the kit** | `action: harmonic` — sustained partials stay, hits go |
| **smear the chords but keep the hits tight** | ⌁ separate → TAPE the `-harmonic` asset, leave `-percussive` dry → recombine in MIX (workflow below) |
| **is the separation any good here?** | ▶ both (harmonic + percussive summed ≈ source — if *both* sounds wrong, something upstream is) and read the gold/ember energy strip |
| **let me SEE what's in this clip** | ◩ spectral view — horizontal ridges = sustained/tonal, vertical lines = hits; a wash filling everything predicts a muddy HPSS |
| **where does the hiss/rumble live?** | ◩ spectral view: hiss sits as a faint top-band haze, rumble as a bright floor strip near 40 Hz — then TAPE `highpass`/`lowpass` at the frequency you just read off |
| **it's leaving cymbal wash in the harmonic side** | expected — sustained wash IS horizontal energy; median HPSS is sustained-vs-transient, not instrument-aware |

## Perceptual annotations

- **Confidence is honesty:** boombap reports 0.26 (real grid), drift-bed reports 0.48 on
  a tempo that means nothing (slow ambient swells alias into range). Confidence alone
  doesn't separate them — beat-driven material + confidence is the signal. Listen to the
  grid overlay before trusting a tag.
- **Silence-split follows breath, not grammar:** −38 dB / 0.35 s cuts narration at real
  pauses; sentences that run on stay together. That is usually what a sampler wants.
- **Bar-chop keeps partial edge bars** — a pickup before the grid lands as its own short
  segment (often the best one to drop).
- **Raw cuts click on non-zero crossings.** Derived parts keep every sample; if a bar
  clicks when looped in MIX, give the clip a 5 ms `fadeIn`/`fadeOut` there — placement
  fades are MIX's job, not the splitter's.
- **HPSS artifacts sound like watery pre-echo** when the kernel fights the material
  (fast tonal runs, long snare tails). Audition ▶ both first — it reconstructs the
  source, so any wrongness there is upstream, not the separation.

## Worked workflow — separate the boombap, TAPE the harmonic layer, recombine in MIX

The whole point of separating INSIDE the suite: each component is an ordinary library
asset, so every other studio can process one side and MIX can recombine.

1. **PRISM** — source `name:boombap`, ⌁ Run HPSS, audition ▶ harmonic / ▶ percussive,
   then `→ Library ×2`: the library gains `boombap-harmonic` + `boombap-percussive`
   (tagged `derived`, `hpss`, `boombap`).
2. **TAPE** the harmonic layer only — wow/flutter/saturation on the tonal bed:
   `{ "source": { "ref": "name:boombap-harmonic" }, ... }` → `→ Library` as
   `boombap-harmonic-taped`. The percussive side stays DRY — transients keep their edge.
3. **MIX** recombines, dry hits over smeared bed (tag the source's bpm first if you
   want `conform`):

```json
{
  "seed": "hpss-recombine",
  "bpm": 86,
  "bars": 8,
  "tracks": [
    { "id": "bed",  "gain": -2, "clips": [{ "ref": "name:boombap-harmonic-taped", "at": 1, "loop": true }] },
    { "id": "hits", "gain": 0,  "clips": [{ "ref": "name:boombap-percussive", "at": 1, "loop": true }] }
  ]
}
```

Both components carry full provenance, so the whole chain is reproducible from three
configs — and because harmonic + percussive sums to the source, `gain: 0` on both with
no processing would reconstruct the original boombap inside the mix.

## Worked example — chop the boombap, conform it into an 84 bpm mix

1. Chop the 172 bpm (analyzed 86 — half-time, see octave rule) boombap stem to bars:

```json
{ "seed": 47, "source": { "ref": "name:boombap" }, "action": "bar-chop", "bpm": 86 }
```

Apply **▦ chop to bars** in the studio (or render `segments:[k]` per bar via the CLI):
the library gains `boombap-bar-1 … boombap-bar-8` (2.791 s each at 86), tagged
`derived`. Then **✎ write tags** on the source: `meta.bpm: 86`, tag `bpm:86`.

2. Ride a bar under a mix at 84 bpm, conformed (MIX config):

```json
{
  "seed": "conform-demo",
  "bpm": 84,
  "bars": 16,
  "tracks": [
    { "id": "break", "gain": -3,
      "clips": [{ "ref": "name:boombap-bar-2", "at": 1, "to": 17, "loop": true, "conform": true }] }
  ]
}
```

`boombap-bar-2` carries no bpm of its own yet — tag it too (or ref the tagged source) —
then conform plays it at rate `84/86 ≈ 0.977`, each loop tile stretching to exactly one
84 bpm bar's feel. A 172-tagged clip in this mix would run at rate `84/172 ≈ 0.488` —
half-speed, doubled duration, the classic "drop in this break at our tempo" move.

Encode a config (wraps in the envelope, prints the `#sfa=` link):

```
python3 "$CLAUDE_PLUGIN_ROOT/scripts/encode.py" /path/to/prism-cfg.json --studio prism --live
```

Remember: the URL alone carries the *lens settings*; the audio travels via the shared
library (same origin) or a bundle (RT-5). Derived assets are ordinary assets — MIX,
CHOP, and TAPE reference them by `name:`/`tag:derived` like anything else.
