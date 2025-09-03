// ---------renderer.js---------

import { getZeroXPoint, getShapeBounds } from '../utils.js';
import { drawArrowHead } from '../tools/arrow-tool.js';
import { getStroke } from 'perfect-freehand';

/**
 * Renderer for drawing all shapes and their bounding borders, now supporting per-shape rotation
 */
export function redrawAll(drawingTools) {
  // Remove completed text editors
  document.querySelectorAll('.annotation-text-editor.completed').forEach(el => el.remove());

  // Resize & clear the draw canvas
  drawingTools.canvasManager.sizeCanvases();
  const drawCtx = drawingTools.canvasManager.drawCtx;
  drawCtx.clearRect(0, 0, drawingTools.canvasManager.drawCanvas.width, drawingTools.canvasManager.drawCanvas.height);

  const zeroX = getZeroXPoint();

  // helper to fade flagged shapes (text is skipped)
  const runDraw = (id, drawFn) => {
    if (drawingTools.isErasing && drawingTools.erasedShapeIds.has(id)) {
      drawCtx.save(); drawCtx.globalAlpha = 0.2; drawFn(); drawCtx.restore();
    } else {
      drawFn();
    }
  };

  // DRAW SHAPES
  // rectangles
  drawingTools.shapesData.rectangle.forEach((r, i) => {
    const id = `rectangle-${i}`;
    runDraw(id, () => {
      const w = r.widthRel;
      const h = r.height;
      const cx = zeroX + r.xRel + w / 2;
      const cy = r.y + h / 2;
      const rotRad = ((r.rotation || 0) * Math.PI) / 180;
      drawCtx.save();
      drawCtx.translate(cx, cy);
      drawCtx.rotate(rotRad);
      drawingTools.canvasManager.drawRough.rectangle(
        -w / 2, -h / 2,
        w, h,
        {
          stroke: r.color,
          strokeWidth: drawingTools.strokeWidth,
          roughness: drawingTools.roughness,
          seed: r.seed
        }
      );
      drawCtx.restore();
    });
  });

  // ellipses
  drawingTools.shapesData.ellipse.forEach((e, i) => {
    const id = `ellipse-${i}`;
    runDraw(id, () => {
      const w = Math.abs(e.widthRel);
      const h = Math.abs(e.height);
      const cx = zeroX + e.xRel + e.widthRel / 2;
      const cy = e.y + e.height / 2;
      const rotRad = ((e.rotation || 0) * Math.PI) / 180;
      drawCtx.save();
      drawCtx.translate(cx, cy);
      drawCtx.rotate(rotRad);
      drawingTools.canvasManager.drawRough.ellipse(
        0, 0, w, h,
        {
          stroke: e.color,
          strokeWidth: drawingTools.strokeWidth,
          roughness: drawingTools.roughness,
          seed: e.seed
        }
      );
      drawCtx.restore();
    });
  });

  // lines
  drawingTools.shapesData.line.forEach((l, i) => {
    const id = `line-${i}`;
    runDraw(id, () => {
      const x1 = zeroX + l.x1Rel;
      const y1 = l.y1;
      const x2 = zeroX + l.x2Rel;
      const y2 = l.y2;
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const rotRad = ((l.rotation || 0) * Math.PI) / 180;
      drawCtx.save();
      drawCtx.translate(cx, cy);
      drawCtx.rotate(rotRad);
      drawingTools.canvasManager.drawRough.line(
        x1 - cx, y1 - cy,
        x2 - cx, y2 - cy,
        {
          stroke: l.color,
          strokeWidth: drawingTools.strokeWidth,
          roughness: drawingTools.roughness,
          seed: l.seed
        }
      );
      drawCtx.restore();
    });
  });

  // arrows
  drawingTools.shapesData.arrow.forEach((a, i) => {
    const id = `arrow-${i}`;
    runDraw(id, () => {
      const x1 = zeroX + a.x1Rel;
      const y1 = a.y1;
      const x2 = zeroX + a.x2Rel;
      const y2 = a.y2;
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const rotRad = ((a.rotation || 0) * Math.PI) / 180;
      drawCtx.save();
      drawCtx.translate(cx, cy);
      drawCtx.rotate(rotRad);
      drawingTools.canvasManager.drawRough.line(
        x1 - cx, y1 - cy,
        x2 - cx, y2 - cy,
        {
          stroke: a.color,
          strokeWidth: drawingTools.strokeWidth,
          roughness: drawingTools.roughness,
          seed: a.seed
        }
      );
      drawArrowHead(
        Object.assign({}, drawingTools, { selectedColor: a.color }),
        x1 - cx,
        y1 - cy,
        x2 - cx,
        y2 - cy,
        a.seed
      );
      drawCtx.restore();
    });
  });

  // pencil strokes
  drawingTools.shapesData.pencil.forEach((p, i) => {
    if (!p.points || p.points.length === 0) return;
    const id = `pencil-${i}`;
    runDraw(id, () => {
      const raw = p.points.map(pt => [pt.xRel, pt.y]);
      const xs = raw.map(r => r[0]), ys = raw.map(r => r[1]);
      const cxRel = xs.reduce((a,b)=>a+b)/xs.length;
      const cy = ys.reduce((a,b)=>a+b)/ys.length;
      const cx = zeroX + cxRel;
      const rotRad = ((p.rotation || 0) * Math.PI) / 180;
      const stroke = getStroke(raw, p.options);
      drawCtx.save();
      drawCtx.translate(cx, cy);
      drawCtx.rotate(rotRad);
      drawCtx.beginPath();
      stroke.forEach(([x, y], j) => {
        const rx = x - cxRel;
        const ry = y - cy;
        j ? drawCtx.lineTo(rx, ry) : drawCtx.moveTo(rx, ry);
      });
      drawCtx.closePath();
      drawCtx.fillStyle = p.color;
      drawCtx.fill();
      drawCtx.restore();
    });
  });

  // highlighter strokes
  drawingTools.shapesData.highlighter.forEach((h, i) => {
    if (!h.points || h.points.length === 0) return;
    const id = `highlighter-${i}`;
    runDraw(id, () => {
      const raw = h.points.map(pt => [pt.xRel, pt.y]);
      const xs = raw.map(r => r[0]), ys = raw.map(r => r[1]);
      const cxRel = xs.reduce((a,b)=>a+b)/xs.length;
      const cy = ys.reduce((a,b)=>a+b)/ys.length;
      const cx = zeroX + cxRel;
      const rotRad = ((h.rotation || 0) * Math.PI) / 180;
      const stroke = getStroke(raw, h.options);
      drawCtx.save();
      drawCtx.translate(cx, cy);
      drawCtx.rotate(rotRad);
      drawCtx.beginPath();
      stroke.forEach(([x, y], j) => {
        const rx = x - cxRel;
        const ry = y - cy;
        j ? drawCtx.lineTo(rx, ry) : drawCtx.moveTo(rx, ry);
      });
      drawCtx.closePath();
      drawCtx.fillStyle = drawingTools._hexToRgba(h.color, h.opacity);
      drawCtx.fill();
      drawCtx.restore();
    });
  });

  // TEXT: anchor at click baseline; never affect viewport
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

    const left = zeroX + t.xRel;
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
      zIndex: '-1',
      opacity: (drawingTools.isErasing && drawingTools.erasedShapeIds.has(id)) ? '0.2' : '1'
    });
    document.body.appendChild(div);
  });
}
