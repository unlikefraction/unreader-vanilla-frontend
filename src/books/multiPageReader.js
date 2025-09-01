import { AudioSystem } from './audioAndTextGen.js';
import { ReadAlong } from '../audio/read-along.js';

function slugify(s) {
  return String(s).toLowerCase()
    .replace(/^[a-z]+:\/\/+/, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '');
}
function cloneForCleanHandlers(el) { if (!el) return null; const clone = el.cloneNode(true); el.replaceWith(clone); return clone; }
function rIC(fn, timeout = 50) {
  const ric = window.requestIdleCallback || ((cb) => setTimeout(() => cb({ timeRemaining: () => 0, didTimeout: true }), timeout));
  return ric(fn, { timeout });
}
function getCookie(name) { const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)')); return m ? decodeURIComponent(m[2]) : null; }
function setCookie(name, value, days = 365) {
  const d = new Date(); d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${d.toUTCString()}; path=/; SameSite=Lax`;
}
function qs(name, url = window.location.href) { try { return new URL(url).searchParams.get(name); } catch { return null; } }

/* ---------- transcript normalizer ---------- */
function normalizeWordTimings(raw) {
  if (!raw) return [];
  const monologues = Array.isArray(raw) ? raw : (raw.monologues || []);
  const out = [];
  for (const m of monologues) {
    const elems = m?.elements || [];
    for (const el of elems) {
      if (el?.type !== 'text') continue;
      const word = String(el.value ?? '').trim(); if (!word) continue;
      const start = typeof el.ts === 'number' ? el.ts : typeof el.start_ts === 'number' ? el.start_ts : typeof el.time_start === 'number' ? el.time_start : undefined;
      const end   = typeof el.end_ts === 'number' ? el.end_ts : typeof el.time_end === 'number' ? el.time_end : undefined;
      if (typeof start !== 'number' || typeof end !== 'number') continue;
      out.push({ word, time_start: start, time_end: end });
    }
  }
  out.sort((a, b) => a.time_start - b.time_start);
  return out;
}
async function tryApplyTimings(sys, words) {
  const tp = sys?.textProcessor;
  if (!tp || !Array.isArray(words) || !words.length) return false;
  try {
    if (typeof tp.ingestWordTimingsFromBackend === 'function') { await tp.ingestWordTimingsFromBackend(words); return true; }
    if (typeof tp.ingestWordTimings === 'function') { await tp.ingestWordTimings(words); return true; }
    if (typeof tp.setWordTimings === 'function') { tp.setWordTimings(words); return true; }
    tp.wordTimings = words; tp._wordTimings = words; sys.refreshParagraphNavigation?.(); return true;
  } catch { return false; }
}

export default class MultiPageReader {
  /**
   * pages: [{ page_number, textBlobUrl, pageKey?, audioFile, timingFile, offsetMs?, is_read?, _html? }]
   */
  constructor(pages, {
    autoPlayFirst = false,
    initialActiveIndex = 0,
    lazyHydration = true,
    prefetchRadius = 1,
    observeRadius = 0.75,
    userBookId = null,
    allowWordHighlighting = true,
    callbacks = {}
  } = {}) {
    this.pageMeta = pages.slice();
    this.pageMeta.forEach(m => { m._readyAudioUrl = null; m._audioSettled = false; m._polling = false; m._readyTranscript = null; m._readyTranscriptFlat = null; m._html = null; });
    this.instances = new Array(pages.length).fill(null);
    this.active = -1;
    this.autoPlayFirst = autoPlayFirst;
    this.lazyHydration = !!lazyHydration;
    this.prefetchRadius = Math.max(0, prefetchRadius | 0);
    this.observeRadius = Math.max(0, Math.min(1, observeRadius ?? 0.75));
    this._controlsBound = false;
    this._paragraphClicksBound = false;
    this._onEndHandlers = new WeakMap();
    this._io = null;
    this._container = null;
    this._initialActiveIndex = Math.max(0, Math.min(initialActiveIndex, pages.length - 1));
    this._progressTimer = null;
    this._isLoadingActiveAudio = false;
    this._autoplayOnReady = false;

    // scroll-to-playhead UI
    this._scrollToPlayheadBtn = null;
    this._scrollWatchBound = false;

    this.userBookId = userBookId ?? qs('id');
    this.audioApiBase = window.API_URLS?.AUDIO || '';
    this.allowWordHighlighting = !!allowWordHighlighting;

    this._cb = {
      onActivePageChanged: typeof callbacks.onActivePageChanged === 'function' ? callbacks.onActivePageChanged : null,
      onDestroyed: typeof callbacks.onDestroyed === 'function' ? callbacks.onDestroyed : null
    };
  }

  /* ---------- cookies ---------- */
  _cookieKey() { const id = this.userBookId || 'book'; return `mpr_last_played_${id}`; }
  _saveLastPlayedCookie(pageIndex, seconds) {
    if (pageIndex < 0 || pageIndex >= this.pageMeta.length) return;
    const pn = this.pageMeta[pageIndex]?.page_number ?? pageIndex;
    const payload = { page_number: pn, seconds: Math.max(0, Number(seconds) || 0), at: Date.now() };
    setCookie(this._cookieKey(), JSON.stringify(payload), 365);
  }
  _readLastPlayedCookie() { const raw = getCookie(this._cookieKey()); if (!raw) return null; try { return JSON.parse(raw); } catch { return null; } }
  _mapPageNumberToIndex(pn) { const idx = this.pageMeta.findIndex(p => p.page_number === pn); return idx === -1 ? 0 : idx; }
  _stopProgressTimer() { if (this._progressTimer) { clearInterval(this._progressTimer); this._progressTimer = null; } }
  _startProgressTimer() {
    this._stopProgressTimer();
    this._progressTimer = setInterval(() => {
      if (this.active < 0) return;
      const t = this.getCurrentTime();
      this._saveLastPlayedCookie(this.active, t);
    }, 2000);
  }

  /* ---------- transport UI ---------- */
  _transportRoot() {
    return (
      document.querySelector('.bottomTransport') ||
      document.querySelector('footer .transport') ||
      document.querySelector('.playBack') ||
      document.querySelector('.player') ||
      null
    );
  }
  _updateTransportMeta({ playing = false, loading = false, pageIndex = this.active, paragraphText = null } = {}) {
    const root = this._transportRoot();
    if (root) {
      root.classList.remove('is-loading');
      root.classList.toggle('is-playing', !!playing);
      root.classList.toggle('is-paused', !playing);
      const pageNo = this.pageMeta[pageIndex]?.page_number;
      root.setAttribute('data-active-page', pageNo ?? '');
      if (paragraphText) root.setAttribute('data-active-paragraph', paragraphText);
      const pageEl = root.querySelector('[data-transport="page"]'); if (pageEl && pageNo) pageEl.textContent = `Page ${pageNo}`;
      const paraEl = root.querySelector('[data-transport="paragraph"]'); if (paraEl) paraEl.textContent = paragraphText || '';
    }
    const playButton = document.querySelector('.playButton');
    const icon = playButton?.querySelector('i');
    if (playButton) {
      playButton.classList.remove('loading');
      playButton.classList.toggle('playing', !!playing);
      playButton.classList.toggle('paused', !playing);
    }
    if (icon) icon.className = playing ? 'ph ph-pause' : 'ph ph-play';
  }
  _syncPlayButton(forcePlaying, { loading = false, paragraphText = null } = {}) {
    const playing = (typeof forcePlaying === 'boolean'
          ? forcePlaying
          : (this.active >= 0 && !!this.instances[this.active]?.audioCore?.isPlaying));
    this._updateTransportMeta({ playing, loading, pageIndex: this.active, paragraphText });
  }

  _scrollActivePageIntoView(center = true) {
    const el = this.#pageEl(this.active); if (!el) return;
    try {
      el.scrollIntoView({ behavior: 'auto', block: center ? 'center' : 'nearest', inline: 'nearest' });
    } catch {
      const y = el.getBoundingClientRect().top + window.scrollY;
      const mid = y - (window.innerHeight / 2) + (el.offsetHeight / 2);
      window.scrollTo(0, Math.max(0, mid));
    }
  }

  /* ---------- header helpers ---------- */
  _ensureGlobalOverlayPageDetails() {
    if (document.querySelector('.pageDetails[data-overlay="1"]')) return;
    const container = document.createElement('p');
    container.className = 'pageDetails';
    container.setAttribute('data-overlay', '1');
    container.classList.add("pageDetailsBottomRight")
    container.innerHTML = `Page <span class="currentPage">1</span> of <span class="totalPage">1</span>`;
    document.body.appendChild(container);
  }

  /** Floating notice shown while audio is generating/queued */
  _ensureGeneratingNotice() {
    if (this._genNotice) return this._genNotice;
    const el = document.createElement('div');
    el.className = 'audioGeneratingNotice';
    Object.assign(el.style, {
      position: 'fixed',
      left: '50%',
      bottom: '140px',
      zIndex: '9999',
      padding: '10px 12px',
      borderRadius: '20px',
      border: '1px solid rgba(54, 54, 54, 0.36)',
      background: 'rgba(255, 255, 255, 0.5)',
      color: '#121212',
      fontWeight: '500',
      fontSize: '16px',
      boxShadow: '0px 4px 10px rgba(0, 0, 0, 0.2)',
      backdropFilter: 'blur(5px)',
      WebkitBackdropFilter: 'blur(5px)',
      display: 'none',
      textAlign: 'center',
      transform: 'translateX(-50%)'
    });
    el.textContent = '';
    document.body.appendChild(el);
    this._genNotice = el;
    return el;
  }
  _positionGeneratingNotice() {
    const el = this._genNotice || null;
    if (!el) return;
    // Keep a consistent base position for the notice
    const bottomPx = 100;
    el.style.bottom = bottomPx + 'px';
  }
  _showGeneratingNotice(pageNumber) {
    const el = this._ensureGeneratingNotice();
    el.textContent = `Generating audio for page ${pageNumber}. can take upto 5mins. will auto-play`;
    this._positionGeneratingNotice();
    // Ensure the scroll-to-playhead button sits above the notice when both visible
    this._positionScrollToPlayhead();
    el.style.display = 'inline-flex';
  }
  _hideGeneratingNotice() {
    const el = this._ensureGeneratingNotice();
    el.style.display = 'none';
    // Reposition scroll button back to default
    this._positionScrollToPlayhead();
  }

  _buildPerPageHeader(meta, pageIndex, pageId) {
    const header = document.createElement('div');
    header.className = 'pageDetails pageHeader';
    header.id = `pageHeader-${pageId}`;
    header.innerHTML = `
      <p class="regenerateAudio" role="button" tabindex="0" title="Queue a high-priority audio regeneration">regenerate page’s audio</p>
      <p class="pageNumber">
        <button class="mobilePlayFromStart" type="button" aria-label="Play page from start" title="Play from start">
          <i class="ph ph-play"></i>
        </button>
        <span>Page ${meta.page_number}</span>
      </p>
    `;
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      margin: '8px 0'
    });
    const regen = header.querySelector('.regenerateAudio');
    Object.assign(regen.style, { cursor: 'pointer', textDecoration: 'underline' });

    const onTrigger = (e) => {
      e.preventDefault();
      this._regeneratePageAudio(pageIndex).catch(err => console.warn('regenerate error', err));
    };
    regen.addEventListener('click', onTrigger);
    regen.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') onTrigger(e); });

    // Play-from-start (mobile-first)
    const mobilePlayBtn = header.querySelector('.mobilePlayFromStart');
    if (mobilePlayBtn) {
      Object.assign(mobilePlayBtn.style, { cursor: 'pointer' });
      mobilePlayBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
          // Do NOT scroll or paragraph-match; just ensure this page is active, then play from 0
          if (this.active !== pageIndex) this.setActive(pageIndex);

          // Make sure audio is ready for this page, without moving the viewport
          const url = await this._awaitReadyAudioAndTranscript(pageIndex, { pollGeneratingMs: 5000, pollQueuedMs: 5000, showNotice: true });
          if (url) this._swapAudioUrl(pageIndex, url);
          await this.ensureAudioReady(pageIndex);

          this.seek(0);
          await this.play();
        } catch {}
      });
    }

    return header;
  }

  async _regeneratePageAudio(pageIndex) {
    const meta = this.pageMeta[pageIndex]; if (!meta) return;
    const token = getCookie('authToken');
    const pageId = slugify(meta.pageKey || `page-${meta.page_number}-${pageIndex}`);
    const header = document.getElementById(`pageHeader-${pageId}`);
    const regenEl = header?.querySelector?.('.regenerateAudio');

    const url = `${this.audioApiBase}regenerate/book/${encodeURIComponent(this.userBookId)}/page/${encodeURIComponent(meta.page_number)}/`;
    try { if (window.Analytics) window.Analytics.capture('reader_audio_regenerate', { page_number: meta.page_number, book_id: this.userBookId }); } catch {}

    // optimistic UI
    if (regenEl) {
      regenEl.textContent = 'Regenerating audio';
      regenEl.classList.add('regenerating');
      regenEl.style.pointerEvents = 'none';
      regenEl.style.opacity = '0.7';
    }

    let res, json = null;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 402) {
        handle402AndRedirect();
        return; // bail out of regeneration flow
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      json = await res.json().catch(() => ({}));
    } catch (e) {
      if (regenEl) {
        regenEl.textContent = 'Another Regeneration in Progress (Try Again)';
        regenEl.classList.remove('regenerating');
        regenEl.style.pointerEvents = 'auto';
        regenEl.style.opacity = '1';
      }
      return;
    }

    // Start one immediate fetch, then poll every 5s until audio_url changes
    const getPageUrl = `${this.audioApiBase}book/${encodeURIComponent(this.userBookId)}/page/${encodeURIComponent(meta.page_number)}/`;
    const fetchStatus = async () => {
      const r = await fetch(getPageUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (r.status === 402) {
        handle402AndRedirect();
        throw new Error('Payment Required (402)');
      }
      if (!r.ok) throw new Error(`Audio API ${r.status}`);
      return r.json();

    };

    let firstAudioUrl = null;
    try {
      const first = await fetchStatus();
      firstAudioUrl = first?.audio_url || null;
    } catch {}

    const checkChanged = async () => {
      try {
        const data = await fetchStatus();
        const currUrl = data?.audio_url || null;
        if (firstAudioUrl && currUrl && currUrl !== firstAudioUrl) {
          // Done: swap audio, clear regenerating state, and play from start
          meta._audioSettled = true;
          meta._readyAudioUrl = currUrl;
          const transcript = data?.time_aligned_transcript ?? null;
          meta._readyTranscript = transcript;
          meta._readyTranscriptFlat = normalizeWordTimings(transcript || []);
          this._swapAudioUrl(pageIndex, currUrl);

          if (regenEl) {
            regenEl.textContent = 'regenerate page’s audio';
            regenEl.classList.remove('regenerating');
            regenEl.style.pointerEvents = 'auto';
            regenEl.style.opacity = '1';
          }

          // If this is the active page, start from the beginning
          if (pageIndex === this.active) {
            try {
              this.seek(0);
              await this.play();
            } catch {}
          }
          return true;
        }
      } catch (e) {
        // ignore and keep polling
      }
      return false;
    };

    // Poll every 5 seconds until changed
    const poll = setInterval(async () => {
      const changed = await checkChanged();
      if (changed) clearInterval(poll);
    }, 5000);
  }

  /* ---------- scaffolding ---------- */
  async _buildScaffolding() {
    this._ensureGlobalOverlayPageDetails();

    let main = document.querySelector('.mainContainer');
    if (!main) { main = document.createElement('div'); main.className = 'mainContainer'; document.body.appendChild(main); }
    this._container = main;

    // Ensure "scroll to playhead" button exists
    this._ensureScrollToPlayhead();

    for (let i = 0; i < this.pageMeta.length; i++) {
      const meta = this.pageMeta[i];
      const pageId = slugify(meta.pageKey || `page-${meta.page_number}-${i}`);

      // page wrapper
      const wrapper = document.createElement('div');
      wrapper.className = 'pageWrapper';
      wrapper.id = `pageWrapper-${pageId}`;

      // per-page header
      const header = this._buildPerPageHeader(meta, i, pageId);
      wrapper.appendChild(header);

      // main content host
      const p = document.createElement('div');
      p.className = 'mainContent pageRemaining';
      p.dataset.pageId = pageId;
      p.id = `mainContent-${pageId}`;
      p.style.cursor = 'text';

      const html = await (await fetch(meta.textBlobUrl)).text();
      meta._html = html;
      p.innerHTML = html;

      wrapper.appendChild(p);

      if (i > 0) this._container.appendChild(document.createElement('hr'));
      this._container.appendChild(wrapper);
    }
  }

  async hydratePage(i) {
    if (i < 0 || i >= this.pageMeta.length) return null;
    if (this.instances[i]) return this.instances[i];

    const meta = this.pageMeta[i];
    const sys = new AudioSystem(
      meta.audioFile,
      meta.timingFile,
      meta.textBlobUrl,
      meta.offsetMs ?? 0,
      { disableWordHighlighting: !this.allowWordHighlighting }
    );
    sys.textProcessor.pageId = slugify(meta.pageKey || `page-${meta.page_number}-${i}`);

    // keep the call name the same; TextProcessor.separateText() now preserves markup internally
    await sys.textProcessor.separateText();
    sys.paragraphSeeker.enableParagraphNavigation();

    // hook end-of-page → next
    const onEnd = () => this.next(true);
    sys.audioCore.onEnd(onEnd);
    this._onEndHandlers.set(sys, onEnd);

    // prefer backend timings if we already have them
    const originalLoad = sys.textProcessor.loadWordTimings?.bind(sys.textProcessor);
    sys.textProcessor.loadWordTimings = async () => {
      const words = this.pageMeta[i]._readyTranscriptFlat;
      if (Array.isArray(words) && words.length) {
        const ok = await tryApplyTimings(sys, words);
        if (ok) return true;
      }
      if (typeof originalLoad === 'function') return originalLoad();
      return false;
    };

    // Ensure the singleton exists but DO NOT bind here (hydration can be for prefetch pages)
    ReadAlong.get();

    // Patch highlighter.highlightWord to notify ReadAlong with a concrete element
    try {
      const hl = sys.highlighter;
      if (hl && typeof hl.highlightWord === 'function' && !hl._raPatched) {
        const _orig = hl.highlightWord.bind(hl);
        hl.highlightWord = (...args) => {
          const r = _orig(...args);
          try {
            const el =
              hl.currentWordEl ||
              hl.currentHighlightedWord ||
              (typeof hl.getCurrentWordEl === 'function' ? hl.getCurrentWordEl() : null);
            ReadAlong.get().onWordHighlighted(el || null);
          } catch {
            // swallow; ReadAlong is hardened against nulls anyway
          }
          return r;
        };
        hl._raPatched = true;
      }
    } catch (e) { console.warn('ReadAlong notify patch failed:', e); }

    this.instances[i] = sys;
    return sys;
  }

  async ensureAudioReady(i) {
    const sys = await this.hydratePage(i);
    if (!sys) return null;
    if (!sys.audioCore.sound) {
      await sys.textProcessor.loadWordTimings();
      sys.audioCore.setupAudio();
      sys.refreshParagraphNavigation?.();
    }
    return sys;
  }

  async _prefetchAround(i) {
    const tasks = [];
    for (let k = Math.max(0, i - this.prefetchRadius); k <= Math.min(this.pageMeta.length - 1, i + this.prefetchRadius); k++) {
      if (k === i) continue;
      tasks.push((async () => { await this.hydratePage(k); await rIC(() => {}); })());
    }
    await Promise.all(tasks);
  }

  _setupIntersectionHydrator() {
    if (!this.lazyHydration) return;
    if (this._io) this._io.disconnect();
    const rootMargin = `${Math.round(this.observeRadius * 100)}% 0%`;
    this._io = new IntersectionObserver(async entries => {
      for (const e of entries) {
        if (e.isIntersecting) {
          const el = e.target;
          const all = [...this._container.querySelectorAll('.mainContent')];
          const i = all.indexOf(el);
          if (i >= 0 && !this.instances[i]) await this.hydratePage(i);
        }
      }
    }, { root: null, rootMargin, threshold: 0.01 });
    this._container.querySelectorAll('.mainContent').forEach(p => this._io.observe(p));
  }

  async init() {
    // 1) Build UI scaffolding (this only fetches textBlobUrl for each page)
    await this._buildScaffolding();
  
    // 2) Restore last position (cookie) and set active page — but do NOT touch audio
    const saved = this._readLastPlayedCookie();
    let pageIndex, seconds;
    if (saved && typeof saved.page_number !== 'undefined') {
      pageIndex = this._mapPageNumberToIndex(saved.page_number);
      seconds = Math.max(0, Number(saved.seconds) || 0);
    } else {
      pageIndex = this._initialActiveIndex;
      seconds = 0;
      this._saveLastPlayedCookie(pageIndex, 0);
    }
  
    this.setActive(pageIndex);
  
    // Keep the initial page load scroll; no playback yet
    this._scrollActivePageIntoView(true);
  
    // 3) Absolutely NO audio polling / setup here.
    //    - no _awaitReadyAudioAndTranscript
    //    - no ensureAudioReady
    //    - no _prefetchNextAudio
    //    - no seek() (it would be a no-op, but let’s avoid touching audioCore entirely)
  
    // Make sure transport shows paused/idle
    this._stopProgressTimer();
    this._syncPlayButton(false);
  
    // 4) Prefetch/hydrate around the active page ONLY for text/structure (no audio).
    //    hydratePage() sets up processors but does not fetch audio unless ensureAudioReady/play is called.
    await this._prefetchAround(pageIndex);
  
    // 5) Wire up controls and observers (safe; no audio calls)
    this._setupGlobalControls();
    this._setupGlobalParagraphClickDelegation();
    this._setupIntersectionHydrator();
  
    // 6) Scroll-to-playhead button visibility tracking
    this._bindScrollWatcher();
    this._updateScrollToPlayheadVisibility();
  
    // NOTE:
    // Audio (and any holdup notifications) only kick in when the user triggers:
    // - play()
    // - next(true)/prev()/goto(..., {play: true})
    // - jumpToParagraph(..., {play: true})
  }  

  #pageEl(i) { return this._container?.querySelectorAll('.mainContent')[i] || null; }
  #applyPageStateClasses(activeIndex) {
    const N = this.pageMeta.length;
    for (let i = 0; i < N; i++) {
      const el = this.#pageEl(i); if (!el) continue;
      el.classList.remove('pageCompleted', 'pageRemaining', 'pageActive');
      if (i < activeIndex) el.classList.add('pageCompleted');
      else if (i > activeIndex) el.classList.add('pageRemaining');
      else el.classList.add('pageActive');
    }
  }
  _emitActiveChanged(i) { if (this._cb.onActivePageChanged) { try { this._cb.onActivePageChanged(i, this.pageMeta[i]); } catch (e) { console.warn(e); } } }

  setActive(i) {
    if (i < 0 || i >= this.pageMeta.length) return;
    const prev = this.active;
    for (let k = 0; k < this.instances.length; k++) {
      const sys = this.instances[k];
      if (sys && k !== i) { sys.highlighter?.stopHighlighting?.(); sys.audioCore?.pauseAudio?.(); }
    }
    this.active = i;
    this.#applyPageStateClasses(i);
    // DO NOT force paused UI here — let play()/pause() own the state.

    // Bind ReadAlong to the active page’s highlighter
    (async () => {
      const sys = this.instances[i] || await this.hydratePage(i);
      try { ReadAlong.get().rebindHighlighter(sys.highlighter); } catch (e) { console.warn(e); }
    })();

    // Refresh scroll-to-playhead visibility on active change
    this._updateScrollToPlayheadVisibility();

    if (prev !== i) {
      this._emitActiveChanged(i);
      try {
        const meta = this.pageMeta[i] || {};
        const pn = meta.page_number ?? i;
        window.dispatchEvent(new CustomEvent('reader:active_page', { detail: { index: i, page_number: pn } }));
      } catch {}
    }
  }

  getActive() { return this.active; }

  /* ---------- helper: toggle spinner on paragraph chips ---------- */
  _setParagraphChipLoading(pageIndex, paragraphText, isLoading) {
    const meta = this.pageMeta[pageIndex]; if (!meta) return;
    const pageId = slugify(meta.pageKey || `page-${meta.page_number}-${pageIndex}`);
    const pageEl = document.getElementById(`mainContent-${pageId}`);
    if (!pageEl) return;
    const chips = pageEl.querySelectorAll('.paragraph-hover-nav');
    chips.forEach(chip => {
      if (paragraphText && chip.dataset.paragraphText !== paragraphText) return;
      chip.classList.toggle('loading', !!isLoading);
      const icon = chip.querySelector('i');
      if (icon) icon.className = isLoading ? 'ph ph-spinner' : 'ph ph-play';
    });
  }

  /* ---------- AUDIO API polling / swap ---------- */
  async _awaitReadyAudioAndTranscript(i, { pollGeneratingMs = 5000, pollQueuedMs = 5000, showNotice = false } = {}) {
    const meta = this.pageMeta[i];
    if (!meta) return null;
    if (!this.audioApiBase || !this.userBookId) { console.warn('⚠️ Missing audio API base or userBookId.'); return null; }
    if (meta._audioSettled && meta._readyAudioUrl) return meta._readyAudioUrl;
    if (meta._polling) return null;
    meta._polling = true;

    const token = getCookie('authToken');
    const url = `${this.audioApiBase}book/${encodeURIComponent(this.userBookId)}/page/${encodeURIComponent(meta.page_number)}/`;

    const fetchOnce = async () => {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 402) {
        handle402AndRedirect();
        throw new Error('Payment Required (402)'); // stop further logic/polling
      }
      if (!res.ok) throw new Error(`Audio API ${res.status}`);
      return res.json();
    };    

    let noticeShown = false;
    try {
      while (true) {
        const data = await fetchOnce();
        const status = data?.status;
        if (status === 'ready') {
          const audioUrl = data?.audio_url;
          const transcript = data?.time_aligned_transcript ?? null;
          if (audioUrl && transcript) {
            meta._readyAudioUrl = audioUrl;
            meta._readyTranscript = transcript;
            meta._readyTranscriptFlat = normalizeWordTimings(transcript);
            meta._audioSettled = true;
            if (noticeShown) this._hideGeneratingNotice();
            return audioUrl;
          }
          await new Promise(r => setTimeout(r, pollGeneratingMs));
          continue;
        }
        if (status === 'generating' || status === 'queued') {
          if (showNotice && i === this.active) {
            const pageNo = this.pageMeta[i]?.page_number ?? (i + 1);
            this._showGeneratingNotice(pageNo);
            noticeShown = true;
          }
          await new Promise(r => setTimeout(r, status === 'generating' ? pollGeneratingMs : pollQueuedMs));
          continue;
        }
        await new Promise(r => setTimeout(r, pollGeneratingMs));
      }
    } catch (e) {
      console.error(`❌ [page ${meta.page_number}] audio polling failed:`, e);
      return null;
    } finally {
      meta._polling = false;
      if (noticeShown) this._hideGeneratingNotice();
    }
  }

  _swapAudioUrl(i, audioUrl) {
    const sys = this.instances[i];
    if (!sys || !audioUrl) return;
    try {
      const wasPlaying = !!sys.audioCore?.isPlaying;
      const pos = typeof sys.audioCore?.getCurrentTime === 'function' ? sys.audioCore.getCurrentTime() : 0;
      sys.audioCore.pauseAudio();
      if (sys.audioCore.sound) { try { sys.audioCore.sound.unload(); } catch {} sys.audioCore.sound = null; }
      sys.audioCore.audioFile = audioUrl;
      sys.audioCore.setupAudio();
      if (pos && typeof sys.audioCore?.sound?.seek === 'function') sys.audioCore.sound.seek(pos);
      if (wasPlaying) sys.audioCore.playAudio();
    } catch (e) { console.error('audio swap error:', e); }
  }

  /* ---------- NEW: Next-page audio prefetch ---------- */
  async _prefetchNextAudio(i) {
    const next = i + 1;
    if (next >= this.pageMeta.length) return;

    const metaNext = this.pageMeta[next];
    if (metaNext?._audioSettled && metaNext?._readyAudioUrl) return; // already ready

    try { await this.hydratePage(next); } catch {}

    // Fire-and-forget polling for next page
    (async () => {
      try {
        const url = await this._awaitReadyAudioAndTranscript(next, { pollGeneratingMs: 5000, pollQueuedMs: 5000 });
        if (!url) return;
        const sysNext = this.instances[next];
        if (sysNext) {
          this._swapAudioUrl(next, url);
          await this.ensureAudioReady(next);
        }
      } catch (e) {
        console.warn('next-page prefetch failed:', e);
      }
    })();
  }

  /* ---------- transport ---------- */
  async play() {
    if (this.active < 0) return;

    try {
      const sys = this.instances[this.active] || await this.hydratePage(this.active);
      ReadAlong.get().rebindHighlighter(sys.highlighter);
    } catch {}

    const meta = this.pageMeta[this.active];
    if (!meta?._audioSettled) { this._isLoadingActiveAudio = true; this._autoplayOnReady = true; this._syncPlayButton(true, { loading: true }); }
    const url = await this._awaitReadyAudioAndTranscript(this.active, { pollGeneratingMs: 5000, pollQueuedMs: 5000, showNotice: true });
    if (url) this._swapAudioUrl(this.active, url);

    const sys = await this.ensureAudioReady(this.active);
    const flat = this.pageMeta[this.active]?._readyTranscriptFlat;
    if (Array.isArray(flat) && flat.length) await tryApplyTimings(sys, flat);

    for (let k = 0; k < this.instances.length; k++) { if (k !== this.active) this.instances[k]?.audioCore?.pauseAudio?.(); }
    await sys.play();
    this._isLoadingActiveAudio = false; this._autoplayOnReady = false; this._syncPlayButton(true);
    this._startProgressTimer();
    this._saveLastPlayedCookie(this.active, this.getCurrentTime());

    try { window.app?.holdup?.noteLocalAudioActivity?.(true); } catch {}

    // NEW: warm next after we start playing current
    this._prefetchNextAudio(this.active);
  }

  pause() {
    if (this.active < 0) return;
    // If we're auto-advancing/loading, don't flip the UI to paused.
    const suppressUI = this._autoplayOnReady || this._isLoadingActiveAudio;

    this.instances[this.active]?.pause?.();

    // Now reset the flags
    this._isLoadingActiveAudio = false;
    this._autoplayOnReady = false;

    if (!suppressUI) {
      this._syncPlayButton(false);
    }
    this._stopProgressTimer();
    this._saveLastPlayedCookie(this.active, this.getCurrentTime());
    try { window.app?.holdup?.noteLocalAudioActivity?.(false); } catch {}
  }

  async toggle() {
    if (this.active < 0) return;
    const sys = this.instances[this.active] || await this.hydratePage(this.active);
    const isPlaying = !!sys?.audioCore?.isPlaying || this._isLoadingActiveAudio;
    if (isPlaying) return this.pause();
    return this.play();
  }

  forward(seconds = 10) { if (this.active < 0) return; const s = this.getCurrentTime(); this.seek(s + seconds); this._saveLastPlayedCookie(this.active, this.getCurrentTime()); }
  rewind(seconds = 10)  { if (this.active < 0) return; const s = this.getCurrentTime(); this.seek(Math.max(0, s - seconds)); this._saveLastPlayedCookie(this.active, this.getCurrentTime()); }

  seek(seconds) {
    if (this.active < 0) return;
    const sys = this.instances[this.active]; if (!sys) return;
    sys.audioCore.sound?.seek(seconds);
    if (this.allowWordHighlighting) {
      sys.highlighter?.handleSeek?.(seconds);
    } else {
      // Non-English mode: keep the entire page highlighted on seek/forward/rewind
      try {
        const spans = Array.isArray(sys.textProcessor?.wordSpans) ? sys.textProcessor.wordSpans : [];
        for (const el of spans) { try { el.classList.add('highlight'); } catch {} }
      } catch {}
    }
  }
  setSpeed(speed) { if (this.active < 0) return; this.instances[this.active]?.setSpeed?.(speed); }
  getCurrentTime() { return this.active < 0 ? 0 : (this.instances[this.active]?.getCurrentTime?.() || 0); }
  getDuration()    { return this.active < 0 ? 0 : (this.instances[this.active]?.getDuration?.() || 0); }

  /* ---------- paging ---------- */
  async next(auto = false) {
    if (this.active >= this.pageMeta.length - 1) {
      const sys = this.instances[this.active];
      if (sys) { sys.highlighter?.handleAudioEnd?.(sys.getDuration()); this.#pageEl(this.active)?.classList.add('pageCompleted'); }
      // Don't force paused UI here.
      this._stopProgressTimer();
      this._saveLastPlayedCookie(this.active, this.getCurrentTime());
      return;
    }

    const target = this.active + 1;

    // MARK INTENT FIRST so any pauses during page switch don't flip the UI
    this._isLoadingActiveAudio = true;
    this._autoplayOnReady = !!auto;
    this._syncPlayButton(true, { loading: true });

    this.setActive(target);
    this._stopProgressTimer();

    const url = await this._awaitReadyAudioAndTranscript(target, { pollGeneratingMs: 5000, pollQueuedMs: 5000, showNotice: true });
    if (url) this._swapAudioUrl(target, url);

    await this.ensureAudioReady(target);

    // NEW: prefetch the page after the target as well
    this._prefetchNextAudio(target);

    if (auto) {
      // Start playback first so the highlighter paints a current word
      await this.play();

      // Try to snap to the playhead line only; if there's no word yet, do nothing (no random scroll)
      requestAnimationFrame(() => {
        try {
          const ra = ReadAlong.get();
          if (ra && typeof ra.snapToCurrentWord === 'function') {
            ra.snapToCurrentWord({ smooth: true }); // returns false if no current word — fine.
          }
        } catch { /* no-op */ }
      });
    } else {
      // Manual next: keep the classic centering scroll
      this._isLoadingActiveAudio = false; this._autoplayOnReady = false; this._syncPlayButton(false);
      this._scrollActivePageIntoView(true);
    }

    await this._prefetchAround(target);
    this._saveLastPlayedCookie(target, this.getCurrentTime());
  }

  async prev() {
    if (this.active <= 0) return;
    const target = this.active - 1;
    this.setActive(target);
    this._scrollActivePageIntoView(true);
    this._stopProgressTimer();

    this._isLoadingActiveAudio = true; this._autoplayOnReady = true; this._syncPlayButton(true, { loading: true });
    const url = await this._awaitReadyAudioAndTranscript(target, { pollGeneratingMs: 5000, pollQueuedMs: 5000, showNotice: true });
    if (url) this._swapAudioUrl(target, url);

    await this.ensureAudioReady(target);
    await this.play();

    // NEW: warm the next one after moving back (so forward is instant)
    this._prefetchNextAudio(target);

    await this._prefetchAround(target);
    this._saveLastPlayedCookie(target, this.getCurrentTime());
  }

  async goto(index, { play = true } = {}) {
    if (index < 0 || index >= this.pageMeta.length) return;
    this.setActive(index);
    this._scrollActivePageIntoView(true);
    this._stopProgressTimer();

    if (play) { this._isLoadingActiveAudio = true; this._autoplayOnReady = true; this._syncPlayButton(true, { loading: true }); }
    const url = await this._awaitReadyAudioAndTranscript(index, { pollGeneratingMs: 5000, pollQueuedMs: 5000, showNotice: !!play });
    if (url) this._swapAudioUrl(index, url);

    await this.ensureAudioReady(index);

    try { ReadAlong.get().rebindHighlighter(this.instances[index].highlighter); } catch {}

    // NEW: prefetch next after landing here
    this._prefetchNextAudio(index);

    if (play) await this.play();
    else { this._isLoadingActiveAudio = false; this._autoplayOnReady = false; this._syncPlayButton(false); this._saveLastPlayedCookie(index, this.getCurrentTime()); }
    await this._prefetchAround(index);
  }

  async jumpToParagraph(pageIndex, paragraphText, { minProbability = 0.35, play = true } = {}) {
    if (pageIndex < 0 || pageIndex >= this.pageMeta.length) return;
    this.setActive(pageIndex);
    this._stopProgressTimer();

    // Chip spinner ON for this paragraph
    this._setParagraphChipLoading(pageIndex, paragraphText, true);
    if (play) { this._isLoadingActiveAudio = true; this._autoplayOnReady = true; this._syncPlayButton(true, { loading: true, paragraphText }); }

    const meta = this.pageMeta[pageIndex];
    const alreadySettled = !!meta?._audioSettled && !!meta?._readyAudioUrl &&
      !!this.instances[pageIndex]?.audioCore &&
      this.instances[pageIndex].audioCore.audioFile === meta._readyAudioUrl;

    if (!alreadySettled) {
      const url = await this._awaitReadyAudioAndTranscript(pageIndex, { pollGeneratingMs: 5000, pollQueuedMs: 5000, showNotice: !!play });
      if (url) this._swapAudioUrl(pageIndex, url);
    }

    await this.ensureAudioReady(pageIndex);
    const sys = this.instances[pageIndex];

    const flat = this.pageMeta[pageIndex]?._readyTranscriptFlat;
    if (Array.isArray(flat) && flat.length) {
      try {
        if (typeof sys.textProcessor.ingestWordTimingsFromBackend === 'function')      await sys.textProcessor.ingestWordTimingsFromBackend(flat);
        else if (typeof sys.textProcessor.ingestWordTimings === 'function')            await sys.textProcessor.ingestWordTimings(flat);
        else if (typeof sys.textProcessor.setWordTimings === 'function')               sys.textProcessor.setWordTimings(flat);
        else { sys.textProcessor.wordTimings = flat; sys.textProcessor._wordTimings = flat; sys.refreshParagraphNavigation?.(); }
      } catch (e) { console.warn('timings ingest failed; will still attempt seek:', e); }
    }

    try { ReadAlong.get().rebindHighlighter(sys.highlighter); } catch {}

    const seekRes = await sys.seekToParagraph(paragraphText, { minProbability });
    if (play) {
      for (let k = 0; k < this.instances.length; k++) { if (k !== pageIndex) this.instances[k]?.audioCore?.pauseAudio?.(); }
      await sys.play();
      this._isLoadingActiveAudio = false; this._autoplayOnReady = false; this._syncPlayButton(true, { paragraphText });
      this._startProgressTimer();
    } else {
      this._isLoadingActiveAudio = false; this._autoplayOnReady = false; this._syncPlayButton(false, { paragraphText });
    }

    // Chip spinner OFF
    this._setParagraphChipLoading(pageIndex, paragraphText, false);

    // NEW: prefetch next after jumping within this page
    this._prefetchNextAudio(pageIndex);

    this._saveLastPlayedCookie(pageIndex, this.getCurrentTime());
    await this._prefetchAround(pageIndex);
    return seekRes;
  }

  _setupGlobalParagraphClickDelegation() {
    if (this._paragraphClicksBound) return;
    document.addEventListener('click', async (e) => {
      const chip = e.target?.closest?.('.paragraph-hover-nav');
      if (!chip) return;

      const pageId   = chip.dataset?.pageId;
      const paraText = chip.dataset?.paragraphText;
      if (!pageId || !paraText) return;

      const all = [...this._container.querySelectorAll('.mainContent')];
      const pageIndex = all.findIndex(p => p.id === `mainContent-${pageId}`);
      if (pageIndex === -1) return;

      e.preventDefault(); e.stopPropagation();
      // show spinner on the clicked chip immediately
      this._setParagraphChipLoading(pageIndex, paraText, true);
      this._isLoadingActiveAudio = true; this._autoplayOnReady = true; this._syncPlayButton(true, { loading: true, paragraphText: paraText });
      await this.jumpToParagraph(pageIndex, paraText, { minProbability: 0.35, play: true });
      // jumpToParagraph turns the spinner off when ready
    }, { capture: true });
    this._paragraphClicksBound = true;
  }

  _setupGlobalControls() {
    if (this._controlsBound) return;
    const playBtn   = cloneForCleanHandlers(document.querySelector('.playButton'));
    const rewindBtn = cloneForCleanHandlers(document.querySelector('.rewind'));
    const fwdBtn    = cloneForCleanHandlers(document.querySelector('.forward'));

    if (playBtn)   playBtn.addEventListener('click', async () => { await this.toggle(); });
    if (rewindBtn) rewindBtn.addEventListener('click', () => this.rewind());
    if (fwdBtn)    fwdBtn.addEventListener('click', () => this.forward());

    const playBack = document.querySelector('.playBack');
    if (playBack) {
      const slider = playBack.querySelector('.slider');
      const thumb  = playBack.querySelector('.thumb');
      const value  = playBack.querySelector('.thumb .value');
      const cleanThumb  = cloneForCleanHandlers(thumb);
      const cleanSlider = cloneForCleanHandlers(slider);

      const getRect = () => cleanSlider.getBoundingClientRect();
      function widthToSpeed(widthPercent) { const s = 0.5 + ((widthPercent - 40) / 60) * 1.5; return Math.round(s * 10) / 10; }
      function speedToWidth(speed) { return 40 + ((speed - 0.5) / 1.5) * 60; }
      const setSpeedUI = (s) => { const width = speedToWidth(Math.max(0.5, Math.min(2.0, s))); cleanThumb.style.width = width + '%'; if (value) value.textContent = s.toFixed(1); };
      setSpeedUI(1.0);

      const onPoint = (clientX) => {
        const rect = getRect();
        const pctRaw = ((clientX - rect.left) / rect.width) * 100;
        const pct = Math.max(40, Math.min(100, pctRaw - 7));
        const spd = widthToSpeed(pct);
        setSpeedUI(spd);
        this.setSpeed(spd);
      };

      let dragging = false;
      const onDown = (clientX, e) => { dragging = true; e?.preventDefault?.(); onPoint(clientX); };
      const onMove = (clientX, e) => { if (!dragging) return; e?.preventDefault?.(); onPoint(clientX); };
      const onUp   = () => { dragging = false; };

      cleanThumb.addEventListener('mousedown', e => onDown(e.clientX, e));
      cleanSlider.addEventListener('mousedown', e => onDown(e.clientX, e));
      document.addEventListener('mousemove', e => onMove(e.clientX, e));
      document.addEventListener('mouseup', onUp);

      cleanThumb.addEventListener('touchstart', e => onDown(e.touches[0].clientX, e), { passive: false });
      cleanSlider.addEventListener('touchstart', e => onDown(e.touches[0].clientX, e), { passive: false });
      document.addEventListener('touchmove', e => onMove(e.touches[0].clientX, e), { passive: false });
      document.addEventListener('touchend', onUp);
    }

    this._controlsBound = true;
  }

  /* ---------- Scroll to playhead button ---------- */
  _ensureScrollToPlayhead() {
    if (this._scrollToPlayheadBtn) return;
    const btn = document.createElement('button');
    btn.className = 'scrollToPlayhead';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Scroll to current page');
    btn.textContent = 'Scroll to playhead';

    Object.assign(btn.style, {
      position: 'fixed',
      left: '50%',
      bottom: '100px',
      zIndex: '9999',
      padding: '10px 12px',
      borderRadius: '9999px',
      border: '0',
      background: '#111',
      color: '#fff',
      font: '500 13px/1 system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
      cursor: 'pointer',
      display: 'none'
    });

    // snap the current highlighted word to the read-along line
    btn.addEventListener('click', async () => {
      if (this.active >= 0 && !this.instances[this.active]) {
        await this.hydratePage(this.active);
      }
      try {
        const ra = ReadAlong.get();
        const snapped = ra && typeof ra.snapToCurrentWord === 'function'
          ? ra.snapToCurrentWord({ smooth: true })
          : false;

        if (!snapped) this._scrollActivePageIntoView(true);
      } catch {
        this._scrollActivePageIntoView(true);
      }
    });

    document.body.appendChild(btn);
    this._scrollToPlayheadBtn = btn;
    // Initial positioning relative to generating notice (if it appears later, we'll update again)
    this._positionScrollToPlayhead();
  }

  _bindScrollWatcher() {
    if (this._scrollWatchBound) return;
    this._onScrollWatch = () => this._updateScrollToPlayheadVisibility();
    this._onResizeWatch = () => this._updateScrollToPlayheadVisibility();
    window.addEventListener('scroll', this._onScrollWatch, { passive: true });
    window.addEventListener('resize', this._onResizeWatch);
    this._scrollWatchBound = true;
  }

  // Ensure the scroll-to-playhead button stays above the generating notice when both are visible
  _positionScrollToPlayhead() {
    const btn = this._scrollToPlayheadBtn || null;
    if (!btn) return;
    try {
      const notice = this._genNotice || null;
      const noticeVisible = !!notice && window.getComputedStyle(notice).display !== 'none';
      // Base position for the button
      let bottomPx = 100;
      // If notice is visible, nudge the button above it
      if (noticeVisible) bottomPx = 150;
      btn.style.bottom = bottomPx + 'px';
    } catch {}
  }

  _updateScrollToPlayheadVisibility() {
    if (!this._scrollToPlayheadBtn || !this._container) return;
    const activeEl = this.#pageEl(this.active);
    if (!activeEl || this.active < 0) {
      this._scrollToPlayheadBtn.style.display = 'none';
      return;
    }

    // If any part of the current page is visible in the viewport, hide the button
    const rect = activeEl.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const inView = rect.top < vh && rect.bottom > 0;
    this._scrollToPlayheadBtn.style.display = inView ? 'none' : 'inline-flex';
    // Reposition both elements to maintain intended stacking
    this._positionGeneratingNotice();
    this._positionScrollToPlayhead();
  }

  destroy() {
    if (this._io) { try { this._io.disconnect(); } catch {} }
    this._stopProgressTimer();
    if (this._scrollWatchBound) {
      window.removeEventListener('scroll', this._onScrollWatch);
      window.removeEventListener('resize', this._onResizeWatch);
      this._scrollWatchBound = false;
    }
    for (const sys of this.instances) { try { sys?.destroy?.(); } catch (e) { console.error('Destroy error:', e); } }
    this.instances = [];
    this.active = -1;
    if (this._cb.onDestroyed) { try { this._cb.onDestroyed(); } catch {} }
  }
}
