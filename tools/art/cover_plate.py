"""Build the pack front's PRINT PLATE from the supplied cover reference
(tools/art/ref/pack-cover-reference.webp — a studio render of the gold pouch).

    python tools/art/cover_plate.py   →  tools/art/ref/cover-plate.webp

The render's pouch is unwarped into the art box (PACK_W × PACK_H): each row's
own left/right edge — the pillowed sides pull in at the middle — is stretched to
the full width, from the top crimp's tips to the bottom crimp's scallops, so no
studio black survives at the edges. The render's bitmap logo is then inpainted
away: packart.js draws the vector lockup back in its place (crisp, and with an
exact mask for the print's own finish). Prints the logo box in art pixels for
packart.js's COVER_LOGO. Needs OpenCV + NumPy.
"""
import os
import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "ref", "pack-cover-reference.webp")
OUT = os.path.join(HERE, "ref", "cover-plate.webp")
W, H = 1083, 1794           # packart.js PACK_W × PACK_H
TOP, BOT = 47, 1444         # the crimp tips and the bottom scallops, in the render
INSET = 3                   # px kept clear of each side edge's anti-aliasing

img = cv2.imread(SRC, cv2.IMREAD_COLOR)
lum = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

# the pouch's silhouette, row by row: the outermost foil pixels, smoothed over a
# few rows so a wrinkle or a crimp tooth doesn't kink the edge
foil = lum > 34
rows = np.arange(TOP, BOT + 1)
L = np.array([np.argmax(foil[y]) for y in rows], np.float32)
R = np.array([foil.shape[1] - 1 - np.argmax(foil[y][::-1]) for y in rows], np.float32)
k = 15
pad = lambda a: np.pad(a, (k, k), mode="edge")
med = lambda a: np.array([np.median(pad(a)[i:i + 2 * k + 1]) for i in range(len(a))], np.float32)
L, R = med(L) + INSET, med(R) - INSET

# unwarp: output (u, v) ← render (L(y) + u·(R(y) − L(y)), y)
v = np.linspace(0, 1, H, dtype=np.float32)
ys = TOP + v * (BOT - TOP)
Ly = np.interp(ys, rows, L).astype(np.float32)
Ry = np.interp(ys, rows, R).astype(np.float32)
u = np.linspace(0, 1, W, dtype=np.float32)
map_x = (Ly[:, None] + u[None, :] * (Ry - Ly)[:, None]).astype(np.float32)
map_y = np.repeat(ys[:, None], W, axis=1).astype(np.float32)
plate = cv2.remap(img, map_x, map_y, cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REPLICATE)

# the bitmap logo: near-black, neutral ink in the middle band of the cover
pl = cv2.cvtColor(plate, cv2.COLOR_BGR2GRAY).astype(np.int32)
b, g, r = (plate[..., i].astype(np.int32) for i in range(3))
ink = (pl < 70) & ((r - b) < 45)
band = np.zeros_like(ink); band[int(H * 0.40):int(H * 0.60), int(W * 0.12):int(W * 0.92)] = True
ink &= band
n, lab, stats, _ = cv2.connectedComponentsWithStats(ink.astype(np.uint8), 8)
keep = np.zeros_like(ink)
for i in range(1, n):
    if stats[i, cv2.CC_STAT_AREA] > 40: keep |= lab == i
ys_, xs_ = np.where(keep)
x0, y0, x1, y1 = xs_.min(), ys_.min(), xs_.max() + 1, ys_.max() + 1
hole = cv2.dilate(keep.astype(np.uint8) * 255, np.ones((9, 9), np.uint8))
plate = cv2.inpaint(plate, hole, 7, cv2.INPAINT_TELEA)

cv2.imwrite(OUT, plate, [cv2.IMWRITE_WEBP_QUALITY, 94])
print(f"plate {W}x{H} -> {os.path.relpath(OUT)} ({os.path.getsize(OUT) // 1024} KB)")
print(f"COVER_LOGO = {{ x: {x0}, y: {y0}, w: {x1 - x0}, h: {y1 - y0} }}  (aspect {(x1 - x0) / (y1 - y0):.3f})")
