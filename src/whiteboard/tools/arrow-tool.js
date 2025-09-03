// -----arrwow-tool.js-----


import { computeCoords, getZeroXPoint } from '../utils.js';

/**
 * Arrow drawing tool
 */
export function handleArrow(drawingTools, type, e) {
  if (!drawingTools.activeTool?.classList.contains('arrow')) return;
  const zeroX = getZeroXPoint();
  const { xRel, y } = computeCoords(e, getZeroXPoint);
  
  drawingTools._genericDraw(
    type, xRel, y,
    // preview draw
    (x1, y1, x2, y2, seed) => {
      drawingTools.canvasManager.previewRough.line(
        zeroX + x1, y1,
        zeroX + x2, y2,
        {
          stroke: drawingTools.selectedColor,
          strokeWidth: drawingTools.strokeWidth,
          roughness: drawingTools.roughness,
          seed
        }
      );
      previewArrowHead(drawingTools, zeroX + x1, y1, zeroX + x2, y2, seed);
    },
    // final draw
    (x1, y1, x2, y2, seed) => {
      drawingTools.shapesData.arrow.push({
        x1Rel: x1,
        y1,
        x2Rel: x2,
        y2,
        seed,
        color: drawingTools.selectedColor
      });
      drawingTools.canvasManager.drawRough.line(
        zeroX + x1, y1,
        zeroX + x2, y2,
        {
          stroke: drawingTools.selectedColor,
          strokeWidth: drawingTools.strokeWidth,
          roughness: drawingTools.roughness,
          seed
        }
      );
      drawArrowHead(drawingTools, zeroX + x1, y1, zeroX + x2, y2, seed);
    }
  );
}

/** Draw arrow head for final canvas */
export function drawArrowHead(drawingTools, x1, y1, x2, y2, seed) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const angle = Math.atan2(dy, dx);
  const len = Math.hypot(dx, dy) * 0.2;
  [angle - Math.PI / 6, angle + Math.PI / 6].forEach(wing => {
    const x3 = x2 - len * Math.cos(wing);
    const y3 = y2 - len * Math.sin(wing);
    drawingTools.canvasManager.drawRough.line(
      x2,
      y2,
      x3,
      y3,
      {
        stroke: drawingTools.selectedColor,
        strokeWidth: drawingTools.strokeWidth,
        roughness: drawingTools.roughness,
        seed
      }
    );
  });
}

/** Preview arrow head on preview canvas */
export function previewArrowHead(drawingTools, x1, y1, x2, y2, seed) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const angle = Math.atan2(dy, dx);
  const len = Math.hypot(dx, dy) * 0.2;
  [angle - Math.PI / 6, angle + Math.PI / 6].forEach(wing => {
    const x3 = x2 - len * Math.cos(wing);
    const y3 = y2 - len * Math.sin(wing);
    drawingTools.canvasManager.previewRough.line(
      x2,
      y2,
      x3,
      y3,
      {
        stroke: drawingTools.selectedColor,
        strokeWidth: drawingTools.strokeWidth,
        roughness: drawingTools.roughness,
        seed
      }
    );
  });
}