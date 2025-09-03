// -------pencil-tool.js--------

import { getStroke } from 'perfect-freehand';
import { computeCoords, getZeroXPoint } from '../utils.js';
import { ReadAlong } from '../../audio/read-along.js';

/**
 * Pencil drawing tool
 */
export function handlePencil(drawingTools, type, e) {
  if (!drawingTools.activeTool?.classList.contains('pencil')) return;
  // Pass in the selectedColor instead of 'black'
  drawingTools._handleFreehand(
    type,
    e,
    'pencil',
    drawingTools.pencilOptions,
    drawingTools.selectedColor,
    1
  );
}

/** 
 * Generic freehand helper – doesn’t auto-switch tools 
 */
export function handleFreehand(
  drawingTools,
  type,
  e,
  dataKey,
  options,
  color,
  opacity
) {
  const { xRel, y } = computeCoords(e, getZeroXPoint);
  const zeroX = getZeroXPoint();

  if (type === 'mousedown') {
    drawingTools.isDrawing = true;
    drawingTools.currentPoints = [{ xRel, y }];
    document.body.style.userSelect = 'none';
    // Snapshot zone and disable read-along while drawing
    try {
      const ra = ReadAlong.get();
      drawingTools._wasInReadAlongZone = (ra && typeof ra.isCurrentWordInZone === 'function') ? ra.isCurrentWordInZone() : false;
      ra?.setAutoEnabled(false);
    } catch {}
  } else if (type === 'mousemove' && drawingTools.isDrawing) {
    drawingTools.currentPoints.push({ xRel, y });
    drawingTools.canvasManager.clearPreview();

    const raw = drawingTools.currentPoints.map(pt => [pt.xRel, pt.y]);
    const stroke = getStroke(raw, options);
    const poly = stroke.map(([px, py]) => [zeroX + px, py]);

    const ctx = drawingTools.canvasManager.previewCtx;
    ctx.beginPath();
    poly.forEach(([px, py], i) =>
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)
    );
    ctx.closePath();
    ctx.fillStyle =
      dataKey === 'highlighter'
        ? drawingTools._hexToRgba(color, opacity)
        : color;
    ctx.fill();
  } else if (type === 'mouseup' && drawingTools.isDrawing) {
    drawingTools.isDrawing = false;
    document.body.style.userSelect = 'auto';
    drawingTools.canvasManager.clearPreview();

    // Persist the stroke data
    drawingTools.shapesData[dataKey].push({
      points: drawingTools.currentPoints,
      options,
      color,
      opacity
    });

    const raw = drawingTools.currentPoints.map(pt => [pt.xRel, pt.y]);
    const stroke = getStroke(raw, options);
    const poly = stroke.map(([px, py]) => [zeroX + px, py]);

    const ctx = drawingTools.canvasManager.drawCtx;
    ctx.beginPath();
    poly.forEach(([px, py], i) =>
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)
    );
    ctx.closePath();
    ctx.fillStyle =
      dataKey === 'highlighter'
        ? drawingTools._hexToRgba(color, opacity)
        : color;
    ctx.fill();

    drawingTools.save();
    // Snap once only if previously in zone; then re-enable
    try {
      const ra = ReadAlong.get();
      if (drawingTools._wasInReadAlongZone && ra && typeof ra.snapToCurrentWord === 'function') {
        ra.snapToCurrentWord({ smooth: true });
      }
      ra?.setAutoEnabled(true);
    } catch {}
    drawingTools._wasInReadAlongZone = undefined;
    // tool remains active for continuous drawing
  }
}
