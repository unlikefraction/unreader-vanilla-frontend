// ----paragraph-seeker.js-----

import { commonVars } from '../common-vars.js';

export class ParagraphSeeker {
  static _mouseListenersAdded = false;

  constructor(
    textProcessor,
    audioCore,
    {
      minProbabilityThreshold = 0.4,
      contextWindow = 15,
      cleanPattern = /[^\w\s]/g
    } = {}
  ) {
    this.textProcessor = textProcessor;
    this.audioCore = audioCore;
    this.minProbabilityThreshold = minProbabilityThreshold;
    this.contextWindow = contextWindow;
    this.cleanPattern = cleanPattern;

    // respect edit mode for selection
    document.body.style.userSelect = commonVars.beingEdited ? 'none' : '';

    this._lastToolActive = commonVars.toolActive;
    this._lastBeingEdited = commonVars.beingEdited;

    // watch global tool/edit switches and refresh paragraph hover UI when needed
    this._stateInterval = setInterval(() => {
      const { toolActive, beingEdited } = commonVars;

      if (beingEdited !== this._lastBeingEdited) {
        document.body.style.userSelect = beingEdited ? 'none' : '';
      }

      if (toolActive !== this._lastToolActive || beingEdited !== this._lastBeingEdited) {
        this._lastToolActive = toolActive;
        this._lastBeingEdited = beingEdited;
        this.refreshParagraphNavigation();
      }
    }, 100);

    // Re-enable hover areas after selection attempts
    if (!ParagraphSeeker._mouseListenersAdded) {
      const reenable = () => {
        document.querySelectorAll('.paragraph-hover-area').forEach(area => {
          area.style.pointerEvents = commonVars.beingEdited ? 'none' : 'auto';
        });
      };
      document.addEventListener('mouseup', reenable);
      document.addEventListener('touchend', reenable, { passive: true });
      ParagraphSeeker._mouseListenersAdded = true;
    }
  }

  // ---------- text utils ----------

  preprocessText(inputText) {
    return inputText
      .toLowerCase()
      .replace(this.cleanPattern, '')
      .split(/\s+/)
      .filter(Boolean);
  }

  calculateSimilarity(inputWords, referenceWords) {
    const maxLen = Math.max(inputWords.length, referenceWords.length);
    if (!maxLen) return 0;

    const refSet = new Set(referenceWords);
    let directMatches = 0;
    let sequentialMatches = 0;
    const minLen = Math.min(inputWords.length, referenceWords.length);

    for (let i = 0; i < inputWords.length; i++) {
      if (refSet.has(inputWords[i])) directMatches++;
      if (i < referenceWords.length && inputWords[i] === referenceWords[i]) sequentialMatches++;
    }

    const directScore = directMatches / maxLen;
    const seqScore = minLen ? sequentialMatches / minLen : 0;
    return directScore * 0.6 + seqScore * 0.4;
  }

  getTextContext(start, end) {
    const spans = this.textProcessor.wordSpans;
    const from = Math.max(0, start - this.contextWindow);
    const to = Math.min(spans.length, end + this.contextWindow);
    const ctx = [];
    for (let i = from; i < to; i++) {
      const w = spans[i]?.dataset?.originalWord;
      if (w) ctx.push(w.toLowerCase());
    }
    return ctx;
  }

  findBestTextMatch(inputWords) {
    const spans = this.textProcessor.wordSpans;
    const total = spans.length;
    const winSize = inputWords.length;
    let best = { start: -1, end: -1, probability: 0, direct: 0, context: 0 };

    for (let i = 0; i <= total - winSize; i++) {
      const slice = spans.slice(i, i + winSize);
      const windowWords = slice
        .map(s => s.dataset.originalWord?.toLowerCase())
        .filter(Boolean);
      if (windowWords.length < winSize * 0.5) continue;

      const direct = this.calculateSimilarity(inputWords, windowWords);
      const context = this.calculateSimilarity(inputWords, this.getTextContext(i, i + winSize));
      const prob = direct * 0.7 + context * 0.3;

      if (prob > best.probability) {
        best = { start: i, end: i + winSize - 1, probability: prob, direct, context };
      }
    }
    return best;
  }

  getAudioContext(idx) {
    const timings = this.textProcessor.wordTimings;
    const from = Math.max(0, idx - this.contextWindow);
       const to = Math.min(timings.length, idx + this.contextWindow);
    const ctx = [];
    for (let i = from; i < to; i++) {
      const w = timings[i].word.toLowerCase().replace(this.cleanPattern, '');
      if (w) ctx.push(w);
    }
    return ctx;
  }

  findAudioTimestamp(textIdx) {
    const timings = this.textProcessor.wordTimings;
    if (!timings?.length) return null;

    const span = this.textProcessor.wordSpans[textIdx];
    const target = span?.dataset?.originalWord?.toLowerCase().replace(this.cleanPattern, '');
    if (!target) return null;

    let best = { timing: null, prob: 0 };
    for (let i = 0; i < timings.length; i++) {
      const tw = timings[i].word.toLowerCase().replace(this.cleanPattern, '');
      if (tw !== target) continue;

      const ctxScore = this.calculateSimilarity(
        this.getTextContext(textIdx, textIdx + 1),
        this.getAudioContext(i)
      );
      const prob = 0.5 + 0.5 * ctxScore;
      if (prob > best.prob) best = { timing: timings[i], prob };
    }
    return best.timing;
  }

  // ---------- seeking APIs ----------

  async seekToParagraph(inputText, { minProbability, log = true } = {}) {
    const thresh = minProbability ?? this.minProbabilityThreshold;
    const words = this.preprocessText(inputText);
    if (!words.length) return { success: false, error: 'No valid words' };

    const match = this.findBestTextMatch(words);
    if (match.probability < thresh) {
      return { success: false, error: 'Low match probability', match };
    }

    const timing = this.findAudioTimestamp(match.start);
    if (!timing) {
      return { success: false, error: 'No audio timing', match };
    }

    this.audioCore.sound?.seek(timing.time_start);
    if (log) printl?.(`Seeked to ${timing.time_start}s`);
    return { success: true, timestamp: timing.time_start, match, timing };
  }

  async seekToParagraphs(paragraphTexts, options = {}) {
    const results = [];
    for (let i = 0; i < paragraphTexts.length; i++) {
      const result = await this.seekToParagraph(paragraphTexts[i], { ...options, log: false });
      results.push({ index: i, text: paragraphTexts[i], result });
      if (result.success) break;
    }
    return results;
  }

  // ---------- paragraph detection (HTML-preserving) ----------

  /** block-ish displays we treat as paragraph hosts */
  _isBlockish(el) {
    try {
      const display = getComputedStyle(el).display;
      if (display === 'block' || display === 'list-item' || display === 'table' ||
          display === 'table-row' || display === 'table-cell' ||
          display === 'grid' || display === 'flex') return true;
    } catch {}
    // fallback by tag (covers <p>, headings, li, blockquote, pre, div, section, article, aside)
    const tag = el.tagName;
    return /^(P|H[1-6]|LI|BLOCKQUOTE|PRE|DIV|SECTION|ARTICLE|ASIDE|HEADER|FOOTER|MAIN|NAV|DD|DT|FIGCAPTION|ADDRESS)$/.test(tag);
  }

  _closestParagraphHost(spanEl, stopAt) {
    let n = spanEl?.parentElement || null;
    while (n && n !== stopAt) {
      if (this._isBlockish(n)) return n;
      n = n.parentElement;
    }
    return stopAt || null;
  }

  /**
   * Build paragraph boundaries by grouping contiguous word spans under the same
   * block-level ancestor. This works for real HTML (<p>, <li>, headings, etc.).
   */
  findParagraphBoundaries() {
    const main = this.textProcessor?.container;
    if (!main) return [];
    const spans = this.textProcessor.wordSpans || [];
    const paras = [];

    let curHost = null;
    let para = { start: 0, end: 0, text: '', elements: [] };
    let idx = 0;

    for (let i = 0; i < spans.length; i++) {
      const w = spans[i];
      if (!w?.isConnected) continue;
      const host = this._closestParagraphHost(w, main) || main;

      // start a new paragraph when host changes
      if (host !== curHost && para.elements.length) {
        para.end = idx - 1;
        paras.push({ ...para });
        para = { start: idx, end: idx, text: '', elements: [] };
      }

      curHost = host;
      para.text += w.textContent + ' ';
      para.elements.push(w);
      idx++;
    }

    if (para.elements.length) {
      para.end = idx - 1;
      paras.push(para);
    }

    if (!paras.length) {
      printl?.('⚠️ ParagraphSeeker: no paragraph boundaries found');
    } else {
      printl?.(`🧭 ParagraphSeeker: found ${paras.length} paragraph(s)`);
    }
    return paras;
  }

  extractParagraphs() {
    return this.findParagraphBoundaries().map(p => p.text.trim()).filter(Boolean);
  }

  // ---------- paragraph hover UI (container-scoped, multi-page safe) ----------

  setupParagraphHoverNavigation() {
    const main = this.textProcessor?.container;
    if (!main) return;

    // ensure relative positioning so our absolute children are local to this page only
    if (getComputedStyle(main).position === 'static') {
      main.style.position = 'relative';
    }

    // remove only *this page's* hover UI
    main.querySelectorAll('.paragraph-hover-nav, .paragraph-hover-area').forEach(el => el.remove());

    // cache paragraphs and corresponding hover elements for rAF-throttled updates
    this._paragraphs = this.findParagraphBoundaries();
    this._hoverAreas = [];
    this._hoverDivs = [];
    this._posUpdateScheduled = false;

    this._paragraphs.forEach((p, i) => this.setupParagraphHover(p, i));

    this.setupDynamicUpdates();

    // Observe DOM changes to rebuild paragraph map lazily
    try {
      this._mo?.disconnect?.();
      this._mo = new MutationObserver(() => this._scheduleRefresh());
      this._mo.observe(main, { subtree: true, childList: true, characterData: true });
    } catch {}
  }

  setupParagraphHover(paragraph, index) {
    const main = this.textProcessor?.container;
    if (!main || !paragraph.elements.length) return;

    const first = paragraph.elements[0];

    // Invisible hit area spanning the paragraph block (within this page only)
    const hoverArea = document.createElement('div');
    Object.assign(hoverArea.style, {
      position: 'absolute',
      zIndex: 1,
      background: 'transparent',
      // make it hoverable immediately unless actively editing
      pointerEvents: commonVars.beingEdited ? 'none' : 'auto',
      cursor: commonVars.toolActive ? 'crosshair' : 'text'
    });
    hoverArea.className = 'paragraph-hover-area';
    hoverArea.dataset.pageId = this.textProcessor.pageId; // scope tagging

    main.appendChild(hoverArea);
    this._hoverAreas[index] = hoverArea;
    this.updateHoverAreaPosition(hoverArea, paragraph);

    // When user presses to select text, let the real content take the events.
    // We flip pointer events OFF on down; global mouseup/touchend flips it back ON.
    const dropThrough = () => { hoverArea.style.pointerEvents = 'none'; };
    hoverArea.addEventListener('mousedown', dropThrough);
    hoverArea.addEventListener('touchstart', dropThrough, { passive: true });

    // Visible “play” chip
    const hoverDiv = document.createElement('div');
    hoverDiv.className = 'paragraph-hover-nav';
    Object.assign(hoverDiv.style, {
      display: 'none',
      position: 'absolute',
      zIndex: 2,
      cursor: commonVars.toolActive ? 'crosshair' : 'pointer',
      pointerEvents: commonVars.beingEdited ? 'none' : 'auto'
    });
    if (commonVars.toolActive) hoverDiv.style.visibility = 'hidden';

    hoverDiv.innerHTML = '<i class="ph ph-play"></i>';
    hoverDiv.dataset.paragraphIndex = index;

    // 🔑 carry page + full paragraph text for the orchestrator
    hoverDiv.dataset.pageId = this.textProcessor.pageId;
    hoverDiv.dataset.paragraphText = paragraph.text.trim();

    // hover show/hide
    hoverArea.addEventListener('mouseenter', () => this.showHoverDiv(hoverDiv, first, paragraph));
    hoverArea.addEventListener('mouseleave', e => {
      if (!hoverDiv.contains(e.relatedTarget)) this.hideHoverDiv(hoverDiv);
    });
    hoverDiv.addEventListener('mouseenter', () => this.showHoverDiv(hoverDiv, first, paragraph));
    hoverDiv.addEventListener('mouseleave', e => {
      if (!hoverArea.contains(e.relatedTarget)) this.hideHoverDiv(hoverDiv);
    });

    // local click (still works single-page); reader will also intercept globally
    hoverDiv.addEventListener('click', async e => {
      e.preventDefault();
      if (commonVars.beingEdited) return;
      const result = await this.seekToParagraph(paragraph.text);
      if (result.success && this.audioCore && !this.audioCore.isPlaying) {
        await this.audioCore.playAudio();
      }
    });

    main.appendChild(hoverDiv);
    this._hoverDivs[index] = hoverDiv;
  }

  updateHoverAreaPosition(hoverArea, paragraph) {
    const main = this.textProcessor?.container;
    if (!main) return;

    const firstRect = paragraph.elements[0].getBoundingClientRect();
    const lastRect = paragraph.elements[paragraph.elements.length - 1].getBoundingClientRect();
    const containerRect = main.getBoundingClientRect();

    // position relative to the page container
    const left = Math.min(firstRect.left, lastRect.left) - containerRect.left - 25;
    const top = Math.min(firstRect.top, lastRect.top) - containerRect.top;
    const height = Math.max(firstRect.bottom, lastRect.bottom) - Math.min(firstRect.top, lastRect.top);
    const rightMost = Math.max(firstRect.right, lastRect.right);
    const width = Math.min(700, Math.max(200, rightMost - containerRect.left + 50));

    hoverArea.style.left = `${left}px`;
    hoverArea.style.top = `${top}px`;
    hoverArea.style.width = `${width}px`;
    hoverArea.style.height = `${height}px`;
  }

  showHoverDiv(hoverDiv, firstElement, paragraph) {
    const main = this.textProcessor?.container;
    if (!main) return;

    const rect = firstElement.getBoundingClientRect();
    const containerRect = main.getBoundingClientRect();

    hoverDiv.style.left = `${rect.left - containerRect.left - 10}px`;
    hoverDiv.style.top = `${rect.top - containerRect.top}px`;
    hoverDiv.style.display = 'block';
    hoverDiv.style.visibility = commonVars.toolActive ? 'hidden' : 'visible';
    hoverDiv.style.cursor = commonVars.toolActive ? 'crosshair' : 'pointer';
    hoverDiv.dataset.paragraphLength = paragraph.elements.length;
    hoverDiv.dataset.paragraphPreview = paragraph.text.substring(0, 100);
  }

  hideHoverDiv(hoverDiv) {
    setTimeout(() => {
      const area = hoverDiv.closest('.paragraph-hover-area');
      if (!hoverDiv.matches(':hover') && !(area && area.matches(':hover'))) {
        hoverDiv.style.display = 'none';
      }
    }, 50);
  }

  enableParagraphNavigation() {
    this.setupParagraphHoverNavigation();
    printl?.('✅ Paragraph hover navigation enabled (scoped to page)');
  }

  disableParagraphNavigation() {
    const main = this.textProcessor?.container;
    if (main) main.querySelectorAll('.paragraph-hover-nav, .paragraph-hover-area').forEach(el => el.remove());
    if (this.scrollListener) window.removeEventListener('scroll', this.scrollListener);
    if (this.resizeListener) window.removeEventListener('resize', this.resizeListener);
    try { this._mo?.disconnect?.(); } catch {}
    printl?.('❌ Paragraph hover navigation disabled (page-scoped)');
  }

  setupDynamicUpdates() {
    this.scrollListener = () => this._schedulePositionsUpdate();
    this.resizeListener = () => this._schedulePositionsUpdate();
    window.addEventListener('scroll', this.scrollListener, { passive: true });
    window.addEventListener('resize', this.resizeListener, { passive: true });
  }

  updateAllHoverAreas() {
    const main = this.textProcessor?.container;
    if (!main) return;

    if (!Array.isArray(this._paragraphs) || !this._paragraphs.length) return;
    this._hoverAreas?.forEach((area, idx) => {
      const p = this._paragraphs[idx];
      if (area && p) this.updateHoverAreaPosition(area, p);
    });
  }

  refreshParagraphNavigation() {
    this.disableParagraphNavigation();
    this.enableParagraphNavigation();
  }

  _schedulePositionsUpdate() {
    if (this._posUpdateScheduled) return;
    this._posUpdateScheduled = true;
    requestAnimationFrame(() => {
      try { this.updateAllHoverAreas(); } finally { this._posUpdateScheduled = false; }
    });
  }

  _scheduleRefresh() {
    clearTimeout(this._refreshTO);
    this._refreshTO = setTimeout(() => this.refreshParagraphNavigation(), 60);
  }

  // ---------- tuning ----------

  setMinProbabilityThreshold(threshold) {
    this.minProbabilityThreshold = Math.min(1, Math.max(0, threshold));
    printl?.(`📊 Min probability threshold set to: ${this.minProbabilityThreshold}`);
  }

  setContextWindow(windowSize) {
    this.contextWindow = Math.min(50, Math.max(5, windowSize));
    printl?.(`🔍 Context window set to: ${this.contextWindow} words`);
  }

  // ---------- cleanup ----------
  destroy() {
    clearInterval(this._stateInterval);
    this.disableParagraphNavigation();
  }
}
