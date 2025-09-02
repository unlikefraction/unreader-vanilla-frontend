// -----main.js-----

import { AudioCore } from './landing-audio/audio-core.js';
import { TextProcessor } from './landing-audio/text-processor.js';
import { WordHighlighter } from './landing-audio/word-highlighter.js';
import { ReadAlong } from './read-along.js';
import { PlaybackControls } from './playback-controls.js';
import { ParagraphSeeker } from './paragraph-seeker.js';

/**
 * Main audio system that orchestrates all components
 */
export class AudioSystem {
  constructor(audioFile, timingFile, textFile, offsetMs = 0) {
    // Initialize core components
    this.audioCore = new AudioCore(audioFile, offsetMs);
    this.textProcessor = new TextProcessor(textFile, timingFile, offsetMs);
    this.highlighter = new WordHighlighter(this.textProcessor);
    // ensure the 0.7 gate is applied even if defaults change later
    if (typeof this.highlighter.minProbability === 'number') {
      this.highlighter.minProbability = 0.7;
    }
    this.readAlong = new ReadAlong(this.highlighter);
    this.playbackControls = new PlaybackControls(this.audioCore);
    this.paragraphSeeker = new ParagraphSeeker(this.textProcessor, this.audioCore);

    // Setup component connections
    this.setupConnections();
  }

  setupConnections() {
    // Connect audio events to highlighter
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

    // Connect highlighter to read-along: pass a concrete element if possible
    const originalHighlightWordsInRange = this.highlighter.highlightWordsInRange.bind(this.highlighter);
    this.highlighter.highlightWordsInRange = (startIndex, endIndex, reason = '') => {
      originalHighlightWordsInRange(startIndex, endIndex, reason);
      try {
        const el =
          this.highlighter.currentWordEl ||
          this.highlighter.currentHighlightedWord ||
          (typeof this.highlighter.getCurrentWordEl === 'function'
            ? this.highlighter.getCurrentWordEl()
            : null);
        this.readAlong.onWordHighlighted(el || null);
      } catch {
        try { this.readAlong.onWordHighlighted(null); } catch {}
      }
    };

    // Setup audio controls
    if (typeof this.audioCore.setupEventListeners === 'function') {
      this.audioCore.setupEventListeners();
    }
  }

  // Public API methods
  async init() {
    try { if (typeof printl === 'function') printl('🎵 Initializing audio system...'); } catch {}

    try {
      // Initialize text processor first
      await this.textProcessor.init();
      try { if (typeof printl === 'function') printl('✅ Text processor initialized'); } catch {}

      // Build the DOM spans before we start highlighting (MANDATORY)
      if (typeof this.textProcessor.separateText === 'function') {
        await this.textProcessor.separateText();
        try { if (typeof printl === 'function') printl('✅ Text separated into word spans'); } catch {}
      }

      // Setup audio core
      this.audioCore.setupAudio();
      try { if (typeof printl === 'function') printl('✅ Audio core initialized'); } catch {}

      // Enable paragraph hover navigation if available
      if (this.paragraphSeeker && typeof this.paragraphSeeker.enableParagraphNavigation === 'function') {
        this.paragraphSeeker.enableParagraphNavigation();
        try { if (typeof printl === 'function') printl('✅ Paragraph navigation enabled'); } catch {}
      } else {
        try { if (typeof printl === 'function') printl('⚠️ Paragraph navigation not available (method missing)'); } catch {}
      }

      try { if (typeof printl === 'function') printl('🚀 Audio system ready!'); } catch {}

    } catch (error) {
      try { if (typeof printError === 'function') printError('❌ Error initializing audio system:', error); else console.error('❌ Error initializing audio system:', error); } catch {}
      throw error;
    }
  }

  // Audio control methods
  async play() {
    await this.audioCore.playAudio();
  }

  pause() {
    this.audioCore.pauseAudio();
  }

  toggle() {
    this.audioCore.toggleAudio();
  }

  forward() {
    this.audioCore.forward();
  }

  rewind() {
    this.audioCore.rewind();
  }

  setPlaybackSpeed(speed) {
    this.audioCore.setPlaybackSpeed(speed);
  }

  getCurrentTime() {
    return this.audioCore.getCurrentTime();
  }

  getDuration() {
    return this.audioCore.getDuration();
  }

  // Highlighting control methods
  clearHighlights() {
    this.highlighter.clearAllHighlights();
  }

  // Read-along control methods
  toggleReadAlong() {
    if (typeof this.readAlong.toggle === 'function') return this.readAlong.toggle();
    // fallback if API is different
    if (typeof this.readAlong.toggleAuto === 'function') return this.readAlong.toggleAuto();
  }

  isReadAlongActive() {
    return !!this.readAlong.isActive;
  }

  // Playback control methods
  getCurrentSpeed() {
    return this.playbackControls.getCurrentSpeed();
  }

  setSpeed(speed) {
    this.playbackControls.setSpeed(speed);
  }

  // Paragraph seeking methods
  async seekToParagraph(paragraphText, options = {}) {
    return await this.paragraphSeeker.seekToParagraph(paragraphText, options);
  }

  async seekToParagraphs(paragraphTexts, options = {}) {
    return await this.paragraphSeeker.seekToParagraphs(paragraphTexts, options);
  }

  extractParagraphs() {
    return this.paragraphSeeker.extractParagraphs();
  }

  // Configuration methods for paragraph seeking
  setParagraphSeekingThreshold(threshold) {
    this.paragraphSeeker.setMinProbabilityThreshold(threshold);
  }

  setParagraphContextWindow(windowSize) {
    this.paragraphSeeker.setContextWindow(windowSize);
  }

  // Convenience methods
  async seekToText(text) {
    try { if (typeof printl === 'function') printl(`🔍 Seeking to text: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`); } catch {}
    return await this.seekToParagraph(text);
  }

  async seekToSentence(sentence) {
    try { if (typeof printl === 'function') printl(`🔍 Seeking to sentence: "${sentence}"`); } catch {}
    return await this.seekToParagraph(sentence);
  }

  // Interactive paragraph navigation
  async createParagraphNavigation() {
    const paragraphs = this.extractParagraphs();

    if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
      try { if (typeof printError === 'function') printError('No paragraphs found in text'); else console.error('No paragraphs found in text'); } catch {}
      return [];
    }

    try { if (typeof printl === 'function') printl(`📝 Found ${paragraphs.length} paragraphs`); } catch {}

    // Create clickable paragraph navigation
    const navItems = paragraphs.map((paragraph, index) => ({
      index,
      text: paragraph,
      preview: paragraph.substring(0, 100) + (paragraph.length > 100 ? '...' : ''),
      seekTo: async () => {
        const result = await this.seekToParagraph(paragraph);
        if (result?.success) {
          try { if (typeof printl === 'function') printl(`✅ Navigated to paragraph ${index + 1}`); } catch {}
        } else {
          try { if (typeof printError === 'function') printError(`❌ Failed to navigate to paragraph ${index + 1}:`, result?.error); else console.error('Failed to navigate', result); } catch {}
        }
        return result;
      }
    }));

    return navItems;
  }

  // Paragraph navigation control methods
  enableParagraphNavigation() {
    if (this.paragraphSeeker && typeof this.paragraphSeeker.enableParagraphNavigation === 'function') {
      this.paragraphSeeker.enableParagraphNavigation();
    } else {
      try { if (typeof printError === 'function') printError('Paragraph navigation not available'); else console.error('Paragraph navigation not available'); } catch {}
    }
  }

  disableParagraphNavigation() {
    if (this.paragraphSeeker && typeof this.paragraphSeeker.disableParagraphNavigation === 'function') {
      this.paragraphSeeker.disableParagraphNavigation();
    } else {
      try { if (typeof printError === 'function') printError('Paragraph navigation not available'); else console.error('Paragraph navigation not available'); } catch {}
    }
  }

  refreshParagraphNavigation() {
    if (this.paragraphSeeker && typeof this.paragraphSeeker.refreshParagraphNavigation === 'function') {
      this.paragraphSeeker.refreshParagraphNavigation();
    } else {
      try { if (typeof printError === 'function') printError('Paragraph navigation not available'); else console.error('Paragraph navigation not available'); } catch {}
    }
  }

  // Cleanup method
  destroy() {
    this.highlighter.stopHighlighting();
    this.playbackControls?.destroy?.();
    if (this.audioCore?.sound) {
      try { this.audioCore.sound.unload(); } catch {}
    }
    try { if (typeof printl === 'function') printl('🧹 Audio system destroyed'); } catch {}
  }
}

// Create and initialize the audio system
const audioSystem = new AudioSystem(
  'https://cdn.unlikefraction.com/suckAtReading.wav',
  '/order/word_timings_ordered.json',
  '/transcript/landing.html',
  -100
);

// Make it globally available
window.audioSystem = audioSystem;
window.audioSetup = audioSystem; // Keep backward compatibility

// Initialize the system
audioSystem.init().catch(error => {
  try { if (typeof printError === 'function') printError('Failed to initialize audio system:', error); else console.error('Failed to initialize audio system:', error); } catch {}
});

// Add some convenience global functions for easy testing
window.seekToParagraph = (text) => audioSystem.seekToParagraph(text);
window.seekToText = (text) => audioSystem.seekToText(text);
window.extractParagraphs = () => audioSystem.extractParagraphs();
