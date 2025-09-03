import rough from 'roughjs';

/**
 * Canvas manager for a single band (draw + preview) positioned at an
 * ABSOLUTE top in page coordinates. It also keeps a normalized "topOffset"
 * if upstream code wants it, but CSS positioning always uses _absTop.
 */
export class CanvasManager {
  constructor({ topOffset = 0, height = 0, bg = '' } = {}) {
    this.topOffset = Math.max(0, topOffset | 0); // kept for compatibility
    this.height = Math.max(0, height | 0);
    this.bg = bg;

    // absolute page Y used for CSS top and transform mapping
    this._absTop = this.topOffset;

    this.drawCanvas = null;
    this.previewCanvas = null;
    this.drawCtx = null;
    this.previewCtx = null;
    this.drawRough = null;
    this.previewRough = null;

    this._setupCanvases();
  }

  getCanvasElement() {
    // prefer preview for hit-testing; either works (same size/position)
    return this.previewCanvas || this.drawCanvas;
  }

  _setupCanvases() {
    this.drawCanvas = document.createElement('canvas');
    this.previewCanvas = document.createElement('canvas');

    // Draw layer below, preview layer above (both ABOVE the document)
    Object.assign(this.drawCanvas.style, {
      position: 'absolute',
      left: '0',
      top: `${this._absTop}px`,
      pointerEvents: 'none',
      zIndex: '1000',
      willChange: 'transform',
      background: this.bg || 'transparent'
    });
    Object.assign(this.previewCanvas.style, {
      position: 'absolute',
      left: '0',
      top: `${this._absTop}px`,
      pointerEvents: 'none',
      zIndex: '1001',
      willChange: 'transform',
      background: 'transparent'
    });

    document.body.appendChild(this.drawCanvas);
    document.body.appendChild(this.previewCanvas);

    this.drawCtx = this.drawCanvas.getContext('2d');
    this.previewCtx = this.previewCanvas.getContext('2d');
    this.drawRough = rough.canvas(this.drawCanvas);
    this.previewRough = rough.canvas(this.previewCanvas);
    if (this.drawCtx) {
      this.drawCtx.imageSmoothingEnabled = true;
      try { this.drawCtx.imageSmoothingQuality = 'high'; } catch {}
      this.drawCtx.lineJoin = 'round';
      this.drawCtx.lineCap = 'round';
    }
    if (this.previewCtx) {
      this.previewCtx.imageSmoothingEnabled = true;
      try { this.previewCtx.imageSmoothingQuality = 'high'; } catch {}
      this.previewCtx.lineJoin = 'round';
      this.previewCtx.lineCap = 'round';
    }

    this.sizeCanvases();

    // keep canvases sized to layout changes smoothly
    try {
      this._ro?.disconnect?.();
      this._ro = new ResizeObserver(() => this.sizeCanvases());
      this._ro.observe(document.body);
    } catch {}
  }

  /** Map page-space (x, y_page) -> canvas-local by translating -_absTop on Y */
  _applyPageSpaceTransform() {
    if (!this.drawCtx || !this.previewCtx) return;

    // reset to identity, then translate Y by -_absTop so page Y works directly
    const apply = (ctx) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.translate(0, -this._absTop);
    };

    apply(this.drawCtx);
    apply(this.previewCtx);
  }

  /** Resize canvases to full document width and fixed band height */
  sizeCanvases() {
    const doc = document.documentElement;
    const body = document.body;
    const width = Math.max(doc.scrollWidth, body.scrollWidth, doc.clientWidth);
    const dpr = window.devicePixelRatio || 1;

    [this.drawCanvas, this.previewCanvas].forEach(c => {
      // Backing store in device pixels for crisp rendering
      c.width = Math.max(1, Math.floor(width * dpr));
      c.height = Math.max(1, Math.floor(this.height * dpr));
      // CSS size in CSS pixels
      c.style.top = `${this._absTop}px`;   // ABSOLUTE
      c.style.width = `${width}px`;
      c.style.height = `${this.height}px`;
    });

    // after resizing, contexts reset; apply dpr scaling and page-space mapping
    const apply = (ctx) => {
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // scale for DPR
      ctx.translate(0, -this._absTop);        // map page-space Y
    };
    apply(this.drawCtx);
    apply(this.previewCtx);
  }

  /** Legacy: update with normalized offset (kept for compatibility) */
  updateTopAndHeight(topOffset, height) {
    this.topOffset = Math.max(0, topOffset | 0);
    if (typeof height === 'number') this.height = Math.max(0, height | 0);
    // DO NOT change _absTop here; absolute update must call updateAbsoluteTopAndHeight
    this.sizeCanvases();
    this.clearPreview();
    this.clearDraw();
  }

  /** New: update with ABSOLUTE page Y */
  updateAbsoluteTopAndHeight(absTop, height) {
    this._absTop = Math.max(0, absTop | 0);
    this.height = Math.max(0, height | 0);
    this.sizeCanvases();
    this.clearPreview();
    this.clearDraw();
  }

  clearPreview() {
    if (!this.previewCtx) return;
    // clear must ignore current transform, so temporarily reset to identity
    this.previewCtx.save();
    this.previewCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
    this.previewCtx.restore();
  }

  clearDraw() {
    if (!this.drawCtx) return;
    this.drawCtx.save();
    this.drawCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawCtx.clearRect(0, 0, this.drawCanvas.width, this.drawCanvas.height);
    this.drawCtx.restore();
  }

  destroy() {
    try { this.drawCanvas?.remove(); } catch {}
    try { this.previewCanvas?.remove(); } catch {}
    this.drawCanvas = this.previewCanvas = null;
    this.drawCtx = this.previewCtx = null;
    this.drawRough = this.previewRough = null;
  }
}
