// -----elipse-tool.js-----


import { computeCoords, getZeroXPoint } from '../utils.js';

/**
 * Ellipse drawing tool with Shift for perfect circles
 */
export function handleEllipse(drawingTools, type, e) {
  // Only run when circle tool is active
  if (!drawingTools.activeTool?.classList.contains('circle')) return;

  const zeroX = getZeroXPoint();
  const { xRel: startX, y: startY } = computeCoords(e, getZeroXPoint);
  const isCircle = e.shiftKey;

  drawingTools._genericDraw(
    type,
    startX,
    startY,
    // Preview callback
    (x1, y1, x2, y2, seed) => {
      let width = x2 - x1;
      let height = y2 - y1;
      if (isCircle) {
        const size = Math.min(Math.abs(width), Math.abs(height));
        width = Math.sign(width) * size;
        height = Math.sign(height) * size;
      }
      const cx = zeroX + x1 + width / 2;
      const cy = y1 + height / 2;
      drawingTools.canvasManager.previewRough.ellipse(
        cx,
        cy,
        Math.abs(width),
        Math.abs(height),
        {
          stroke: drawingTools.selectedColor,
          strokeWidth: drawingTools.strokeWidth,
          roughness: drawingTools.roughness,
          seed
        }
      );
    },
    // Commit callback
    (x1, y1, x2, y2, seed) => {
      let width = x2 - x1;
      let height = y2 - y1;
      if (isCircle) {
        const size = Math.min(Math.abs(width), Math.abs(height));
        width = Math.sign(width) * size;
        height = Math.sign(height) * size;
      }
      // Save shape data including color
      drawingTools.shapesData.ellipse.push({
        xRel: x1,
        y: y1,
        widthRel: width,
        height: height,
        seed,
        color: drawingTools.selectedColor
      });
      const cx = zeroX + x1 + width / 2;
      const cy = y1 + height / 2;
      drawingTools.canvasManager.drawRough.ellipse(
        cx,
        cy,
        Math.abs(width),
        Math.abs(height),
        {
          stroke: drawingTools.selectedColor,
          strokeWidth: drawingTools.strokeWidth,
          roughness: drawingTools.roughness,
          seed
        }
      );
    }
  );
}
