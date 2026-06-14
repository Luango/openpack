import { delegate } from "./util.js";

// Display options — an extensible set of on/off toggles shown in the filter
// bar. Each option flips a class on <body> (so CSS gates the effect) and is
// persisted to localStorage.
//
// To add a future toggle (another VFX, a layout option, …): add one entry
// here and a matching `body.<bodyClass> …` rule in CSS. Nothing else to wire.
const OPTIONS = [
  { key: "holo", label: "Holo", bodyClass: "holo-on", default: true },
];

const STORE_KEY = "openpack.options.v1";

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
  } catch {
    return {};
  }
}

function save(state) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    /* private mode / storage full — non-fatal */
  }
}

export function createOptions({ containerEl }) {
  const saved = load();
  const state = {};
  for (const o of OPTIONS) state[o.key] = o.key in saved ? !!saved[o.key] : o.default;

  function apply() {
    for (const o of OPTIONS) document.body.classList.toggle(o.bodyClass, state[o.key]);
  }

  function sync() {
    containerEl.querySelectorAll(".toggle").forEach((btn) => {
      const on = state[btn.dataset.key];
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-checked", String(on));
    });
  }

  containerEl.innerHTML = OPTIONS.map(
    (o) => `
      <button class="toggle" data-key="${o.key}" role="switch" aria-checked="${state[o.key]}">
        <span class="toggle-track"><span class="toggle-thumb"></span></span>
        ${o.label}
      </button>`
  ).join("");

  delegate(containerEl, "click", ".toggle", (btn) => {
    const k = btn.dataset.key;
    state[k] = !state[k];
    save(state);
    apply();
    sync();
  });

  apply();
  sync();
}
