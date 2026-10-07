"""build.py — bake the card frames (assets/frames/) from the two source designs.

    python tools/frames/build.py

Sources (tools/frames/src/):
  gold-frame.webp  — the gold "swirl" shield (already cut out, RGBA)
  icon-frame.png   — the ivory Icon frame with the gold rim (on white — cut out here)

Two FAMILIES, one per source, carry the ten editions (src/rarity.js):
  gold family: bronze, silver, gold, rare gold — the whole metal re-toned by a
               gradient map, so the swirl engraving survives in every metal
  icon family: Team of the Week … Legend — the gold rim stays, the ivory field
               is re-dyed per promo (Legend keeps the original ivory)

Each frame is placed, fit to height, in the card's 756×1056 (63:88) art box and
saved as an RGBA WebP. Per family it also writes mask-<family>.png (the
silhouette — CSS clips the holo layers to it), shade-<family>.png (a blurred
silhouette on a padded canvas — the card's drop shadow / rarity glow) and
field-<family>.png (the inner panel — cardart.js clips the player photo to it).
"""

import os

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "assets", "frames")
W, H = 756, 1056
MARGIN = 6           # px of air above + below the frame inside the art box
SHADE_PAD = 0.10     # the shade canvas overhangs the card box by this much per side


def cut_white(rgb):
    """RGBA from a frame on a white page: flood the near-white that touches the
    border, then feather the rim so it doesn't carry a white halo."""
    a = np.asarray(rgb).astype(np.int16)
    whiteish = (a.min(-1) > 236) & ((a.max(-1) - a.min(-1)) < 14)
    lab, _ = ndimage.label(whiteish)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    outside = np.isin(lab, list(edge))
    inside = ~outside
    # shave the 1px anti-aliased rim (it is mostly page white), then soften
    inside = ndimage.binary_erosion(inside, iterations=1)
    alpha = Image.fromarray((inside * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.9))
    out = Image.fromarray(a.astype(np.uint8), "RGB").convert("RGBA")
    out.putalpha(alpha)
    return out


def trim(im):
    return im.crop(im.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox())


def place(im):
    """fit to the art box height (less MARGIN), centred"""
    h = H - 2 * MARGIN
    w = round(im.width * h / im.height)
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    canvas.paste(im.resize((w, h), Image.LANCZOS), ((W - w) // 2, MARGIN))
    return canvas


def hexrgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], np.float32)


def gradient_map(lum, stops):
    """lum 0..1 → RGB through [(t, '#hex'), …]"""
    ts = np.array([t for t, _ in stops], np.float32)
    cs = np.stack([hexrgb(c) for _, c in stops])
    out = np.empty(lum.shape + (3,), np.float32)
    for k in range(3):
        out[..., k] = np.interp(lum, ts, cs[:, k])
    return out


def luminance(rgb):
    return (0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]) / 255.0


# ---- gold family: re-tone the whole metal -------------------------------------
METALS = {
    "bronze":   [(0, "#1f0d04"), (0.30, "#6b3518"), (0.55, "#a8622f"), (0.75, "#d99566"), (0.9, "#f3c39b"), (1, "#fff1e2")],
    "silver":   [(0, "#14181d"), (0.30, "#4f5862"), (0.55, "#8f99a5"), (0.75, "#c4ccd6"), (0.9, "#e8edf2"), (1, "#ffffff")],
    "raregold": [(0, "#2a1500"), (0.30, "#86500a"), (0.55, "#d29a1c"), (0.75, "#f7c83c"), (0.9, "#ffe68a"), (1, "#fffbe8")],
}


def metal(src, stops):
    a = np.asarray(src).astype(np.float32)
    lum = luminance(a[..., :3])
    lo, hi = np.percentile(lum[a[..., 3] > 200], [1, 99.6])
    t = np.clip((lum - lo) / (hi - lo), 0, 1)
    rgb = gradient_map(t, stops)
    return Image.fromarray(np.dstack([rgb, a[..., 3]]).clip(0, 255).astype(np.uint8), "RGBA")


# ---- icon family: re-dye the ivory field, keep the gold rim -------------------
# field: [top-left, bottom-right] base gradient; ink: the texture's highlight
DYES = {
    "totw":   {"field": ["#2b2b30", "#060607"], "ink": "#6d6250", "glow": "#3c3a36"},
    "potm":   {"field": ["#a51d38", "#2a0610"], "ink": "#ff8fa3", "glow": "#d2304f"},
    "future": {"field": ["#5a2bb8", "#12062e"], "ink": "#9fffe0", "glow": "#8f55ff"},
    "tots":   {"field": ["#c8fff6", "#1fa69a"], "ink": "#ffffff", "glow": "#e6fffb"},
    "toty":   {"field": ["#2d57db", "#071242"], "ink": "#a8c1ff", "glow": "#4f7dff"},
}


def field_mask(src):
    """the ivory field: light, low-saturation pixels connected to the centre"""
    a = np.asarray(src).astype(np.int16)
    rgb = a[..., :3]
    light = (rgb.min(-1) > 200) & ((rgb.max(-1) - rgb.min(-1)) < 34) & (a[..., 3] > 250)
    lab, _ = ndimage.label(light)
    keep = lab[a.shape[0] // 2, a.shape[1] // 2]
    m = lab == keep
    return ndimage.binary_closing(m, iterations=2)


def dye(src, mask, d):
    a = np.asarray(src).astype(np.float32)
    rgb = a[..., :3]
    h, w = mask.shape
    lum = luminance(rgb)
    lo, hi = np.percentile(lum[mask], [2, 99.8])
    tex = np.clip((lum - lo) / (hi - lo + 1e-6), 0, 1)  # the brush-stroke texture, stretched
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    diag = np.clip((xx / w * 0.45 + yy / h * 0.85) / 1.3, 0, 1)[..., None]
    c0, c1 = hexrgb(d["field"][0]), hexrgb(d["field"][1])
    base = c0 * (1 - diag) + c1 * diag
    # a soft light pool behind where the player stands
    cx, cy = w * 0.56, h * 0.30
    pool = np.exp(-(((xx - cx) / (w * 0.42)) ** 2 + ((yy - cy) / (h * 0.30)) ** 2))[..., None]
    base = base + (hexrgb(d["glow"]) - base) * pool * 0.55
    ink = hexrgb(d["ink"])
    # texture: the strokes catch light in the ink colour
    stroke = (1 - tex)[..., None]  # strokes are the darker marks on the ivory
    out = base + (ink - base) * stroke * 0.28
    out = out * (0.92 + 0.08 * tex[..., None])
    soft = ndimage.gaussian_filter(mask.astype(np.float32), 1.0)[..., None]
    res = rgb * (1 - soft) + out * soft
    return Image.fromarray(np.dstack([res, a[..., 3]]).clip(0, 255).astype(np.uint8), "RGBA")


def alpha_png(alpha, path):
    """white + alpha: CSS mask-image and canvas destination-in both read alpha"""
    im = Image.new("RGBA", alpha.size, (255, 255, 255, 0))
    im.putalpha(alpha)
    im.save(path, optimize=True)


def masks(family, placed, field):
    """mask-: the silhouette (clips the holo layers) · shade-: blurred + padded
    (the drop shadow / rarity glow) · field-: the inner panel the photo sits in"""
    alpha = placed.getchannel("A")
    alpha_png(alpha.resize((W // 2, H // 2), Image.LANCZOS), os.path.join(OUT, f"mask-{family}.png"))
    px, py = round(W * SHADE_PAD), round(H * SHADE_PAD)
    pad = Image.new("L", (W + 2 * px, H + 2 * py), 0)
    pad.paste(alpha, (px, py))
    shade = pad.resize((pad.width // 4, pad.height // 4), Image.LANCZOS).filter(ImageFilter.GaussianBlur(7))
    alpha_png(shade, os.path.join(OUT, f"shade-{family}.png"))
    f = Image.fromarray((field * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
    alpha_png(f.resize((W // 2, H // 2), Image.LANCZOS), os.path.join(OUT, f"field-{family}.png"))


def save(name, im):
    im.save(os.path.join(OUT, f"{name}.webp"), "WEBP", quality=90, method=6)
    print("wrote", name)


def main():
    os.makedirs(OUT, exist_ok=True)
    gold = place(trim(Image.open(os.path.join(HERE, "src", "gold-frame.webp")).convert("RGBA")))
    save("gold", gold)
    for name, stops in METALS.items():
        save(name, metal(gold, stops))
    # the gold shield has no rim: its panel is the silhouette, pulled in off the bevel
    inner = ndimage.binary_erosion(np.asarray(gold.getchannel("A")) > 128, iterations=16)
    masks("gold", gold, inner)

    icon = place(trim(cut_white(Image.open(os.path.join(HERE, "src", "icon-frame.png")).convert("RGB"))))
    save("legend", icon)
    fm = field_mask(icon)
    for name, d in DYES.items():
        save(name, dye(icon, fm, d))
    masks("icon", icon, ndimage.binary_erosion(fm, iterations=3))


if __name__ == "__main__":
    main()
