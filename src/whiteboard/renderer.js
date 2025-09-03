import { getZeroXPoint, getShapeBounds } from './utils.js';
import { drawArrowHead } from './tools/arrow-tool.js';
import { getStroke } from 'perfect-freehand';

/**
 * Renderer for drawing all shapes across multiple bands.
 * We always compare against ABSOLUTE top via mgr._absTop.
 * Contexts are pre-translated in CanvasManager so we can draw in page-space.
 */
export function redrawAll(drawingTools) {
  // Remove completed text editors
  document.querySelectorAll('.annotation-text-editor.completed').forEach(el => el.remove());

  // Resize & clear all draw canvases
  drawingTools.canvasManagers.forEach(mgr => {
    mgr.sizeCanvases();
    if (mgr.drawCtx && mgr.drawCanvas) mgr.clearDraw();
    if (mgr.previewCtx && mgr.previewCanvas) mgr.clearPreview();
  });

  const zeroX = getZeroXPoint();

  // helper: pick manager by a page-space Y (ABSOLUTE top)
  const pickManagerByY = (y) => {
    let chosen = drawingTools.canvasManagers[0] || null;
    for (const m of drawingTools.canvasManagers) {
      const top = (typeof m._absTop === 'number') ? m._absTop : m.topOffset;
      const bottom = top + m.height;
      if (y >= top && y <= bottom) return m;
      if (y > bottom) chosen = m;
    }
    return chosen;
  };

  const runDraw = (id, mgr, drawFn) => {
    const ctx = mgr.drawCtx;
    if (!ctx) return;
    if (drawingTools.isErasing && drawingTools.erasedShapeIds.has(id)) {
      ctx.save(); ctx.globalAlpha = 0.2; drawFn(ctx, mgr); ctx.restore();
    } else {
      drawFn(ctx, mgr);
    }
  };

  // rectangles
  drawingTools.shapesData.rectangle.forEach((r, i) => {
    const id = `rectangle-${i}`;
    const w = r.widthRel;
    const h = r.height;
    const cx = zeroX + r.xRel + w / 2;
    const cy = r.y + h / 2;
    const mgr = pickManagerByY(cy);
    if (!mgr) return;
    const rotRad = ((r.rotation || 0) * Math.PI) / 180;

    runDraw(id, mgr, (ctx) => {
      ctx.save();
      ctx.translate(cx, cy); // page-space; CanvasManager maps Y to local
      ctx.rotate(rotRad);
      mgr.drawRough.rectangle(
        -w / 2, -h / 2,
        w, h,
        { stroke: r.color, strokeWidth: drawingTools.strokeWidth, roughness: drawingTools.roughness, seed: r.seed }
      );
      ctx.restore();
    });
  });

  // ellipses
  drawingTools.shapesData.ellipse.forEach((e, i) => {
    const id = `ellipse-${i}`;
    const w = Math.abs(e.widthRel);
    const h = Math.abs(e.height);
    const cx = zeroX + e.xRel + e.widthRel / 2;
    const cy = e.y + e.height / 2;
    const mgr = pickManagerByY(cy);
    if (!mgr) return;
    const rotRad = ((e.rotation || 0) * Math.PI) / 180;

    runDraw(id, mgr, (ctx) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rotRad);
      mgr.drawRough.ellipse(0, 0, w, h, {
        stroke: e.color, strokeWidth: drawingTools.strokeWidth, roughness: drawingTools.roughness, seed: e.seed
      });
      ctx.restore();
    });
  });

  // lines
  drawingTools.shapesData.line.forEach((l, i) => {
    const id = `line-${i}`;
    const x1 = zeroX + l.x1Rel;
    const y1 = l.y1;
    const x2 = zeroX + l.x2Rel;
    const y2 = l.y2;
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const mgr = pickManagerByY(cy);
    if (!mgr) return;
    const rotRad = ((l.rotation || 0) * Math.PI) / 180;

    runDraw(id, mgr, (ctx) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rotRad);
      mgr.drawRough.line(
        x1 - cx, y1 - cy,
        x2 - cx, y2 - cy,
        { stroke: l.color, strokeWidth: drawingTools.strokeWidth, roughness: drawingTools.roughness, seed: l.seed }
      );
      ctx.restore();
    });
  });

  // arrows
  drawingTools.shapesData.arrow.forEach((a, i) => {
    const id = `arrow-${i}`;
    const x1 = zeroX + a.x1Rel;
    const y1 = a.y1;
    const x2 = zeroX + a.x2Rel;
    const y2 = a.y2;
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const mgr = pickManagerByY(cy);
    if (!mgr) return;
    const rotRad = ((a.rotation || 0) * Math.PI) / 180;

    runDraw(id, mgr, (ctx) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rotRad);
      mgr.drawRough.line(
        x1 - cx, y1 - cy,
        x2 - cx, y2 - cy,
        { stroke: a.color, strokeWidth: drawingTools.strokeWidth, roughness: drawingTools.roughness, seed: a.seed }
      );
      drawArrowHead(
        Object.assign({}, drawingTools, { selectedColor: a.color, canvasManager: mgr }),
        x1 - cx, y1 - cy, x2 - cx, y2 - cy, a.seed
      );
      ctx.restore();
    });
  });

  // pencil
  drawingTools.shapesData.pencil.forEach((p, i) => {
    if (!p.points || p.points.length === 0) return;
    const id = `pencil-${i}`;
    const raw = p.points.map(pt => [pt.xRel, pt.y]);
    const ys = raw.map(r => r[1]);
    const cy = ys.reduce((a,b)=>a+b)/ys.length;
    const mgr = pickManagerByY(cy);
    if (!mgr) return;

    const xs = raw.map(r => r[0]);
    const cxRel = xs.reduce((a,b)=>a+b)/xs.length;
    const cx = zeroX + cxRel;
    const rotRad = ((p.rotation || 0) * Math.PI) / 180;
    const stroke = getStroke(raw, p.options);

    runDraw(id, mgr, (ctx) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rotRad);
      ctx.beginPath();
      stroke.forEach(([x, y], j) => {
        const rx = x - cxRel;
        const ry = y - cy;
        j ? ctx.lineTo(rx, ry) : ctx.moveTo(rx, ry);
      });
      ctx.closePath();
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.restore();
    });
  });

  // highlighter
  drawingTools.shapesData.highlighter.forEach((h, i) => {
    if (!h.points || h.points.length === 0) return;
    const id = `highlighter-${i}`;
    const raw = h.points.map(pt => [pt.xRel, pt.y]);
    const ys = raw.map(r => r[1]);
    const cy = ys.reduce((a,b)=>a+b)/ys.length;
    const mgr = pickManagerByY(cy);
    if (!mgr) return;

    const xs = raw.map(r => r[0]);
    const cxRel = xs.reduce((a,b)=>a+b)/xs.length;
    const cx = getZeroXPoint() + cxRel;
    const rotRad = ((h.rotation || 0) * Math.PI) / 180;
    const stroke = getStroke(raw, h.options);

    runDraw(id, mgr, (ctx) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rotRad);
      ctx.beginPath();
      stroke.forEach(([x, y], j) => {
        const rx = x - cxRel;
        const ry = y - cy;
        j ? ctx.lineTo(rx, ry) : ctx.moveTo(rx, ry);
      });
      ctx.closePath();
      ctx.fillStyle = drawingTools._hexToRgba(h.color, h.opacity);
      ctx.fill();
      ctx.restore();
    });
  });

  // TEXT overlay divs anchored at the click baseline; no viewport shifts
  drawingTools.shapesData.text.forEach((t, i) => {
    const id = `text-${i}`;
    const rotDeg = t.rotation || 0;

    const fontSize = t.fontSize || 24;
    const fontFamily = t.fontFamily || 'sans-serif';
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `${fontSize}px ${fontFamily}`;
    const m = ctx.measureText('Mg');
    const ascent = m.actualBoundingBoxAscent ?? fontSize * 0.8;
    const descent = m.actualBoundingBoxDescent ?? fontSize * 0.2;
    const lines = String(t.text ?? '').split(/\n/);
    let textWidth = 0;
    for (const line of lines) {
      const w = ctx.measureText(line).width;
      if (w > textWidth) textWidth = w;
    }
    const height = ascent + descent + Math.max(0, lines.length - 1) * fontSize;

    const left = getZeroXPoint() + t.xRel;
    const top = (t.y - ascent);

    const div = document.createElement('div');
    div.innerText = t.text;
    div.classList.add('annotation-text-editor', 'completed');
    div.setAttribute('data-text-id', id);
    Object.assign(div.style, {
      position: 'absolute',
      left: `${left}px`,
      top: `${top}px`,
      width: `${textWidth}px`,
      height: `${height}px`,
      transform: `rotate(${rotDeg}deg)`,
      transformOrigin: 'left top',
      display: 'block',
      pointerEvents: 'none',
      textAlign: 'left',
      fontSize: `${fontSize}px`,
      fontFamily,
      lineHeight: 'normal',
      whiteSpace: 'pre',
      background: 'transparent',
      color: t.color,
      zIndex: '1',
      opacity: (drawingTools.isErasing && drawingTools.erasedShapeIds.has(id)) ? '0.2' : '1'
    });
    document.body.appendChild(div);
  });
}
