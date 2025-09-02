// -------playback-controls.js--------

// Mic input is lazy: no permissions until .hold-up is clicked.
// Input dropdown shows a placeholder by default.
// If the user denies mic permission, we show a one-time alert and avoid re-requesting
// until they manually enable and reload.

export class PlaybackControls {
  constructor() {
    this._currentStream = null;
    this._currentInputId = null;
    this._holdupStarted = false;

    this._micPermissionBlocked = false; // sticky after explicit deny
    this._onDeviceChange = this._refreshDevices.bind(this);

    const boot = () => {
      this._setupInitialInputUI();  // placeholder only
      this._bindSettingsDialog();   // dialog only, no device work
      this._bindHoldUpTrigger();    // permission unlock + list + mic on click
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
      boot();
    }
  }

  // ----- UI: placeholder text in the input select -----
  _setupInitialInputUI() {
    const inputSelect = document.querySelector('#input-device select.device-select');
    if (!inputSelect) {
      this._logErr('Input device select element not found');
      return;
    }
    this._setPlaceholder(inputSelect);
  }

  _setPlaceholder(selectEl) {
    selectEl.innerHTML = '';
    const opt = document.createElement('option');
    opt.value = '';
    opt.text = 'Input device selector when using holdup';
    opt.disabled = true;
    opt.selected = true;
    selectEl.append(opt);
  }

  // ----- Holdup trigger: unlock permission → enumerate → choose mic → request exact device -----
  _bindHoldUpTrigger() {
    const holdBtn = document.querySelector('.hold-up');
    if (!holdBtn) {
      this._logErr('.hold-up button not found');
      return;
    }

    holdBtn.addEventListener('click', async () => {
      if (this._micPermissionBlocked) return this._showMicPermissionHelp();

      this._holdupStarted = true;

      // 1) Unlock permission so enumerateDevices returns real IDs + labels
      const ok = await this._ensurePermissionUnlock();
      if (!ok) return; // user denied or unlock failed

      // 2) Build input device list
      await this._refreshDevices();

      // 3) Pick selection (first option if none chosen), then request that exact device
      const inputSelect = document.querySelector('#input-device select.device-select');
      if (!inputSelect) return;

      const firstReal = [...inputSelect.options].find(o => o.value);
      if (firstReal) {
        if (!inputSelect.value) inputSelect.value = firstReal.value;
        await this._setInput(inputSelect.value);
      } else {
        alert('No microphones detected. Please connect a mic and try again.');
      }
    });
  }

  // One-shot permission unlock (stop tracks immediately)
  async _ensurePermissionUnlock() {
    // HTTPS/localhost is required for full media APIs in most browsers.
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
      this._logErr('Non-secure context; media device enumeration may fail. Use HTTPS or localhost.');
    }

    // If the Permissions API already says "denied", don't even prompt.
    if (await this._isMicPermanentlyDenied()) {
      this._micPermissionBlocked = true;
      this._showMicPermissionHelp();
      return false;
    }

    try {
      const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
      tmp.getTracks().forEach(t => t.stop());
      // allow labels to propagate to enumerateDevices
      await new Promise(r => setTimeout(r, 0));
      return true;
    } catch (e) {
      if (e && (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError')) {
        this._micPermissionBlocked = true;
        this._showMicPermissionHelp();
        return false;
      }
      if (e && e.name === 'NotFoundError') {
        alert('No microphone found. Plug one in and try again.');
        return false;
      }
      this._logErr('getUserMedia failed during permission unlock:', e);
      return false;
    }
  }

  // Build/refresh the input devices list; attach change handler the first time.
  async _refreshDevices() {
    const inputSelect = document.querySelector('#input-device select.device-select');
    if (!inputSelect) {
      this._logErr('Input device select element not found');
      return;
    }

    let devices = [];
    try {
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch (e) {
      this._logErr('enumerateDevices failed:', e);
      this._setPlaceholder(inputSelect);
      return;
    }

    const prev = inputSelect.value;
    inputSelect.innerHTML = '';
    let count = 0;

    for (const d of devices) {
      if (d.kind !== 'audioinput') continue;
      const opt = document.createElement('option');
      opt.value = d.deviceId;                  // concrete IDs after unlock
      opt.text  = d.label || 'Microphone';     // labels visible post-unlock
      inputSelect.append(opt);
      count++;
    }

    if (count === 0) {
      // As a fallback, try one more unlock-then-enumerate (some UAs are finicky)
      const ok = this._holdupStarted ? await this._ensurePermissionUnlock() : false;
      if (ok) return this._refreshDevices();
      this._setPlaceholder(inputSelect);
    } else {
      // restore prior selection if still valid
      if (prev && [...inputSelect.options].some(o => o.value === prev)) {
        inputSelect.value = prev;
      }
      // bind change only once
      if (!inputSelect.dataset.bound) {
        inputSelect.addEventListener('change', () => this._setInput(inputSelect.value));
        inputSelect.dataset.bound = 'true';
      }
    }

    // devicechange only after holdup begins to avoid background churn
    navigator.mediaDevices.removeEventListener('devicechange', this._onDeviceChange);
    if (this._holdupStarted) {
      navigator.mediaDevices.addEventListener('devicechange', this._onDeviceChange);
    }
  }

  // Actually request the selected mic (after holdup click).
  async _setInput(id) {
    if (!this._holdupStarted) return; // guard: never request early
    if (this._micPermissionBlocked) return this._showMicPermissionHelp();

    // If Permissions API says denied, don't call getUserMedia again.
    if (await this._isMicPermanentlyDenied()) {
      this._micPermissionBlocked = true;
      return this._showMicPermissionHelp();
    }

    try {
      if (this._currentStream) {
        this._currentStream.getTracks().forEach(t => t.stop());
        this._currentStream = null;
      }

      this._currentStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: id ? { exact: id } : undefined }
      });

      this._currentInputId = id || null;
      this._log(`🎤 Input device selected: ${id || 'default'}`);
    } catch (e) {
      if (e && (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError')) {
        this._micPermissionBlocked = true;
        return this._showMicPermissionHelp();
      }
      if (e && e.name === 'NotFoundError') {
        alert('No microphone found. Plug one in and try again.');
        return;
      }
      this._logErr('Input device error:', e);
    }
  }

  // ----- Settings dialog: open reliably -----
  _bindSettingsDialog() {
    const gearBtn = document.querySelector('.settings.control');
    const settingsD = document.querySelector('.settingsDialog');

    if (!gearBtn || !settingsD) {
      // If your DOM mounts later, ctor already handled DOMContentLoaded.
      this._logErr('Settings dialog elements not found');
      return;
    }

    // Ensure it opens even if clicks bubble: stop propagation on the gear.
    gearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      settingsD.classList.toggle('active');
      gearBtn.classList.toggle('active');
      gearBtn.setAttribute('aria-expanded', settingsD.classList.contains('active') ? 'true' : 'false');
      settingsD.setAttribute('aria-hidden', settingsD.classList.contains('active') ? 'false' : 'true');
    });

    // Close on outside click.
    document.addEventListener('click', (e) => {
      if (!settingsD.contains(e.target) && !gearBtn.contains(e.target)) {
        settingsD.classList.remove('active');
        gearBtn.classList.remove('active');
        gearBtn.setAttribute('aria-expanded', 'false');
        settingsD.setAttribute('aria-hidden', 'true');
      }
    });

    // Close on Escape.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        settingsD.classList.remove('active');
        gearBtn.classList.remove('active');
        gearBtn.setAttribute('aria-expanded', 'false');
        settingsD.setAttribute('aria-hidden', 'true');
      }
    });
  }

  // ----- Permission helpers -----
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
      "• Chrome/Edge: Lock icon → Site settings → Allow Microphone.\n" +
      "• Safari: Settings → Websites → Microphone → Allow for this site.\n" +
      "• Firefox: Lock icon → Connection settings → Permissions → Microphone.\n\n" +
      "After enabling, reload and press Hold Up again."
    );
  }

  // ----- Public API -----
  getCurrentInputId() { return this._currentInputId || null; }
  getCurrentStream()  { return this._currentStream || null; }

  destroy() {
    try {
      navigator.mediaDevices.removeEventListener('devicechange', this._onDeviceChange);
    } catch {}
    if (this._currentStream) {
      this._currentStream.getTracks().forEach(t => t.stop());
      this._currentStream = null;
    }
  }

  // ----- tiny log helpers -----
  _log(...a)    { try { if (typeof printl === 'function') printl(...a); } catch {} }
  _logErr(...a) { try { if (typeof printError === 'function') printError(...a); } catch { console.error(...a); } }
}
