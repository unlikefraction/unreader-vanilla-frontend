// ---------line-tool.js----------

import { computeCoords, getZeroXPoint } from '../utils.js';

/**
 * Line drawing tool
 */
export function handleLine(drawingTools, type, e) {
  if (!drawingTools.activeTool?.classList.contains('line')) return;
  const zeroX = getZeroXPoint();
  const { xRel, y } = computeCoords(e, getZeroXPoint);
  
  drawingTools._genericDraw(
    type,
    xRel,
    y,
    // Preview
    (x1, y1, x2, y2, seed) => {
      drawingTools.canvasManager.previewRough.line(
        zeroX + x1,
        y1,
        zeroX + x2,
        y2,
        {
          stroke: drawingTools.selectedColor,
          strokeWidth: drawingTools.strokeWidth,
          roughness: drawingTools.roughness,
          seed
        }
      );
    },
    // Final draw
    (x1, y1, x2, y2, seed) => {
      drawingTools.shapesData.line.push({
        x1Rel: x1,
        y1,
        x2Rel: x2,
        y2,
        seed,
        color: drawingTools.selectedColor
      });
      drawingTools.canvasManager.drawRough.line(
        zeroX + x1,
        y1,
        zeroX + x2,
        y2,
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
