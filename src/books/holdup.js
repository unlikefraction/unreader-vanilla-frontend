// holdup.js

function getCookie(name) {
  const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[2]) : null;
}
function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/&[a-z0-9#]+;/gi, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export class HoldupManager {
  /**
   * @param {object} opts
   * @param {string|number} opts.userBookId
   * @param {string} opts.bookTitle
   * @param {object} [opts.callbacks]
   * @param {number} [opts.inactivityMs=300000]
   */
  constructor({ userBookId, bookTitle, callbacks = {}, inactivityMs = 300000 } = {}) {
    this.userBookId = userBookId;
    this.bookSlug = slugify(bookTitle || 'book');

    this.lk = null;
    this.room = null;
    this.localMicTrack = null;

    this._connected = false;
    this._connecting = false;
    this._currentPage = null;
    this._currentRoomName = null;

    // start fully muted by default (remote + mic)
    this._outputMuted = true; // remote/output mute state

    this._cb = {
      onEngageStart: typeof callbacks.onEngageStart === 'function' ? callbacks.onEngageStart : null,
      onEngageEnd: typeof callbacks.onEngageEnd === 'function' ? callbacks.onEngageEnd : null,
      onRemoteAudioStart: typeof callbacks.onRemoteAudioStart === 'function' ? callbacks.onRemoteAudioStart : null,
      onRemoteAudioStop: typeof callbacks.onRemoteAudioStop === 'function' ? callbacks.onRemoteAudioStop : null,
    };

    this._inactivityMs = Math.max(60000, inactivityMs | 0);
    this._lastActivityAt = Date.now();
    this._inactivityTimer = null;
    this._localAudioActive = false;

    // NEW: sticky mic-permission denial; once set, we never re-request this session
    this._micPermissionBlocked = false;

    this._ensureStatusOutlet();
    this._bindHoldUpButton();
    this._setStatus('Idle');

    // Default: no state classes applied (starts muted)
    this._setHoldupBtn({ disabled: false, connecting: false, loading: false, active: false });
  }

  /* -------------------- UI helpers -------------------- */
  _ensureStatusOutlet() {
    const host = document.querySelector('.holdup') || document.body;
    // reserved for future status outlet
  }
  _setStatus(text) {
    const el = document.querySelector('.holdup');
    if (el) el.textContent = text;
  }
  _bindHoldUpButton() {
    const btn = document.querySelector('.hold-up');
    if (!btn) return;
    btn.addEventListener('click', () => this.toggleMute().catch(e => console.warn('toggleMute err', e)));
  }
  /**
   * Manage state classes on the .hold-up button.
   * We DO NOT change innerHTML/text; we only toggle classes.
   * States:
   *  - connecting: when establishing LiveKit connection or switching pages
   *  - loading: when user just pressed to change mute state (optimistic spinner)
   *  - active: conversation engaged (remote unmuted; mic attempted)
   * Default (muted & idle): no classes.
   */
  _setHoldupBtn({ disabled = false, connecting = false, loading = false, active = false } = {}) {
    const btn = document.querySelector('.hold-up');
    if (!btn) return;

    btn.disabled = !!disabled;

    // Reset all our managed classes first
    btn.classList.remove('loading', 'loading', 'active');

    // Apply as requested
    if (connecting) btn.classList.add('loading');
    if (loading) btn.classList.add('loading');
    if (active) btn.classList.add('active');
  }

  /* -------------------- activity / inactivity -------------------- */
  bumpActivity() { this._lastActivityAt = Date.now(); }
  noteLocalAudioActivity(isActive) { this._localAudioActive = !!isActive; this.bumpActivity(); }
  _startInactivityWatch() {
    if (this._inactivityTimer) clearInterval(this._inactivityTimer);
    this._inactivityTimer = setInterval(() => {
      const idleFor = Date.now() - this._lastActivityAt;
      if (idleFor >= this._inactivityMs && !this._localAudioActive) {
        this.disconnect().catch(() => {});
        this._setStatus('Disconnected (idle)');
      }
    }, 15000);
  }

  /* -------------------- livekit plumbing -------------------- */
  async _ensureLiveKit() {
    if (this.lk) return this.lk;
    const mod = await import('https://cdn.jsdelivr.net/npm/livekit-client@latest/dist/livekit-client.esm.mjs');
    this.lk = { Room: mod.Room, RoomEvent: mod.RoomEvent, createLocalAudioTrack: mod.createLocalAudioTrack };
    return this.lk;
  }
  _roomNameFor(pageNumber) {
    const pn = Number(pageNumber) || 0;
    return `page-${pn}-${this.bookSlug}`;
  }
  
  async _generateToken({ roomName, metadata }) {
    const token = getCookie('authToken');
    if (!token) throw new Error('Missing auth token');
    const base = window.API_URLS?.BASE;
    if (!base) throw new Error('Missing window.API_URLS.BASE');
    const body = { room: roomName, userbook_id: Number(this.userBookId), metadata };
    const res = await fetch(`${base}/holdup/generate-token/`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  
    // ✨ 402 handling
    if (res.status === 402) {
      handle402AndRedirect();
      throw new Error('Payment Required (402)');
    }
  
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Token request failed (${res.status}): ${t}`);
    }
  
    const json = await res.json();
    const roomUrl = json.room_url || json.url || json.livekit_url;
    const jwt = json.token;
    if (!roomUrl || !jwt) throw new Error('Token response missing room_url or token');
    return { roomUrl, token: jwt };
  }
  

  /* -------------------- remote audio soft-mute helpers -------------------- */
  _applyOutputMuteState() {
    document.querySelectorAll('audio[data-lk-remote]').forEach(el => {
      try {
        el.muted = this._outputMuted;
        el.volume = this._outputMuted ? 0 : 1;
      } catch {}
    });
  }

  /* -------------------- mic permission helpers -------------------- */
  async _isMicPermanentlyDenied() {
    try {
      if (!('permissions' in navigator) || !navigator.permissions?.query) return false;
      const st = await navigator.permissions.query({ name: 'microphone' });
      return st.state === 'denied';
    } catch {
      return false; // Safari/older browsers: fall back to sticky flag
    }
  }
  _showMicPermissionHelp() {
    alert(
      "Microphone access is blocked for this site.\n\n" +
      "Enable it manually and reload:\n" +
      "• Chrome/Edge: Click the lock icon → Site settings → Allow Microphone.\n" +
      "• Safari: Settings → Websites → Microphone → Allow for this site.\n" +
      "• Firefox: Lock icon → Connection settings → Permissions → Microphone.\n\n" +
      "After enabling, reload and press Hold Up again."
    );
  }
  _getSelectedInputDeviceId() {
    const sel = document.querySelector('#input-device select.device-select');
    return sel && sel.value ? sel.value : null;
  }

  /* -------------------- public API -------------------- */
  async connectForPage({ pageNumber, metadata }) {
    await this._ensureLiveKit();
    const roomName = this._roomNameFor(pageNumber);

    await this.disconnect(); // fresh room every page

    this._connecting = true;
    this._setStatus(`Connecting… (${roomName})`);
    this._setHoldupBtn({ disabled: true, connecting: true, loading: false, active: false });

    const { Room, RoomEvent } = this.lk;
    const { roomUrl, token } = await this._generateToken({ roomName, metadata });

    const room = new Room();
    this.room = room;

    room
      .on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === 'audio') {
          const el = track.attach();
          el.setAttribute('data-lk-remote', '1');
          el.setAttribute('playsinline', '');
          el.autoplay = true;
          if (window.HOLDUP_DEBUG_AUDIO) el.controls = true;
          el.style.cssText = window.HOLDUP_DEBUG_AUDIO
            ? 'position:fixed;bottom:8px;left:8px;z-index:99999;'
            : 'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;';
          document.body.appendChild(el);

          // honor our global output mute immediately
          this._applyOutputMuteState();

          if (!this._outputMuted && this._cb.onRemoteAudioStart) {
            try { this._cb.onRemoteAudioStart(); } catch {}
          }
        }
      })
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track?.kind === 'audio') {
          try { track.detach().forEach(n => n.remove()); } catch {}
          if (this._cb.onRemoteAudioStop) { try { this._cb.onRemoteAudioStop(); } catch {} }
        }
      })
      .on(RoomEvent.Disconnected, () => {
        this._connected = false;
        this._connecting = false;
        this._setStatus('Disconnected');
        this._setHoldupBtn({ disabled: false, connecting: false, loading: false, active: false });
        this.localMicTrack = null;
        document.querySelectorAll('audio[data-lk-remote]').forEach(el => { try { el.remove(); } catch {} });
      });

    await room.connect(roomUrl, token);
    try { await room.startAudio?.(); } catch {}

    this._connected = true;
    this._connecting = false;
    this._currentPage = pageNumber;
    this._currentRoomName = roomName;
    try { if (window.Analytics) window.Analytics.capture('holdup_connect', { page_number: pageNumber, room: roomName }); } catch {}

    // IMPORTANT: do NOT request/publish mic here.
    // We only request the mic when the user actually unmutes via toggleMute().
    this._outputMuted = true;
    this._applyOutputMuteState();

    this._setStatus('Connected (muted)');
    this._setHoldupBtn({ disabled: false, connecting: false, loading: false, active: false });
    this._startInactivityWatch();
    this.bumpActivity();
  }

  async switchToPage({ pageNumber, metadata }) {
    this._setStatus('Switching page…');
    this._setHoldupBtn({ disabled: true, connecting: true, loading: false, active: false });
    await this.connectForPage({ pageNumber, metadata });
  }

  async toggleMute() {
    if (this._connecting) return;
    if (!this.room) return;

    // optimistic feedback: entering a transition
    this._setHoldupBtn({ disabled: true, connecting: false, loading: true, active: false });

    const micIsMuted = this.localMicTrack ? (this.localMicTrack.isMuted ?? true) : true;
    const currentlyMuted = this._outputMuted && micIsMuted;

    if (currentlyMuted) {
      // UNMUTE: remote first (instant feedback), then mic (if allowed)
      this._outputMuted = false;
      this._applyOutputMuteState();

      // try to create/publish mic lazily, respecting selected input and denial stickiness
      if (!this._micPermissionBlocked) {
        if (await this._isMicPermanentlyDenied()) {
          this._micPermissionBlocked = true;
          this._showMicPermissionHelp();
          try { if (window.Analytics) window.Analytics.capture('holdup_mic_permission_denied', { page_number: this._currentPage || null }); } catch {}
        } else {
          try {
            if (!this.localMicTrack) {
              const deviceId = this._getSelectedInputDeviceId();
              const opts = deviceId ? { deviceId } : {};
              this.localMicTrack = await this.lk.createLocalAudioTrack(opts);
              await this.room.localParticipant.publishTrack(this.localMicTrack);
            }
            await this.localMicTrack?.unmute?.();
          } catch (e) {
            // explicit deny → sticky + show help; other errors get a soft warning
            if (e && (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError')) {
              this._micPermissionBlocked = true;
              this._showMicPermissionHelp();
              try { if (window.Analytics) window.Analytics.capture('holdup_mic_permission_denied', { page_number: this._currentPage || null }); } catch {}
            } else if (e && e.name === 'NotFoundError') {
              alert('No microphone found. Plug one in and try again.');
            } else {
              console.warn('[Holdup] mic create/publish failed:', e);
            }
          }
        }
      }

      this._setStatus('Listening…');
      // show active state (we are at least listening to remote)
      this._setHoldupBtn({ disabled: false, connecting: false, loading: false, active: true });
      if (this._cb.onEngageStart) { try { this._cb.onEngageStart(); } catch {} }
      try { if (window.Analytics) window.Analytics.capture('holdup_engage_start', { page_number: this._currentPage || null }); } catch {}
    } else {
      // MUTE: slam remote output to 0 instantly, then mute mic if present
      this._outputMuted = true;
      this._applyOutputMuteState();
      try { await this.localMicTrack?.mute?.(); } catch {}

      this._setStatus('Connected (muted)');
      // back to neutral (no classes)
      this._setHoldupBtn({ disabled: false, connecting: false, loading: false, active: false });
      if (this._cb.onEngageEnd) { try { this._cb.onEngageEnd(); } catch {} }
      try { if (window.Analytics) window.Analytics.capture('holdup_engage_end', { page_number: this._currentPage || null }); } catch {}
    }

    this.bumpActivity();
  }

  async disconnect() {
    try { if (this._inactivityTimer) clearInterval(this._inactivityTimer); } catch {}
    this._inactivityTimer = null;

    if (!this.room) return;

    try { await this.room.disconnect(); }
    catch (e) { console.warn('Holdup disconnect warning:', e); }
    finally {
      this._connected = false;
      this._connecting = false;
      this.localMicTrack = null;
      this.room = null;
      // on disconnect, drop to neutral classes
      this._setHoldupBtn({ disabled: false, connecting: false, loading: false, active: false });
      document.querySelectorAll('audio[data-lk-remote]').forEach(el => { try { el.remove(); } catch {} });
      try { if (window.Analytics) window.Analytics.capture('holdup_disconnect', { page_number: this._currentPage || null }); } catch {}
    }
  }
}
