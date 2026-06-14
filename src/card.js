import { rarityToTier, vfxFor } from "./rarity.js";
import { escapeHtml, escapeAttr } from "./util.js";

// THE card component — one template, two variants:
//   "grid"   — clickable thumbnail tile for the gallery (meta overlay)
//   "detail" — large card for the lightbox (tilt/glare wired by lightbox.js)
//
// Both variants carry the tier mark (.tier-N + data-tier) and an empty
// .card__vfx layer stamped with the tier's effect id (data-vfx). Define an
// effect once per tier (see rarity.js + card.css) and every card of that
// rarity inherits it — no per-card wiring.
export function renderCard(card, { variant = "grid", index } = {}) {
  const tier = rarityToTier(card);
  const src = card.imageSmall || card.image; // thumbnail; lightbox upgrades to full-res
  const dataI = index != null ? ` data-i="${index}"` : "";

  const meta =
    variant === "grid"
      ? `<div class="card__meta">
           <span class="card__name">${escapeHtml(card.name)}</span>
           <span class="card__rarity">${escapeHtml(card.rarity)}</span>
         </div>`
      : "";
  const attrs =
    `class="card card--${variant} tier-${tier}" data-tier="${tier}" ` +
    `data-rarity="${escapeAttr(card.rarity)}"${dataI} ` +
    `title="${escapeAttr(card.name)} · ${escapeAttr(card.rarity)}"`;
  const art = `<img class="card__art" loading="lazy" src="${src}" alt="${escapeAttr(card.name)}" />`;
  const vfx = `<div class="card__vfx" data-vfx="${vfxFor(card)}" aria-hidden="true"></div>`;

  // Detail (lightbox): a flat double-sided card — front (art + holo) and back
  // (card back) coplanar at z=0, no thickness. backface-visibility hides
  // whichever face is turned away. The front lives in a flat .card__face so
  // mix-blend works. .card--detail is the preserve-3d parent (tilted/flipped
  // by lightbox.js).
  if (variant === "detail") {
    return `
      <article ${attrs}>
        <div class="card__face">
          ${art}
          ${vfx}
          <div class="card__sparkle" aria-hidden="true"></div>
          <div class="card__glare" aria-hidden="true"></div>
        </div>
        <div class="card__back" style="transform: rotateY(180deg)" aria-hidden="true"></div>
      </article>`;
  }

  // Grid: flat thumbnail tile with a meta overlay.
  return `
    <article ${attrs}>
      ${art}
      ${vfx}
      ${meta}
    </article>`;
}
