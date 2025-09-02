// -----word-highlighter.js-------

// Word highlighting and synchronization with audio
// Hardened against null/DOM-detached spans so ReadAlong never receives invalid elements.
export class WordHighlighter {
  constructor(textProcessor) {
    this.textProcessor = textProcessor;

    // state
    this.highlightedIndices = new Set();
    this.loggedWords = new Set();
    this.lastHighlightedIndex = 0;
    this.isInitialHighlightDone = false;
    this.lookaheadMs = 50;
    this.processedTimingIndices = new Set();
    this.currentHighlightedWord = null;

    // probability threshold to accept a bestMatch
    this.minProbability = 0.8;

    // timers & perf
    this.highlightInterval = null;
    this._rafId = null;
    this.nextTimingToConsider = 0; // rolling pointer for perf
  }

  /* ---------------- helpers & safety ---------------- */

  _spans() {
    const spans = this.textProcessor?.wordSpans;
    return Array.isArray(spans) ? spans : [];
  }

  _isValidSpan(span) {
    return !!(span && span.nodeType === 1 && span.isConnected);
  }

  _safeSpan(i) {
    const spans = this._spans();
    if (i < 0 || i >= spans.length) return null;
    const el = spans[i];
    return this._isValidSpan(el) ? el : null;
  }

  _setCurrentWordEl(el) {
    this.currentHighlightedWord = this._isValidSpan(el) ? el : null;
  }

  getCurrentWordEl() {
    return this._isValidSpan(this.currentHighlightedWord) ? this.currentHighlightedWord : null;
  }

  _addHighlight(i) {
    const el = this._safeSpan(i);
    if (!el) return false;
    try { el.classList.add('highlight'); } catch {}
    this.highlightedIndices.add(i);
    this._setCurrentWordEl(el);
    return true;
  }

  _removeHighlight(i) {
    const el = this._safeSpan(i);
    if (!el) return false;
    try { el.classList.remove('highlight'); } catch {}
    return true;
  }

  /* ---------------- DOM rehydration ---------------- */

  _rehydrateSpansIfDetached() {
    const spans = this._spans();
    if (!spans.length) return;

    let detached = 0;
    for (let i = 0; i < spans.length; i++) {
      const el = spans[i];
      if (!this._isValidSpan(el)) detached++;
      if (detached > 5) break; // early exit once clear
    }

    // If a handful are detached, rebuild references from DOM
    if (detached > 0) {
      const container = this.textProcessor?.container;
      if (!container || !container.isConnected) return;
      let fresh;
      try {
        fresh = Array.from(container.querySelectorAll('span.word'));
      } catch { fresh = null; }

      if (!fresh || fresh.length === 0) return;

      // Build an indexable array by data-index, falling back to order
      const byIndex = [];
      for (const el of fresh) {
        const n = Number(el.dataset?.index);
        if (Number.isInteger(n) && n >= 0) byIndex[n] = el;
      }
      const rebuilt = byIndex.length > 0 ? byIndex : fresh;

      // Replace references in textProcessor
      this.textProcessor.wordSpans = rebuilt;

      // Reapply current highlights idempotently
      for (const i of this.highlightedIndices) {
        const el = this._safeSpan(i);
        if (el) { try { el.classList.add('highlight'); } catch {} }
      }

      // Reset current word element to a safe handle
      this._setCurrentWordEl(this._safeSpan(Math.max(0, this.lastHighlightedIndex - 1)));

      try { printl?.(`♻️ Rehydrated ${detached} detached span reference(s)`); } catch {}
    }
  }

  /* ---------------- lifecycle ---------------- */

  pause() {
    this.stopHighlighting();
  }

  destroy() {
    this.stopHighlighting();
    this.clearAllHighlights();
    this.processedTimingIndices.clear();
    this.loggedWords.clear();
    this.nextTimingToConsider = 0;
  }

  /* ---------------- core ops ---------------- */

  clearAllHighlights() {
    const spans = this._spans();
    for (let i = 0; i < spans.length; i++) {
      const el = spans[i];
      if (this._isValidSpan(el)) {
        try { el.classList.remove('highlight'); } catch {}
      }
    }
    this.highlightedIndices.clear();
    this.lastHighlightedIndex = 0;
    this._setCurrentWordEl(null);
  }

  highlightWordsInRange(startIndex, endIndex, reason = '') {
    const spans = this._spans();
    if (!spans.length) return;

    const actualStartIndex = Math.max(startIndex, this.lastHighlightedIndex);
    const actualEndIndex = Math.max(endIndex, actualStartIndex);

    for (let i = actualStartIndex; i <= actualEndIndex && i < spans.length; i++) {
      if (!this.highlightedIndices.has(i)) {
        if (this._addHighlight(i)) {
          try {
            printl?.(`✨ Highlighted "${spans[i]?.textContent ?? ''}" @${i} ${reason}`);
          } catch {}
        }
      }
    }
    this.lastHighlightedIndex = Math.max(this.lastHighlightedIndex, actualEndIndex + 1);
  }

  fillGapsToTarget(targetIndex, reason = '') {
    if (targetIndex > this.lastHighlightedIndex) {
      this.highlightWordsInRange(
        this.lastHighlightedIndex,
        targetIndex - 1,
        `(filling gap ${reason})`
      );
    }
  }

  handleInitialWords(currentTime) {
    if (
      this.isInitialHighlightDone ||
      !this.textProcessor?.wordTimings ||
      this.textProcessor.wordTimings.length === 0
    ) return;

    const firstTimedWord = this.textProcessor.wordTimings[0];
    const lookaheadTime = firstTimedWord.time_start - this.lookaheadMs / 1000;

    if (currentTime >= Math.max(0, lookaheadTime) && currentTime < firstTimedWord.time_start) {
      const timeElapsed = currentTime;
      const estimatedWordsPerSecond = 2.5;
      const wordsToHighlight = Math.max(1, Math.floor(timeElapsed * estimatedWordsPerSecond));
      const endIndex = Math.min(wordsToHighlight - 1, this._spans().length - 1);
      this.highlightWordsInRange(0, endIndex, '(initial words before first timed word)');
      try { printl?.(`🌟 Highlighted ${wordsToHighlight} initial words (${timeElapsed.toFixed(3)}s)`); } catch {}
    }

    if (currentTime >= firstTimedWord.time_start) {
      this.isInitialHighlightDone = true;
    }
  }

  processWordTiming(wordData, index, currentTime) {
    const lookaheadTime = wordData.time_start - this.lookaheadMs / 1000;

    if (currentTime >= lookaheadTime && !this.processedTimingIndices.has(index)) {
      this.processedTimingIndices.add(index);

      try {
        printl?.(
          `🎯 Timing "${wordData.word}" (${this.lookaheadMs}ms early) at ${wordData.time_start.toFixed(
            5
          )}s (now: ${currentTime.toFixed(5)}s)`
        );
      } catch {}

      const bestMatch = this.textProcessor.findBestWordMatch(
        wordData.word,
        index,
        null,
        this.lastHighlightedIndex
      );

      const p = bestMatch?.probability ?? 0;
      if (bestMatch.index !== -1 && p >= this.minProbability) {
        this.fillGapsToTarget(bestMatch.index, `before "${wordData.word}"`);

        this.highlightWordsInRange(
          bestMatch.index,
          bestMatch.index,
          `(p=${(bestMatch.probability ?? 0).toFixed(3)}, w=${(bestMatch.wordScore ?? 0).toFixed(
            3
          )}, c=${(bestMatch.contextScore ?? 0).toFixed(3)})`
        );

        if (index < (this.textProcessor.wordTimings?.length ?? 0) - 1) {
          const nextWordData = this.textProcessor.wordTimings[index + 1];
          const nextMatch = this.textProcessor.findBestWordMatch(
            nextWordData.word,
            index + 1,
            null,
            this.lastHighlightedIndex
          );

          const nextP = nextMatch?.probability ?? 0;
          if (
            nextMatch.index !== -1 &&
            nextMatch.index > bestMatch.index + 1 &&
            nextP >= this.minProbability
          ) {
            const timeGap = nextWordData.time_start - wordData.time_end;

            if (timeGap > 0.1) {
              const estimatedWordsInGap = Math.max(1, Math.ceil(timeGap * 3));
              const actualWordsInGap = nextMatch.index - bestMatch.index - 1;
              const wordsToHighlight = Math.min(estimatedWordsInGap, actualWordsInGap);

              if (wordsToHighlight > 0) {
                this.highlightWordsInRange(
                  bestMatch.index + 1,
                  bestMatch.index + wordsToHighlight,
                  `(~${wordsToHighlight} words in ${timeGap.toFixed(3)}s gap)`
                );
              }
            } else {
              this.highlightWordsInRange(
                bestMatch.index + 1,
                nextMatch.index - 1,
                '(between consecutive timed words)'
              );
            }
          }
        }
      } else {
        // Fallback 1: forward exact search within a small window ahead
        const forwardIndex = this._forwardExactSearch(wordData.word, this.lastHighlightedIndex);
        if (forwardIndex !== -1) {
          this.fillGapsToTarget(forwardIndex, `fallback forward-search for "${wordData.word}"`);
          this.highlightWordsInRange(forwardIndex, forwardIndex, '(forward exact match)');
        } else {
          try { printl?.(`⏭️ Skipping low-confidence match for "${wordData.word}" (p=${p.toFixed(3)})`); } catch {}
        }
      }
    }
  }

  // process only timings that are due by now (perf)
  processUpToTime(currentTime) {
    if (!this.textProcessor?.wordTimings) return;
    const lookahead = this.lookaheadMs / 1000;

    while (
      this.nextTimingToConsider < this.textProcessor.wordTimings.length &&
      this.textProcessor.wordTimings[this.nextTimingToConsider].time_start - lookahead <= currentTime
    ) {
      const i = this.nextTimingToConsider;
      const wd = this.textProcessor.wordTimings[i];
      this.processWordTiming(wd, i, currentTime);
      this.nextTimingToConsider++;
    }
  }

  catchUpToCurrentTime(currentTime) {
    if (!this.textProcessor?.wordTimings) return;

    let lastExpectedIndex = -1;

    for (let i = 0; i < this.textProcessor.wordTimings.length; i++) {
      if (currentTime >= this.textProcessor.wordTimings[i].time_start - this.lookaheadMs / 1000) {
        lastExpectedIndex = i;
      } else {
        break;
      }
    }

    if (lastExpectedIndex >= 0) {
      const expectedWordData = this.textProcessor.wordTimings[lastExpectedIndex];
      const expectedMatch = this.textProcessor.findBestWordMatch(
        expectedWordData.word,
        lastExpectedIndex,
        null,
        this.lastHighlightedIndex
      );

      const p = expectedMatch?.probability ?? 0;
      if (
        expectedMatch.index !== -1 &&
        expectedMatch.index >= this.lastHighlightedIndex &&
        p >= this.minProbability
      ) {
        this.fillGapsToTarget(expectedMatch.index + 1, 'catching up to current time');
      }
    }
  }

  findCurrentWordAndHighlight(currentTime) {
    const spans = this._spans();
    if (!this.textProcessor?.wordTimings || this.textProcessor.wordTimings.length === 0) {
      try { printl?.(`⚠️ No word timings for t=${currentTime.toFixed(3)}s`); } catch {}
      return null;
    }

    for (let i = 0; i < this.textProcessor.wordTimings.length; i++) {
      const wordData = this.textProcessor.wordTimings[i];

      if (currentTime >= wordData.time_start && currentTime <= wordData.time_end) {
        try { printl?.(`🎯 Current word "${wordData.word}" @ ${currentTime.toFixed(3)}s`); } catch {}

        const bestMatch = this.textProcessor.findBestWordMatch(
          wordData.word,
          i,
          null,
          this.lastHighlightedIndex
        );

        const p = bestMatch?.probability ?? 0;
        if (bestMatch.index !== -1 && p >= this.minProbability) {
          this.clearAllHighlights();
          this.highlightWordsInRange(
            0,
            Math.min(bestMatch.index, spans.length - 1),
            `(seek target p=${p.toFixed(3)})`
          );

          return { wordData, textIndex: Math.min(bestMatch.index, spans.length - 1) };
        }

        // Fallback: try a quick forward exact search before bailing
        const forwardIndex = this._forwardExactSearch(wordData.word, this.lastHighlightedIndex);
        if (forwardIndex !== -1) {
          this.clearAllHighlights();
          this.highlightWordsInRange(0, Math.min(forwardIndex, spans.length - 1), '(seek forward exact)');
          return { wordData, textIndex: Math.min(forwardIndex, spans.length - 1) };
        }

        // Gate: no highlight if below threshold
        return { wordData, textIndex: -1 };
      }
    }

    // nearest previous
    let closestWord = null;
    let closestIndex = -1;

    for (let i = 0; i < this.textProcessor.wordTimings.length; i++) {
      const wd = this.textProcessor.wordTimings[i];
      if (wd.time_start <= currentTime) {
        closestWord = wd;
        closestIndex = i;
      } else {
        break;
      }
    }

    if (closestWord) {
      try { printl?.(`🎯 Closest previous "${closestWord.word}" @ ${currentTime.toFixed(3)}s`); } catch {}

      const bestMatch = this.textProcessor.findBestWordMatch(
        closestWord.word,
        closestIndex,
        null,
        this.lastHighlightedIndex
      );

      const p = bestMatch?.probability ?? 0;
      if (bestMatch.index !== -1 && p >= this.minProbability) {
        this.clearAllHighlights();
        this.highlightWordsInRange(
          0,
          Math.min(bestMatch.index, spans.length - 1),
          `(seek closest p=${p.toFixed(3)})`
        );

        return { wordData: closestWord, textIndex: Math.min(bestMatch.index, spans.length - 1) };
      }
      // Fallback: forward exact search
      const forwardIndex = this._forwardExactSearch(closestWord.word, this.lastHighlightedIndex);
      if (forwardIndex !== -1) {
        this.clearAllHighlights();
        this.highlightWordsInRange(0, Math.min(forwardIndex, spans.length - 1), '(seek closest forward exact)');
        return { wordData: closestWord, textIndex: Math.min(forwardIndex, spans.length - 1) };
      }
    }

    try { printl?.(`⚠️ No suitable high-confidence word for t=${currentTime.toFixed(3)}s`); } catch {}
    return null;
  }

  estimatePositionFromTime(currentTime) {
    const spans = this._spans();

    if (!this.textProcessor?.wordTimings || this.textProcessor.wordTimings.length === 0) {
      const estimatedWordsPerSecond = 2.5;
      const estimatedWords = Math.max(0, Math.floor(currentTime * estimatedWordsPerSecond));
      const endIndex = Math.min(estimatedWords, spans.length - 1);

      if (endIndex >= 0) {
        this.clearAllHighlights();
        this.highlightWordsInRange(0, endIndex, '(time-based estimate)');
      }
      return;
    }

    let lastWordIndex = -1;

    for (let i = 0; i < this.textProcessor.wordTimings.length; i++) {
      if (this.textProcessor.wordTimings[i].time_start <= currentTime) {
        lastWordIndex = i;
      } else {
        break;
      }
    }

    let lastTextIndex = -1;
    if (lastWordIndex >= 0) {
      const bestMatch = this.textProcessor.findBestWordMatch(
        this.textProcessor.wordTimings[lastWordIndex].word,
        lastWordIndex,
        null,
        this.lastHighlightedIndex
      );
      const p = bestMatch?.probability ?? 0;
      if (bestMatch.index !== -1 && p >= this.minProbability) lastTextIndex = bestMatch.index;
    }

    if (lastTextIndex >= 0) {
      this.clearAllHighlights();
      this.highlightWordsInRange(0, Math.min(lastTextIndex, spans.length - 1), '(seek position estimate)');
    } else if (currentTime > 0) {
      const estimatedWordsPerSecond = 2.5;
      const estimatedWords = Math.max(0, Math.floor(currentTime * estimatedWordsPerSecond));
      const endIndex = Math.min(estimatedWords, spans.length - 1);

      if (endIndex >= 0) {
        this.clearAllHighlights();
        this.highlightWordsInRange(0, endIndex, '(fallback time estimate)');
      }
    } else {
      this.clearAllHighlights();
    }
  }

  handleSeek(currentTime) {
    try { printl?.(`🔄 Handling seek to: ${currentTime.toFixed(5)}s`); } catch {}

    this.clearAllHighlights();

    // reset processing state
    this.processedTimingIndices.clear();
    this.isInitialHighlightDone = false;
    this.lastHighlightedIndex = 0;
    this.nextTimingToConsider = 0;

    const currentWord = this.findCurrentWordAndHighlight(currentTime);

    if (currentWord) {
      try { printl?.(`✅ Highlighted after seek: "${currentWord.wordData?.word ?? ''}"`); } catch {}
    } else {
      this.estimatePositionFromTime(currentTime);
    }
  }

  handleAudioEnd(audioDuration) {
    const finalTime = audioDuration;
    try { printl?.(`🏁 Audio ended at: ${finalTime.toFixed(5)}s`); } catch {}
    try {
      printl?.(
        `📊 Highlighted ${this.highlightedIndices.size}/${this._spans().length}`
      );
    } catch {}

    const remaining = this._spans().length - this.highlightedIndices.size;
    if (remaining > 0) {
      try {
        printl?.(`🔧 Highlighting remaining ${remaining} words`);
      } catch {}
      this.highlightWordsInRange(
        this.lastHighlightedIndex,
        this._spans().length - 1,
        '(ensure all highlighted at end)'
      );
    }
  }

  async highlightWord(time, audioDuration) {
    if (!Number.isFinite(time) || time < 0) return;
    try { printl?.(`Audio time: ${time.toFixed(5)}s`); } catch {}

    try {
      // Repair span references if the DOM was re-rendered
      this._rehydrateSpansIfDetached();

      this.handleInitialWords(time);
      // perf: process only what's due
      this.processUpToTime(time);
      this.catchUpToCurrentTime(time);

      if (audioDuration && time >= audioDuration - 0.1) {
        const remaining = this._spans().length - this.lastHighlightedIndex;
        if (remaining > 0) {
          this.highlightWordsInRange(
            this.lastHighlightedIndex,
            this._spans().length - 1,
            '(final words at audio end)'
          );
        }
      }
    } catch (error) {
      try { printError?.('Error highlighting words:', error); } catch {}
    }
  }

  startHighlighting(getCurrentTime, getDuration, { preferRAF = true } = {}) {
    // Clear any existing schedulers
    if (this.highlightInterval) { clearInterval(this.highlightInterval); this.highlightInterval = null; }
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }

    const tick = () => {
      try {
        const currentTime = getCurrentTime();
        const duration = getDuration();
        this.highlightWord(currentTime, duration);
      } finally {
        this._rafId = requestAnimationFrame(tick);
      }
    };

    if (preferRAF && typeof requestAnimationFrame === 'function') {
      this._rafId = requestAnimationFrame(tick);
    } else {
      this.highlightInterval = setInterval(() => {
        const currentTime = getCurrentTime();
        const duration = getDuration();
        this.highlightWord(currentTime, duration);
      }, 50);
    }
  }

  stopHighlighting() {
    if (this.highlightInterval) { clearInterval(this.highlightInterval); this.highlightInterval = null; }
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
  }

  /* ---------------- util: forward exact search ---------------- */
  _forwardExactSearch(targetWord, fromIndex, windowSize = this.textProcessor?.referenceWords ?? 10) {
    const spans = this._spans();
    if (!spans.length) return -1;

    const cleanTarget = String(targetWord)
      .toLocaleLowerCase()
      .normalize('NFKC')
      .replace(/[^\p{L}\p{N}’']+/gu, '');

    const start = Math.max(0, fromIndex);
    const end = Math.min(spans.length, start + Math.max(3, windowSize));
    for (let i = start; i < end; i++) {
      const el = this._safeSpan(i);
      if (!el) continue;
      const ow = el.dataset?.originalWord;
      if (ow && ow === cleanTarget) return i;
    }
    return -1;
  }
}
