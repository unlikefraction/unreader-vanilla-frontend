// ----audio-core.js---------
import { Howl, Howler } from 'howler';

/**
 * Core audio functionality using Howler.js
 * Headless: no DOM mutations; UI is owned by MultiPageReader.
 */
export class AudioCore {
  static _controlsBound = false; // avoid binding play/ff/rw multiple times

  constructor(audioFile, offsetMs = 0) {
    this.audioFile = audioFile;
    this.offsetMs = offsetMs;
    this.sound = null;
    this.isPlaying = false;
    this.playbackSpeed = 1.0;

    // Event callbacks
    this.onPlayCallback = null;
    this.onPauseCallback = null;
    this.onEndCallback = null;
    this.onSeekCallback = null;
    this.onErrorCallback = null;
  }

  setupAudio() {
    if (!this.sound) {
      this.sound = new Howl({
        src: [this.audioFile],
        html5: false,
        preload: true,
        rate: this.playbackSpeed,
        onend: () => {
          this.isPlaying = false;
          try { if (window.Analytics) window.Analytics.isAudioPlaying = () => false; } catch {}
          try {
            if (window.Analytics) {
              const dur = this.getDuration();
              window.Analytics.capture('audio_end', { path: location.pathname, duration_s: dur });
            }
          } catch {}
          if (this.onEndCallback) this.onEndCallback();
        },
        onloaderror: (id, error) => {
          printError?.('Audio loading error:', error);
          this.isPlaying = false;
          try { if (window.Analytics) window.Analytics.isAudioPlaying = () => false; } catch {}
          if (this.onErrorCallback) this.onErrorCallback(error);
        },
        onplayerror: (id, error) => {
          printError?.('Audio play error:', error);
          this.isPlaying = false;
          try { if (window.Analytics) window.Analytics.isAudioPlaying = () => false; } catch {}
          if (this.onErrorCallback) this.onErrorCallback(error);
        },
        onseek: () => {
          const currentTime = this.getCurrentTime();
          printl?.(`🔄 Audio seeked to: ${currentTime.toFixed(5)}s`);
          if (this.onSeekCallback) this.onSeekCallback(currentTime);
        },
        onplay: () => {
          const startTime = this.getCurrentTime();
          this.isPlaying = true;
          printl?.(`▶️ Audio started playing from: ${startTime.toFixed(5)}s`);
          try { if (window.Analytics) window.Analytics.isAudioPlaying = () => true; } catch {}
          try { if (window.Analytics) window.Analytics.capture('audio_play', { path: location.pathname, at_s: startTime }); } catch {}
          if (this.onPlayCallback) this.onPlayCallback(startTime);
        },
        onpause: () => {
          const pauseTime = this.getCurrentTime();
          this.isPlaying = false;
          printl?.(`⏸️ Audio paused at: ${pauseTime.toFixed(5)}s`);
          try { if (window.Analytics) window.Analytics.isAudioPlaying = () => false; } catch {}
          if (this.onPauseCallback) this.onPauseCallback(pauseTime);
        }
      });
    }
  }

  setPlaybackSpeed(speed) {
    this.playbackSpeed = speed;
    if (this.sound) {
      this.sound.rate(speed);
      printl?.(`⚡ Playback speed set to ${speed.toFixed(1)}x (pitch preserved)`);
    }
  }

  async playAudio() {
    try {
      this.setupAudio();
      if (!this.sound.playing()) {
        this.sound.play();
        // isPlaying flips true in onplay; UI updates happen in MultiPageReader listeners.
      }
    } catch (error) {
      printError?.('Error playing audio:', error);
      this.isPlaying = false;
      if (this.onErrorCallback) this.onErrorCallback(error);
    }
  }

  pauseAudio() {
    if (this.sound && this.sound.playing()) {
      this.sound.pause();
      // isPlaying flips false in onpause; UI updates happen in MultiPageReader listeners.
    }
  }

  toggleAudio() {
    if (this.isPlaying) {
      this.pauseAudio();
    } else {
      this.playAudio();
    }
  }

  forward() {
    if (this.sound) {
      const currentTime = this.sound.seek();
      const duration = this.sound.duration();
      const newTime = Math.min(currentTime + 10, duration);
      this.sound.seek(newTime);
    }
  }

  rewind() {
    if (this.sound) {
      const currentTime = this.sound.seek();
      const newTime = Math.max(currentTime - 10, 0);
      this.sound.seek(newTime);
    }
  }

  getCurrentTime() {
    return this.sound ? this.sound.seek() : 0;
  }

  getDuration() {
    return this.sound ? this.sound.duration() : 0;
  }

  // Event callback setters
  onPlay(callback) { this.onPlayCallback = callback; }
  onPause(callback) { this.onPauseCallback = callback; }
  onEnd(callback) { this.onEndCallback = callback; }
  onSeek(callback) { this.onSeekCallback = callback; }
  onError(callback) { this.onErrorCallback = callback; }

  // Optional: if you really want these global controls here, keep them headless
  setupEventListeners() {
    if (AudioCore._controlsBound) return; // only bind once (first page)
    const playButton = document.querySelector('.playButton');
    const forward = document.querySelector('.forward');
    const rewind = document.querySelector('.rewind');

    if (playButton) {
      playButton.addEventListener('click', () => this.toggleAudio());
    }
    if (forward) {
      forward.addEventListener('click', () => this.forward());
    }
    if (rewind) {
      rewind.addEventListener('click', () => this.rewind());
    }
    AudioCore._controlsBound = true;
  }
}
