"""fetch.py — download each roster player's photo, its licence, and their club.

    python tools/players/fetch.py <cache-dir>

For every id in roster.py: the file roster.FILE pins (picked with scout.py),
else the English Wikipedia article's lead image (only free images qualify as a
page image), at up to 2400px; its Commons author + licence; and the infobox's
`current_club` (printed, to cross-check src/players.js — Wikidata's club spells
lag behind, the infobox is kept current). Writes <cache-dir>/raw/<id>.jpg and
<cache-dir>/meta.json; cutout.py takes it from there.
"""

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from html import unescape

sys.path.insert(0, os.path.dirname(__file__))
from roster import ROSTER, FILE  # noqa: E402

UA = "OpenPackFC-card-builder/1.0 (https://github.com/Luango/openpack)"
WIKI = "https://en.wikipedia.org/w/api.php"
COMMONS = "https://commons.wikimedia.org/w/api.php"


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


def chunks(xs, n):
    for i in range(0, len(xs), n):
        yield xs[i:i + n]


def strip_html(s):
    s = re.sub(r"<[^>]+>", "", s or "")
    return re.sub(r"\s+", " ", unescape(s)).strip()


def wikilink_text(s):
    """'[[Inter Milan]]<br>(on loan …' → 'Inter Milan'"""
    m = re.search(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]", s or "")
    return (m.group(2) or m.group(1)).strip() if m else (s or "").strip() or None


def articles(titles):
    """title → {file, club} — lead image + infobox current club, redirects followed."""
    out = {}
    for batch in chunks(titles, 25):
        d = get(WIKI, {
            "action": "query", "format": "json", "redirects": 1,
            "prop": "pageimages|revisions", "piprop": "name", "pilicense": "free",
            "rvprop": "content", "rvslots": "main", "titles": "|".join(batch),
        })
        q = d["query"]
        alias = {}
        for kind in ("normalized", "redirects"):
            for m in q.get(kind, []):
                alias[m["to"]] = alias.get(m["from"], m["from"])
        for p in q["pages"].values():
            src = p["title"]
            while src in alias:
                src = alias[src]
            text = p.get("revisions", [{}])[0].get("slots", {}).get("main", {}).get("*", "")
            m = re.search(r"\|\s*current_?club\s*=\s*([^\n]*)", text)
            out[src] = {"file": p.get("pageimage"), "club": wikilink_text(m.group(1)) if m else None}
    return out


def image_info(files):
    """file name → {url, w, h, author, license, license_url, page}"""
    out = {}
    for batch in chunks(files, 40):
        d = get(COMMONS, {
            "action": "query", "format": "json", "prop": "imageinfo",
            "iiprop": "url|size|extmetadata", "iiurlwidth": 2400,
            "titles": "|".join("File:" + f for f in batch),
        })
        norm = {m["to"]: m["from"] for m in d["query"].get("normalized", [])}
        for p in d["query"]["pages"].values():
            if "imageinfo" not in p:
                continue
            ii = p["imageinfo"][0]
            em = ii.get("extmetadata", {})
            val = lambda k: em.get(k, {}).get("value", "")  # noqa: E731
            name = norm.get(p["title"], p["title"])[5:]
            out[name.replace(" ", "_")] = {
                "url": ii.get("thumburl") or ii["url"],
                "author": strip_html(val("Artist")) or strip_html(val("Credit")),
                "license": strip_html(val("LicenseShortName")),
                "license_url": val("LicenseUrl"),
                "page": ii.get("descriptionurl"),
            }
    return out


def main(cache):
    os.makedirs(os.path.join(cache, "raw"), exist_ok=True)
    arts = articles(list(ROSTER.values()))
    files = {}
    for pid, title in ROSTER.items():
        f = FILE.get(pid) or arts.get(title, {}).get("file")
        if not f:
            print(f"!! {pid} {title}: no free lead image")
        files[pid] = f.replace(" ", "_") if f else None
    info = image_info([f for f in files.values() if f])
    meta_path = os.path.join(cache, "meta.json")
    prev = json.load(open(meta_path, encoding="utf-8")) if os.path.exists(meta_path) else {}

    meta = {}
    for pid, title in ROSTER.items():
        f = files[pid]
        rec = {"title": title, "file": f, "club": arts.get(title, {}).get("club")}
        if f and f in info:
            rec.update(info[f])
            out = os.path.join(cache, "raw", pid + ".jpg")
            if not os.path.exists(out) or prev.get(pid, {}).get("file") != f:  # new or re-pinned
                open(out, "wb").write(get(rec["url"], raw=True))
                time.sleep(0.3)
        elif f:
            print(f"!! {pid}: no imageinfo for {f}")
        meta[pid] = rec
        print(f"{pid} {title[:30]:30} {rec.get('license', '-'):14} {str(rec['club'])[:30]}")
    json.dump(meta, open(meta_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "players-cache")
