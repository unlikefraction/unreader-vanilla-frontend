// -----audioAndTextGen.js------
import { AudioCore } from '../audio/audio-core.js';
import { TextProcessor } from '../audio/text-processor.js';
import { WordHighlighter } from '../audio/word-highlighter.js';
import { ReadAlong } from '../audio/read-along.js';
import { ParagraphSeeker } from '../audio/paragraph-seeker.js';
import { PlaybackControls } from '../audio/playback-controls.js';


// Make it a singleton for the whole app, and bind immediately.
if (!window.playbackControls) {
  window.playbackControls = new PlaybackControls();
}

/**
 * Single-page audio/text orchestrator (UI-agnostic).
 * ReadAlong is a singleton shared across pages; MultiPageReader binds it
 * to the ACTIVE page’s highlighter.
 */
export class AudioSystem {
  constructor(audioFile, timingFile, textFile, offsetMs = 0, options = {}) {
    this.audioCore     = new AudioCore(audioFile, offsetMs);
    this.textProcessor = new TextProcessor(textFile, timingFile, offsetMs);
    this.highlighter   = new WordHighlighter(this.textProcessor);
    this.disableWordHighlighting = !!(options && options.disableWordHighlighting);

    // Create the singleton but DO NOT bind here (binding happens in MultiPageReader).
    this.readAlong = ReadAlong.get();

    this.paragraphSeeker = new ParagraphSeeker(this.textProcessor, this.audioCore);
    this._armed = false;

    this.setupConnections();
  }

  setupConnections() {
    // Start/stop/highlight behavior depends on language capability
    if (this.disableWordHighlighting) {
      // Non-English: do not track word-level; on play, just paint the full page once without
      // advancing internal highlighter state (avoid picking a "current word").
      this.audioCore.onPlay(() => {
        try {
          const spans = Array.isArray(this.textProcessor?.wordSpans)
            ? this.textProcessor.wordSpans
            : [];
          for (const el of spans) {
            try { el.classList.add('highlight'); } catch {}
          }
        } catch {}
      });
      // Pause/End/Seek: no word-level updates when disabled
      this.audioCore.onPause(() => {});
      this.audioCore.onEnd(() => {});
      this.audioCore.onSeek(() => {});
    } else {
      // English (or en-*): normal word-level highlighting
      this.audioCore.onPlay(() => {
        this.highlighter.startHighlighting(
          () => this.audioCore.getCurrentTime(),
          () => this.audioCore.getDuration()
        );
      });

      this.audioCore.onPause(() => {
        this.highlighter.stopHighlighting();
      });

      this.audioCore.onEnd(() => {
        this.highlighter.stopHighlighting();
        this.highlighter.handleAudioEnd(this.audioCore.getDuration());
      });

      this.audioCore.onSeek((currentTime) => {
        this.highlighter.handleSeek(currentTime);
      });
    }

    // Notify ReadAlong after words are painted; pass the concrete element if available.
    const original = this.highlighter.highlightWordsInRange.bind(this.highlighter);
    this.highlighter.highlightWordsInRange = (startIndex, endIndex, reason = '') => {
      original(startIndex, endIndex, reason);
      try {
        const el =
          this.highlighter.currentWordEl ||
          this.highlighter.currentHighlightedWord ||
          (typeof this.highlighter.getCurrentWordEl === 'function'
            ? this.highlighter.getCurrentWordEl()
            : null);
        this.readAlong.onWordHighlighted(el || null);
      } catch {
        this.readAlong.onWordHighlighted(null);
      }
    };
  }

  async init() {
    // If you have global log helpers, these will show in console; otherwise no-op.
    try {
      if (typeof printl === 'function') printl('🎵 Initializing audio system...');
    } catch {}
    try {
      await this.textProcessor.init();
      if (typeof printl === 'function') printl('✅ Text processor initialized');

      this.audioCore.setupAudio();
      if (typeof printl === 'function') printl('✅ Audio core initialized');

      // Enable paragraph navigation only on hover-capable, wider screens
      const hoverCapable = !(window.matchMedia && window.matchMedia('(hover: none)').matches);
      const wideEnough = (window.innerWidth || 0) >= 1000;
      if (hoverCapable && wideEnough) {
        this.paragraphSeeker.enableParagraphNavigation?.();
        if (typeof printl === 'function') printl('✅ Paragraph navigation enabled');
      } else {
        if (typeof printl === 'function') printl('📵 Paragraph hover disabled on small/touch screens');
      }

      if (typeof printl === 'function') printl('🚀 Audio system ready!');
    } catch (error) {
      try {
        if (typeof printError === 'function') printError('❌ Error initializing audio system:', error);
        else console.error('❌ Error initializing audio system:', error);
      } catch {}
      throw error;
    }
  }

  // ---------- arm/disarm ----------
  // You can call this if you want ReadAlong to explicitly follow this page
  // (MultiPageReader already rebinds on active page changes).
  arm() {
    this._armed = true;
    try {
      this.readAlong.rebindHighlighter(this.highlighter);
    } catch {}
  }

  disarm() {
    this._armed = false;
    try {
      this.highlighter.stopHighlighting();
      this.audioCore.pauseAudio();
    } catch {}
  }

  // ---------- transport ----------
  async play()          { await this.audioCore.playAudio(); }
  pause()               { this.audioCore.pauseAudio(); }
  toggle()              { this.audioCore.toggleAudio(); }
  forward()             { this.audioCore.forward(); }
  rewind()              { this.audioCore.rewind(); }

  // For compatibility with MultiPageReader (calls setSpeed)
  setSpeed(speed)       { this.audioCore.setPlaybackSpeed(speed); }
  // Also expose a verbose alias if you use it elsewhere
  setPlaybackSpeed(s)   { this.audioCore.setPlaybackSpeed(s); }

  getCurrentTime()      { return this.audioCore.getCurrentTime(); }
  getDuration()         { return this.audioCore.getDuration(); }

  // ---------- highlighting / read-along ----------
  clearHighlights()     { this.highlighter.clearAllHighlights(); }

  /**
   * Toggle the ReadAlong AUTO mode (not the active-follow state directly).
   * When auto is OFF, ReadAlong won’t auto-engage even if the word is near the guide.
   * When auto is ON, it auto-engages only if the current word is within the configured band.
   */
  toggleReadAlong()     { this.readAlong.toggleAuto(); }
  isReadAlongActive()   { return this.readAlong.isActive; }

  // ---------- paragraph seeking ----------
  async seekToParagraph(paragraphText, options = {}) {
    return await this.paragraphSeeker.seekToParagraph(paragraphText, options);
  }
  async seekToParagraphs(paragraphTexts, options = {}) {
    return await this.paragraphSeeker.seekToParagraphs(paragraphTexts, options);
  }
  extractParagraphs()   { return this.paragraphSeeker.extractParagraphs(); }
  setParagraphSeekingThreshold(threshold) { this.paragraphSeeker.setMinProbabilityThreshold(threshold); }
  setParagraphContextWindow(windowSize)   { this.paragraphSeeker.setContextWindow(windowSize); }

  async seekToText(text) {
    try { if (typeof printl === 'function') printl(`🔍 Seeking to text: "${text.slice(0, 50)}${text.length > 50 ? '…' : ''}"`); } catch {}
    return await this.seekToParagraph(text);
  }
  async seekToSentence(sentence) {
    try { if (typeof printl === 'function') printl(`🔍 Seeking to sentence: "${sentence}"`); } catch {}
    return await this.seekToParagraph(sentence);
  }

  enableParagraphNavigation()  { this.paragraphSeeker?.enableParagraphNavigation?.(); }
  disableParagraphNavigation() { this.paragraphSeeker?.disableParagraphNavigation?.(); }
  refreshParagraphNavigation() { this.paragraphSeeker?.refreshParagraphNavigation?.(); }

  destroy() {
    try {
      this.highlighter.stopHighlighting();
      if (this.audioCore?.sound) this.audioCore.sound.unload();
    } catch {}
    try { if (typeof printl === 'function') printl('🧹 Audio system destroyed'); } catch {}
  }
}
