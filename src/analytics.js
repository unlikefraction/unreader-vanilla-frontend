import posthog from 'posthog-js'

// Central analytics bootstrap. Safe, additive, and page-agnostic.
// - Does not alter existing behavior; only adds passive listeners
// - Exposes window.Analytics with tiny helpers for future, granular events

const PH_PROJECT_KEY = 'phc_8CyOzFvrraB0asG5M4IPk7rFiSQ7k9EWPg0qazr6kzM'
const PH_API_HOST = 'https://cue.shubhastro2.workers.dev'

// Init PostHog
posthog.init(PH_PROJECT_KEY, {
  api_host: PH_API_HOST,
  person_profiles: 'always',
  capture_pageview: true,
  capture_pageleave: true,
  autocapture: true,
})

// ---- helpers ----
function now() { return Date.now() }
function getCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()\[\]\\/+^])/g, '\\$1') + '=([^;]*)'))
  return m ? decodeURIComponent(m[1]) : null
}
function onReady(fn) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true })
  else fn()
}

// ---- UTM + referral ----
function parseUtms() {
  const p = new URLSearchParams(location.search)
  const utm = {}
  for (const k of ['utm_source','utm_medium','utm_campaign','utm_term','utm_content']) {
    const v = p.get(k)
    if (v) utm[k] = v
  }
  return utm
}
function persistFirstTouch(params) {
  try {
    const key = 'ph_first_touch'
    const existing = JSON.parse(localStorage.getItem(key) || '{}')
    if (!existing.timestamp) {
      const first = {
        timestamp: now(),
        referrer: document.referrer || null,
        landing_path: location.pathname,
        utm: parseUtms(),
      }
      localStorage.setItem(key, JSON.stringify(first))
      return first
    }
    return existing
  } catch { return null }
}

// ---- Performance (basic web vitals) ----
function collectPerformance() {
  const nav = performance.getEntriesByType('navigation')[0]
  const fcp = performance.getEntriesByName('first-contentful-paint')[0]
  let lcp = 0
  let cls = 0

  try {
    const poL = new PerformanceObserver((list) => {
      const entries = list.getEntries()
      const last = entries[entries.length - 1]
      if (last && last.startTime) lcp = Math.max(lcp, last.startTime)
    })
    poL.observe({ type: 'largest-contentful-paint', buffered: true })
  } catch {}
  try {
    const poC = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (!e.hadRecentInput) cls += e.value || 0
      }
    })
    poC.observe({ type: 'layout-shift', buffered: true })
  } catch {}

  return () => {
    const out = {
      path: location.pathname,
      title: document.title,
      ttfb_ms: nav ? Math.round(nav.responseStart) : undefined,
      dom_content_loaded_ms: nav ? Math.round(nav.domContentLoadedEventEnd) : undefined,
      load_event_ms: nav ? Math.round(nav.loadEventEnd) : undefined,
      fcp_ms: fcp ? Math.round(fcp.startTime) : undefined,
      lcp_ms: lcp ? Math.round(lcp) : undefined,
      cls,
    }
    return out
  }
}

// ---- Active time + scroll depth ----
function setupEngagementMeters() {
  const startAt = now()
  let lastActiveAt = now()
  let activeSeconds = 0
  let tickTimer = null
  let maxScrollPct = 0
  let audioListeningSeconds = 0

  const activity = () => { lastActiveAt = now() }
  const onScroll = () => {
    // percent scrolled of the page
    const scrollTop = document.documentElement.scrollTop || document.body.scrollTop || 0
    const scrollHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.offsetHeight,
      document.documentElement.clientHeight
    )
    const winH = window.innerHeight || document.documentElement.clientHeight || 0
    const denom = Math.max(1, scrollHeight - winH)
    const pct = Math.max(0, Math.min(100, (scrollTop / denom) * 100))
    if (pct > maxScrollPct) maxScrollPct = pct
    activity()
  }

  const everySecond = () => {
    tickTimer = setInterval(() => {
      const vis = document.visibilityState === 'visible'
      const interactedRecently = (now() - lastActiveAt) <= 15000 // 15s window
      const audioActive = Boolean(window?.Analytics?.isAudioPlaying?.())
      if (vis && (interactedRecently || audioActive)) activeSeconds += 1
      if (audioActive) audioListeningSeconds += 1
    }, 1000)
  }

  const teardown = () => { try { clearInterval(tickTimer) } catch {} }

  // listeners (passive)
  window.addEventListener('mousemove', activity, { passive: true })
  window.addEventListener('keydown', activity)
  window.addEventListener('click', activity)
  window.addEventListener('touchstart', activity, { passive: true })
  window.addEventListener('scroll', onScroll, { passive: true })
  document.addEventListener('visibilitychange', activity)
  everySecond()

  const snapshot = () => ({
    started_at: startAt,
    duration_ms: now() - startAt,
    active_seconds: activeSeconds,
    audio_listen_seconds: audioListeningSeconds,
    max_scroll_pct: Math.round(maxScrollPct),
  })
  return { snapshot, teardown }
}

// ---- Identify (post-login, using email as distinct_id) ----
async function identifyOnAuthIfPossible() {
  try {
    const hasAuth = !!getCookie('authToken')
    if (!hasAuth) return

    // await API_URLS presence (apiUrls.js is loaded after analytics.js on pages)
    const waitForApi = async (tries = 20) => {
      for (let i = 0; i < tries; i++) {
        if (window.API_URLS?.USER) return window.API_URLS
        await new Promise(r => setTimeout(r, 100))
      }
      return null
    }
    const api = await waitForApi()
    if (!api?.USER) return

    const res = await fetch(`${api.USER}info/`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${getCookie('authToken')}`,
        'Accept': 'application/json'
      }
    })
    if (!res.ok) return
    const user = await res.json()

    const email = user?.email || user?.primary_email || null
    const name = user?.name || null
    const credits = typeof user?.credits === 'number' ? user.credits : undefined

    if (email) {
      posthog.identify(String(email), { email, name, credits })
      posthog.register({ user_email: email, user_name: name, user_credits: credits })
      posthog.capture('login_identified', {
        path: location.pathname,
        onboarding_cookie: (getCookie('onboardingComplete') || null),
      })
    }
  } catch {}
}

// ---- Bootstrap ----
;(function boot() {
  // First touch persistence
  const first = persistFirstTouch()

  // Register common context
  const tz = (Intl && Intl.DateTimeFormat && Intl.DateTimeFormat().resolvedOptions().timeZone) || null
  const nowDate = new Date()
  posthog.register({
    path: location.pathname,
    page_title: document.title,
    tz,
    hour_local: nowDate.getHours(),
    weekday_local: nowDate.toLocaleString(undefined, { weekday: 'short' }),
    referrer: document.referrer || null,
    ...parseUtms(),
    ...(first ? { first_touch_referrer: first.referrer, first_touch_path: first.landing_path } : {}),
  })

  // Engagement meters
  const perfSnap = collectPerformance()
  const meters = setupEngagementMeters()
  // Simple labeled page visits where useful
  try {
    if (location.pathname.endsWith('/home.html')) posthog.capture('home_visit')
    if (location.pathname.endsWith('/pricing.html')) posthog.capture('pricing_visit')
    if (location.pathname === '/' || location.pathname.endsWith('/index.html')) posthog.capture('landing_visit')
  } catch {}

  // On page hide/leave, send a compact summary event
  const flush = () => {
    try {
      const perf = perfSnap()
      const engagement = meters.snapshot()
      posthog.capture('page_session', { ...perf, ...engagement })
      // Reading session summary (readBook.html only)
      if (/\/readBook\.html$/.test(location.pathname) && window.__readingSession) {
        const s = window.__readingSession
        const pages = Array.from(s.pages || [])
        const durationMs = now() - (s.started_at || now())
        posthog.capture('reading_session_end', {
          session_id: s.id,
          duration_ms: durationMs,
          pages_read_count: pages.length,
          pages_read_list: pages,
          tool_counts: s.toolCounts || {},
        })
        try {
          localStorage.setItem('reading_last_active', String(now()))
          localStorage.setItem('reading_last_session_id', String(s.id || ''))
        } catch {}
      }
    } catch {}
  }
  window.addEventListener('pagehide', flush)
  window.addEventListener('beforeunload', flush)

  // Try identification once DOM is up (and when user cookie exists)
  onReady(() => { identifyOnAuthIfPossible() })
})();

// ---- Public, safe facade for future use ----
window.Analytics = Object.freeze({
  capture: (name, props = {}) => {
    try { posthog.capture(name, props) } catch {}
  },
  setProps: (props = {}) => {
    try { posthog.register(props) } catch {}
  },
  identify: (email, props = {}) => {
    try { if (email) posthog.identify(String(email), props) } catch {}
  },
  // External systems can toggle this to improve active-time fidelity
  // Implemented as a getter so callers can replace at runtime.
  isAudioPlaying: () => false,
})

// ---- Lightweight navigation click tracking (non-intrusive) ----
document.addEventListener('click', (e) => {
  try {
    const a = e.target?.closest?.('a[href]')
    if (!a) return
    const href = a.getAttribute('href') || ''
    const path = href.replace(location.origin, '')
    if (/pricing\.html(?:$|[?#])/.test(path) || path === '/pricing.html') {
      posthog.capture('nav_to_pricing', { from_path: location.pathname, link: href })
    }
    if (/login(?:Og)?\.html(?:$|[?#])/.test(path)) {
      posthog.capture('nav_to_login', { from_path: location.pathname, link: href })
    }
    if (/bookDetails\.html(?:$|[?#])/.test(path)) {
      posthog.capture('nav_to_book_details', { from_path: location.pathname, link: href })
    }
    if (/readBook\.html(?:$|[?#])/.test(path)) {
      posthog.capture('nav_to_read_book', { from_path: location.pathname, link: href })
    }
    if (/createBook\.html(?:$|[?#])/.test(path)) {
      posthog.capture('nav_to_create_book', { from_path: location.pathname, link: href })
    }
    if (/credits\.html(?:$|[?#])/.test(path)) {
      posthog.capture('nav_to_credits', { from_path: location.pathname, link: href })
    }
  } catch {}
}, { capture: true })

// ---- Canvas interactions (landing; books later) ----
window.addEventListener('drawing:start', () => {
  try { posthog.capture('canvas_draw_start', { path: location.pathname }) } catch {}
})
window.addEventListener('drawing:end', () => {
  try { posthog.capture('canvas_draw_end', { path: location.pathname }) } catch {}
})

document.addEventListener('click', (e) => {
  try {
    const tool = e.target?.closest?.('.w-control')
    if (!tool) return
    const toolName = ['cursor','highlighter','pencil','text','line','arrow','eraser','rectangle','circle'].find(c => tool.classList?.contains?.(c)) || 'unknown'
    posthog.capture('canvas_tool_select', { tool: toolName, path: location.pathname })
    // if on reading page, tally tool usage for session summary
    if (/\/readBook\.html$/.test(location.pathname)) {
      const s = window.__readingSession
      if (s) s.toolCounts[toolName] = (s.toolCounts[toolName] || 0) + 1
    }
  } catch {}
}, { capture: true })

// ---- Reading session (10 min inactivity == new) ----
;(function initReadingSession() {
  if (!/\/readBook\.html$/.test(location.pathname)) return
  const TEN_MIN = 10 * 60 * 1000
  let last = 0
  try { last = Number(localStorage.getItem('reading_last_active') || '0') || 0 } catch {}
  const isFresh = !last || (now() - last) > TEN_MIN
  const id = isFresh ? (Math.random().toString(36).slice(2) + Date.now().toString(36)) : (localStorage.getItem('reading_last_session_id') || (Math.random().toString(36).slice(2)))
  const sess = { id, started_at: now(), pages: new Set(), toolCounts: {} }
  window.__readingSession = sess
  try { posthog.capture('reading_session_start', { session_id: id }) } catch {}
  window.addEventListener('reader:active_page', (e) => {
    try {
      const pn = e?.detail?.page_number
      if (pn != null) sess.pages.add(Number(pn))
    } catch {}
  })
  // bump last active periodically while on page
  setInterval(() => { try { localStorage.setItem('reading_last_active', String(now())) } catch {} }, 30000)
})()
