import { getZeroXPoint, getShapeBounds } from './utils.js';
import { commonVars } from '../common-vars.js';

export function initSelectionHandler(drawingTools) {
  let dragInfo = null;

  // helpers for multi-canvas bands
  function pickManagerByY(dt, y) {
    const list = dt.canvasManagers && dt.canvasManagers.length
      ? dt.canvasManagers
      : (dt.canvasManager ? [dt.canvasManager] : []);
    if (!list.length) return null;

    let chosen = list[0];
    for (const m of list) {
      // USE ABSOLUTE TOP; fallback to topOffset if needed
      const top = (typeof m._absTop === 'number') ? m._absTop : (m.topOffset || 0);
      const bottom = top + (m.height || m.drawCanvas?.height || 0);
      if (y >= top && y <= bottom) return m;
      if (y > bottom) chosen = m;
    }
    return chosen;
  }
  function clearAllPreviews(dt) {
    const list = dt.canvasManagers && dt.canvasManagers.length
      ? dt.canvasManagers
      : (dt.canvasManager ? [dt.canvasManager] : []);
    list.forEach(m => m?.clearPreview());
  }

  // Preload SVG handle
  const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" fill="none"/><polyline points="80 104 32 152 80 200" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><path d="M224,56a96,96,0,0,1-96,96H32" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/></svg>`;
  const svgImg = new Image();
  svgImg.src = `data:image/svg+xml;utf8,${encodeURIComponent(svgMarkup)}`;
  const HANDLE_SIZE = 24; // adjust size as needed
  const OFFSETX = 5;     // handle offset in px
  const OFFSETY = 7;     // handle offset in px
  const EXTRA_ROT = -25 * Math.PI / 180; // extra rotation

  function drawPersistentHighlight() {
    const sel = drawingTools.selectedShape;
    if (!sel) return;
    const { type, index } = sel;
    const shape = drawingTools.shapesData[type][index];
    const bounds = getShapeBounds(type, shape);
    const zeroX = getZeroXPoint();

    // Compute rotation pivot & local center
    let centerXLocal, centerYLocal;
    if (type === 'pencil' || type === 'highlighter') {
      const pts = shape.points || [];
      if (!pts.length) return;
      const sum = pts.reduce((acc, p) => {
        acc.x += p.xRel;
        acc.y += p.y;
        return acc;
      }, { x: 0, y: 0 });
      centerXLocal = sum.x / pts.length;
      centerYLocal = sum.y / pts.length;
    } else {
      centerXLocal = (bounds.minX + bounds.maxX) / 2;
      centerYLocal = (bounds.minY + bounds.maxY) / 2;
    }
    const cx = zeroX + centerXLocal; // page-space
    const cy = centerYLocal;         // page-space
    const rot = ((shape.rotation || 0) * Math.PI) / 180;

    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    const halfW = width / 2;
    const halfH = height / 2;

    // choose the correct preview ctx by Y band (ABSOLUTE)
    const mgr = pickManagerByY(drawingTools, cy) || drawingTools.canvasManager;
    if (!mgr) return;
    const ctx = mgr.previewCtx;

    ctx.save();
    // IMPORTANT: contexts are already translated by -mgr._absTop in CanvasManager
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'black';
    ctx.strokeRect(-halfW, -halfH, width, height);

    // Handle local position with offset
    const handleLocalX = halfW - HANDLE_SIZE / 2 + OFFSETX;
    const handleLocalY = halfH - HANDLE_SIZE / 2 + OFFSETY;

    // Draw SVG handle rotated by EXTRA_ROT
    if (svgImg.complete) {
      ctx.save();
      ctx.translate(handleLocalX + HANDLE_SIZE / 2, handleLocalY + HANDLE_SIZE / 2);
      ctx.rotate(EXTRA_ROT);
      ctx.drawImage(svgImg, -HANDLE_SIZE / 2, -HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
      ctx.restore();
    } else {
      svgImg.onload = () => {
        clearAllPreviews(drawingTools);
        drawingTools.redrawAll();
        drawPersistentHighlight();
      };
    }

    ctx.restore();

    // Store handle region for hit-testing (page-space center + local rect)
    drawingTools.selectedShape.handle = {
      cx,
      cy,
      localX: handleLocalX,
      localY: handleLocalY,
      size: HANDLE_SIZE,
      rot
    };
  }

  // Use page-space coords since our canvases translate to page space
  function getPageCoords(e) {
    return { x: e.pageX, y: e.pageY };
  }

  document.addEventListener('mousedown', e => {
    if (commonVars.toolActive !== false) return;

    // bind the appropriate canvas manager for this event
    drawingTools._bindManagerForEvent?.(e);

    const { x, y } = getPageCoords(e);
    let hit = null;
    dragInfo = null;

    // Check rotation handle hit
    const h = drawingTools.selectedShape?.handle;
    if (h) {
      const { cx, cy, localX, localY, size, rot } = h;
      const dx = x - cx;
      const dy = y - cy;
      const invCos = Math.cos(-rot);
      const invSin = Math.sin(-rot);
      const lx = dx * invCos - dy * invSin;
      const ly = dx * invSin + dy * invCos;
      if (lx >= localX && lx <= localX + size && ly >= localY && ly <= localY + size) {
        dragInfo = {
          mode: 'rotate',
          type: drawingTools.selectedShape.type,
          index: drawingTools.selectedShape.index,
          cx,
          cy,
          startAng: Math.atan2(y - cy, x - cx),
          origRot: drawingTools.shapesData[drawingTools.selectedShape.type][drawingTools.selectedShape.index].rotation || 0
        };
      }
    }

    // Shape/line/arrow body hit-testing
    if (!dragInfo) {
      outer: for (const typeKey of Object.keys(drawingTools.shapesData)) {
        const list = drawingTools.shapesData[typeKey];
        for (let i = list.length - 1; i >= 0; i--) {
          const shape = list[i];
          const bounds = getShapeBounds(typeKey, shape);
          const zeroXInner = getZeroXPoint();
          const cxShape = zeroXInner + (bounds.minX + bounds.maxX) / 2; // page-space
          const cyShape = (bounds.minY + bounds.maxY) / 2;              // page-space
          const rotInv = -((shape.rotation || 0) * Math.PI / 180);
          const dx = x - cxShape;
          const dy = y - cyShape;
          const localX = dx * Math.cos(rotInv) - dy * Math.sin(rotInv);
          const localY = dx * Math.sin(rotInv) + dy * Math.cos(rotInv);
          const halfWBody = (bounds.maxX - bounds.minX) / 2;
          const halfHBody = (bounds.maxY - bounds.minY) / 2;

          if (localX >= -halfWBody && localX <= halfWBody && localY >= -halfHBody && localY <= halfHBody) {
            hit = { type: typeKey, index: i };
            const info = { mode: 'move', type: typeKey, index: i, startX: x, startY: y };
            if (shape.points) {
              info.origPoints = shape.points.map(pt => ({ x: pt.xRel, y: pt.y }));
            } else if ('x1Rel' in shape && 'x2Rel' in shape) {
              info.origEnds = { x1Rel: shape.x1Rel, y1: shape.y1, x2Rel: shape.x2Rel, y2: shape.y2 };
            } else {
              info.origX = shape.xRel;
              info.origY = shape.y;
            }
            dragInfo = info;
            break outer;
          }
        }
      }
    }

    if (hit || dragInfo) {
      commonVars.beingEdited = true;
      drawingTools.selectedShape = hit || drawingTools.selectedShape;
    } else if (drawingTools.selectedShape) {
      drawingTools.selectedShape = null;
      commonVars.beingEdited = false;
    }

    clearAllPreviews(drawingTools);
    drawingTools.redrawAll();
    drawPersistentHighlight();
  });

  document.addEventListener('mousemove', e => {
    if (!dragInfo) return;

    // keep manager selection in sync while dragging
    drawingTools._bindManagerForEvent?.(e);

    const { x, y } = getPageCoords(e);
    const { mode, type: moveType, index } = dragInfo;
    const shape = drawingTools.shapesData[moveType][index];

    if (mode === 'move') {
      const dx = x - dragInfo.startX;
      const dy = y - dragInfo.startY;
      if (dragInfo.origPoints) {
        shape.points.forEach((pt, i) => {
          pt.xRel = dragInfo.origPoints[i].x + dx;
          pt.y    = dragInfo.origPoints[i].y + dy;
        });
      } else if (dragInfo.origEnds) {
        shape.x1Rel = dragInfo.origEnds.x1Rel + dx;
        shape.y1    = dragInfo.origEnds.y1    + dy;
        shape.x2Rel = dragInfo.origEnds.x2Rel + dx;
        shape.y2    = dragInfo.origEnds.y2    + dy;
      } else {
        shape.xRel = dragInfo.origX + dx;
        shape.y    = dragInfo.origY + dy;
      }
    } else if (mode === 'rotate') {
      const ang = Math.atan2(y - dragInfo.cy, x - dragInfo.cx);
      shape.rotation = dragInfo.origRot + (ang - dragInfo.startAng) * 180 / Math.PI;
    }

    clearAllPreviews(drawingTools);
    drawingTools.redrawAll();
    drawPersistentHighlight();
  });

  document.addEventListener('mouseup', () => {
    if (!dragInfo) return;
    drawingTools.save();
    dragInfo = null;
    clearAllPreviews(drawingTools);
    drawingTools.redrawAll();
    drawPersistentHighlight();
  });

  document.addEventListener('keydown', e => {
    if (!drawingTools.selectedShape) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const { type: delType, index: delIdx } = drawingTools.selectedShape;
      drawingTools.shapesData[delType].splice(delIdx, 1);
      drawingTools.selectedShape = null;
      commonVars.beingEdited = false;
      clearAllPreviews(drawingTools);
      drawingTools.redrawAll();
      drawingTools.save();
      e.preventDefault();
    }
  });
}
