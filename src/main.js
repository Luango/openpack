import { fetchSets, fetchSetPool } from "./api.js";
import { createGallery } from "./gallery.js";
import { createFilters } from "./filters.js";
import { createLightbox } from "./lightbox.js";
import { createOptions } from "./options.js";
import * as sfx from "./sfx.js";

const $ = (s) => document.querySelector(s);
const el = {
  setSelect: $("#set-select"),
  cardCount: $("#card-count"),
  statusHint: $("#status-hint"),
  toast: $("#toast"),
  grid: $("#card-grid"),
  modeSwitch: $("#mode-switch"),
  rarityChips: $("#rarity-chips"),
};

createOptions({ containerEl: $("#view-options") });

const lightbox = createLightbox({
  overlayEl: $("#lightbox"),
  hostEl: $("#lightbox-host"),
  captionEl: $("#lightbox-caption"),
  closeEl: $("#lightbox-close"),
});

const gallery = createGallery({
  gridEl: el.grid,
  onCardClick: (card) => lightbox.open(card),
  onHoverCard: sfx.hover,
});

const filters = createFilters({
  switchEl: el.modeSwitch,
  chipsEl: el.rarityChips,
  onApply: (active) => {
    const { visible, total } = gallery.applyFilter(active);
    el.cardCount.textContent =
      visible === total ? `${total} cards` : `${visible} / ${total} cards`;
  },
});

async function init() {
  try {
    const sets = await fetchSets();
    el.setSelect.innerHTML = sets
      .map((s) => `<option value="${s.id}">${s.name} (${s.total})</option>`)
      .join("");
  } catch (err) {
    el.setSelect.innerHTML = `<option value="sv8">Surging Sparks</option>`;
    toast(`Couldn't load sets: ${err.message}`);
  }

  el.setSelect.addEventListener("change", () => loadSet(el.setSelect.value));
  await loadSet(el.setSelect.value);
}

async function loadSet(setId) {
  el.grid.innerHTML = "";
  el.cardCount.textContent = "";
  el.statusHint.textContent = "Loading cards…";
  el.statusHint.classList.remove("hidden");

  let cards;
  try {
    cards = await fetchSetPool(setId);
  } catch (err) {
    el.statusHint.textContent = `Couldn't load cards: ${err.message}`;
    return;
  }

  cards = [...cards].sort((a, b) => cardNo(a.number) - cardNo(b.number)); // natural set order
  el.statusHint.classList.add("hidden");
  gallery.render(cards);
  filters.build(cards); // rebuilds chips, reapplies the persisted filter + count label
}

// numbers can be "1", "23", "TG01", "GG70"… sort by the numeric part, rest last
function cardNo(n) {
  const m = String(n ?? "").match(/\d+/);
  return m ? parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER;
}

let toastTimer;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.add("hidden"), 2600);
}

init();
