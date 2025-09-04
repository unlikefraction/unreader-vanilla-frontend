// keyboard.js

/**
 * Keyboard shortcuts for drawing tools, audio controls, and holdup toggle
 */

// Drawing Tool Shortcuts Configuration
const DRAWING_SHORTCUTS = {
  'KeyV': 'cursor',
  'KeyR': 'rectangle',
  'KeyA': 'arrow',
  'KeyL': 'line',
  'KeyE': 'eraser',
  'KeyP': 'pencil',
  'KeyH': 'highlighter',
  'KeyO': 'circle',
  'KeyT': 'text'
};

const AUDIO_SHORTCUTS = {
  'Space': 'playPause',
  'ArrowRight': 'forward',
  'ArrowLeft': 'rewind'
};

// Holdup shortcuts ("/" key). Note: Shift+"/" is "?" but still comes through as 'Slash'.
const HOLDUP_SHORTCUTS = {
  'Slash': 'toggle',
  'Backslash': 'toggle'
};

const SETTINGS = {
  enabled: true,
  preventInInputs: true
};

// Check if target is an input field where we should skip shortcuts
function isInputField(target) {
  const inputTypes = ['INPUT', 'TEXTAREA', 'SELECT'];
  return inputTypes.includes(target.tagName) ||
         target.contentEditable === 'true' ||
         target.isContentEditable ||
         target.classList.contains('annotation-text-editor');
}

// Get the active audio system (supports new MultiPageReader + legacy)
function getAudioSystem() {
  // ✅ New: MultiPageReader
  if (window.reader) return window.reader;

  // Legacy fallbacks
  if (window.audioSystem) return window.audioSystem;
  if (window.audioSetup)  return window.audioSetup;

  return null;
}

// Get the drawing system
function getDrawingSystem() {
  return window.drawer || null;
}

// Get the holdup system
function getHoldupSystem() {
  if (window.app?.holdup) return window.app.holdup;
  if (window.holdup) return window.holdup;
  return null;
}

// Handle drawing tool shortcuts
function handleDrawingShortcut(toolClass) {
  const drawer = getDrawingSystem();
  if (!drawer) {
    printError?.('Drawing system not available');
    return false;
  }

  const tool = document.querySelector(`.w-control.${toolClass}`);
  if (tool) {
    drawer.setActiveTool(tool);
    printl?.(`🎨 Switched to ${toolClass} tool`);
    return true;
  } else {
    printError?.(`Tool with class ${toolClass} not found`);
    return false;
  }
}

// Handle audio shortcuts (targets MultiPageReader API if present)
function handleAudioShortcut(audioAction) {
  const a = getAudioSystem();
  if (!a) {
    printError?.('Audio system not available');
    return false;
  }

  // MultiPageReader methods: toggle(), forward(), rewind(), play(), pause()
  // Legacy fallbacks supported as well.
  switch (audioAction) {
    case 'playPause': {
      if (typeof a.toggle === 'function') {
        a.toggle();
      } else if (typeof a.toggleAudio === 'function') {
        a.toggleAudio();
      } else if (typeof a.play === 'function' && typeof a.pause === 'function') {
        // crude fallback
        if (a.audioCore?.isPlaying) a.pause(); else a.play();
      }
      printl?.('🎵 Toggled audio playback');
      return true;
    }

    case 'forward': {
      if (typeof a.forward === 'function') {
        a.forward();                // MultiPageReader: +10s default
      } else if (typeof a.seek === 'function') {
        const cur = a.getCurrentTime?.() ?? 0;
        a.seek(cur + 10);
      }
      printl?.('⏭️ Audio forward +10s');
      return true;
    }

    case 'rewind': {
      if (typeof a.rewind === 'function') {
        a.rewind();                 // MultiPageReader: -10s default
      } else if (typeof a.seek === 'function') {
        const cur = a.getCurrentTime?.() ?? 0;
        a.seek(Math.max(0, cur - 10));
      }
      printl?.('⏮️ Audio rewind -10s');
      return true;
    }

    default:
      printError?.(`Unknown audio action: ${audioAction}`);
      return false;
  }
}

// Handle holdup shortcut
function handleHoldupShortcut(action) {
  const h = getHoldupSystem();
  if (!h) {
    printError?.('Holdup system not available');
    return false;
  }
  switch (action) {
    case 'toggle': {
      h.toggleMute?.();
      printl?.('🗣️ Toggled holdup (agent + mic)');
      return true;
    }
    default:
      printError?.(`Unknown holdup action: ${action}`);
      return false;
  }
}

// Wait for systems to be ready
function waitForSystems(callback, maxAttempts = 50) {
  let attempts = 0;

  const checkSystems = () => {
    attempts++;

    const audioReady = getAudioSystem() !== null;
    const drawingReady = getDrawingSystem() !== null;
    const holdupReady = getHoldupSystem() !== null;

    if (audioReady && drawingReady) {
      printl?.('✅ All systems ready for shortcuts');
      // also log holdup status, but don’t block
      printl?.(`Holdup system: ${holdupReady ? 'Ready' : 'Not ready'}`);
      callback();
      return;
    }

    if (attempts >= maxAttempts) {
      printError?.('⚠️ Timeout waiting for systems to be ready');
      printl?.(`Audio system: ${audioReady ? 'Ready' : 'Not ready'}`);
      printl?.(`Drawing system: ${drawingReady ? 'Ready' : 'Not ready'}`);
      printl?.(`Holdup system: ${holdupReady ? 'Ready' : 'Not ready'}`);
      callback(); // Proceed anyway
      return;
    }

    setTimeout(checkSystems, 100);
  };

  checkSystems();
}

// Initialize shortcuts
function initializeShortcuts() {
  printl?.('⌨️ Initializing keyboard shortcuts...');

  document.addEventListener('keydown', (e) => {
    if (!SETTINGS.enabled) return;

    // Skip if user is typing in input fields
    if (SETTINGS.preventInInputs && isInputField(e.target)) return;

    // Reload shortcut (Ctrl+R / Cmd+R)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      printl?.('🔄 Reloading page...');
      window.location.reload();
      return;
    }

    // Holdup shortcuts (handle first so "/" never triggers browser quick-find)
    const holdupAction = HOLDUP_SHORTCUTS[e.code];
    if (holdupAction) {
      e.preventDefault();
      handleHoldupShortcut(holdupAction);
      return;
    }

    // Drawing tool shortcuts
    const toolClass = DRAWING_SHORTCUTS[e.code];
    if (toolClass) {
      e.preventDefault();
      handleDrawingShortcut(toolClass);
      return;
    }

    // Audio shortcuts
    const audioAction = AUDIO_SHORTCUTS[e.code];
    if (audioAction) {
      // Prevent space/arrow scrolling
      e.preventDefault();
      handleAudioShortcut(audioAction);
      return;
    }
  });

  // Log available shortcuts
  printl?.('📋 Available shortcuts:');
  printl?.('Drawing tools:', Object.entries(DRAWING_SHORTCUTS).map(([key, tool]) => `${key} → ${tool}`));
  printl?.('Audio controls:', Object.entries(AUDIO_SHORTCUTS).map(([key, action]) => `${key} → ${action}`));
  printl?.('Holdup:', Object.entries(HOLDUP_SHORTCUTS).map(([key, action]) => `${key} → ${action}`));
  printl?.('Other: Ctrl+R → reload');
}

// Public API for controlling shortcuts
export const ShortcutManager = {
  enable() {
    SETTINGS.enabled = true;
    printl?.('✅ Shortcuts enabled');
  },

  disable() {
    SETTINGS.enabled = false;
    printl?.('❌ Shortcuts disabled');
  },

  toggle() {
    SETTINGS.enabled = !SETTINGS.enabled;
    printl?.(`🔄 Shortcuts ${SETTINGS.enabled ? 'enabled' : 'disabled'}`);
  },

  setPreventInInputs(prevent) {
    SETTINGS.preventInInputs = prevent;
    printl?.(`🎯 Prevent shortcuts in inputs: ${prevent}`);
  },

  isEnabled() {
    return SETTINGS.enabled;
  },

  getShortcuts() {
    return {
      drawing: { ...DRAWING_SHORTCUTS },
      audio: { ...AUDIO_SHORTCUTS },
      holdup: { ...HOLDUP_SHORTCUTS }
    };
  }
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    waitForSystems(initializeShortcuts);
  });
} else {
  waitForSystems(initializeShortcuts);
}

// Make ShortcutManager globally available
window.ShortcutManager = ShortcutManager;
