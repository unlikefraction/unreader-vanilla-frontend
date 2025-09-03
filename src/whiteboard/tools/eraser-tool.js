// ------eraser-tool.js-----


import { getStroke } from 'perfect-freehand';
import {
  computeCoords,
  getZeroXPoint,
  getShapeBounds,
  hexToRgba
} from '../utils.js';

/**
 * Helper: rotation-aware hit test using a shape’s bounds
 */
function isPointInRotatedBounds(shapeType, shapeData, x, y) {
  const bounds = getShapeBounds(shapeType, shapeData);
  const zeroX = getZeroXPoint();
  const minX = bounds.minX, maxX = bounds.maxX;
  const minY = bounds.minY, maxY = bounds.maxY;
  const cx = zeroX + (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rot = -((shapeData.rotation || 0) * Math.PI / 180);

  // transform point into shape-local coords
  const dx = x - cx;
  const dy = y - cy;
  const localX = dx * Math.cos(rot) - dy * Math.sin(rot);
  const localY = dx * Math.sin(rot) + dy * Math.cos(rot);

  const halfW = (maxX - minX) / 2;
  const halfH = (maxY - minY) / 2;
  return (
    localX >= -halfW && localX <= halfW &&
    localY >= -halfH && localY <= halfH
  );
}

/**
 * Eraser drawing tool with rotation-aware detection
 */
export function handleEraser(drawingTools, type, e) {
  if (!drawingTools.activeTool?.classList.contains('eraser')) return;
  const { xRel, y } = computeCoords(e, getZeroXPoint);

  if (type === 'mousedown') {
    drawingTools.isErasing = true;
    drawingTools.erasedShapeIds.clear();
    document.body.style.userSelect = 'none';

  } else if (type === 'mousemove' && drawingTools.isErasing) {
    // redraw to apply fading
    drawingTools.redrawAll();

    // detect shapes under cursor with rotation-aware bounds
    drawingTools.canvasManager.clearPreview();
    Object.entries(drawingTools.shapesData).forEach(([kind, shapes]) => {
      shapes.forEach((shape, idx) => {
        const id = `${kind}-${idx}`;
        if (!drawingTools.erasedShapeIds.has(id)) {
          const absX = xRel + getZeroXPoint();
          if (isPointInRotatedBounds(kind, shape, absX, y)) {
            drawingTools.erasedShapeIds.add(id);
          }
        }
      });
    });

    // preview overlay
    drawingTools.erasedShapeIds.forEach(id => {
      const [kind, idx] = id.split('-');
      drawShapePreview(drawingTools, kind, drawingTools.shapesData[kind][idx], 0.2);
    });

  } else if (type === 'mouseup' && drawingTools.isErasing) {
    drawingTools.isErasing = false;
    document.body.style.userSelect = 'auto';
    drawingTools.canvasManager.clearPreview();

    // remove flagged shapes
    Object.keys(drawingTools.shapesData).forEach(kind => {
      drawingTools.shapesData[kind] =
        drawingTools.shapesData[kind].filter((_, i) => !drawingTools.erasedShapeIds.has(`${kind}-${i}`));
    });
    drawingTools.erasedShapeIds.clear();
    drawingTools.save();
    drawingTools.redrawAll();

    // switch back to cursor
    const cursor = drawingTools.tools.find(t => t.classList.contains('cursor'));
    if (cursor) drawingTools.setActiveTool(cursor);
  }
}

/**
 * Draw faded preview of a shape, honoring rotation
 */
export function drawShapePreview(drawingTools, type, shape, opacity) {
  const zeroX = getZeroXPoint();
  const ctx = drawingTools.canvasManager.previewCtx;
  ctx.save();
  ctx.globalAlpha = opacity;

  if (type === 'rectangle') {
    const w = shape.widthRel, h = shape.height;
    const cx = zeroX + shape.xRel + w/2;
    const cy = shape.y + h/2;
    const rot = ((shape.rotation || 0) * Math.PI)/180;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    drawingTools.canvasManager.previewRough.rectangle(
      -w/2, -h/2, w, h,
      { stroke: 'black', strokeWidth: drawingTools.strokeWidth, roughness: drawingTools.roughness, seed: shape.seed }
    );
    ctx.restore();

  } else if (type === 'ellipse') {
    const w = Math.abs(shape.widthRel), h = Math.abs(shape.height);
    const cx = zeroX + shape.xRel + shape.widthRel/2;
    const cy = shape.y + shape.height/2;
    const rot = ((shape.rotation || 0) * Math.PI)/180;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    drawingTools.canvasManager.previewRough.ellipse(
      0, 0, w, h,
      { stroke: 'black', strokeWidth: drawingTools.strokeWidth, roughness: drawingTools.roughness, seed: shape.seed }
    );
    ctx.restore();

  } else if (type === 'line' || type === 'arrow') {
    const x1 = zeroX + shape.x1Rel, y1 = shape.y1;
    const x2 = zeroX + shape.x2Rel, y2 = shape.y2;
    const cx = (x1 + x2)/2, cy = (y1 + y2)/2;
    const rot = ((shape.rotation || 0)*Math.PI)/180;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    drawingTools.canvasManager.previewRough.line(
      x1-cx, y1-cy, x2-cx, y2-cy,
      { stroke: 'black', strokeWidth: drawingTools.strokeWidth, roughness: drawingTools.roughness, seed: shape.seed }
    );
    if (type === 'arrow') {
      drawingTools._previewArrowHead(shape.x1Rel, shape.y1, shape.x2Rel, shape.y2, shape.seed);
    }
    ctx.restore();

  } else if (type === 'pencil' || type === 'highlighter') {
    // compute raw centroid
    const raw = shape.points.map(pt => [pt.xRel, pt.y]);
    const xs = raw.map(r => r[0]), ys = raw.map(r => r[1]);
    const cxRel = xs.reduce((a,b)=>a+b)/xs.length;
    const cy    = ys.reduce((a,b)=>a+b)/ys.length;
    const cx    = zeroX + cxRel;
    const rot   = ((shape.rotation || 0) * Math.PI)/180;

    // get stroke polygon
    const stroke = getStroke(raw, shape.options);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.beginPath();
    stroke.forEach(([x,y], i) => {
      const rx = x - cxRel;
      const ry = y - cy;
      i ? ctx.lineTo(rx, ry) : ctx.moveTo(rx, ry);
    });
    ctx.closePath();
    ctx.fillStyle = type==='highlighter'
      ? hexToRgba(shape.options.color, shape.options.opacity)
      : 'black';
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}
