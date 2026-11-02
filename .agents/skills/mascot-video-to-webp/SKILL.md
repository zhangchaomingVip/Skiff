---
name: mascot-video-to-webp
description: Convert white-background anime/chibi mascot MP4 videos into transparent, seamless-looping Animated WebP assets (`public/companion/idle.webp`, `tap.webp`, `working.webp`) for Skiff's VoyageRail Companion Deck. Use when the user provides a new mascot video in `design/videos/` or asks to cut out, matte, or convert companion animations.
---

# Mascot Video to Transparent Animated WebP

## Purpose

Convert Image-to-Video (I2V) `.mp4` clips of the Skiff navigator mascot ("小蓝鲸女仆") into transparent, Retina-ready (`360×360`, `12fps`) Animated WebP loops with zero white halos on both dark (`star-blue` `#1c2b45`) and light (`#fafaf9`) backgrounds.

## Target Output Paths

`src/components/VoyageRail.tsx` loads companion poses from `public/companion/`:
- `public/companion/idle.webp` — Default breathing/blinking standby loop
- `public/companion/tap.webp` — Click interaction (happy hop/wave) loop
- `public/companion/working.webp` — Streaming/thinking loop
- `public/companion/idle.png` — Static first-frame fallback for `prefers-reduced-motion: reduce`

## How the Hybrid Matting Pipeline Works

Pure neural matting (`isnet-anime`) punches out hair holes and floor shadows well, but can accidentally make bright white anime highlights (such as the right whale-tail fin highlight or white lace) semi-transparent, or leave a white pocket between the skirt and whale tail. Pure corner flood-fill protects closed line-art 100%, but misses enclosed background loops.

The bundled script `scripts/process_mascot_video.py` combines both:
1. **Closed Line-Art Interior Protection (Corner Flood-Fill)**: Flood-fills from all 4 image corners (`dist_white < 42`, or `< 86` below `y=608` floor level). Every pixel inside the dark anime outline (headband lace, apron, socks, whale ear inner white, whale tail white highlight) is strictly protected.
2. **Enclosed Hole Punching (`isnet-anime` + Connected Components)**: Removes enclosed background pockets inside hair loops, between the legs/shoes, the floor shadow, and the enclosed white triangle between the skirt and the whale tail (`x ∈ [470, 585]`, `y ∈ [508, 570]`).
3. **Edge Color Decontamination (Unmultiply White)**: Un-blends `#FFFFFF` from the outer `1.5–2px` anti-aliased contour (`C_true = (C_obs - (1 - α) * 255) / α`) so dark backgrounds (`#1c2b45`) show zero white fringe.
4. **Seamless Loop & Retina Downsample**: Drops the final frame (`N-1`, which duplicates Frame `0` in start/end-frame-locked I2V clips), subsamples `24fps → 12fps` (`--step 2`, `83ms`/frame), and resizes with `LANCZOS` to `360×360` (`quality=80`, `method=6`).

## Workflow

1. Locate the input `.mp4` file (typically in `design/videos/`) and determine which target state (`idle`, `tap`, or `working`) it corresponds to.
2. Run the bundled processor script via `uv run` (using `https://pypi.org/simple` if the local mirror returns 403):

```bash
uv run --default-index https://pypi.org/simple \
  --with rembg --with onnxruntime --with pillow --with numpy --with scipy --with opencv-python-headless \
  python .agents/skills/mascot-video-to-webp/scripts/process_mascot_video.py \
  --input "design/videos/<video-name>.mp4" \
  --output "public/companion/<pose>.webp" \
  --preview "dist/preview_<pose>.png"
```

> If `<pose>` is `idle`, also pass `--still "public/companion/idle.png"` to update the static reduced-motion fallback.

3. Inspect `dist/preview_<pose>.png` with the `read` tool to verify that:
   - Neither the white headband, apron, socks, nor whale-tail white highlight is clipped on the left dark (`#1c2b45`) panel.
   - The gap between the skirt and tail, hair loops, and shoe shadow are cleanly transparent.
4. Report the output path and file size to the user.
