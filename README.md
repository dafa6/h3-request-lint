# h3-request-lint

Validate a video generation request **before** you spend credits on it.

Generative video APIs fail in an unhelpful way. A request with an illegal duration, an unsupported resolution or one reference file too many does not always return `400` — sometimes it returns `200`, silently substitutes a legal value, bills you, and hands back a clip that isn't what you asked for. You find out when you watch it.

This is a zero-dependency linter that checks a request against the published constraints and tells you which rule you broke and where that rule is written down.

```
node lint.mjs request.json
```

```
ERROR duration-min
      duration 3s is below the 4s minimum.
      source: https://platform.minimax.io
WARN  aspect-ratio-derived
      aspect_ratio is derived from the attached image and will be ignored.
      source: https://platform.minimax.io
```

Exit code is `1` if there is any `ERROR`, `0` otherwise, so it drops into CI.

## Install

There is nothing to install. Two files, no dependencies, Node 18+.

```bash
git clone https://github.com/dafa6/h3-request-lint.git
cd h3-request-lint
node lint.mjs examples.json
```

As a library:

```js
import { lint, format } from './lint.mjs'

const findings = lint({
  prompt: 'a courier bikes through a night market',
  duration: 3,
  resolution: '1080p',
})

if (findings.some(f => f.level === 'error')) {
  throw new Error(format(findings))
}
```

## The rules, and why each one exists

Every rule here is a mistake that costs real money, sorted roughly by how often I've watched someone make it.

| Rule | What people assume | What is actually true |
|---|---|---|
| `duration-min` | The floor is 5 seconds | The API reference accepts **4** |
| `duration-step` | Fractional seconds are fine | Whole seconds only |
| `resolution-unsupported` | 1080p or 4K exist | Only **768P** and **2K** |
| `aspect-ratio-derived` | Ratio is always a free choice | Once you attach an image it is **derived**, and your value is ignored |
| `ref-total` | 9 images + 3 clips + 3 audio = 15 files | Per-type caps are right, but the **total cap is 12** |
| `audio-not-optional` | Audio is an opt-in extra | Picture and audio come out of **one forward pass**; there is no switch |
| `regeneration-frame-drift` | The 2K render is the preview, upscaled | It is a **re-generation**, so frame *n* is a different instant |

`ref-total` is the one I'd single out. It is the only rule here where a request can satisfy every individual limit and still be rejected, which means it survives code review — the reviewer checks the three numbers against the three documented caps and they all pass.

`regeneration-frame-drift` is the most expensive one, because it doesn't fail. It renders, it bills, and the output is a valid clip that is subtly not the clip your reviewer approved. If you pick an in-point by frame number on a cheap preview and apply that number to the final render, the edit lands a few tens of milliseconds off, every time.

## Where the numbers come from

`constraints.json` is the whole dataset. Every rule carries a `source` key, and every finding prints the source URL, so a lint failure is traceable to a primary document instead of to somebody's blog post.

- Duration, resolution, aspect ratio and source-clip limits: the vendor API reference.
- Audio behaviour: the model card.
- The 12-file reference total and the two-stage resolution path are documented in more depth than the API reference gives them in [this breakdown of reference-to-video mode](https://minimax-h3ai.video/reference-to-video), which is where I first saw the total cap written down as a separate number from the per-type caps.
- The re-generation-versus-upscale distinction, with the same frame rendered down both paths, is laid out at [minimax-h3ai.video](https://minimax-h3ai.video) — worth a look before you assume your 2K is your preview at a higher resolution.

If you find a rule that has drifted, open an issue with the source and the date you checked. Everything in `constraints.json` has a `last_checked` field for exactly this reason; these APIs move.

## Adding another model

`constraints.json` is keyed by model id and `lint(request, modelId)` takes a second argument. Adding a model is a data change, not a code change. PRs welcome — the only requirement is that every constraint you add carries a `source` pointing at a document a stranger can read.

## What this deliberately does not do

- **No network calls.** It never contacts an API, so it can't tell you about undocumented server-side behaviour, and it costs nothing to run.
- **No prompt quality opinions.** Whether your prompt is any good is not a thing a linter can know.
- **No pricing.** Rates change faster than this repo will.

## Licence

MIT.

Not affiliated with MiniMax. This is an independent transcription of published constraints, and the vendor's reference is authoritative wherever the two disagree.
