// Small shared helpers.

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

export function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

// Delegated event listener: calls fn(matchedEl, event) when `type` fires on an
// element matching `selector` inside `root`. Survives re-renders of `root`'s
// children, and saves the repeated closest()/guard boilerplate.
export function delegate(root, type, selector, fn) {
  root.addEventListener(type, (e) => {
    const match = e.target.closest(selector);
    if (match && root.contains(match)) fn(match, e);
  });
}
