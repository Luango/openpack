"""cutout.py — turn each fetched photo into a card portrait (assets/players/<id>.webp).

    pip install "rembg[cpu]" "opencv-python-headless<5"   # 5.x dropped the Haar cascades
    python tools/players/cutout.py <cache-dir> [id ...]

Per player: matte the people in the photo (rembg / IS-Net), find the face
(OpenCV Haar cascades — the biggest face that sits ON a matted person, so a
crest, a flag or a crowd face can't win), frame a square head-and-shoulders
crop around it (head near the top, down to mid-chest), keep only the
silhouette in the column under that face (drops team-mates, referees, the
crowd), feather any edge where the crop runs past the photo, and save a 600px
RGBA WebP. Also writes src/photos.js — the per-photo credit line every CC
licence asks for — and <cache-dir>/sheet-*.jpg contact sheets to eyeball.
"""

import json
import os
import re
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw
from rembg import new_session, remove

sys.path.insert(0, os.path.dirname(__file__))
from roster import ROSTER, CROP  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "assets", "players")
SIZE = 600
SPAN = 3.3        # crop side, in face widths
HEADROOM = 0.10   # gap above the hair, as a share of the crop
FEATHER = 0.07    # fade where the crop overruns the photo, as a share of the crop

CASCADES = [cv2.CascadeClassifier(cv2.data.haarcascades + n) for n in (
    "haarcascade_frontalface_default.xml", "haarcascade_frontalface_alt2.xml", "haarcascade_profileface.xml")]


def person_matte(img, session, max_side=1024):
    """a full-frame people matte (0–255), computed small and scaled back up"""
    s = min(1.0, max_side / max(img.size))
    small = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS) if s < 1 else img
    m = remove(small, session=session, only_mask=True, post_process_mask=False)
    return np.array(m.resize(img.size, Image.BILINEAR))


def find_face(rgb, matte, head):
    """→ (x, y, w, h) of the biggest face on the matted figure's head, or None.
    `head` is face_from_matte's guess: a detection must sit on the matte AND no
    lower than the figure's head + neck — so a crest, a number or a shirt fold
    the cascade mistakes for a face can't win over the real head."""
    gray = cv2.equalizeHist(cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY))
    H, W = gray.shape
    cands = []
    for k, cas in enumerate(CASCADES):
        for flip in ((False, True) if k == 2 else (False,)):
            g = cv2.flip(gray, 1) if flip else gray
            for (x, y, w, h) in cas.detectMultiScale(g, scaleFactor=1.08, minNeighbors=6, minSize=(W // 16, W // 16)):
                if flip:
                    x = W - x - w
                cx, cy = x + w // 2, y + h // 2
                if matte[cy, cx] <= 110:
                    continue
                if head and (cy > head[1] + 2.2 * head[3] or w < 0.3 * head[2]):
                    continue
                # big faces high in the frame win
                cands.append((w * (1.25 - 0.5 * (y / H)), (x, y, w, h)))
    cands.sort(reverse=True)
    return cands[0][1] if cands else None


def face_from_matte(matte):
    """no detectable face (a profile, a turned head): take the top of the biggest
    matted figure as the head"""
    hard = (matte > 110).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(hard)
    if n < 2:
        return None
    k = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    ys, xs = np.where(lab == k)
    top, height = ys.min(), ys.max() - ys.min()
    band = (ys < top + height * 0.12)
    cx = int(xs[band].mean())
    w = int(max(20, (xs[band].max() - xs[band].min()) * 0.8))
    return (cx - w // 2, int(top + w * 0.25), w, w)


def crop_box(face, pid, img_h):
    x, y, w, h = face
    c = CROP.get(pid, {})
    side = SPAN * w / c.get("zoom", 1.0)
    # a photo already cropped tight under the chin would leave the player floating
    # small in an empty square — frame closer, so the photo's bottom edge lands
    # near the crop's (the edge feather hides the cut), but never tighter than
    # the head and collar
    fit = (img_h - y + 0.42 * w) / (1 - HEADROOM) * 1.04
    side = max(min(side, fit), 2.3 * w)
    cx = x + w / 2 + c.get("dx", 0) * w
    top = y - 0.42 * w - HEADROOM * side + c.get("dy", 0) * w  # the box top sits ~at the brow; hair above
    return int(cx - side / 2), int(top), int(cx + side / 2), int(top + side)


def padded_crop(img, box):
    """crop that may run past the photo edge (filled transparent)"""
    x0, y0, x1, y1 = box
    out = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
    src = img.crop((max(0, x0), max(0, y0), min(img.width, x1), min(img.height, y1)))
    out.paste(src, (max(0, -x0), max(0, -y0)))
    return out


def keep_subject(alpha, face):
    """keep the matte blobs that reach into the column under the face (the
    player's own head, neck and shoulders) and drop the rest (other people)"""
    x, y, w, h = face
    hard = (alpha > 90).astype(np.uint8)
    n, lab = cv2.connectedComponents(hard)
    if n <= 2:
        return alpha
    H, W = alpha.shape
    col = lab[max(0, y):H, max(0, x):min(W, x + w)]
    keep = np.setdiff1d(np.unique(col), [0])
    if not len(keep):
        return alpha
    gate = cv2.dilate(np.isin(lab, keep).astype(np.uint8), np.ones((9, 9), np.uint8))
    gate = cv2.GaussianBlur(gate.astype(np.float32), (9, 9), 0)
    return (alpha * gate).astype(np.uint8)


def process(pid, cache, session):
    raw = Image.open(os.path.join(cache, "raw", pid + ".jpg")).convert("RGB")
    rgb = np.array(raw)
    matte_full = person_matte(raw, session)
    head = face_from_matte(matte_full)
    face = find_face(rgb, matte_full, head) or head
    if face is None:
        print(f"!! {pid}: no face or figure found — check the photo")
        W, H = raw.size
        face = (int(W * 0.4), int(H * 0.12), int(W * 0.2), int(W * 0.2))
    box = crop_box(face, pid, raw.height)
    # matte a margin wider than the crop, so shoulders cut by the crop edge stay whole
    pad = (box[2] - box[0]) // 6
    big = (box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad)
    region = padded_crop(raw.convert("RGBA"), big)
    inside = (np.array(region)[..., 3] > 0).astype(np.uint8)
    matte = np.array(remove(region.convert("RGB"), session=session, only_mask=True, post_process_mask=False))
    matte = np.where(inside > 0, matte, 0).astype(np.uint8)
    fx, fy, fw, fh = face
    matte = keep_subject(matte, (fx - big[0], fy - big[1], fw, fh))
    if not inside.all():
        # the crop overruns the photo: fade out toward that edge instead of a hard cut
        ramp = FEATHER * (box[2] - box[0])
        dist = cv2.distanceTransform(inside, cv2.DIST_L2, 5)
        matte = (matte * np.clip(dist / ramp, 0, 1)).astype(np.uint8)
    region.putalpha(Image.fromarray(matte))
    cut = region.crop((pad, pad, pad + box[2] - box[0], pad + box[3] - box[1]))
    cut = cut.resize((SIZE, SIZE), Image.LANCZOS)
    cut.save(os.path.join(OUT, pid + ".webp"), "WEBP", quality=84, method=6)
    return cut


def sheet(cache, ids, name):
    cols, cell = 8, 200
    rows = (len(ids) + cols - 1) // cols
    bg = Image.new("RGB", (cols * cell, rows * (cell + 18)), (40, 30, 10))
    d = ImageDraw.Draw(bg)
    for i, pid in enumerate(ids):
        x, y = (i % cols) * cell, (i // cols) * (cell + 18)
        tile = Image.new("RGB", (cell, cell), (214, 172, 82))
        tile.paste(Image.new("RGB", (cell, cell // 2), (238, 206, 122)), (0, 0))
        im = Image.open(os.path.join(OUT, pid + ".webp")).resize((cell, cell))
        tile.paste(im, (0, 0), im)
        bg.paste(tile, (x, y))
        d.text((x + 4, y + cell + 3), f"{pid} {ROSTER[pid][:22]}", fill=(255, 255, 255))
    bg.save(os.path.join(cache, name), quality=88)


def clean_author(a):
    a = re.sub(r"\s*Author:\s*$", "", (a or "").strip())  # a dangling empty "Author:" field
    half = len(a) // 2
    if len(a) % 2 == 0 and a[:half] == a[half:]:  # Commons sometimes doubles "Unknown author"
        a = a[:half]
    return a or "Unknown author"


def credits(cache):
    meta = json.load(open(os.path.join(cache, "meta.json"), encoding="utf-8"))
    lines = [
        "// photos.js — GENERATED by tools/players/cutout.py; don't edit by hand.",
        "//",
        "// Every player portrait (assets/players/<id>.webp) is cut from a freely licensed",
        "// Wikimedia Commons photo — cropped, background removed. The licences require",
        "// crediting the author and licence, which the reveal shows under each card.",
        "",
        "export const PHOTOS = {",
    ]
    for pid in ROSTER:
        m = meta[pid]
        rec = {"author": clean_author(m.get("author")), "license": m.get("license") or "",
               "url": m.get("page") or ""}
        lines.append(f"  {pid}: {json.dumps(rec, ensure_ascii=False)},")
    lines.append("};")
    open(os.path.join(ROOT, "src", "photos.js"), "w", encoding="utf-8").write("\n".join(lines) + "\n")


def main(cache, only):
    os.makedirs(OUT, exist_ok=True)
    session = new_session("isnet-general-use")
    ids = only or list(ROSTER)
    for pid in ids:
        process(pid, cache, session)
        print("ok", pid)
    credits(cache)
    every = list(ROSTER)
    for k in range(0, len(every), 32):
        sheet(cache, every[k:k + 32], f"sheet-{k // 32}.jpg")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "players-cache", sys.argv[2:])
