"""Convert a black-background entrance clip into an alpha animated WebP
(soft black key + top fade + feathered edges) and an AAC audio track.
Usage: python make_alpha_entrance.py in.mp4 out_basename [crop_top_frac]
"""
import subprocess
import sys

import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

FF = imageio_ffmpeg.get_ffmpeg_exe()
src, out = sys.argv[1], sys.argv[2]
crop_top = float(sys.argv[3]) if len(sys.argv) > 3 else 0.25
top_fade = float(sys.argv[4]) if len(sys.argv) > 4 else 0.40
W, FPS = 432, 15

# Decode frames as raw RGB at target width.
h_full = int(1920 * W / 1080)
y0 = int(h_full * crop_top) // 2 * 2
H = h_full - y0
proc = subprocess.run(
    [FF, "-loglevel", "error", "-i", src, "-vf", f"fps={FPS},scale={W}:{h_full}:flags=lanczos,crop={W}:{H}:0:{y0}",
     "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    capture_output=True, check=True,
)
frames = np.frombuffer(proc.stdout, np.uint8).reshape(-1, H, W, 3)

# Static masks: top 40% fades in from 0, sides/bottom lightly feathered.
yy = np.linspace(0, 1, H)[:, None]
xx = np.linspace(0, 1, W)[None, :]
top = np.clip(yy / top_fade, 0, 1) ** 1.6
# The animal's solid body only gets a very short fade so it is never visibly faded.
body_edge = np.clip(yy / 0.035, 0, 1) * np.clip(np.minimum(xx, 1 - xx) / 0.02, 0, 1)
side = np.clip(np.minimum(xx, 1 - xx) / 0.06, 0, 1)
bottom = np.clip((1 - yy) / 0.03, 0, 1)
edge = top * side * bottom

imgs = []
for f in frames:
    rgb = f.astype(np.float32)
    mx = rgb.max(axis=2)
    # Soft key: pure black → transparent, dark fur (≥ ~45) stays opaque.
    # Adaptive black level: the clip's 'black' can lift (mist / grading), so key
    # against this frame's own border background instead of a fixed value.
    border = np.concatenate([mx[: H // 25].ravel(), mx[:, : W // 25].ravel(), mx[:, -W // 25:].ravel()])
    thr = max(11.0, float(np.percentile(border, 70)) + 7.0)
    a = np.clip((mx - thr) / 12.0, 0, 1)
    a = a * a * (3 - 2 * a)  # smoothstep
    # Fill enclosed holes (dark fur inside the silhouette) so the body stays solid.
    m = Image.fromarray(((mx > thr + 4) * 255).astype(np.uint8)).resize((W // 3, H // 3), Image.BILINEAR)
    m = m.point(lambda v: 255 if v > 100 else 0)
    pad = Image.new("L", (m.width + 2, m.height + 2), 0)
    pad.paste(m, (1, 1))
    ImageDraw.floodfill(pad, (0, 0), 128)
    inner = np.array(pad.crop((1, 1, m.width + 1, m.height + 1)).filter(ImageFilter.MinFilter(3)))
    solid = inner == 0  # enclosed holes only (dark fur inside the silhouette)
    solid = np.array(Image.fromarray((solid * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR)
                     .filter(ImageFilter.GaussianBlur(2))) / 255.0
    a = np.maximum(a * edge, solid * body_edge)
    # Remove the black fringe on semi-transparent pixels (un-premultiply toward colour).
    boost = np.where(a > 0.02, np.minimum(1 / np.maximum(a, 0.02), 3.0), 1.0)[..., None]
    col = np.clip(rgb * np.where(mx[..., None] < 21, boost, 1.0), 0, 255)
    rgba = np.dstack([col, a * 255]).astype(np.uint8)
    imgs.append(Image.fromarray(rgba, "RGBA"))

imgs[0].save(f"{out}.webp", save_all=True, append_images=imgs[1:], duration=int(1000 / FPS),
             loop=0, quality=60, method=6, lossless=False, alpha_quality=80)
imgs[len(imgs) // 3].save(f"{out}_frame.png")
subprocess.run([FF, "-loglevel", "error", "-y", "-i", src, "-vn", "-c:a", "aac", "-b:a", "128k", f"{out}.m4a"], check=True)
# Compressed preview video (with sound) for the VIP Center / My Bag preview.
subprocess.run([FF, "-loglevel", "error", "-y", "-i", src, "-vf", "scale=540:-2", "-c:v", "libx264", "-crf", "28",
                "-preset", "slow", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
                f"{out}_preview.mp4"], check=True)
print("frames", len(imgs), "size", W, H)
