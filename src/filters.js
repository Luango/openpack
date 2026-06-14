import { rarityToTier, tierColorVar } from "./rarity.js";
import { escapeHtml, escapeAttr, delegate } from "./util.js";

// Rarity filter. Builds the chips for the loaded set and tracks the user's
// intent so it survives set changes. Two modes:
//   "all"  — multi-select; everything shown, click a chip to hide/show it
//   "only" — single-select; click a chip to show only that rarity
// Calls onApply(activeRaritiesSet) whenever the visible set should change.
export function createFilters({ switchEl, chipsEl, onApply }) {
  let allRarities = [];
  let mode = "all";
  const excluded = new Set(); // All-mode: rarities the user hid (persists across sets)
  let only = null; // Only-mode: the isolated rarity (persists across sets)

  // Derive the visible set from the persisted intent + this set's rarities.
  function recompute() {
    if (mode === "only") {
      const target =
        only && allRarities.includes(only) ? only : allRarities[allRarities.length - 1];
      return target ? new Set([target]) : new Set();
    }
    return new Set(allRarities.filter((r) => !excluded.has(r)));
  }

  function sync(active) {
    switchEl.querySelectorAll(".switch-opt").forEach((opt) =>
      opt.classList.toggle("active", opt.dataset.mode === mode)
    );
    chipsEl.querySelectorAll(".chip").forEach((chip) =>
      chip.classList.toggle("active", active.has(chip.dataset.rarity))
    );
  }

  // Short label for the collapsed Filters button: the isolated rarity in Only
  // mode, "All" when nothing's hidden, else "N of M".
  function summarize(active) {
    if (mode === "only") return [...active][0] || "None";
    if (excluded.size === 0) return "All";
    return `${active.size} of ${allRarities.length}`;
  }

  function apply() {
    const active = recompute();
    sync(active);
    onApply?.(active, summarize(active));
  }

  delegate(switchEl, "click", ".switch-opt", (opt) => {
    mode = opt.dataset.mode;
    if (mode === "all") excluded.clear(); // All = show everything
    apply();
  });

  delegate(chipsEl, "click", ".chip", (chip) => {
    const r = chip.dataset.rarity;
    if (mode === "only") only = r; // isolate
    else if (excluded.has(r)) excluded.delete(r);
    else excluded.add(r);
    apply();
  });

  function build(cards) {
    const counts = {};
    for (const c of cards) counts[c.rarity] = (counts[c.rarity] || 0) + 1;

    // order chips low → high tier so common sits left, chase sits right
    allRarities = Object.keys(counts).sort((a, b) => rarityToTier(a) - rarityToTier(b));

    chipsEl.innerHTML = allRarities
      .map(
        (r) => `
        <button class="chip" data-rarity="${escapeAttr(r)}">
          <span class="chip-dot" style="background: ${tierColorVar(r)}"></span>
          ${escapeHtml(r)}
          <span class="chip-count">${counts[r]}</span>
        </button>`
      )
      .join("");

    apply(); // honor persisted intent + push the count label
  }

  return { build };
}
