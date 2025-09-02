// -----word-highlighter.js-------

/**
 * Word highlighting and synchronization with audio
 *
 * Behavior: same as your original implementation, plus a probability gate:
 * we do not paint any match whose bestMatch.probability < minProbability (default 0.8).
 */
export class WordHighlighter {
  constructor(textProcessor) {
    this.textProcessor = textProcessor;

    // state
    this.highlightedIndices = new Set();
    this.loggedWords = new Set();
    this.lastHighlightedIndex = 0;
    this.isInitialHighlightDone = false;
    this.lookaheadMs = 100;
    this.processedTimingIndices = new Set();
    this.currentHighlightedWord = null;

    // probability threshold for painting
    this.minProbability = 0.8;

    // timers & perf
    this.highlightInterval = null;
    this.nextTimingToConsider = 0; // rolling pointer for perf
  }

  // ---------- lifecycle ----------
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

  // ---------- core ops ----------
  clearAllHighlights() {
    this.textProcessor.wordSpans.forEach(span => {
      span.classList.remove('highlight');
    });
    this.highlightedIndices.clear();
    this.lastHighlightedIndex = 0;
    this.currentHighlightedWord = null;
  }

  highlightWordsInRange(startIndex, endIndex, reason = '') {
    const actualStartIndex = Math.max(startIndex, this.lastHighlightedIndex);
    const actualEndIndex = Math.max(endIndex, actualStartIndex);

    for (
      let i = actualStartIndex;
      i <= actualEndIndex && i < this.textProcessor.wordSpans.length;
      i++
    ) {
      if (this.textProcessor.wordSpans[i] && !this.highlightedIndices.has(i)) {
        this.textProcessor.wordSpans[i].classList.add('highlight');
        this.highlightedIndices.add(i);
        this.currentHighlightedWord = this.textProcessor.wordSpans[i];
        printl?.(
          `✨ Highlighted "${this.textProcessor.wordSpans[i].textContent}" @${i} ${reason}`
        );
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
      !this.textProcessor.wordTimings ||
      this.textProcessor.wordTimings.length === 0
    ) return;

    const firstTimedWord = this.textProcessor.wordTimings[0];
    const lookaheadTime = firstTimedWord.time_start - this.lookaheadMs / 1000;

    if (currentTime >= Math.max(0, lookaheadTime) && currentTime < firstTimedWord.time_start) {
      const timeElapsed = currentTime;
      const estimatedWordsPerSecond = 2.5;
      const wordsToHighlight = Math.max(1, Math.floor(timeElapsed * estimatedWordsPerSecond));
      const endIndex = Math.min(wordsToHighlight - 1, this.textProcessor.wordSpans.length - 1);
      this.highlightWordsInRange(0, endIndex, '(initial words before first timed word)');
      printl?.(`🌟 Highlighted ${wordsToHighlight} initial words (${timeElapsed.toFixed(3)}s)`);
    }

    if (currentTime >= firstTimedWord.time_start) {
      this.isInitialHighlightDone = true;
    }
  }

  processWordTiming(wordData, index, currentTime) {
    const lookaheadTime = wordData.time_start - this.lookaheadMs / 1000;

    if (currentTime >= lookaheadTime && !this.processedTimingIndices.has(index)) {
      this.processedTimingIndices.add(index);

      printl?.(
        `🎯 Timing "${wordData.word}" (${this.lookaheadMs}ms early) at ${wordData.time_start.toFixed(
          5
        )}s (now: ${currentTime.toFixed(5)}s)`
      );

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

        if (index < this.textProcessor.wordTimings.length - 1) {
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
        // Gate: do not paint when p < threshold. No fallback painting.
        printl?.(
          `⏭️ Skipping low-confidence match for "${wordData.word}" (p=${p.toFixed(3)})`
        );
      }
    }
  }

  // process only timings that are due by now (perf)
  processUpToTime(currentTime) {
    if (!this.textProcessor.wordTimings) return;
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
    if (!this.textProcessor.wordTimings) return;

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
    if (!this.textProcessor.wordTimings || this.textProcessor.wordTimings.length === 0) {
      printl?.(`⚠️ No word timings for t=${currentTime.toFixed(3)}s`);
      return null;
    }

    for (let i = 0; i < this.textProcessor.wordTimings.length; i++) {
      const wordData = this.textProcessor.wordTimings[i];

      if (currentTime >= wordData.time_start && currentTime <= wordData.time_end) {
        printl?.(`🎯 Current word "${wordData.word}" @ ${currentTime.toFixed(3)}s`);

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
            bestMatch.index,
            `(seek target p=${p.toFixed(3)})`
          );

          return { wordData, textIndex: bestMatch.index };
        }

        // Gate: no highlight if below threshold
        return { wordData, textIndex: -1 };
      }
    }

    // nearest previous
    let closestWord = null;
    let closestIndex = -1;

    for (let i = 0; i < this.textProcessor.wordTimings.length; i++) {
      const wordData = this.textProcessor.wordTimings[i];
      if (wordData.time_start <= currentTime) {
        closestWord = wordData;
        closestIndex = i;
      } else {
        break;
      }
    }

    if (closestWord) {
      printl?.(`🎯 Closest previous "${closestWord.word}" @ ${currentTime.toFixed(3)}s`);

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
          bestMatch.index,
          `(seek closest p=${p.toFixed(3)})`
        );

        return { wordData: closestWord, textIndex: bestMatch.index };
      }
    }

    printl?.(`⚠️ No suitable high-confidence word for t=${currentTime.toFixed(3)}s`);
    return null;
  }

  estimatePositionFromTime(currentTime) {
    if (!this.textProcessor.wordTimings || this.textProcessor.wordTimings.length === 0) {
      const estimatedWordsPerSecond = 2.5;
      const estimatedWords = Math.max(0, Math.floor(currentTime * estimatedWordsPerSecond));
      const endIndex = Math.min(estimatedWords, this.textProcessor.wordSpans.length - 1);

      if (endIndex >= 0) {
        this.clearAllHighlights();
        this.highlightWordsInRange(0, endIndex, '(time-based estimate)');
      }
      return;
    }

    let lastWordIndex = -1;
    let lastTextIndex = -1;

    for (let i = 0; i < this.textProcessor.wordTimings.length; i++) {
      if (this.textProcessor.wordTimings[i].time_start <= currentTime) {
        lastWordIndex = i;
      } else {
        break;
      }
    }

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
      this.highlightWordsInRange(0, lastTextIndex, '(seek position estimate)');
    } else if (currentTime > 0) {
      const estimatedWordsPerSecond = 2.5;
      const estimatedWords = Math.max(0, Math.floor(currentTime * estimatedWordsPerSecond));
      const endIndex = Math.min(estimatedWords, this.textProcessor.wordSpans.length - 1);

      if (endIndex >= 0) {
        this.clearAllHighlights();
        this.highlightWordsInRange(0, endIndex, '(fallback time estimate)');
      }
    } else {
      this.clearAllHighlights();
    }
  }

  handleSeek(currentTime) {
    printl?.(`🔄 Handling seek to: ${currentTime.toFixed(5)}s`);

    this.clearAllHighlights();

    // reset processing state
    this.processedTimingIndices.clear();
    this.isInitialHighlightDone = false;
    this.lastHighlightedIndex = 0;
    this.nextTimingToConsider = 0;

    const currentWord = this.findCurrentWordAndHighlight(currentTime);

    if (currentWord) {
      printl?.(`✅ Highlighted after seek: "${currentWord.wordData?.word ?? ''}"`);
    } else {
      this.estimatePositionFromTime(currentTime);
    }
  }

  handleAudioEnd(audioDuration) {
    const finalTime = audioDuration;
    printl?.(`🏁 Audio ended at: ${finalTime.toFixed(5)}s`);
    printl?.(
      `📊 Highlighted ${this.highlightedIndices.size}/${this.textProcessor.wordSpans.length}`
    );

    if (this.highlightedIndices.size < this.textProcessor.wordSpans.length) {
      printl?.(
        `🔧 Highlighting remaining ${
          this.textProcessor.wordSpans.length - this.highlightedIndices.size
        } tokens`
      );
      this.highlightWordsInRange(
        this.lastHighlightedIndex,
        this.textProcessor.wordSpans.length - 1,
        '(ensure all highlighted at end)'
      );
    }
  }

  async highlightWord(time, audioDuration) {
    try {
      printl?.(`Audio time: ${time.toFixed(5)}s`);

      this.handleInitialWords(time);

      // perf: process only what's due
      this.processUpToTime(time);

      this.catchUpToCurrentTime(time);

      if (audioDuration && time >= audioDuration - 0.1) {
        const remaining = this.textProcessor.wordSpans.length - this.lastHighlightedIndex;
        if (remaining > 0) {
          this.highlightWordsInRange(
            this.lastHighlightedIndex,
            this.textProcessor.wordSpans.length - 1,
            '(final tokens at audio end)'
          );
        }
      }
    } catch (error) {
      printError?.('Error highlighting words:', error);
    }
  }

  startHighlighting(getCurrentTime, getDuration) {
    if (this.highlightInterval) clearInterval(this.highlightInterval);

    this.highlightInterval = setInterval(() => {
      const currentTime = getCurrentTime();
      const duration = getDuration();
      this.highlightWord(currentTime, duration);
    }, 50);
  }

  stopHighlighting() {
    if (this.highlightInterval) {
      clearInterval(this.highlightInterval);
      this.highlightInterval = null;
    }
  }
}