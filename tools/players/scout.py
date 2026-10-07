"""scout.py — find each player's best BUST SHOT on Wikimedia Commons.

    python tools/players/scout.py <cache-dir> [id ...]

A card portrait should read like an ultimate-team card's: the player facing the
lens, head level, shoulders square, sharp, alone in frame, with room in the
photo for the shoulders and chest. The article's lead image often isn't that
(an action frame, a profile, a suit at an event), so per player this:

  1. searches Commons for files whose TITLE names the player (identity comes
     from the file's own title, never from the face), dropping titles that name
     a second person or aren't a photo of him (shirts, statues, signatures…)
  2. scores every candidate on a 640px preview with YuNet landmarks:
       frontal (nose on the eyes' midline) · level · chin neither up nor down ·
       face big enough at full size · the bust crop fits inside the photo ·
       no second face of similar size in the crop
  3. re-scores the best few at full size, adding sharpness (Laplacian variance
     over the face)
  4. cuts the top three out exactly as the card will show them (cutout.portrait)
     and writes contact sheets — current portrait (C) beside #1–#3 — so the
     final pick is a quick look

Writes <cache-dir>/scout/<id>.json (ranked, with author/licence) and
<cache-dir>/scout-*.jpg. Pin the winners in roster.FILE, then fetch.py + cutout.py.
"""

import io
import json
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import cv2
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(__file__))
from roster import ROSTER, FILE  # noqa: E402
import cutout  # noqa: E402

UA = "OpenPackFC-card-builder/1.0 (https://github.com/Luango/openpack)"
COMMONS = "https://commons.wikimedia.org/w/api.php"
PREVIEW_W = 640
FULL_W = 2400
TOP = 3

# searches for names an intitle: on first + last name gets wrong (mononyms that
# other players share, spelling variants, a surname that isn't the last word)
QUERIES = {
    "p09": ["Rodri Spain", "Rodri Manchester", "Rodri Barcelona", "Rodri Hernández"],
    "p20": ["Vitinha Portugal", "Vitinha PSG", "Vitinha Paris"],
    "p27": ["Lionel Messi", "Leo Messi"],
    "p29": ["Son Heung", "Heung-Min Son"],
    "p32": ["Alisson Becker", "Alisson Liverpool", "Alisson Brazil"],
    "p92": ["Endrick Brazil", "Endrick Palmeiras", "Endrick Madrid"],
    "p93": ["Estevao Brazil", "Estevao Palmeiras", "Estevao Chelsea", "Estêvão Willian"],
    "l01": ["Pelé", "Pele Santos", "Pele Brasil"],
    "l02": ["Maradona"],
    "l04": ["Ronaldo Nazario", "Ronaldo Fenômeno", "Ronaldo Inter", "Ronaldo Real Madrid", "Ronaldo Corinthians"],
    "l05": ["Johan Cruijff", "Johan Cruyff"],
    "l08": ["Ronaldinho"],
}
# title words that rule a candidate out
EXCLUDE = re.compile(
    r"\band\b|\bwith\b|&|\b(e|y|und|et|con|mit)\b|\bfans?\b|signature|autograph|statue|mural|\bwax\b|museum|trophy|\bshirt|jersey|"
    r"\bkit\b|boots?\b|logo|painting|drawing|cartoon|caricature|grave|funeral|cenaze|stadium|tifo|banner|"
    r"celebrat|walker-peters|\bmap\b",
    re.I,
)


def fold(s):
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def queries(pid):
    if pid in QUERIES:
        words = QUERIES[pid]
    else:
        name = re.sub(r"\s*\(.*\)", "", ROSTER[pid])
        toks = [t for t in re.split(r"[\s\-']+", name) if len(t) >= 3]
        words = [name] if len(toks) < 2 else [f"{toks[0]} {toks[-1]}"]
    out = []
    for w in words:
        for v in {w, fold(w)}:
            out.append(" ".join(f'intitle:"{t}"' for t in v.split()) + " filetype:bitmap")
    return out


# other spellings a file title may use for a player's name
ALIASES = {"p27": "Leo", "p29": "Heung Min", "l04": "Nazario Fenomeno", "l05": "Cruijff", "p93": "Willian"}


def name_tokens(pid):
    name = re.sub(r"\s*\(.*\)", "", ROSTER[pid]) + " " + ALIASES.get(pid, "")
    return {fold(t).lower() for t in re.split(r"[\s\-']+", name) if len(t) >= 3}


def names_him_first(pid, title):
    """the title must name THIS player first: no capitalised name-like word right
    before his name ("Nicolas Otamendi Lionel Messi …" is Otamendi's shot). A
    separator, a number or a lowercase word before it is fine."""
    toks = name_tokens(pid)
    text = fold(os.path.splitext(title)[0]).replace("_", " ")
    for m in re.finditer(r"[A-Za-z]+", text):
        if m.group().lower() not in toks:
            continue
        before = text[: m.start()].rstrip()
        if not before or before[-1] in "(-,–:[":
            return True
        prev = re.split(r"\s+", before)[-1]
        return not (prev[:1].isupper() and prev.isalpha() and prev.lower() not in toks)
    return False


def get(url, params=None, raw=False, tries=4):
    if params:
        url += "?" + urllib.parse.urlencode(params)
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            return data if raw else json.loads(data)
        except Exception as e:  # noqa: BLE001
            if k == tries - 1:
                raise
            time.sleep(2 + 3 * k)


def strip_html(s):
    from html import unescape
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", "", s or ""))).strip()


def search(pid):
    """→ {title: {url640, w, h, author, license, page}}"""
    found = {}
    for q in queries(pid):
        d = get(COMMONS, {
            "action": "query", "format": "json", "generator": "search", "gsrsearch": q,
            "gsrnamespace": 6, "gsrlimit": 50, "prop": "imageinfo",
            "iiprop": "url|size|mime|extmetadata", "iiurlwidth": PREVIEW_W,
        })
        for p in d.get("query", {}).get("pages", {}).values():
            t = p["title"][5:]
            ii = (p.get("imageinfo") or [{}])[0]
            if not ii or ii.get("mime") not in ("image/jpeg", "image/png", "image/webp"):
                continue
            if min(ii.get("width", 0), ii.get("height", 0)) < 600 or EXCLUDE.search(t) or not names_him_first(pid, t):
                continue
            em = ii.get("extmetadata", {})
            found[t] = {
                "url": ii.get("thumburl") or ii["url"], "w": ii["width"], "h": ii["height"],
                "author": strip_html(em.get("Artist", {}).get("value", "")) or strip_html(em.get("Credit", {}).get("value", "")),
                "license": strip_html(em.get("LicenseShortName", {}).get("value", "")),
                "page": ii.get("descriptionurl"),
            }
    return found


def assess(rgb, scale, cache, sharp=False):
    """bust-shot score for one image (rgb at `scale` × original size) → dict or None"""
    faces = cutout.detect_faces(rgb, cache, min_conf=0.6)
    if not faces:
        return None
    H, W = rgb.shape[:2]
    f = max(faces, key=lambda a: a.w * a.h * (1.25 - 0.5 * a.y / H))
    x0, y0, x1, y1 = cutout.crop_box(f.box(), {}, 10 ** 9)  # the ideal crop, unclamped
    side = x1 - x0
    ix = max(0, min(W, x1) - max(0, x0)) / side
    iy = max(0, min(H, y1) - max(0, y0)) / side
    # ONE dominant face in the whole photo: a match frame often names its player
    # while an opponent's face is the bigger one, so any rival face rules it out
    others = [g for g in faces if g is not f and g.w > 0.35 * f.w]
    fw = f.w / scale
    r = {
        "face_w": round(fw), "yaw": round(f.yaw, 3), "roll": round(f.roll, 1), "pitch": round(f.pitch, 3),
        "conf": round(f.conf, 3), "fit": round(ix * iy, 3), "others": len(others),
    }
    res = min(1.0, fw / 300)
    front = max(0.0, 1 - abs(f.yaw) / 0.24)
    level = max(0.0, 1 - abs(f.roll) / 25)  # tilt is levelled in the cutout, so it costs little
    chin = max(0.0, 1 - abs(f.pitch - 0.56) / 0.3)
    fit = (ix * iy) ** 2
    solo = 0.0 if others else 1.0
    score = f.conf * (0.2 + 0.8 * res) * front * (0.6 + 0.4 * level) * (0.4 + 0.6 * chin) * fit * solo
    if sharp:
        x, y, w, h = (int(v) for v in f.box())
        crop = cv2.cvtColor(rgb[max(0, y):y + h, max(0, x):x + w], cv2.COLOR_RGB2GRAY)
        if crop.size:
            crop = cv2.resize(crop, (256, int(256 * crop.shape[0] / max(1, crop.shape[1]))))
            lap = float(cv2.Laplacian(crop, cv2.CV_64F).var())
            r["sharp"] = round(lap)
            score *= min(1.0, max(0.25, lap / 140))
    r["score"] = round(score, 4)
    return r


def image(url):
    return Image.open(io.BytesIO(get(url, raw=True))).convert("RGB")


def scout(pid, cache, session):
    out_dir = os.path.join(cache, "scout", pid)
    os.makedirs(out_dir, exist_ok=True)
    cands = search(pid)
    current = FILE.get(pid)
    meta = json.load(open(os.path.join(cache, "meta.json"), encoding="utf-8")).get(pid, {})
    lead = (meta.get("file") or "").replace("_", " ")
    # stage 1 — previews (fetched in parallel; the detector isn't thread-safe, so
    # it rates them one by one)
    def prev(item):
        t, c = item
        try:
            return t, image(c["url"])
        except Exception:  # noqa: BLE001
            return t, None
    with ThreadPoolExecutor(6) as ex:
        previews = list(ex.map(prev, cands.items()))
    rated = []
    for t, im in previews:
        r = im and assess(np.array(im), im.width / cands[t]["w"], cache)
        if r and r["score"] > 0:
            rated.append((t, r))
    rated.sort(key=lambda tr: tr[1]["score"], reverse=True)
    # stage 2 — the best few at full size
    ranked = []
    for t, r1 in rated[: TOP + 1]:
        c = cands[t]
        width = min(c["w"], FULL_W)
        try:
            d = get(COMMONS, {"action": "query", "format": "json", "titles": "File:" + t,
                              "prop": "imageinfo", "iiprop": "url", "iiurlwidth": width})
            ii = next(iter(d["query"]["pages"].values()))["imageinfo"][0]
            im = image(ii.get("thumburl") or ii["url"])
        except Exception:  # noqa: BLE001
            continue
        r = assess(np.array(im), im.width / c["w"], cache, sharp=True)
        if r and r["score"] > 0:
            ranked.append({"file": t, **c, **r, "_im": im})
    ranked.sort(key=lambda c: c["score"], reverse=True)
    ranked = ranked[:TOP]
    for k, c in enumerate(ranked):
        cut, _ = cutout.portrait(c.pop("_im"), session, cache)
        cut.save(os.path.join(out_dir, f"{k + 1}.webp"), "WEBP", quality=86)
        c["current"] = c["file"] in (current, lead)
    json.dump(ranked, open(os.path.join(out_dir, "..", pid + ".json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return ranked


def sheets(cache, ids):
    cell, label = 190, 210
    per = 6
    for s in range(0, len(ids), per):
        chunk = ids[s:s + per]
        bg = Image.new("RGB", (label + cell * (TOP + 1), len(chunk) * (cell + 24)), (24, 22, 18))
        d = ImageDraw.Draw(bg)
        for row, pid in enumerate(chunk):
            y = row * (cell + 24)
            d.text((8, y + 8), f"{pid}\n{ROSTER[pid][:26]}", fill=(255, 255, 255))
            ranked = json.load(open(os.path.join(cache, "scout", pid + ".json"), encoding="utf-8"))
            tiles = [("C", os.path.join(cutout.OUT, pid + ".webp"), "current")]
            for k, c in enumerate(ranked):
                tag = f"#{k + 1} s{c['score']:.2f} fw{c['face_w']} y{c['yaw']:+.2f} sh{c.get('sharp', 0)}"
                tiles.append((str(k + 1), os.path.join(cache, "scout", pid, f"{k + 1}.webp"), tag + (" =C" if c.get("current") else "")))
            for i, (_, path, tag) in enumerate(tiles):
                x = label + i * cell
                tile = Image.new("RGB", (cell, cell), (214, 172, 82))
                tile.paste(Image.new("RGB", (cell, cell // 2), (238, 206, 122)), (0, 0))
                if os.path.exists(path):
                    im = Image.open(path).resize((cell, cell))
                    tile.paste(im, (0, 0), im)
                bg.paste(tile, (x, y))
                d.text((x + 3, y + cell + 4), tag[:40], fill=(255, 230, 150))
        bg.save(os.path.join(cache, f"scout-{s // per:02d}.jpg"), quality=86)


def main(cache, only):
    from rembg import new_session
    session = new_session("isnet-general-use")
    ids = only or list(ROSTER)
    for pid in ids:
        ranked = scout(pid, cache, session)
        best = ranked[0] if ranked else None
        print(pid, ROSTER[pid][:24].ljust(24), len(ranked),
              (f"{best['score']:.2f} fw{best['face_w']} yaw{best['yaw']:+.2f} sh{best.get('sharp')} {best['file'][:60]}" if best else "-"),
              flush=True)
    sheets(cache, ids)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "players-cache", sys.argv[2:])
