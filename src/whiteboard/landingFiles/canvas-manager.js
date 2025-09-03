// ------canvas-manager.js--------

import rough from 'roughjs';

/**
 * Canvas manager for drawing and preview canvases
 */
export class CanvasManager {

  /** Create canvases for drawing + preview */
  setupCanvases() {
    this.drawCanvas = document.createElement('canvas');
    this.previewCanvas = document.createElement('canvas');
    
    [this.drawCanvas, this.previewCanvas].forEach(c => {
      Object.assign(c.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        zIndex: '-1',
        pointerEvents: 'none',
        willChange: 'transform'
      });
      document.body.appendChild(c);
    });
    
    this.drawCtx = this.drawCanvas.getContext('2d');
    this.previewCtx = this.previewCanvas.getContext('2d');
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
    this.drawRough = rough.canvas(this.drawCanvas);
    this.previewRough = rough.canvas(this.previewCanvas);
  }

  /** Resize canvases to cover the full document */
  sizeCanvases() {
    const doc = document.documentElement;
    const body = document.body;
    const width = Math.max(doc.scrollWidth, body.scrollWidth, doc.clientWidth);
    const height = Math.max(doc.scrollHeight, body.scrollHeight, doc.clientHeight);

    const dpr = window.devicePixelRatio || 1;

    [this.drawCanvas, this.previewCanvas].forEach(c => {
      // Backing store size in device pixels
      c.width = Math.max(1, Math.floor(width * dpr));
      c.height = Math.max(1, Math.floor(height * dpr));
      // CSS display size in CSS pixels
      c.style.width = `${width}px`;
      c.style.height = `${height}px`;
    });

    // Scale contexts so all drawing uses CSS pixel coords but renders sharp
    if (this.drawCtx) {
      this.drawCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    if (this.previewCtx) {
      this.previewCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  constructor() {
    this.drawCanvas = null;
    this.previewCanvas = null;
    this.drawCtx = null;
    this.previewCtx = null;
    this.drawRough = null;
    this.previewRough = null;
    
    this.setupCanvases();
    // Initial size and react to layout changes smoothly
    this.sizeCanvases();
    try {
      this._ro = new ResizeObserver(() => this.sizeCanvases());
      this._ro.observe(document.body);
    } catch {}
  }

  /** Clear preview canvas */
  clearPreview() {
    if (!this.previewCtx) return;
    this.previewCtx.save();
    // Clear in device pixel space (identity transform)
    this.previewCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
    this.previewCtx.restore();
  }

  /** Clear draw canvas */
  clearDraw() {
    if (!this.drawCtx) return;
    this.drawCtx.save();
    this.drawCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawCtx.clearRect(0, 0, this.drawCanvas.width, this.drawCanvas.height);
    this.drawCtx.restore();
  }
}
