// -----appController.js-----
import MultiPageReader from './multiPageReader.js';
import { HoldupManager } from './holdup.js';
import { unskelton } from '../utils.js';

/** tiny silent WAV as a stub until real audio arrives */
function createSilentWavDataUrl(durationSec = 0.2, sampleRate = 16000) {
  const numSamples = Math.max(1, Math.floor(durationSec * sampleRate));
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  function writeString(off, str) { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); }
  writeString(0, 'RIFF'); view.setUint32(4, 36 + numSamples * 2, true); writeString(8, 'WAVE');
  writeString(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  writeString(36, 'data'); view.setUint32(40, numSamples * 2, true);
  const blob = new Blob([view], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}
const DEFAULT_AUDIO_FILE  = createSilentWavDataUrl(0.2, 16000);
const DEFAULT_TIMING_FILE = '/order/word_timings_ordered_1.json';
const DEFAULT_OFFSET_MS   = 100;

function getCookie(name) {
  const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[2]) : null;
}
function getQueryParam(name, url = window.location.href) {
  try { return new URL(url).searchParams.get(name); } catch { return null; }
}
function blobUrlForHtml(html) {
  const blob = new Blob([html || '<p></p>'], { type: 'text/html;charset=utf-8' });
  return URL.createObjectURL(blob);
}
async function fetchBook(userBookId) {
  const token = getCookie('authToken');
  if (!token) throw new Error('Missing auth token');
  if (!window.API_URLS?.BOOK) throw new Error('Missing window.API_URLS.BOOK');
  const url = `${window.API_URLS.BOOK}get-details/${encodeURIComponent(userBookId)}/`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Book fetch failed (${res.status})`);
  return res.json();
}
function computeAnchorIndex(pages = []) {
  let lastReadIdx = -1;
  for (let i = 0; i < pages.length; i++) if (pages[i]?.is_read) lastReadIdx = i;
  if (lastReadIdx === -1) return 0;
  return Math.min(lastReadIdx + 1, pages.length - 1);
}

/** ------- UI helpers for "Page X of Y" ------- **/
function ensurePageDetailsElement() {
  let container = document.querySelector('.pageDetails');
  if (!container) {
    container = document.createElement('p');
    container.className = 'pageDetails';
    container.style.position = 'fixed';
    container.style.right = '16px';
    container.style.bottom = '16px';
    container.style.margin = '0';
    container.style.padding = '6px 10px';
    container.style.borderRadius = '8px';
    container.style.background = 'rgba(0,0,0,0.6)';
    container.style.color = '#fff';
    container.style.font = '500 13px/1.2 system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    container.style.zIndex = '2147483647';
    document.body.appendChild(container);
  }
  let current = container.querySelector('.currentPage');
  let total = container.querySelector('.totalPage');
  if (!current || !total) {
    container.innerHTML = `Page <span class="currentPage">1</span> of <span class="totalPage">1</span>`;
    current = container.querySelector('.currentPage');
    total = container.querySelector('.totalPage');
  }
  return { container, current, total };
}
function updatePageDetails(currentPage, totalPages) {
  const { current, total } = ensurePageDetailsElement();
  // avoid layout thrash if unchanged
  if (current.textContent !== String(currentPage)) current.textContent = String(currentPage);
  if (total.textContent !== String(totalPages)) total.textContent = String(totalPages);
}
/** ------------------------------------------- **/

export default class AppController {
  constructor() {
    this.reader = null;
    this.holdup = null;
    this.pageDescriptors = [];
    this._pausedByHoldup = false;
    this._wasPlayingPreHoldup = false;
    this._localAudioWatch = null; // tell Holdup about local audio activity
  }

  _pauseForHoldup() {
    if (!this.reader) return;
    const active = this.reader.getActive();
    const sys = this.reader.instances?.[active];
    this._wasPlayingPreHoldup = !!sys?.audioCore?.isPlaying;
    if (this._wasPlayingPreHoldup) {
      this.reader.pause();
      this._pausedByHoldup = true;
    } else {
      this._pausedByHoldup = false;
    }
  }
  _resumeAfterHoldup() {
    if (!this.reader) return;
    if (this._pausedByHoldup && this._wasPlayingPreHoldup) {
      this.reader.play();
    }
    this._pausedByHoldup = false;
    this._wasPlayingPreHoldup = false;
  }

  async bootstrap() {
    try {
      const userBookId = getQueryParam('id');
      if (!userBookId) throw new Error('Missing ?id=');

      const book = await fetchBook(userBookId);
      // Determine if we should allow word-level highlighting
      const rawLang = String(book?.language || '').trim().toLowerCase();
      const isEnglish = !!rawLang && (
        rawLang === 'en' || rawLang.startsWith('en-') || rawLang.startsWith('en_')
      );
      const allowWordHighlighting = !!isEnglish;
      const bookTitle = String(book?.title || '').trim() || 'book';
      try { if (bookTitle) document.title = `${bookTitle} | Unreader`; } catch {}

      const pages = Array.isArray(book.pages) ? [...book.pages] : [];
      pages.sort((a, b) => (a.page_number || 0) - (b.page_number || 0));

      const anchor = computeAnchorIndex(pages);
      unskelton()

      this.pageDescriptors = pages.map(p => ({
        page_number: p.page_number,
        textBlobUrl: blobUrlForHtml(p.content),
        is_read: !!p.is_read,
        audioFile: DEFAULT_AUDIO_FILE,
        timingFile: DEFAULT_TIMING_FILE,
        offsetMs: DEFAULT_OFFSET_MS,
        pageKey: `ub-${book.user_book_id}-p${p.page_number}`
      }));

      // Holdup: now requires bookTitle; room => page-{n}-{slug(bookTitle)}
      this.holdup = new HoldupManager({
        userBookId,
        bookTitle,
        callbacks: {
          onEngageStart: () => this._pauseForHoldup(),
          onEngageEnd:   () => this._resumeAfterHoldup(),
          onRemoteAudioStart: () => this._pauseForHoldup(),
          onRemoteAudioStop:  () => this._resumeAfterHoldup()
        },
        inactivityMs: 300000 // 5 minutes
      });

      // Reader
      this.reader = new MultiPageReader(this.pageDescriptors, {
        autoPlayFirst: false,
        initialActiveIndex: anchor,
        lazyHydration: true,
        prefetchRadius: 1,
        observeRadius: 0.75,
        userBookId,
        // Disable word-level highlighting for non-English content
        allowWordHighlighting,
        callbacks: {
          onActivePageChanged: async (index) => {
            try {
              const pageNo = this.pageDescriptors[index]?.page_number ?? (index + 1);
              // Update Page X of Y UI on scroll / page change
              updatePageDetails(pageNo, this.pageDescriptors.length);

              const ctx = { pageNumber: pageNo, metadata: this._metadataForIndex(index) };
              // Switch LiveKit room on page change, show loading in holdup status
              await this.holdup.switchToPage(ctx);
            } catch (e) { console.warn('Holdup switchToPage error:', e); }
          },
          onDestroyed: () => this.holdup?.disconnect()
        }
      });

      await this.reader.init();

      // Initial per-page connect
      const startIndex = this.reader.getActive();
      const startPageNo = this.pageDescriptors[startIndex]?.page_number ?? (startIndex + 1);

      // Seed the Page X of Y UI immediately on load
      updatePageDetails(startPageNo, this.pageDescriptors.length);

      // Align the start of the active page so its top sits at the height-setter line
      const alignToHeightSetter = (pageIndex) => {
        try {
          const wrappers = Array.from(document.querySelectorAll('.pageWrapper'));
          const el = wrappers[pageIndex] || wrappers[0];
          if (!el) return;
          const setter = document.getElementById('heightSetter');
          // Ensure heightSetter reflects last saved top% before reading it
          try {
            if (setter) {
              const saved = localStorage.getItem('ui:heightSetterTopPercent');
              if (saved != null) {
                const v = Math.max(10, Math.min(90, parseFloat(saved)));
                setter.style.top = `${isNaN(v) ? 50 : v}%`;
              }
            }
          } catch {}
          const pct = setter && setter.style.top ? parseFloat(String(setter.style.top).replace('%','')) : 50;
          const vh = window.innerHeight || 800;
          const targetY = window.scrollY + (Math.max(0, Math.min(100, isNaN(pct) ? 50 : pct)) / 100) * vh;
          const rect = el.getBoundingClientRect();
          const elTopAbs = rect.top + window.scrollY;
          const delta = elTopAbs - targetY;
          window.scrollTo({ top: Math.max(0, window.scrollY + delta), behavior: 'auto' });
        } catch {}
      };
      // Run after layout settles
      requestAnimationFrame(() => requestAnimationFrame(() => alignToHeightSetter(startIndex)));

      await this.holdup.connectForPage({
        pageNumber: startPageNo,
        metadata: this._metadataForIndex(startIndex)
      });

      // 🔌 Expose to window so keyboard.js can discover them
      window.app    = this;
      window.reader = this.reader;
      window.holdup = this.holdup;

      // Feed holdup with local audio activity (inactivity auto-disconnect)
      this._localAudioWatch = setInterval(() => {
        try {
          const active = this.reader?.getActive?.() ?? -1;
          const sys = this.reader?.instances?.[active];
          const playing = !!sys?.audioCore?.isPlaying;
          this.holdup?.noteLocalAudioActivity?.(playing);
        } catch {}
      }, 1500);

      window.addEventListener('beforeunload', () => {
        try { this.pageDescriptors.forEach(pg => URL.revokeObjectURL(pg.textBlobUrl)); } catch {}
        this.holdup?.disconnect();
        try { URL.revokeObjectURL(DEFAULT_AUDIO_FILE); } catch {}
        if (this._localAudioWatch) clearInterval(this._localAudioWatch);
      });

      console.log('📚 AppController ready.');
    } catch (err) {
      console.error('App bootstrap failed:', err);
    }
  }

  _htmlAt(i) {
    const fromReader = this.reader?.pageMeta?.[i]?._html;
    if (fromReader) return fromReader;
    const meta = this.pageDescriptors[i];
    return (meta && meta._html) ? meta._html : null;
  }
  _metadataForIndex(i) {
    const cur  = this._htmlAt(i);
    const prev = (i > 0) ? this._htmlAt(i - 1) : '';
    const next = (i < this.pageDescriptors.length - 1) ? this._htmlAt(i + 1) : '';
    return {
      current_page:  cur  || '',
      previous_page: prev || '',
      next_page:     next || ''
    };
  }  
}
