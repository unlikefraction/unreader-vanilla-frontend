// ------text-tool.js-------


import { computeCoords, getZeroXPoint } from '../utils.js';
import { ReadAlong } from '../../audio/read-along.js';

/**
 * Text drawing tool
 */
export function handleText(drawingTools, e) {
  if (!drawingTools.activeTool?.classList.contains('text')) return;
  if (drawingTools._isClickOnTool(e)) return; // Skip if clicking on tools

  drawingTools._createTextEditor(e);
}

/** Create editable text box */
export function createTextEditor(drawingTools, e) {
  const cx = e.pageX; // center X in page space
  const cy = e.pageY; // center Y in page space
  const zeroX = getZeroXPoint();

  const el = document.createElement('div');
  el.contentEditable = 'true';
  el.classList.add('annotation-text-editor', 'editing');

  const maxW = Math.min(600, Math.floor(window.innerWidth * 0.9));
  Object.assign(el.style, {
    position: 'absolute',
    left: `${cx}px`,
    top: `${cy}px`,
    transform: 'none', // anchor start exactly at click (adjusted to baseline below)
    transformOrigin: 'left top',
    display: 'block',
    padding: '4px 6px',
    border: '1px dashed rgba(0,0,0,0.3)',
    outline: 'none',
    background: 'rgba(255,255,255,0.9)',
    zIndex: '1000',
    fontSize: '24px',
    lineHeight: '1.2',
    color: drawingTools.selectedColor,
    whiteSpace: 'pre',
    overflow: 'visible',
    minWidth: '40px',
    minHeight: '1em',
    textAlign: 'left',
    borderRadius: '6px'
  });

  document.body.appendChild(el);
  // Prevent initial focus from scrolling viewport
  try { el.focus({ preventScroll: true }); } catch { el.focus(); }
  // Snapshot zone and disable read-along while editing text
  try {
    const ra = ReadAlong.get();
    drawingTools._wasInReadAlongZone = (ra && typeof ra.isCurrentWordInZone === 'function') ? ra.isCurrentWordInZone() : false;
    ra?.setAutoEnabled(false);
  } catch {}

  // After insertion, align top to baseline so the click point is baseline of first line
  try {
    const cs = getComputedStyle(el);
    const fontSize = parseFloat(cs.fontSize) || 24;
    const fontFamily = cs.fontFamily || 'sans-serif';
    const cvs = document.createElement('canvas');
    const ctx = cvs.getContext('2d');
    ctx.font = `${fontSize}px ${fontFamily}`;
    const m = ctx.measureText('Mg');
    const ascent = m.actualBoundingBoxAscent ?? fontSize * 0.8;
    el.style.top = `${cy - ascent}px`;
  } catch {}

  // Handle Enter vs Shift+Enter, Esc to cancel
  const restoreScroll = () => {
    const x = window.scrollX, y = window.scrollY;
    requestAnimationFrame(() => window.scrollTo(x, y));
  };

  el.addEventListener('keydown', ev => {
    // Never allow viewport to shift to keep caret visible
    restoreScroll();
    if (ev.key === 'Enter') {
      if (ev.shiftKey) {
        // Insert a literal newline without causing viewport jumps
        ev.preventDefault();
        try { document.execCommand('insertText', false, '\n'); } catch {}
        restoreScroll();
      } else {
        ev.preventDefault();
        el.blur();
      }
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      el.dataset.cancelled = '1';
      el.blur();
    }
  });
  // Extra guards against scroll adjustments while typing
  el.addEventListener('keyup', restoreScroll);
  el.addEventListener('input', restoreScroll);
  el.addEventListener('beforeinput', restoreScroll);

  // Prevent creating another editor when clicking inside current one
  ['mousedown','click'].forEach(evt => el.addEventListener(evt, ev => ev.stopPropagation()));

  el.addEventListener('blur', () => {
    const cancelled = el.dataset.cancelled === '1';
    const textValue = (el.innerText || '').replace(/\s+$/,'');
    const cs = getComputedStyle(el);
    const fontSize = parseFloat(cs.fontSize) || 24;
    const fontFamily = cs.fontFamily || 'sans-serif';

    // If cancelled or empty, cleanup and bail
    if (cancelled || textValue.length === 0) {
      el.remove();
      const cursor = drawingTools.tools.find(t => t.classList.contains('cursor'));
      if (cursor) drawingTools.setActiveTool(cursor);
      return;
    }

    // Persist with click point as the fixed start (baseline of first line)
    const baselineY = cy;
    const xRel = (cx - zeroX);

    // Persist text
    drawingTools.shapesData.text.push({
      xRel,
      y: baselineY,
      text: textValue,
      color: drawingTools.selectedColor,
      fontSize,
      fontFamily
    });
    drawingTools.save();
    el.remove();
    drawingTools.redrawAll();
    // Snap once only if previously in zone; then re-enable
    try {
      const ra = ReadAlong.get();
      if (drawingTools._wasInReadAlongZone && ra && typeof ra.snapToCurrentWord === 'function') {
        ra.snapToCurrentWord({ smooth: true });
      }
      ra?.setAutoEnabled(true);
    } catch {}
    drawingTools._wasInReadAlongZone = undefined;
    const cursor = drawingTools.tools.find(t => t.classList.contains('cursor'));
    if (cursor) drawingTools.setActiveTool(cursor);
  });
}
