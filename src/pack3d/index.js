// pack3d/index.js — the pack's front door.
//
// createPack({ mountEl, onOpen, onGrab }) tries the procedural 3D foil pack
// (view.js) and falls back to the flat SVG tear-pack (../pack.js) when WebGL is
// unavailable or the page asks for it (?pack=svg). Both expose the same host
// contract: reset, setArmed, setTell, and (3D only) setCards / getHandoffRect /
// getHandoffPose / present — the host guards the extras with optional chaining.

import { createPack3D } from "./view.js";

export async function createPackAuto(opts) {
  const q = new URLSearchParams(location.search);
  if (q.get("pack") !== "svg") {
    let pack = null;
    try {
      pack = createPack3D({ ...opts, debug: q.has("packdebug") });
      await pack.ready;
      return pack;
    } catch (err) {
      console.warn("[pack3d] falling back to the SVG pack:", err);
      try { pack?.dispose(); } catch { /* half-built */ }
      opts.mountEl.innerHTML = "";
    }
  }
  const { createPack } = await import("../pack.js");
  const pack = createPack(opts);
  pack.kind = "svg";
  return pack;
}

export { createPack3D };
