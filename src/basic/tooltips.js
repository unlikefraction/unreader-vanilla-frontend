// /src/basic/tooltips.js

// className → [Tool Name, Shortcut, Position]
const tools = {
  ".cursor": ["Cursor", "V", "right"],
  ".highlighter": ["Highlighter", "H", "right"],
  ".pencil": ["Pencil", "P", "right"],
  ".text": ["Text", "T", "right"],
  ".line": ["Line", "L", "right"],
  ".arrow": ["Arrow", "A", "right"],
  ".eraser": ["Eraser", "E", "right"],
  ".rectangle": ["Rectangle", "R", "right"],
  ".circle": ["Circle", "O", "right"],
  ".inbox": ["Inbox", null, "right"],
  ".hold-up": ["Holdup", "/", "top"],
  ".holdup": ["Holdup", "/", "top"],

  ".settings": ["Settings", null, "top"],
  ".rewind": ["Rewind", "←", "top"],
  ".playButton": ["Play", "␣", "top"],
  ".forward": ["Forward", "→", "top"],
  ".read-along": ["Read Along", null, "top"],

  ".heightSetter": ["Aligner", null, "left"],
};

(function () {
  const GAP = 6;
  const PAD = 8;
  const RADIUS = 4;

  let tooltipEl = null;
  let currentHost = null; // the element we’re currently attached to

  // Precompute for quick matching
  const selectors = Object.keys(tools);

  function createTooltip() {
    const el = document.createElement("div");
    el.classList.add("tooltip");
    el.setAttribute("role", "tooltip");
    el.style.position = "fixed";
    el.style.left = "0";
    el.style.top = "0";
    el.style.background = "#000";
    el.style.color = "#fff";
    el.style.padding = `${PAD}px`;
    el.style.borderRadius = `${RADIUS}px`;
    el.style.fontSize = `14px`;
    el.style.whiteSpace = "nowrap";
    el.style.pointerEvents = "none";
    el.style.zIndex = "2147483647";
    el.style.boxSizing = "border-box";
    el.style.visibility = "hidden";
    document.body.appendChild(el);
    return el;
  }

  function setTooltipContent(name, shortcut) {
    tooltipEl.textContent = "";
    const nameSpan = document.createElement("span");
    nameSpan.textContent = name || "";
    tooltipEl.appendChild(nameSpan);

    if (shortcut && String(shortcut).toLowerCase() !== "null") {
      const shortSpan = document.createElement("span");
      shortSpan.textContent = shortcut;
      shortSpan.style.opacity = "0.6";
      shortSpan.style.marginLeft = "8px";
      tooltipEl.appendChild(shortSpan);
    }
  }

  function positionTooltip(target, position) {
    const rect = target.getBoundingClientRect();
    const tRect = tooltipEl.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;

    let top, left;

    switch (position) {
      case "left":
        top = rect.top + (rect.height - tRect.height) / 2;
        left = rect.left - GAP - tRect.width + 10;
        break;
      case "right":
        top = rect.top + (rect.height - tRect.height) / 2;
        left = rect.right + GAP + 5;
        break;
      case "bottom":
        top = rect.bottom + GAP;
        left = rect.left + (rect.width - tRect.width) / 2;
        break;
      case "top":
      default:
        top = rect.top - GAP - tRect.height - 10;
        left = rect.left + (rect.width - tRect.width) / 2;
        break;
    }

    // Clamp to viewport
    if (left < 4) left = 4;
    if (left + tRect.width > vw - 4) left = Math.max(4, vw - tRect.width - 4);
    if (top < 4) top = 4;
    if (top + tRect.height > vh - 4) top = Math.max(4, vh - tRect.height - 4);

    tooltipEl.style.left = `${Math.round(left)}px`;
    tooltipEl.style.top = `${Math.round(top)}px`;
  }

  function showTooltipFor(hostEl, toolName, shortcut, position) {
    if (!tooltipEl) tooltipEl = createTooltip();
    setTooltipContent(toolName, shortcut);
    tooltipEl.style.visibility = "hidden";
    // force reflow
    // eslint-disable-next-line no-unused-expressions
    tooltipEl.offsetWidth;
    positionTooltip(hostEl, position);
    tooltipEl.style.visibility = "visible";
    currentHost = hostEl;
  }

  function hideTooltip() {
    if (tooltipEl) tooltipEl.style.visibility = "hidden";
    currentHost = null;
  }

  function isEnabled() {
    // Disable tooltips on narrow viewports
    return (document.documentElement.clientWidth || window.innerWidth) >= 1000;
  }

  function findMatch(startEl) {
    // find nearest ancestor matching any tool selector
    for (const sel of selectors) {
      const host = startEl.closest(sel);
      if (host) return { sel, host, def: tools[sel] };
    }
    return null;
  }

  // --- Delegated pointer hover ---
  document.addEventListener("mouseover", (e) => {
    if (!isEnabled()) { hideTooltip(); return; }
    const m = findMatch(e.target);
    if (!m) return;

    // If we’re moving within the same host, ignore
    if (currentHost && currentHost === m.host) return;

    const [name, shortcut, pos] = m.def;
    showTooltipFor(m.host, name, shortcut, pos || "top");
  });

  document.addEventListener("mouseout", (e) => {
    if (!currentHost) return;
    // If moving to an element still inside the current host, keep it
    if (currentHost.contains(e.relatedTarget)) return;
    hideTooltip();
  });

  // --- Keyboard focus (accessibility) ---
  document.addEventListener("focusin", (e) => {
    if (!isEnabled()) { hideTooltip(); return; }
    const m = findMatch(e.target);
    if (!m) return;
    const [name, shortcut, pos] = m.def;
    showTooltipFor(m.host, name, shortcut, pos || "top");
  });

  document.addEventListener("focusout", (e) => {
    if (!currentHost) return;
    if (currentHost.contains(e.relatedTarget)) return;
    hideTooltip();
  });

  // Global hide on resize/scroll
  window.addEventListener("resize", () => {
    // Always hide on resize; if disabled at this size, keep hidden
    hideTooltip();
  }, true);
  window.addEventListener("scroll", hideTooltip, true);
})();
