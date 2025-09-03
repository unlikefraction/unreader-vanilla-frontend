// -----scribbles-sync.js-----
// Handles syncing whiteboard scribbles to backend while keeping localStorage fast.

import { saveShapesData, loadShapesData, defaultShapesData } from './storage.js';

function getCookie(name) {
  const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[2]) : null;
}
function setCookie(name, value, { days = 365, path = '/' } = {}) {
  try {
    const maxAge = days ? days * 24 * 60 * 60 : undefined;
    const parts = [
      `${name}=${encodeURIComponent(String(value))}`,
      path ? `Path=${path}` : null,
      maxAge ? `Max-Age=${maxAge}` : null,
    ].filter(Boolean);
    document.cookie = parts.join('; ');
  } catch {}
}
function getBookIdFromUrl() {
  try { return new URL(window.location.href).searchParams.get('id'); } catch { return null; }
}
function cookieKeyForUpdatedAt(bookId) { return `scribbles_updated_at_${bookId}`; }
function getLocalUpdatedAt(bookId) { return bookId ? getCookie(cookieKeyForUpdatedAt(bookId)) : null; }
function setLocalUpdatedAt(bookId, iso) { if (bookId && iso) setCookie(cookieKeyForUpdatedAt(bookId), iso, { days: 365 }); }
function isNonEmptyObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0;
}
function withDefaults(shapes) {
  // Ensure all shape types exist
  try { return Object.assign({ ...defaultShapesData }, (shapes || {})); } catch { return { ...defaultShapesData }; }
}

async function fetchRemoteScribbles(userBookId) {
  const token = getCookie('authToken');
  if (!token) return null;
  const base = window.API_URLS?.BOOK;
  if (!base || !userBookId) return null;
  const url = `${base}scribbles/${encodeURIComponent(userBookId)}/`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const data = await res.json();
    const scribbles = (data && typeof data.scribbles === 'object') ? data.scribbles : null;
    const updatedAt = (data && typeof data.scribbles_updated_at === 'string') ? data.scribbles_updated_at : null;
    return { scribbles, updatedAt };
  } catch {
    return null;
  }
}

async function pushRemoteScribbles(userBookId, scribbles) {
  const token = getCookie('authToken');
  if (!token) return false;
  const base = window.API_URLS?.BOOK;
  if (!base || !userBookId) return false;
  const url = `${base}update/${encodeURIComponent(userBookId)}/`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ scribbles: (scribbles || {}) })
    });
    return res.ok;
  } catch {
    return false;
  }
}

function beaconPushScribbles(userBookId, scribbles) {
  try {
    const token = getCookie('authToken');
    const base = window.API_URLS?.BOOK;
    if (!navigator.sendBeacon || !token || !base || !userBookId) return false;
    const url = `${base}update/${encodeURIComponent(userBookId)}/`;
    const payload = JSON.stringify({ scribbles: (scribbles || {}) });
    const headers = { type: 'application/json' };
    // Some backends ignore auth headers with beacon; embed token as query if needed.
    // Prefer standard: use Beacon with Bearer via Keepalive fetch fallback if beacon not honored.
    // Here we try beacon without auth header; backend may read token from cookie as fallback.
    return navigator.sendBeacon(url, new Blob([payload], headers));
  } catch { return false; }
}

/**
 * Initialize backend syncing for scribbles.
 * - Loads local immediately.
 * - Fetches remote in background; if present and different, replaces local and calls setData.
 * - Debounces POST of entire scribbles object on each local save.
 *
 * @param {Object} opts
 * @param {() => Object} opts.getData - returns current shapes/scribbles object
 * @param {(data: Object) => void} opts.setData - replace local state with provided data
 * @param {number=} opts.debounceMs - debounce interval for push (default 1500ms)
 * @returns {{ schedulePush: () => void }}
 */
export function initScribblesSync({ getData, setData, debounceMs = 0 } = {}) {
  const userBookId = getBookIdFromUrl();
  let pendingTimer = null;
  let lastPushedJson = null;

  // Debug polling: fetch scribbles JSON every 5s and log
  try {
    const pollBase = window.API_URLS?.BOOK;
    const token = getCookie('authToken');
    if (pollBase && userBookId && token) {
      const pollUrl = `${pollBase}scribbles/${encodeURIComponent(userBookId)}/`;
      setInterval(async () => {
        try {
          const res = await fetch(pollUrl, { headers: { Authorization: `Bearer ${token}` } });
          if (!res.ok) { console.warn('[Scribbles poll] HTTP', res.status); return; }
          const json = await res.json();
          console.log('[Scribbles poll]', json);
        } catch (e) {
          console.warn('[Scribbles poll] error', e);
        }
      }, 5000);
    }
  } catch {}

  // Background: reconcile with remote once
  (async () => {
    const result = await fetchRemoteScribbles(userBookId);
    if (result && typeof result === 'object') {
      const { scribbles: remoteScribbles, updatedAt: remoteUpdatedAt } = result;
      const localUpdatedAt = getLocalUpdatedAt(userBookId);
      const tLocal = Date.parse(localUpdatedAt || '') || 0;
      const tRemote = Date.parse(remoteUpdatedAt || '') || 0;

      if (remoteScribbles && typeof remoteScribbles === 'object') {
        if (tRemote > tLocal) {
          // Server newer → adopt and set cookie
          const normalized = withDefaults(remoteScribbles);
          saveShapesData(normalized, userBookId);
          setLocalUpdatedAt(userBookId, remoteUpdatedAt);
          try { setData?.(normalized); } catch {}
        } else {
          // Local newer or equal → keep local; attempt to push to server
          try { schedulePush(); } catch {}
        }
      }
    }
  })();

  async function doPushNow() {
    const scribbles = withDefaults(getData?.() || {});
    const payloadJson = JSON.stringify(scribbles);
    if (payloadJson === lastPushedJson) return;
    const ok = await pushRemoteScribbles(userBookId, scribbles);
    if (ok) lastPushedJson = payloadJson;
  }

  function schedulePush() {
    // Immediate push when debounceMs <= 0
    try { setLocalUpdatedAt(userBookId, new Date().toISOString()); } catch {}
    if ((debounceMs | 0) <= 0) { doPushNow(); return; }
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => { pendingTimer = null; doPushNow(); }, Math.max(0, debounceMs | 0));
  }

  // Try to flush on page hide
  async function pushWithKeepalive() {
    try {
      const token = getCookie('authToken');
      const base = window.API_URLS?.BOOK;
      const id = getBookIdFromUrl();
      if (!token || !base || !id) return false;
      const url = `${base}update/${encodeURIComponent(id)}/`;
      const scribbles = withDefaults(getData?.() || {});
      const res = await fetch(url, {
        method: 'POST',
        keepalive: true,
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ scribbles })
      });
      return res.ok;
    } catch { return false; }
  }

  const onVisibility = () => { if (document.visibilityState === 'hidden') { pushWithKeepalive().then(ok => { if (!ok) schedulePush(); }); } };
  document.addEventListener('visibilitychange', onVisibility);

  // Also on unload (best-effort; may be skipped by browsers)
  window.addEventListener('beforeunload', () => { pushWithKeepalive(); });

  return { schedulePush };
}
