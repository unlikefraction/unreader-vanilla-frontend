/**
 * Storage management for drawing annotations (book-scoped)
 */

/** Default shape data structure */
export const defaultShapesData = {
  rectangle: [],
  ellipse: [],
  line: [],
  arrow: [],
  pencil: [],
  highlighter: [],
  text: []
};

/** Derive the current book id from URL or an explicit override */
function detectBookId(explicitId) {
  if (explicitId) return String(explicitId);
  try {
    const u = new URL(window.location.href);
    const id = u.searchParams.get('id');
    return id ? String(id) : null;
  } catch {
    return null;
  }
}

/** Compose the localStorage key for a given book */
function storageKey(bookId) {
  const id = detectBookId(bookId);
  // Fallback to legacy key if no bookId found
  return id ? `annotations:book:${id}` : 'annotations';
}

/** Attempt one-time migration from legacy 'annotations' (global) to book-scoped key */
function migrateLegacyIfNeeded(bookId) {
  const id = detectBookId(bookId);
  if (!id) return; // nothing to migrate without a concrete id
  try {
    const legacy = localStorage.getItem('annotations');
    const namespacedKey = storageKey(id);
    const already = localStorage.getItem(namespacedKey);
    if (legacy && !already) {
      localStorage.setItem(namespacedKey, legacy);
      // optional: keep legacy for other pages still on old code
      // localStorage.removeItem('annotations');
      console.info(`Migrated legacy annotations -> ${namespacedKey}`);
    }
  } catch (e) {
    console.warn('Migration check failed:', e);
  }
}

/** Persist shapesData (book-scoped if id present) */
export function saveShapesData(shapesData, bookId) {
  try {
    localStorage.setItem(storageKey(bookId), JSON.stringify(shapesData));
  } catch (e) {
    // non-fatal
    console.warn('saveShapesData failed:', e);
  }
}

/** Load shapesData from localStorage (book-scoped if id present) */
export function loadShapesData(bookId) {
  const key = storageKey(bookId);
  migrateLegacyIfNeeded(bookId);
  try {
    const saved = localStorage.getItem(key);
    if (saved) {
      const shapesData = JSON.parse(saved);
      // Ensure all shape types exist in case new types were added
      return Object.assign({ ...defaultShapesData }, shapesData);
    }
  } catch (error) {
    console.warn(`Failed to load annotations from ${key}:`, error);
  }
  // Return default if no saved data or corrupted
  return { ...defaultShapesData };
}

/** Clear all annotations */
export function clearAllShapesData() {
  return { ...defaultShapesData };
}

/** Optional: expose current key for debugging */
export function getCurrentAnnotationsKey(bookId) {
  return storageKey(bookId);
}
