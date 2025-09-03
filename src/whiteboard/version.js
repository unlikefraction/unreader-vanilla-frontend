// version.js

/**
 * VersionManager handles undo/redo for DrawingTools by snapshotting shapesData.
 * Usage:
 *   import { initVersioning } from './version.js';
 *   initVersioning(drawingTools, { maxHistory: 10 });
 */

export class VersionManager {
    constructor(drawingTools, maxHistory = 10) {
      this.drawingTools = drawingTools;
      this.maxHistory = maxHistory;
      this.history = [];
      this.pointer = -1;
      // Placeholder for original save method; assigned in initVersioning
      this.origSave = null;
      // Record the initial state
      this.record();
    }
  
    // Deep clone shapesData (assumes serializable)
    cloneState() {
      return JSON.parse(JSON.stringify(this.drawingTools.shapesData));
    }
  
    // Record a new state, trimming future states and capping history length
    record() {
      // Drop states ahead if we've undone
      if (this.pointer < this.history.length - 1) {
        this.history = this.history.slice(0, this.pointer + 1);
      }
      // Push current state
      this.history.push(this.cloneState());
  
      // Enforce history limit (+1 because initial state counts)
      if (this.history.length > this.maxHistory + 1) {
        this.history.shift();  // remove oldest
      } else {
        this.pointer++;
      }
  
      // If we removed one, ensure pointer at end
      if (this.history.length > this.maxHistory) {
        this.pointer = this.history.length - 1;
      }
    }
  
    // Undo one step
    undo() {
      if (this.pointer <= 0) return;
      this.pointer--;
      this.applyState(this.history[this.pointer]);
    }
  
    // Redo one step
    redo() {
      if (this.pointer >= this.history.length - 1) return;
      this.pointer++;
      this.applyState(this.history[this.pointer]);
    }
  
    // Apply a given state without creating a new history entry
    applyState(state) {
      this.drawingTools.shapesData = JSON.parse(JSON.stringify(state));
      // Save via original method (no record)
      this.origSave();
      this.drawingTools.redrawAll();
    }
  }
  
  /**
   * Initialize versioning on a DrawingTools instance.
   * @param {DrawingTools} drawingTools
   * @param {{maxHistory?: number}} options
   * @returns {VersionManager}
   */
  export function initVersioning(drawingTools, options = {}) {
    const maxHistory = options.maxHistory || 10;
    const manager = new VersionManager(drawingTools, maxHistory);
  
    // Capture original save method
    manager.origSave = drawingTools.save.bind(drawingTools);
    // Override save: record then persist
    drawingTools.save = () => {
      manager.record();
      manager.origSave();
    };
  
    // Keyboard shortcuts for undo/redo
    document.addEventListener('keydown', e => {
      const key = e.key.toLowerCase();
      const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && key === 'z';
      const isRedo = (e.ctrlKey || e.metaKey) && e.shiftKey && key === 'z';
      if (isUndo) {
        manager.undo();
        e.preventDefault();
      } else if (isRedo) {
        manager.redo();
        e.preventDefault();
      }
    });
  
    return manager;
  }
  