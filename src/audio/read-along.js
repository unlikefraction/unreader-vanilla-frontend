// -----read-along.js-----
export class ReadAlong {
  static _instance = null;
  static get(highlighter) {
    if (!ReadAlong._instance) ReadAlong._instance = new ReadAlong(highlighter);
    else if (highlighter) ReadAlong._instance.rebindHighlighter(highlighter);
    return ReadAlong._instance;
  }

  constructor(highlighter) {
    this.highlighter = highlighter;

    this.autoEnabled        = true;
    this.isActive           = true;
    this.activationRadiusPx = 250;

    this.isUserScrolling = false;
    this.scrollTimeout   = null;

    this.heightSetter = null;
    this.isDragging   = false;
    this.startY       = 0;
    this.startTop     = 0;

    this._rafId      = null;
    this._lastWordEl = null;

    this.scrollRoot        = null;
    this._boundOnScrollWin = null;
    this._boundOnScrollRoot= null;

    this._bindUI();
    this._startMonitor();
  }

  _getWordEl() {
    // prefer cached if still in DOM
    if (this._lastWordEl && this._lastWordEl.isConnected) return this._lastWordEl;
    const h = this.highlighter;
    if (!h) return null;
    let el = h.currentHighlightedWord;
    if (el && el.nodeType === 1 && el.isConnected) return el;
    el = h.currentWordEl || h._currentWordEl || h._currentWord || h.lastHighlightedEl;
    if (!el && typeof h.getCurrentWordEl === 'function') el = h.getCurrentWordEl();
    return (el && el.nodeType === 1 && el.isConnected) ? el : null;
  }

  _getComputedStyle(el) { try { return window.getComputedStyle(el); } catch { return { overflow: '', overflowY: '' }; } }

  _detectScrollRoot(fromEl) {
    let node = fromEl?.parentElement || null;
    while (node) {
      const cs = this._getComputedStyle(node);
      const oy = cs.overflowY || cs.overflow;
      if (/(auto|scroll|overlay)/.test(oy) && node.scrollHeight > node.clientHeight + 1) {
        return node;
      }
      node = node.parentElement;
    }
    return document.scrollingElement || document.documentElement || document.body;
  }

  _isWindowRoot(root) {
    return (!root ||
      root === document.scrollingElement ||
      root === document.documentElement ||
      root === document.body);
  }

  _rootRect() {
    if (this._isWindowRoot(this.scrollRoot)) return { top: 0, height: window.innerHeight };
    try {
      const r = this.scrollRoot.getBoundingClientRect();
      return { top: r.top, height: this.scrollRoot.clientHeight };
    } catch {
      return { top: 0, height: window.innerHeight };
    }
  }

  _attachScrollListeners() {
    this._detachScrollListeners();
    this._boundOnScrollWin  = this.onScroll.bind(this);
    this._boundOnScrollRoot = this.onScroll.bind(this);

    window.addEventListener('scroll', this._boundOnScrollWin, { passive: true });

    if (!this._isWindowRoot(this.scrollRoot)) {
      if (this.heightSetter && this.heightSetter.parentElement !== this.scrollRoot) {
        Object.assign(this.heightSetter.style, { position: 'absolute', right: '0' });
        try { this.scrollRoot.appendChild(this.heightSetter); } catch {}
      }
      this.scrollRoot.addEventListener('scroll', this._boundOnScrollRoot, { passive: true });
    } else {
      if (this.heightSetter && this.heightSetter.parentElement !== document.body) {
        document.body.appendChild(this.heightSetter);
        Object.assign(this.heightSetter.style, { position: 'fixed', right: '0' });
      }
    }
  }
  _detachScrollListeners() {
    if (this._boundOnScrollWin) {
      window.removeEventListener('scroll', this._boundOnScrollWin);
    }
    if (this._boundOnScrollRoot && this.scrollRoot && !this._isWindowRoot(this.scrollRoot)) {
      this.scrollRoot.removeEventListener('scroll', this._boundOnScrollRoot);
    }
    this._boundOnScrollWin = null;
    this._boundOnScrollRoot = null;
  }

  _bindUI() {
    this.heightSetter = document.getElementById('heightSetter');
    if (!this.heightSetter) {
      this.heightSetter = document.createElement('div');
      this.heightSetter.id = 'heightSetter';
      Object.assign(this.heightSetter.style, {
        position: 'fixed',
        right: '0',
        height: '0',
        top: '50%',
        borderTop: '2px dashed rgba(0,0,0,0.25)',
        zIndex: '9999',
        cursor: 'grab',
        pointerEvents: 'auto'
      });
      document.body.appendChild(this.heightSetter);
    }
    // Restore last saved top% if available; else keep current or default to 50%
    try {
      const saved = localStorage.getItem('ui:heightSetterTopPercent');
      if (saved != null) {
        const v = Math.max(10, Math.min(90, parseFloat(saved)));
        this.heightSetter.style.top = `${isNaN(v) ? 50 : v}%`;
      } else if (!this.heightSetter.style.top) {
        this.heightSetter.style.top = '50%';
      }
    } catch {
      if (!this.heightSetter.style.top) this.heightSetter.style.top = '50%';
    }
    this._setupHeightSetterDragging();

    let ctrl = document.querySelector('.read-along.control');
    if (!ctrl) {
      ctrl = document.createElement('button');
      ctrl.className = 'read-along control';
      ctrl.type = 'button';
      ctrl.textContent = 'Read-along';
      Object.assign(ctrl.style, { position: 'fixed', bottom: '16px', right: '16px', zIndex: '10000' });
      document.body.appendChild(ctrl);
    }
    this._syncCtrl();
    this._onCtrlClick = () => this.toggleAuto();
    ctrl.addEventListener('click', this._onCtrlClick);
  }

  _syncCtrl() {
    const ctrl = document.querySelector('.read-along.control');
    if (!ctrl) return;
    ctrl.classList.toggle('active', this.autoEnabled);
    ctrl.setAttribute('aria-pressed', String(this.autoEnabled));
    ctrl.title = this.autoEnabled ? 'Auto-follow: ON' : 'Auto-follow: OFF';
  }

  _setupHeightSetterDragging() {
    if (!this.heightSetter) return;

    const startDrag = (clientY, e) => {
      this.isDragging = true;
      this.startY     = clientY;
      this.startTop   = this.getCurrentTopPercent();
      if (e.type.startsWith('mouse')) { this.heightSetter.style.cursor = 'grabbing'; e.preventDefault(); }
    };
    const onDrag = (clientY, e) => {
      if (!this.isDragging) return;
      const vpHeight     = this._rootRect().height;
      const deltaPercent = ((clientY - this.startY) / vpHeight) * 100;
      this.setTopPercent(this.startTop + deltaPercent);
      if (e.type.startsWith('touch')) e.preventDefault();
    };
    const endDrag = () => { if (!this.isDragging) return; this.isDragging = false; this.heightSetter.style.cursor = 'grab'; };

    this._onMouseMove = e => onDrag(e.clientY, e);
    this._onMouseUp   = endDrag;
    this._onTouchMove = e => onDrag(e.touches[0].clientY, e);
    this._onTouchEnd  = endDrag;

    this.heightSetter.addEventListener('mousedown', e => startDrag(e.clientY, e));
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mouseup',   this._onMouseUp);

    this.heightSetter.addEventListener('touchstart', e => startDrag(e.touches[0].clientY, e));
    document.addEventListener('touchmove', this._onTouchMove, { passive: false });
    document.addEventListener('touchend',  this._onTouchEnd);
  }

  _startMonitor() {
    const tick = () => {
      const cur = this._getWordEl();

      if (cur && !this.scrollRoot) {
        this.scrollRoot = this._detectScrollRoot(cur);
        this._attachScrollListeners();
      }

      if (cur && cur !== this._lastWordEl) {
        this._lastWordEl = cur;
        this.onWordHighlighted(cur);
      }
      this._rafId = window.requestAnimationFrame(tick);
    };
    if (!this._rafId) this._rafId = window.requestAnimationFrame(tick);
  }
  _stopMonitor() { if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; } }

  onScroll() {
    this.isUserScrolling = true;

    const el = this._getWordEl();
    if (this.autoEnabled && el) {
      if (!this._isInZone(el)) this.setReadAlongActive(false);
    }

    clearTimeout(this.scrollTimeout);
    this.scrollTimeout = setTimeout(() => this.onScrollEnd(), 250);
  }

  onScrollEnd() {
    this.isUserScrolling = false;
    this.evaluateReadAlongState();
  }

  _isInZone(el) {
    if (!el) return false;
    let rect;
    try {
      rect = el.getBoundingClientRect();
    } catch {
      return false;
    }
    const { top, height } = this._rootRect();
    const linePct         = this.getCurrentTopPercent();
    const lineY           = top + (linePct / 100) * height;
    const diff            = rect.top - lineY;
    return Math.abs(diff) <= this.activationRadiusPx;
  }

  evaluateReadAlongState() {
    if (!this.autoEnabled) return;
    const el = this._getWordEl();
    if (!el) return;

    if (!this.isUserScrolling) {
      if (this._isInZone(el)) {
        this.setReadAlongActive(true);
        this.updateTextPosition();
      } else {
        this.setReadAlongActive(false);
      }
    } else {
      if (!this._isInZone(el)) this.setReadAlongActive(false);
    }
  }

  setReadAlongActive(active) {
    if (this.isActive === active) return;
    this.isActive = active;

    const ctrl = document.querySelector('.read-along.control');
    if (ctrl) ctrl.toggleAttribute('data-following', active);

    if (active) this.updateTextPosition();
  }

  getCurrentTopPercent() {
    return parseFloat((this.heightSetter?.style.top || '50%').replace('%', ''));
  }

  setTopPercent(pct) {
    if (!this.heightSetter) return;
    const clamped = Math.max(10, Math.min(90, pct));
    this.heightSetter.style.top = `${clamped}%`;
    try { localStorage.setItem('ui:heightSetterTopPercent', String(clamped)); } catch {}
    if (this.autoEnabled && this.isActive) this.updateTextPosition();
  }

  setAutoEnabled(enabled) {
    enabled = !!enabled;
    if (this.autoEnabled === enabled) return;
    this.autoEnabled = enabled;
    if (!enabled) this.setReadAlongActive(false);
    this._syncCtrl();
    if (enabled) this.evaluateReadAlongState();
  }
  toggleAuto() { this.setAutoEnabled(!this.autoEnabled); }
  toggle() { this.toggleAuto(); }

  updateTextPosition() {
    if (!this.isActive || this.isUserScrolling) return;
    const el = this._getWordEl(); 
    if (!el) return;

    let rect;
    try {
      rect = el.getBoundingClientRect();
    } catch {
      return;
    }
    const { top, height } = this._rootRect();
    const linePct         = this.getCurrentTopPercent();
    const targetY         = top + (linePct / 100) * height;
    const delta           = rect.top - targetY;

    const behavior = 'smooth';
    if (this._isWindowRoot(this.scrollRoot)) {
      window.scrollTo({ top: window.scrollY + delta, behavior });
    } else {
      try {
        this.scrollRoot.scrollTo({ top: this.scrollRoot.scrollTop + delta, behavior });
      } catch {}
    }
  }

  onWordHighlighted(el) {
    // Harden against nulls
    if (el && el.nodeType === 1 && el.isConnected) {
      this._lastWordEl = el;
    } else {
      // if null or detached, try to recover a current element; if still none, bail quietly
      const cur = this._getWordEl();
      if (!cur) return;
      el = cur;
      this._lastWordEl = cur;
    }

    if (!this.autoEnabled) return;
    if (this.isUserScrolling) return;

    if (this._isInZone(el)) {
      this.setReadAlongActive(true);
      this.updateTextPosition();
    } else {
      this.setReadAlongActive(false);
    }
  }

  rebindHighlighter(highlighter) {
    this.highlighter = highlighter;
    this._lastWordEl = null;
    this._detachScrollListeners();
    this.scrollRoot = null;
    // evaluate on next frame to reattach to new scroll root when a word appears
    requestAnimationFrame(() => this.evaluateReadAlongState());
  }

  // Public helper: is the current word within the activation zone?
  isCurrentWordInZone() {
    try {
      const el = this._getWordEl();
      return this._isInZone(el);
    } catch {
      return false;
    }
  }

  setActivationRadius(px) {
    const v = Math.max(0, Number(px) || 0);
    this.activationRadiusPx = v;
    this.evaluateReadAlongState();
  }

  // NEW: imperative snap used by the "Scroll to playhead" button
  snapToCurrentWord({ smooth = true } = {}) {
    const el = this._getWordEl();
    if (!el) return false;

    let rect;
    try {
      rect = el.getBoundingClientRect();
    } catch {
      return false;
    }

    const { top, height } = this._rootRect();
    const linePct         = this.getCurrentTopPercent();
    const targetY         = top + (linePct / 100) * height;
    const delta           = rect.top - targetY;
    const behavior        = smooth ? 'smooth' : 'auto';

    if (this._isWindowRoot(this.scrollRoot)) {
      window.scrollTo({ top: window.scrollY + delta, behavior });
    } else {
      try {
        this.scrollRoot.scrollTo({ top: this.scrollRoot.scrollTop + delta, behavior });
      } catch {}
    }

    this.setReadAlongActive(true);
    return true;
  }

  destroy() {
    this._stopMonitor();
    this._detachScrollListeners();

    if (this._onMouseMove) document.removeEventListener('mousemove', this._onMouseMove);
    if (this._onMouseUp)   document.removeEventListener('mouseup',   this._onMouseUp);
    if (this._onTouchMove) document.removeEventListener('touchmove', this._onTouchMove);
    if (this._onTouchEnd)  document.removeEventListener('touchend',  this._onTouchEnd);

    const ctrl = document.querySelector('.read-along.control');
    if (ctrl && this._onCtrlClick) ctrl.removeEventListener('click', this._onCtrlClick);

    if (this.heightSetter) { try { this.heightSetter.remove(); } catch {} }
  }
}
