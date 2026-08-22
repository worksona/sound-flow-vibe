# Sound Flow — Claude Code plugin marketplace

Vibe music with words. Describe a sound; get a link that opens a studio with it already
loaded and playing.

**Studios:** https://sound-flow.netlify.app · **Docs:** https://sound-flow.netlify.app/docs/

```
/plugin marketplace add worksona/sound-flow-vibe
/plugin install sound-flow-vibe@sound-flow
```

Then just ask:

> *"lazy boom bap at 88, hats barely holding on, warm low end, and a turnaround every fourth bar"*
> *"six minutes of glassy ambient that never repeats and loops clean"*
> *"age this like it came off a worn cassette, with a bit of vinyl dust on top"*
> *"sit the bed under the voice, and bring the beat in on bar five"*

## The ten studios

| studio | what it's for |
|---|---|
| **PULSE** | step sequencer — patterns, song mode, swing, ratchets, per-lane mute/solo |
| **CIRCUIT** | synth & phrase — FM/subtractive patches, arps; a patch fits in a URL |
| **DRIFT** | generative ambient — chord journeys, density rules, loop-safe beds |
| **CHOP** | sampler & slicer — transient slicing, 16 keyboard-mapped pads, performance capture |
| **LOOM** | loop station — layered takes, quantized mic recording, per-slot sends |
| **VOX** | narration — script table, per-line TTS or your own voice |
| **PRISM** | analysis — bpm, onsets, silence splits, harmonic/percussive separation |
| **TAPE** | texture — wobble, crush, filter sweeps, granular stretch, vinyl |
| **MIX** | the hub — arrange stems, duck/ride/swell/tail intents, automation, master |
| **STOMP** | pedalboard — a vocoder built from plain WebAudio nodes, plus pitch, ring mod and 25 stompbox presets in three banks. Pedals **compound**: stack several, bypass any one, or run the whole board live on your microphone |

## How it works

Every studio's state is a **config** — plain JSON. The skill reads that studio's schema
(field ranges, voices, and a vibe-translation table mapping mood words to parameters),
authors a minimal seeded config, and encodes it into an `#sfa=` share URL. Open the link
and the studio loads the sound.

Configs are **seeded and deterministic**: the same config renders the same audio, so a URL
*is* the piece. Generative studios (PULSE, CIRCUIT, DRIFT) travel completely in a link —
no audio moves. Sample-based studios (CHOP, LOOM, VOX, PRISM, TAPE, MIX, STOMP) carry *clip refs*
instead, so the link carries the arrangement while the audio lives in your browser library.

## What's in the box

- `sound-flow-vibe/skills/sound-flow-vibe/` — the skill, plus one reference schema per
  studio and `composing.md` for building whole tracks across several.
- `sound-flow-vibe/scripts/encode.py` — the `#sfa=` codec, dependency-free. Encode a
  config, or decode any share link back to JSON to remix it.

Self-contained for authoring and sharing. Rendering audio headlessly, keeping a substrate
of stems, and running the orchestrator need the Sound Flow app repo (private) — those
commands are marked *(app repo)* in the skill.

## Honest limits

STOMP's microphone is a *studio* mode, never a config value — `input.ref` always names a
clip. So every pedalboard renders headlessly against its clip and a share link always opens
with audio; what the skill cannot do is be the microphone. Author and verify on a clip, then
play it live yourself.

The skill can't hear. It verifies by analysis — durations, peak and RMS levels, onset
counts, detected tempo — so it can tell you a mix isn't clipping and the beat landed where
the math says. Whether it *grooves* is your call.

---

Built by [Worksona](https://github.com/worksona) · MIT
