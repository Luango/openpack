"""cutout.py — turn each fetched photo into a card portrait (assets/players/<id>.webp).

    pip install "rembg[cpu]" "opencv-python-headless<5"
    python tools/players/cutout.py <cache-dir> [id ...]

The card wants a BUST SHOT, the way an ultimate-team card frames its player:
head near the top, level, shoulders and upper chest below, one person, nothing
else. Per player:

  1. matte the people in the photo (rembg / IS-Net)
  2. find the face with YuNet (face box + eye/nose/mouth landmarks) — the
     biggest confident face that stands ON a matted person
  3. level the head: rotate the photo about the face by the eye-line's tilt
  4. frame a square crop around it (SPAN face-widths wide, HEADROOM above the
     hair), drawn in closer when the photo itself ends under the chin
  5. keep only the matte blobs in the column under that face (drops team-mates,
     referees, the crowd), feather any edge where the crop overruns the photo
  6. save a 600px RGBA WebP

Also writes src/photos.js — the per-photo credit line every CC licence asks
for — and <cache-dir>/sheet-*.jpg contact sheets to eyeball. The photos
themselves are picked by scout.py (which uses the same framing).
"""

import json
import math
import os
import re
import sys
import urllib.request

import cv2
import numpy as np
from PIL import Image, ImageDraw
from rembg import new_session, remove

sys.path.insert(0, os.path.dirname(__file__))
from roster import ROSTER, CROP  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "assets", "players")
SIZE = 600
SPAN = 3.4        # crop side, in face widths
HEADROOM = 0.11   # gap above the hair, as a share of the crop
FEATHER = 0.07    # fade where the crop overruns the photo, as a share of the crop

YUNET_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
_yunet = None


def yunet(cache):
    """the YuNet face detector (fetched once into the cache dir)"""
    global _yunet
    if _yunet is None:
        path = os.path.join(cache, "yunet.onnx")
        if not os.path.exists(path):
            urllib.request.urlretrieve(YUNET_URL, path)
        _yunet = cv2.FaceDetectorYN.create(path, "", (320, 320), 0.6, 0.3, 50)
    return _yunet


class Face:
    """one YuNet detection: box, landmarks, and the pose read off them"""

    def __init__(self, row):
        self.x, self.y, self.w, self.h = (float(v) for v in row[:4])
        self.re, self.le = np.array(row[4:6]), np.array(row[6:8])  # subject's right / left eye
        self.nose = np.array(row[8:10])
        self.mouth = (np.array(row[10:12]) + np.array(row[12:14])) / 2
        self.conf = float(row[14])
        eyes = (self.re + self.le) / 2
        iod = max(1.0, float(np.linalg.norm(self.le - self.re)))
        # yaw: how far the nose sits off the eyes' midline (0 = facing the lens)
        self.yaw = float((self.nose[0] - eyes[0]) / iod)
        # roll: the eye line's tilt, in degrees
        self.roll = math.degrees(math.atan2(self.le[1] - self.re[1], self.le[0] - self.re[0]))
        # pitch: nose height between eyes and mouth (~0.55 level; low = chin up, high = head down)
        self.pitch = float((self.nose[1] - eyes[1]) / max(1.0, self.mouth[1] - eyes[1]))
        self.cx, self.cy = self.x + self.w / 2, self.y + self.h / 2

    def box(self):
        return (self.x, self.y, self.w, self.h)


def detect_faces(rgb, cache, min_conf=0.7, max_side=960):
    """YuNet is tuned for faces of roughly 10–300px, so a big photo is searched
    at ≤ max_side and the boxes/landmarks scaled back up"""
    det = yunet(cache)
    h, w = rgb.shape[:2]
    s = min(1.0, max_side / max(h, w))
    img = cv2.resize(rgb, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA) if s < 1 else rgb
    det.setInputSize((img.shape[1], img.shape[0]))
    _, rows = det.detect(cv2.cvtColor(img, cv2.COLOR_RGB2BGR))
    rows = [] if rows is None else [np.concatenate([r[:14] / s, r[14:]]) for r in rows]
    return [f for f in (Face(r) for r in rows) if f.conf >= min_conf]


def person_matte(img, session, max_side=1024):
    """a full-frame people matte (0–255), computed small and scaled back up"""
    s = min(1.0, max_side / max(img.size))
    small = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS) if s < 1 else img
    m = remove(small, session=session, only_mask=True, post_process_mask=False)
    return np.array(m.resize(img.size, Image.BILINEAR))


def main_face(faces, matte, H):
    """the subject: the biggest face that stands on a matted person, high in the frame"""
    on = [f for f in faces if matte[int(min(H - 1, f.cy)), int(f.cx)] > 110] or faces
    return max(on, key=lambda f: f.w * f.h * (1.25 - 0.5 * f.y / H)) if on else None


def face_from_matte(matte):
    """no detectable face (a turned head): take the top of the biggest matted figure"""
    hard = (matte > 110).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(hard)
    if n < 2:
        return None
    k = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    ys, xs = np.where(lab == k)
    top, height = ys.min(), ys.max() - ys.min()
    band = ys < top + height * 0.12
    cx = int(xs[band].mean())
    w = int(max(20, (xs[band].max() - xs[band].min()) * 0.8))
    return (cx - w // 2, int(top + w * 0.25), w, w)


def crop_box(face, crop, img_h):
    """the square bust crop for a face box (x, y, w, h)"""
    x, y, w, h = face
    side = SPAN * w / crop.get("zoom", 1.0)
    # a photo already cropped tight under the chin would leave the player floating
    # small in an empty square — frame closer, but only until the photo's bottom
    # edge sits in the crop's lowest quarter (the card fades the chest out there
    # anyway, and the edge feather hides the cut), so every head keeps about the
    # same size on the card; never tighter than the head and collar
    fit = (img_h - y + 0.42 * w) / (0.76 - HEADROOM)
    side = max(min(side, fit), 2.3 * w)
    cx = x + w / 2 + crop.get("dx", 0) * w
    top = y - 0.42 * w - HEADROOM * side + crop.get("dy", 0) * w  # the box top sits ~at the brow; hair above
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
    x, y, w, h = (int(v) for v in face)
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


def portrait(raw, session, cache, crop=None):
    """photo (PIL RGB) → (600px RGBA bust, the Face used or None)"""
    crop = crop or {}
    matte_full = person_matte(raw, session)
    face = main_face(detect_faces(np.array(raw), cache), matte_full, raw.height)
    img = raw.convert("RGBA")
    if face is not None:
        box = face.box()
        if 1.5 < abs(face.roll) < 25 and not crop.get("keep_tilt"):
            # level the head: rotate about the face centre (corners fill transparent,
            # and are feathered like any other photo edge below)
            img = img.rotate(face.roll, resample=Image.BICUBIC, center=(face.cx, face.cy))
    else:
        box = face_from_matte(matte_full) or (raw.width * 0.4, raw.height * 0.12, raw.width * 0.2, raw.width * 0.2)
    bx = crop_box(box, crop, raw.height)
    # matte a margin wider than the crop, so shoulders cut by the crop edge stay whole
    pad = (bx[2] - bx[0]) // 6
    big = (bx[0] - pad, bx[1] - pad, bx[2] + pad, bx[3] + pad)
    region = padded_crop(img, big)
    inside = (np.array(region)[..., 3] > 250).astype(np.uint8)
    matte = np.array(remove(region.convert("RGB"), session=session, only_mask=True, post_process_mask=False))
    matte = np.where(inside > 0, matte, 0).astype(np.uint8)
    fx, fy, fw, fh = box
    matte = keep_subject(matte, (fx - big[0], fy - big[1], fw, fh))
    if not inside.all():
        # the crop overruns the photo: fade out toward that edge instead of a hard cut
        ramp = FEATHER * (bx[2] - bx[0])
        dist = cv2.distanceTransform(inside, cv2.DIST_L2, 5)
        matte = (matte * np.clip(dist / ramp, 0, 1)).astype(np.uint8)
    region.putalpha(Image.fromarray(matte))
    cut = region.crop((pad, pad, pad + bx[2] - bx[0], pad + bx[3] - bx[1]))
    return cut.resize((SIZE, SIZE), Image.LANCZOS), face


def process(pid, cache, session):
    raw = Image.open(os.path.join(cache, "raw", pid + ".jpg")).convert("RGB")
    cut, face = portrait(raw, session, cache, CROP.get(pid))
    if face is None:
        print(f"!! {pid}: no face found — framed from the matte; check it")
    cut.save(os.path.join(OUT, pid + ".webp"), "WEBP", quality=86, method=6)


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
        "// crediting the author and licence — this file is that record (it is not shown in",
        "// the UI; see README / the Commons page each entry links to).",
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
