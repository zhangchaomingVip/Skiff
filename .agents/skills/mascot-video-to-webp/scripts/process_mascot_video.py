#!/usr/bin/env python3
"""
Convert an anime/chibi mascot MP4 video on a white background into a transparent,
seamless-looping Animated WebP (and optional static PNG fallback) for Skiff's
VoyageRail Companion Deck.

Pipeline highlights:
1. Hybrid matting (`isnet-anime` + exterior flood-fill line-art protection):
   - Protects interior white elements enclosed by dark line-art (white lace headband,
     apron, socks, eyes, whale-ear inner white, whale-tail white highlights).
   - Punches out enclosed background holes (skirt-to-tail gap, hair loops, between legs,
     and floor shadow).
2. Edge color decontamination (Unmultiply White):
   - Removes white halos on the 1.5-2px anti-aliased outer contour so the character
     blends cleanly onto both dark (`star-blue` #1c2b45) and light (#fafaf9) themes.
3. Seamless loop & Retina sizing:
   - Drops the duplicate last frame when first/last frames are locked, subsamples
     24fps -> 12fps (duration=83ms), and resizes with LANCZOS to 360x360.
"""

from __future__ import annotations

import argparse
import os
import time
import cv2
import numpy as np
from PIL import Image
from rembg import new_session, remove
from scipy import ndimage


def process_frame(bgr: np.ndarray, session, size: int = 360) -> Image.Image:
	rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
	rgb_f = rgb.astype(np.float32)

	# 1. Neural anime matting pass
	out = np.array(remove(Image.fromarray(rgb), session=session))
	alpha = out[:, :, 3].astype(np.float32) / 255.0
	dist_w = np.linalg.norm(255.0 - rgb_f, axis=2)

	# 2. Exterior flood-fill from all 4 corners to strictly respect closed anime line-art
	h, w = dist_w.shape
	yy, _ = np.mgrid[0:h, 0:w]
	floor_y = int(h * 0.844)  # ~608 on 720p
	ext_seed = dist_w < np.where(yy >= floor_y, 86.0, 42.0)
	lbl_ext, _ = ndimage.label(ext_seed)
	is_exterior = (
		(lbl_ext == lbl_ext[0, 0])
		| (lbl_ext == lbl_ext[0, -1])
		| (lbl_ext == lbl_ext[-1, 0])
		| (lbl_ext == lbl_ext[-1, -1])
	)

	# 3. Punch out enclosed white background holes (skirt-tail gap, hair loops, leg gap)
	#    while protecting interior white clothing/highlights
	hole_mask = np.zeros((h, w), dtype=bool)
	white_mask = (~is_exterior) & (dist_w < 38.0)
	labeled, num = ndimage.label(white_mask)
	sx, sy = w / 720.0, h / 720.0
	for cid in range(1, num + 1):
		m = labeled == cid
		area = m.sum()
		if area < int(15 * sx * sy):
			continue
		ys, xs = np.where(m)
		xm, ym = xs.mean() / sx, ys.mean() / sy
		norm_area = area / (sx * sy)

		is_skirt_tail_gap = (470 < xm < 585) and (508 < ym < 570) and (norm_area > 400)
		is_hair_hole = (
			((500 < xm < 590) and (160 < ym < 495))
			or ((xm < 175) and (200 < ym < 495))
		) and (alpha[m].mean() < 0.75)
		is_leg_gap = (ym > 605) and (312 < xm < 360)

		if is_skirt_tail_gap or is_hair_hole or is_leg_gap:
			hole_mask |= ndimage.binary_dilation(m, iterations=2) & (dist_w < 78.0)

	floor_bg = (yy >= floor_y) & (alpha < 0.55) & (dist_w < 95.0)
	bg_total = is_exterior | hole_mask | floor_bg

	# 4. Anti-aliased rim alpha + white halo decontamination (Unmultiply White)
	fg_solid = ~bg_total
	dist_to_bg = ndimage.distance_transform_edt(fg_solid)
	final_alpha = fg_solid.astype(np.float32)
	rim = fg_solid & (dist_to_bg <= 2.2)
	rim_alpha = np.clip((dist_w - 14.0) / 85.0, 0.0, 1.0)
	final_alpha = np.where(
		rim & (dist_w < 78.0), np.minimum(final_alpha, rim_alpha), final_alpha
	)
	alpha_blur = cv2.GaussianBlur(final_alpha, (3, 3), 0.55)
	final_alpha = np.where((dist_to_bg <= 1.5) & (dist_w < 78.0), alpha_blur, final_alpha)

	a_exp = np.clip(final_alpha[:, :, None], 1e-3, 1.0)
	fg_clean = np.where(
		(final_alpha[:, :, None] > 0.01) & (final_alpha[:, :, None] < 0.97),
		np.clip((rgb_f - (1.0 - a_exp) * 255.0) / a_exp, 0.0, 255.0),
		rgb_f,
	)

	rgba = np.dstack([fg_clean.astype(np.uint8), (final_alpha * 255.0).astype(np.uint8)])
	return Image.fromarray(rgba).resize((size, size), Image.Resampling.LANCZOS)


def save_preview(img: Image.Image, preview_path: str) -> None:
	rgba = np.array(img)
	a = rgba[:, :, 3:4].astype(np.float32) / 255.0
	fg = rgba[:, :, :3].astype(np.float32)
	dark_bg = np.array([[[0x1C, 0x2B, 0x45]]], dtype=np.float32)  # star-blue
	light_bg = np.array([[[0xFA, 0xFA, 0xF9]]], dtype=np.float32)  # light paper
	comp_dark = (fg * a + dark_bg * (1.0 - a)).astype(np.uint8)
	comp_light = (fg * a + light_bg * (1.0 - a)).astype(np.uint8)
	os.makedirs(os.path.dirname(preview_path) or ".", exist_ok=True)
	Image.fromarray(np.hstack([comp_dark, comp_light])).save(preview_path)


def main() -> None:
	parser = argparse.ArgumentParser(description="Convert mascot MP4 to transparent Animated WebP")
	parser.add_argument("--input", "-i", required=True, help="Input MP4 path")
	parser.add_argument("--output", "-o", required=True, help="Output WebP path (e.g. public/companion/tap.webp)")
	parser.add_argument("--still", help="Optional static PNG output path (e.g. public/companion/idle.png)")
	parser.add_argument("--preview", help="Optional side-by-side dark/light preview PNG path")
	parser.add_argument("--size", type=int, default=360, help="Output square pixel size (default: 360)")
	parser.add_argument("--step", type=int, default=2, help="Frame subsample step (default: 2 for 24fps->12fps)")
	parser.add_argument("--quality", type=int, default=80, help="WebP quality 1-100 (default: 80)")
	args = parser.parse_args()

	t0 = time.time()
	cap = cv2.VideoCapture(args.input)
	if not cap.isOpened():
		raise SystemExit(f"Failed to open input video: {args.input}")

	src_fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
	raw_frames = []
	while True:
		ok, frame = cap.read()
		if not ok:
			break
		raw_frames.append(frame)
	cap.release()

	if not raw_frames:
		raise SystemExit("No frames decoded from video.")

	# Drop duplicate final frame when first & last frames are locked for seamless looping
	end_idx = len(raw_frames) - 1 if len(raw_frames) > 1 else 1
	indices = list(range(0, end_idx, args.step))
	frame_duration_ms = round(1000.0 / (src_fps / args.step))

	print(f"Decoded {len(raw_frames)} frames @ {src_fps:.1f}fps -> sampling {len(indices)} frames ({frame_duration_ms}ms/frame)")
	session = new_session("isnet-anime")

	pil_frames: list[Image.Image] = []
	for idx in indices:
		pil_frames.append(process_frame(raw_frames[idx], session, size=args.size))
		if len(pil_frames) % 15 == 0 or len(pil_frames) == len(indices):
			print(f"  Processed {len(pil_frames)}/{len(indices)} frames ({time.time() - t0:.1f}s)")

	os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
	pil_frames[0].save(
		args.output,
		save_all=True,
		append_images=pil_frames[1:],
		duration=frame_duration_ms,
		loop=0,
		quality=args.quality,
		method=6,
		minimize_size=True,
	)
	out_kb = os.path.getsize(args.output) / 1024.0
	print(f"Saved animated WebP: {args.output} ({out_kb:.1f} KB)")

	if args.still:
		os.makedirs(os.path.dirname(args.still) or ".", exist_ok=True)
		pil_frames[0].save(args.still, optimize=True)
		still_kb = os.path.getsize(args.still) / 1024.0
		print(f"Saved static PNG:    {args.still} ({still_kb:.1f} KB)")

	if args.preview:
		save_preview(pil_frames[0], args.preview)
		print(f"Saved QA preview:    {args.preview}")


if __name__ == "__main__":
	main()
