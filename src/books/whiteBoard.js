// -----whiteBoard..js-----

// 🔧 knobs
// Each band gets PADDING_REM above AND below (total = 2 * PADDING_REM).
const PADDING_REM = 5;
// How many canvases to keep alive at once (ring buffer)
const BAND_COUNT = 3;
// How many pages each band spans
const PAGES_PER_BAND = 2;

import { commonVars } from '../common-vars.js';
import { CanvasManager } from '../whiteboard/canvas-manager.js';
import { saveShapesData, loadShapesData, clearAllShapesData } from '../whiteboard/storage.js';
import { initScribblesSync } from '../whiteboard/scribbles-sync.js';
import { redrawAll } from '../whiteboard/renderer.js';
import { handleRectangle } from '../whiteboard/tools/rectangle-tools.js';
import { handleEllipse } from '../whiteboard/tools/elipse-tool.js';
import { handleLine } from '../whiteboard/tools/line-tool.js';
import { handleArrow, drawArrowHead, previewArrowHead } from '../whiteboard/tools/arrow-tool.js';
import { handlePencil, handleFreehand } from '../whiteboard/tools/pencil-tool.js';
import { handleHighlight } from '../whiteboard/tools/highlighter-tool.js';
import { handleText, createTextEditor } from '../whiteboard/tools/text-tool.js';
import { handleEraser } from '../whiteboard/tools/eraser-tool.js';
import { isClickOnTool, hexToRgba } from '../whiteboard/utils.js';
import { initSelectionHandler } from '../whiteboard/selection.js';
import { initVersioning } from '../whiteboard/version.js';
import { ReadAlong } from '../audio/read-along.js';

export class DrawingTools {
  static _mouseListenersAdded = false;

  constructor({
    selector = '.w-control',
    strokeWidth = 2,
    roughness = 3,
    pencilOptions = {},
    highlightOptions = {}
  } = {}) {
    this.selector = selector;
    this.strokeWidth = strokeWidth;
    this.roughness = roughness;

    this.colorOptions = ['#373737', '#9C0000', '#0099FF', '#045C32', '#FFAA00'];
    this.highlightColorOptions = ['#FFE500', '#F84F4F', '#2FCEF6', '#1FDC82', '#FC49FF'];
    this.selectedColor = this.colorOptions[0];
    this.highlightColor = this.highlightColorOptions[0];

    this.pencilOptions = Object.assign({
      size: 8, smoothing: 0.5, thinning: 0.5, streamline: 0.5, easing: t => t,
      start: { taper: 0, cap: true }, end: { taper: 0, cap: true }
    }, pencilOptions);

    this.highlightOptions = Object.assign({
      size: 35, smoothing: 0.5, thinning: 0.1, streamline: 0.5, easing: t => t,
      start: { taper: 0, cap: true }, end: { taper: 0, cap: true },
      color: this.highlightColor, opacity: 0.5
    }, highlightOptions);

    this.tools = Array.from(document.querySelectorAll(this.selector));
    this.activeTool = this.tools.find(t => t.classList.contains('active')) || null;

    this._createColorPicker();

    this.isDrawing = false;
    this.isErasing = false;
    this.currentPoints = [];
    this.textClickArmed = false;
    this.erasedShapeIds = new Set();

    // Load local scribbles immediately (book-scoped via URL id)
    this.shapesData = loadShapesData();

    // Start backend sync: fetch remote in background; debounce push on local saves
    const sync = initScribblesSync({
      getData: () => this.shapesData,
      setData: (data) => { this.shapesData = data; this.redrawAll(); },
      // Push instantly after saving to localStorage
      debounceMs: 0
    });
    this._scheduleScribblesPush = sync.schedulePush;

    // ring buffer of band managers
    this.canvasManagers = [];
    this.canvasManager = null;

    // single-shot height poll state
    this._heightPollTimer = null;

    // base absolute top for band 0 (used when some APIs expect normalized offsets)
    this._bandsBaseTop = 0;

    initSelectionHandler(this);

    this.eraserCursor = document.createElement('div');
    this.eraserCursor.classList.add('eraser-mouse');
    Object.assign(this.eraserCursor.style, { position: 'absolute', pointerEvents: 'none', display: 'none' });
    document.body.appendChild(this.eraserCursor);

    if (!DrawingTools._mouseListenersAdded) {
      document.addEventListener('mouseup', () =>
        document.querySelectorAll('.paragraph-hover-area').forEach(a => a.style.pointerEvents = 'auto')
      );
      DrawingTools._mouseListenersAdded = true;
    }
  }

  // ========== helpers ==========
  _extraPaddingPx(rootFont) { return (PADDING_REM * (rootFont || 16)); }

  _pageWrappers() {
    return Array.from(document.querySelectorAll('.pageWrapper'));
  }

  _getPageTopBottom(idx, wrappers) {
    const w = wrappers[idx];
    if (!w) return null;
    const r = w.getBoundingClientRect();
    const top = r.top + window.scrollY;
    const bottom = top + r.height;
    return { top, bottom, height: r.height };
  }

  // ========== band planning & mounting ==========
  _planBandsAroundViewport() {
    const wrappers = this._pageWrappers();
    if (!wrappers.length) return null;

    const viewportTop = window.scrollY;
    const viewportH = window.innerHeight || 800;
    const anchorY = viewportTop + viewportH / 2;

    // find anchor page (linear search; you can switch to binary if needed)
    let anchorPage = 0;
    for (let i = 0; i < wrappers.length; i++) {
      const r = wrappers[i].getBoundingClientRect();
      const top = r.top + window.scrollY;
      const bottom = top + r.height;
      if (anchorY >= top && anchorY <= bottom) { anchorPage = i; break; }
      if (anchorY > bottom) anchorPage = i;
    }

    const centerBandFirstPage = Math.max(0, anchorPage - (anchorPage % PAGES_PER_BAND)); // even index
    const firstBandFirstPage = Math.max(0, centerBandFirstPage - (Math.floor(BAND_COUNT/2) * PAGES_PER_BAND));

    const plans = [];
    const rootFont = parseFloat(getComputedStyle(document.documentElement).fontSize || '16') || 16;
    const EXTRA = this._extraPaddingPx(rootFont);

    for (let b = 0; b < BAND_COUNT; b++) {
      const pageA = firstBandFirstPage + b * PAGES_PER_BAND;
      const pageB = pageA + 1;

      const A = this._getPageTopBottom(pageA, wrappers);
      const B = this._getPageTopBottom(pageB, wrappers);

      if (!A) {
        // synthetic: extend after last known band
        const prev = plans[b-1];
        const top = prev ? (prev.top + prev.height) : (wrappers[0].getBoundingClientRect().top + window.scrollY);
        const height = prev ? prev.height : Math.max(window.innerHeight, 1);
        plans.push({ top, height });
        continue;
      }

      let top = Math.max(0, A.top - EXTRA);
      let lastBottom = A.bottom;
      if (B) lastBottom = B.bottom;

      let height = (lastBottom - A.top) + 2 * EXTRA;
      if (height < 1) height = 1;

      plans.push({ top, height });
    }

    // contiguity: no gaps, no overlaps
    for (let i = 1; i < plans.length; i++) {
      const prevBottom = plans[i-1].top + plans[i-1].height;
      if (plans[i].top > prevBottom) {
        plans[i-1].height += (plans[i].top - prevBottom); // fill gap
      } else if (plans[i].top < prevBottom) {
        plans[i].top = prevBottom; // remove overlap
      }
    }

    const baseTop = plans[0].top;
    return { plans, baseTop };
  }

  _buildWindowedBands() {
    // nuke previous
    if (this.canvasManagers.length) {
      this.canvasManagers.forEach(m => m.destroy?.());
      this.canvasManagers = [];
    }

    // create fixed number of managers (no background tint)
    for (let i = 0; i < BAND_COUNT; i++) {
      const mgr = new CanvasManager({
        topOffset: 0, // we’ll position absolutely via updateAbsoluteTopAndHeight
        height: 1
        // bg intentionally omitted → transparent
      });
      this.canvasManagers.push(mgr);
    }

    this._replanAndMount(true);
  }

  _replanAndMount(initial = false) {
    const plan = this._planBandsAroundViewport();
    if (!plan) return;

    this._bandsBaseTop = plan.baseTop || 0;

    // Update only when something actually changes; skip redraw if stable.
    let anyChanged = false;
    plan.plans.forEach((p, i) => {
      const mgr = this.canvasManagers[i];
      const prevTop = typeof mgr._absTop === 'number' ? mgr._absTop : 0;
      const prevH = mgr.height || 0;
      if (prevTop !== p.top || prevH !== p.height) {
        // Use absolute updater so contexts remap page-space correctly
        mgr.updateAbsoluteTopAndHeight(p.top, p.height);
        anyChanged = true;
      }
    });

    if (initial) {
      // pick the first band by default; selection logic will switch as needed
      this.canvasManager = this.canvasManagers[0] || null;
      anyChanged = true; // ensure initial paint
    }

    if (anyChanged) this.redrawAll();
  }

  // ========== events & boot ==========
  _bootWhenPagesReady() {
    const ready = () => {
      const first = document.querySelector('.pageWrapper');
      if (!first) return false;
      const r = first.getBoundingClientRect();
      return r.height > 0;
    };

    const tryBuild = () => {
      this._buildWindowedBands();

      // single-shot late poll ~2s to catch late layout shifts
      if (!this._heightPollTimer) {
        this._heightPollTimer = setTimeout(() => {
          this._heightPollTimer = null;
          this._replanAndMount(false);
        }, 2000);
      }
    };

    if (ready()) { tryBuild(); return; }

    const obs = new MutationObserver(() => {
      if (ready()) { obs.disconnect(); tryBuild(); }
    });
    obs.observe(document.body, { childList: true, subtree: true });

    // safety fallback after 5s
    setTimeout(() => {
      if (this.canvasManagers.length) return;
      this._buildWindowedBands();
      console.warn('[Whiteboard] Fallback boot: windowed bands created.');
    }, 5000);
  }

  init() {
    window.addEventListener('load', () => this._bootWhenPagesReady());
    this._bootWhenPagesReady();

    // throttle scroll/resize via rAF
    let ticking = false;
    const onScrollOrResize = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        this._replanAndMount(false);
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScrollOrResize, { passive: true });
    window.addEventListener('resize', onScrollOrResize);

    // tools UI
    this.tools.forEach(tool =>
      tool.addEventListener('click', () => this.setActiveTool(tool))
    );

    window.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
        if (confirm('Clear all annotations?')) this.clearAll();
      }
    });

    // global pointer routing (eraser + shapes tools)
    ['mousedown','mousemove','mouseup'].forEach(evt =>
      document.addEventListener(evt, e => {
        if (evt === 'mousedown' && this._isClickOnTool(e)) return;
        this._bindManagerForEvent(e);
        if (!this.canvasManager) return;
        handleEraser(this, evt, e);
      })
    );

    document.addEventListener('mousemove', e => {
      if (this.activeTool?.classList.contains('eraser')) {
        this.eraserCursor.style.display = 'block';
        this.eraserCursor.style.left = `${e.pageX}px`;
        this.eraserCursor.style.top = `${e.pageY}px`;
      } else {
        this.eraserCursor.style.display = 'none';
      }
    });

    // text tool on click
    document.addEventListener('click', e => {
      this._bindManagerForEvent(e);
      if (!this.canvasManager) return;
      handleText(this, e, this.selectedColor);
    });

    // draw tools
    ['mousedown','mousemove','mouseup'].forEach(evt =>
      document.addEventListener(evt, e => {
        if (evt === 'mousedown' && this._isClickOnTool(e)) return;
        this._bindManagerForEvent(e);
        if (!this.canvasManager) return;
        handleRectangle(this, evt, e, this.selectedColor);
        handleEllipse(this, evt, e, this.selectedColor);
        handleLine(this, evt, e, this.selectedColor);
        handleArrow(this, evt, e, this.selectedColor);
        handlePencil(this, evt, e, this.pencilOptions, this.selectedColor);
        handleHighlight(this, evt, e, this.highlightOptions, this.highlightColor, this.highlightOptions.opacity);
      })
    );
  }

  // ========== hit-testing manager (bulletproof) ==========
  /**
   * Prefer DOM-rect hit-testing against each band's canvas element,
   * so we don't care whether manager stores normalized or absolute offsets.
   */
  _bindManagerForEvent(e) {
    const yClient = e.clientY; // viewport coords for DOM rects
    let chosen = null;

    for (const m of this.canvasManagers) {
      const el = m.getCanvasElement?.() || m.canvas || m.el;
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (yClient >= r.top && yClient <= r.bottom) { chosen = m; break; }
    }

    // fallback hit-test using absolute numbers if DOM node missing
    if (!chosen) {
      const yPage = e.pageY;
      for (const m of this.canvasManagers) {
        const topAbs = (typeof m._absTop === 'number') ? m._absTop : (this._bandsBaseTop + (m.topOffset || 0));
        const bottomAbs = topAbs + (m.height || 0);
        if (yPage >= topAbs && yPage <= bottomAbs) { chosen = m; break; }
      }
    }

    this.canvasManager = chosen || this.canvasManagers[0] || null;
    return this.canvasManager;
  }

  // ========== UI: color picker, tool state, etc ==========
  _createColorPicker() {
    this.colorPicker = document.createElement('div');
    Object.assign(this.colorPicker.style, {
      display: 'none',
      position: 'fixed',
      flexDirection: 'column',
      gap: '8px',
      marginLeft: '8px',
      borderRadius: '20px',
      padding: '5px',
      background: '#fff',
      border: '1px solid #B7B7B7',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    });
    ['mousedown','click'].forEach(evt =>
      this.colorPicker.addEventListener(evt, e => e.stopPropagation())
    );
    document.body.appendChild(this.colorPicker);
  }

  _showColorPicker(tool) {
    this.colorPicker.innerHTML = '';
    const isHighlight = tool.classList.contains('highlighter');
    const palette = isHighlight ? this.highlightColorOptions : this.colorOptions;
    const current = isHighlight ? this.highlightColor : this.selectedColor;

    palette.forEach(color => {
      const dot = document.createElement('div');
      const size = color === current ? '20px' : '13px';
      Object.assign(dot.style, { width: size, height: size, borderRadius: '50%', background: color, cursor: 'pointer' });
      ['mousedown','click'].forEach(evt =>
        dot.addEventListener(evt, e => {
          e.stopPropagation();
          if (evt === 'click') {
            if (isHighlight) { this.highlightColor = color; this.highlightOptions.color = color; }
            else { this.selectedColor = color; }
            this._updatePickerDots(tool);
          }
        })
      );
      this.colorPicker.appendChild(dot);
    });

    const r = tool.getBoundingClientRect();
    Object.assign(this.colorPicker.style, { top: `${r.top}px`, left: `${r.right + 8}px`, display: 'flex' });
  }

  _updatePickerDots(tool) {
    const isHighlight = tool.classList.contains('highlighter');
    const palette = isHighlight ? this.highlightColorOptions : this.colorOptions;
    const current = isHighlight ? this.highlightColor : this.selectedColor;

    Array.from(this.colorPicker.children).forEach((dot, idx) => {
      const color = palette[idx];
      const size = color === current ? '20px' : '11px';
      dot.style.width = size; dot.style.height = size;
    });
  }

  _hideColorPicker() { this.colorPicker.style.display = 'none'; }
  redrawAll() { redrawAll(this); }
  save() { saveShapesData(this.shapesData); try { this._scheduleScribblesPush?.(); } catch {} }

  setActiveTool(tool) {
    if (tool === this.activeTool) return;
    this.tools.forEach(t => t.classList.remove('active'));
    tool.classList.add('active');
    this.activeTool = tool;

    const draw = ['rectangle','circle','line','arrow','pencil','highlighter','text'];
    const isDraw = draw.some(c => tool.classList.contains(c));
    if (isDraw) this._showColorPicker(tool); else this._hideColorPicker();

    commonVars.toolActive = !tool.classList.contains('cursor');
    this.textClickArmed = false;
    this.erasedShapeIds.clear();
    document.body.style.cursor = isDraw ? 'crosshair' : 'default';
  }

  _isClickOnTool(e) { return isClickOnTool(e, this.selector); }

  _genericDraw(type, x, y, pF, fF) {
    if (type === 'mousedown') {
      this.isDrawing = true;
      this.startXRel = x;
      this.startY = y;
      this.currentSeed = Math.floor(Math.random() * 10000) + 1;
      document.body.style.userSelect = 'none';
      // Snapshot zone state and disable read-along while drawing
      try {
        const ra = ReadAlong.get();
        this._wasInReadAlongZone = (ra && typeof ra.isCurrentWordInZone === 'function') ? ra.isCurrentWordInZone() : false;
        ra?.setAutoEnabled(false);
      } catch {}
    } else if (type === 'mousemove' && this.isDrawing) {
      this.canvasManager?.clearPreview();
      pF(this.startXRel, this.startY, x, y, this.currentSeed);
    } else if (type === 'mouseup' && this.isDrawing) {
      this.isDrawing = false;
      document.body.style.userSelect = 'auto';
      this.canvasManager?.clearPreview();
      fF(this.startXRel, this.startY, x, y, this.currentSeed);
      this.save();
      // Snap once if previously in zone; always re-enable
      try {
        const ra = ReadAlong.get();
        if (this._wasInReadAlongZone && ra && typeof ra.snapToCurrentWord === 'function') {
          ra.snapToCurrentWord({ smooth: true });
        }
        ra?.setAutoEnabled(true);
      } catch {}
      this._wasInReadAlongZone = undefined;
      const c = this.tools.find(t => t.classList.contains('cursor'));
      if (c) this.setActiveTool(c);
    }
  }

  _drawArrowHead(x1, y1, x2, y2, s) { drawArrowHead(this, x1, y1, x2, y2, s); }
  _previewArrowHead(x1, y1, x2, y2, s) { previewArrowHead(this, x1, y1, x2, y2, s); }
  _hexToRgba(h, a) { return hexToRgba(h, a); }
  _createTextEditor(e) { createTextEditor(this, e); }
  clearAll() { this.shapesData = clearAllShapesData(); this.save(); this.redrawAll(); }
  _handleFreehand(t, e, d, o, c, op) { handleFreehand(this, t, e, d, o, c, op); }
}

window.addEventListener('DOMContentLoaded', () => {
  const drawer = new DrawingTools({ selector: '.w-control', strokeWidth: 2, roughness: 2 });
  initVersioning(drawer, { maxHistory: 10 });
  window.drawer = drawer;
  drawer.init();
});
