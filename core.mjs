/**
 * Ref transforms shared by the unified and Sätteri plugins.
 */

// Minimal HTML attribute escaping.
function escAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Split a `## Heading {ref-name}` suffix off a heading's last text value.
 * Returns { text, refName } or null when there is no suffix.
 */
export function splitHeadingRef(value) {
  const m = value.match(/\s*\{([^}]+)\}\s*$/);
  if (!m) return null;
  return { text: value.slice(0, m.index).trimEnd(), refName: m[1].trim() };
}

/** Invisible anchor inserted before a heading that declares a ref. */
export function anchorHtml(refName) {
  return `<span id="${escAttr(refName)}" data-astro-refs="${escAttr(refName)}" aria-hidden="true" class="astro-refs"></span>`;
}

/**
 * Resolve a `ref:name` link URL against the ref map. Returns the new URL, or
 * null for links that don't use the ref: scheme. Unknown refs are recorded in
 * `state.brokenRefs` and resolve to '#'.
 */
export function resolveRefUrl(state, url) {
  if (typeof url !== 'string' || !url.startsWith('ref:')) return null;
  const refName = url.slice(4);
  const entry = state.refMap?.get(refName);
  if (entry) return entry.url;
  state.brokenRefs.push(refName);
  return '#'; // safe fallback; astro-better-refs reports the broken ref
}
