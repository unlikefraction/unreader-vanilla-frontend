/**
 * Storage management for drawing annotations
 */

export const defaultShapesData = {
  rectangle: [],
  ellipse: [],
  line: [],
  arrow: [],
  pencil: [],
  highlighter: [],
  text: []
};

/** Derive a namespace from the current page */
function detectStorageNamespace() {
  // normalize pathname (works for /, /index.html, /pricing.html, etc.)
  const path = (typeof window !== 'undefined' && window.location && window.location.pathname)
    ? window.location.pathname.toLowerCase()
    : 'index.html';

  // handle cases like "/" or "/index" or "/index.html"
  if (path === '/' || path.endsWith('/index') || path.endsWith('/index.html')) return 'landing';
  if (path.endsWith('/pricing') || path.endsWith('/pricing.html')) return 'pricing';

  // fallback: use last segment without extension
  const last = path.split('/').filter(Boolean).pop() || 'index.html';
  const base = last.split('?')[0].split('#')[0];
  const name = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base;
  return name || 'landing';
}

/** Compose the localStorage key for this page namespace */
function storageKey(namespace) {
  const ns = namespace || detectStorageNamespace();
  return `annotations:${ns}`;
}

/**
 * Persist shapesData under a page-specific key.
 * @param {object} shapesData
 * @param {string=} namespace optional explicit namespace ("landing" | "pricing" | custom)
 */
export function saveShapesData(shapesData, namespace) {
  try {
    localStorage.setItem(storageKey(namespace), JSON.stringify(shapesData));
  } catch (e) {
    console.warn('saveShapesData failed:', e);
  }
}

/**
 * Attempt one-time migration from legacy 'annotations' (global) to namespaced.
 * Only runs if namespaced key is empty and legacy key exists.
 */
function migrateLegacyIfNeeded(namespace) {
  try {
    const legacy = localStorage.getItem('annotations');
    const namespacedKey = storageKey(namespace);
    const already = localStorage.getItem(namespacedKey);

    if (legacy && !already) {
      localStorage.setItem(namespacedKey, legacy);
      // optional: keep legacy for other pages still on old code; comment next line if you prefer to remove
      // localStorage.removeItem('annotations');
      console.info(`Migrated legacy annotations -> ${namespacedKey}`);
    }
  } catch (e) {
    console.warn('Migration check failed:', e);
  }
}

/**
 * Load shapesData from localStorage for the current page.
 * Ensures all shape types exist.
 * @param {string=} namespace optional explicit namespace
 */
export function loadShapesData(namespace) {
  const key = storageKey(namespace);
  migrateLegacyIfNeeded(namespace);

  try {
    const saved = localStorage.getItem(key);
    if (saved) {
      const shapesData = JSON.parse(saved);
      return Object.assign({ ...defaultShapesData }, shapesData);
    }
  } catch (error) {
    console.warn(`Failed to load annotations from ${key}:`, error);
  }
  return { ...defaultShapesData };
}

/**
 * Clear all annotations (in-memory). You still need to save() after calling this.
 */
export function clearAllShapesData() {
  return { ...defaultShapesData };
}

/** Expose for external use if needed */
export function getCurrentAnnotationsKey(namespace) {
  return storageKey(namespace);
}
