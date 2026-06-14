import { renderCard } from "./card.js";
import { delegate } from "./util.js";

// Owns the gallery grid: renders cards (via the shared Card component) and
// shows/hides them for the rarity filter. Hover + click are delegated to the
// grid element so they survive re-renders.
export function createGallery({ gridEl, onCardClick, onHoverCard }) {
  let cards = [];
  let hovered = null;

  // play the hover sound once per card entered (mouseover also fires for the
  // child <img>/meta, so track the card element)
  delegate(gridEl, "mouseover", ".card", (cardEl) => {
    if (cardEl !== hovered) {
      hovered = cardEl;
      onHoverCard?.();
    }
  });
  gridEl.addEventListener("mouseout", (e) => {
    if (hovered && !hovered.contains(e.relatedTarget)) hovered = null;
  });
  delegate(gridEl, "click", ".card", (cardEl) => onCardClick?.(cards[Number(cardEl.dataset.i)]));

  function render(list) {
    cards = list;
    gridEl.innerHTML = list
      .map((card, i) => renderCard(card, { variant: "grid", index: i }))
      .join("");
  }

  function applyFilter(activeRarities) {
    let visible = 0;
    gridEl.querySelectorAll(".card").forEach((cardEl) => {
      const show = activeRarities.has(cardEl.dataset.rarity);
      cardEl.style.display = show ? "" : "none";
      if (show) visible++;
    });
    return { visible, total: cards.length };
  }

  return { render, applyFilter };
}
