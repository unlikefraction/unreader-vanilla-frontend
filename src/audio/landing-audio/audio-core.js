// ----audio-core.js---------
import { Howl, Howler } from 'howler';

/**
 * Core audio functionality using Howler.js
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
          this.updatePlayButton(false);
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
          this.updatePlayButton(false);
          try { if (window.Analytics) window.Analytics.isAudioPlaying = () => false; } catch {}
          if (this.onErrorCallback) this.onErrorCallback(error);
        },
        onplayerror: (id, error) => {
          printError?.('Audio play error:', error);
          this.isPlaying = false;
          this.updatePlayButton(false);
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
          printl?.(`▶️ Audio started playing from: ${startTime.toFixed(5)}s`);
          try { if (window.Analytics) window.Analytics.isAudioPlaying = () => true; } catch {}
          try { if (window.Analytics) window.Analytics.capture('audio_play', { path: location.pathname, at_s: startTime }); } catch {}
          if (this.onPlayCallback) this.onPlayCallback(startTime);
        },
        onpause: () => {
          const pauseTime = this.getCurrentTime();
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
        this.updatePlayButton(true);
        this.isPlaying = true;
      }
    } catch (error) {
      printError?.('Error playing audio:', error);
      this.updatePlayButton(false);
      this.isPlaying = false;
      if (this.onErrorCallback) this.onErrorCallback(error);
    }
  }

  pauseAudio() {
    if (this.sound && this.sound.playing()) {
      this.sound.pause();
      this.updatePlayButton(false);
      this.isPlaying = false;
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

  updatePlayButton(playing) {
    const playButton = document.querySelector('.playButton');
    if (playButton) {
      const icon = playButton.querySelector('i');
      if (icon) {
        if (playing) {
          icon.className = 'ph ph-pause';
          playButton.classList.remove('paused');
        } else {
          icon.className = 'ph ph-play';
          playButton.classList.add('paused');
        }
      }
    }
  }

  // Event callback setters
  onPlay(callback) { this.onPlayCallback = callback; }
  onPause(callback) { this.onPauseCallback = callback; }
  onEnd(callback) { this.onEndCallback = callback; }
  onSeek(callback) { this.onSeekCallback = callback; }
  onError(callback) { this.onErrorCallback = callback; }

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
