// ----utils.js----

/**
 * Utility functions for drawing tools
 */

/** Hex to RGBA conversion */
export function hexToRgba(hex, alpha) {
  const bigint = parseInt(hex.replace('#',''), 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Raw event → relative coords */
export function computeCoords(e, getZeroXPoint) {
  return { xRel: e.clientX - getZeroXPoint(), y: e.pageY };
}

/** X-axis zero offset for centering */
export function getZeroXPoint() {
  return window.innerWidth / 2 - 325;
}

/** Check if click is on a tool button */
export function isClickOnTool(e, selector) {
  return e.target.closest(selector) !== null;
}

/**
 * Get proper bounding box for any shape, including padding,
 * used for both hit-testing and rotation-aware erasing.
 */
export function getShapeBounds(type, shape) {
  const padding = 20; // Extra padding around shapes

  if (type === 'rectangle' || type === 'ellipse') {
    const x1 = shape.xRel;
    const y1 = shape.y;
    const x2 = shape.xRel + shape.widthRel;
    const y2 = shape.y + shape.height;
    return {
      minX: Math.min(x1, x2) - padding,
      maxX: Math.max(x1, x2) + padding,
      minY: Math.min(y1, y2) - padding,
      maxY: Math.max(y1, y2) + padding
    };
  }

  if (type === 'line') {
    return {
      minX: Math.min(shape.x1Rel, shape.x2Rel) - padding,
      maxX: Math.max(shape.x1Rel, shape.x2Rel) + padding,
      minY: Math.min(shape.y1, shape.y2)   - padding,
      maxY: Math.max(shape.y1, shape.y2)   + padding
    };
  }

  if (type === 'arrow') {
    const dx = shape.x2Rel - shape.x1Rel;
    const dy = shape.y2    - shape.y1;
    const angle = Math.atan2(dy, dx);
    const len   = Math.hypot(dx, dy) * 0.2;

    const head1X = shape.x2Rel - len * Math.cos(angle - Math.PI/6);
    const head1Y = shape.y2    - len * Math.sin(angle - Math.PI/6);
    const head2X = shape.x2Rel - len * Math.cos(angle + Math.PI/6);
    const head2Y = shape.y2    - len * Math.sin(angle + Math.PI/6);

    const allX = [shape.x1Rel, shape.x2Rel, head1X, head2X];
    const allY = [shape.y1,    shape.y2,    head1Y, head2Y];

    return {
      minX: Math.min(...allX) - padding,
      maxX: Math.max(...allX) + padding,
      minY: Math.min(...allY) - padding,
      maxY: Math.max(...allY) + padding
    };
  }

  if (type === 'pencil' || type === 'highlighter') {
    const pts = Array.isArray(shape.points) ? shape.points : [];
    if (!pts.length) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    const allX = pts.map(p => p.xRel);
    const allY = pts.map(p => p.y);
    return {
      minX: Math.min(...allX) - padding,
      maxX: Math.max(...allX) + padding,
      minY: Math.min(...allY) - padding,
      maxY: Math.max(...allY) + padding
    };
  }

  if (type === 'text') {
    // Multi-line aware measurement for accurate bounds
    const fontSize   = shape.fontSize   || 24;
    const fontFamily = shape.fontFamily || 'sans-serif';
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `${fontSize}px ${fontFamily}`;
    const lines = String(shape.text ?? '').split(/\n/);
    let textWidth = 0;
    for (const line of lines) {
      const w = ctx.measureText(line).width;
      if (w > textWidth) textWidth = w;
    }
    const m = ctx.measureText('Mg');
    const ascent  = m.actualBoundingBoxAscent  ?? fontSize * 0.8;
    const descent = m.actualBoundingBoxDescent ?? fontSize * 0.2;
    const n = Math.max(1, lines.length);
    const x = shape.xRel;
    const y = shape.y; // baseline of first line
    return {
      minX: x - padding,
      minY: y - ascent - padding,
      maxX: x + textWidth + padding,
      maxY: y + descent + (n - 1) * fontSize + padding
    };
  }

  // Fallback
  return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
}

/** Hit-test using the padded bounding box (no rotation) */
export function pointInShapeBounds(type, shape, x, y) {
  const b = getShapeBounds(type, shape);
  return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
}
