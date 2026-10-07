"""fetch.py — download every club's real crest for the card badges.

    python tools/clubs/fetch.py

For each club id in CLUBS (the same ids as src/players.js): the crest file the
English Wikipedia article's infobox shows (its page image; club crests are
non-free, so `pilicense=any`), unless FILE pins another, rendered by Wikimedia
to a PNG with its long side at RENDER px. Each is trimmed to its alpha bounds, scaled so its long
side is SIZE px, and written to assets/clubs/<id>.webp (lossless alpha).
tools/clubs/sources.json records which file each crest came from.

The Legends side (LGD) is our own and keeps its drawn crest (emblems.js).
"""

import io
import json
import os
import sys
import time
import urllib.parse
import urllib.request

from PIL import Image

UA = "OpenPackFC-card-builder/1.0 (https://github.com/Luango/openpack)"
WIKI = "https://en.wikipedia.org/w/api.php"
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "assets", "clubs")
RENDER = 720  # px Wikimedia renders the (mostly SVG) crest at
SIZE = 360    # long side of the shipped crest — the walkout shows it ~180 CSS px

# club id → English Wikipedia article
CLUBS = {
    "RMA": "Real Madrid CF",
    "MCI": "Manchester City F.C.",
    "PSG": "Paris Saint-Germain F.C.",
    "BAR": "FC Barcelona",
    "BAY": "FC Bayern Munich",
    "TRA": "Trabzonspor",
    "LIV": "Liverpool F.C.",
    "ARS": "Arsenal F.C.",
    "INT": "Inter Milan",
    "MUN": "Manchester United F.C.",
    "MIA": "Inter Miami CF",
    "NAS": "Al Nassr FC",
    "LAF": "Los Angeles FC",
    "GAL": "Galatasaray S.K. (football)",
    "MIL": "AC Milan",
    "BHA": "Brighton & Hove Albion F.C.",
    "CHE": "Chelsea F.C.",
    "CHF": "Chicago Fire FC",
    "NAP": "SSC Napoli",
    "ATH": "Athletic Bilbao",
    "JUV": "Juventus FC",
    "ORL": "Orlando City SC",
    "TOT": "Tottenham Hotspur F.C.",
    "ATM": "Atlético Madrid",
    "FEN": "Fenerbahçe S.K. (football)",
    "VAN": "Vancouver Whitecaps FC",
    "SHB": "Al Shabab FC (Riyadh)",
    "OLY": "Olympiacos F.C.",
    "BAS": "FC Basel",
    "WOL": "Wolverhampton Wanderers F.C.",
    "LAG": "LA Galaxy",
    "PSV": "PSV Eindhoven",
    "SAD": "Al Sadd SC",
    "HJK": "HJK Helsinki",
    "BOU": "AFC Bournemouth",
    "ATA": "Atalanta BC",
    "ITT": "Al-Ittihad Club (Jeddah)",
    "CRY": "Crystal Palace F.C.",
    "FLU": "Fluminense FC",
    "HIL": "Al Hilal SFC",
    "AHL": "Al-Ahli Saudi FC",
    "COM": "Como 1907",
    "RBL": "RB Leipzig",
}

# club id → "File:…" when the article's page image isn't the current crest
FILE = {}


def get(url, params=None, raw=False, tries=4):
    if params:
        url += "?" + urllib.parse.urlencode(params)
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            return data if raw else json.loads(data)
        except Exception as e:  # noqa: BLE001 — retry anything transient
            if k == tries - 1:
                raise
            print("  retry", url[:90], e)
            time.sleep(2 + 3 * k)


def page_images():
    """club id → File: title of each article's page image."""
    titles = list(CLUBS.values())
    r = get(WIKI, {
        "action": "query", "format": "json", "formatversion": 2, "redirects": 1,
        "prop": "pageimages", "piprop": "name", "pilicense": "any",
        "titles": "|".join(titles),
    })
    q = r["query"]
    canon = {t: t for t in titles}
    for m in q.get("normalized", []) + q.get("redirects", []):
        for t, c in canon.items():
            if c == m["from"]:
                canon[t] = m["to"]
    by_title = {p["title"]: p.get("pageimage") for p in q["pages"]}
    out = {}
    for cid, t in CLUBS.items():
        name = by_title.get(canon[t])
        if not name:
            sys.exit(f"{cid}: no page image for {t!r} — pin one in FILE")
        out[cid] = "File:" + name.replace("_", " ")
    return out


def rendered(files):
    """File: title → (png url at RENDER px wide, description page url, w, h)."""
    r = get(WIKI, {
        "action": "query", "format": "json", "formatversion": 2,
        "prop": "imageinfo", "iiprop": "url|size", "iiurlwidth": RENDER,
        "titles": "|".join(files),
    })
    out = {}
    for p in r["query"]["pages"]:
        ii = p["imageinfo"][0]
        out[p["title"]] = (ii["thumburl"], ii["descriptionurl"], ii["width"], ii["height"])
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    files = page_images()
    files.update(FILE)
    info = rendered(sorted(set(files.values())))
    sources = {}
    for cid, f in files.items():
        thumb, page, w, h = info[f]
        if h > w:  # a tall crest: re-ask by height so its long side lands at RENDER
            thumb = get(WIKI, {
                "action": "query", "format": "json", "formatversion": 2,
                "prop": "imageinfo", "iiprop": "url", "iiurlheight": RENDER, "titles": f,
            })["query"]["pages"][0]["imageinfo"][0]["thumburl"]
        im = Image.open(io.BytesIO(get(thumb, raw=True))).convert("RGBA")
        bbox = im.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
        if bbox:
            im = im.crop(bbox)
        k = SIZE / max(im.size)
        im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
        im.save(os.path.join(OUT, f"{cid}.webp"), "WEBP", lossless=True, method=6)
        sources[cid] = {"club": CLUBS[cid], "file": f, "url": page}
        print(f"{cid}  {im.width}x{im.height}  {f}")
        time.sleep(0.3)
    with open(os.path.join(os.path.dirname(__file__), "sources.json"), "w", encoding="utf-8") as fh:
        json.dump(sources, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


if __name__ == "__main__":
    main()
