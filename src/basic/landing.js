// keep your weighted picker + href assignment
const options = ["login.html", "loginOg.html"];
const weights = [0.5, 0.5]; // tweak as needed

function weightedRandom(options, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  let rand = Math.random() * sum;
  for (let i = 0; i < options.length; i++) {
    if (rand < weights[i]) return options[i];
    rand -= weights[i];
  }
  // fallback (shouldn't happen if weights valid)
  return options[0];
}

const chosenHref = weightedRandom(options, weights);
const linkEl = document.querySelector(".logInLink");
if (linkEl) linkEl.href = chosenHref;
// Analytics: mark A/B landing variant exposure
try {
  if (window.Analytics) {
    window.Analytics.setProps({ landing_variant: chosenHref });
    window.Analytics.capture('landing_variant_exposed', { variant: chosenHref, path: location.pathname });
    // Also capture explicit login link clicks
    linkEl?.addEventListener('click', () => {
      try { if (window.Analytics) window.Analytics.capture('landing_login_link_click', { href: linkEl.getAttribute('href') || chosenHref, path: location.pathname }); } catch {}
    });
  }
} catch {}

/* === click/hover logic for the highlight spans === */
(() => {
  const ROOT = '#mainContent-transcript-landing-html-order-word-timings-ordered-json-100';

  // 299 = copy coupon
  const SEL_COPY = `${ROOT} span.highlight[data-index="299"]`;

  // 320/321/322 = redirect (bling)
  const REDIRECT_INDEXES = [317, 318, 319];
  const REDIRECT_SELECTORS = REDIRECT_INDEXES.map(i => `${ROOT} span.highlight[data-index="${i}"]`);

  const q = (sel) => document.querySelector(sel);

  // generic rect hit test
  const hit = (el, x, y) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };

  // padded hit test for the "guys" 320/321/322 (makes it easier to hover/click)
  const hitWithPad = (el, x, y, pad = 8) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const left = r.left - pad;
    const right = r.right + pad;
    const top = r.top - pad;
    const bottom = r.bottom + pad;
    return x >= left && x <= right && y >= top && y <= bottom;
  };

  // copy coupon with Clipboard API + fallback
  async function copyCoupon(code = "I-UNREAD-IT-ALL") {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = code;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try { document.execCommand("copy"); } finally { document.body.removeChild(ta); }
    }
  }

  // float a tiny "copied" badge above the element, fade out in 1s, then remove
  function showCopiedBadge(el) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const badge = document.createElement("div");
    badge.textContent = "copied";
    Object.assign(badge.style, {
      position: "fixed",
      left: `${Math.round(r.left + r.width / 2)}px`,
      top: `${Math.round(r.top - 30)}px`,
      background: "#20bf6b",
      transform: "translate(-50%, 0)",
      fontSize: "18px",
      lineHeight: "1",
      padding: "8px 12px",
      borderRadius: "12px",
      color: "#fff",
      fontWeight: "400",
      pointerEvents: "none",
      zIndex: "2147483647",
      transition: "transform 1s ease, opacity 1s ease",
      opacity: "1",
      userSelect: "none"
    });
    document.body.appendChild(badge);

    requestAnimationFrame(() => {
      badge.style.transform = "translate(-50%, -35px)";
      badge.style.opacity = "0";
    });

    setTimeout(() => { badge.remove(); }, 1050);
  }

  function redirectWeighted() {
    const dest = weightedRandom(options, weights) || options[0];
    // keep the .logInLink in sync, too
    const link = document.querySelector(".logInLink");
    if (link) link.href = dest;
    try { if (window.Analytics) window.Analytics.capture('landing_redirect_to_login', { variant: dest, path: location.pathname }); } catch {}
    window.location.href = dest;
  }

  // === overlay that forces pointer + captures clicks over 320/321/322 ===
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed',
    zIndex: '2147483646',
    background: 'transparent',
    pointerEvents: 'auto',
    cursor: 'pointer',
    display: 'none',
    userSelect: 'none',
  });
  document.body.appendChild(overlay);

  const REDIRECT_OVERLAY_PAD = 12; // padding around the guys

  function findRedirectTargetAt(x, y) {
    for (const sel of REDIRECT_SELECTORS) {
      const el = q(sel);
      if (hitWithPad(el, x, y, REDIRECT_OVERLAY_PAD)) return el;
    }
    return null;
  }

  function positionOverlayOver(el, pad = REDIRECT_OVERLAY_PAD) {
    const r = el.getBoundingClientRect();
    overlay.style.left = `${r.left - pad}px`;
    overlay.style.top = `${r.top - pad}px`;
    overlay.style.width = `${r.width + pad * 2}px`;
    overlay.style.height = `${r.height + pad * 2}px`;
    overlay.style.display = 'block';
  }

  function hideOverlay() {
    overlay.style.display = 'none';
  }

  // move overlay on mousemove; ensures pointer cursor even if underlying spans are non-interactive
  document.addEventListener('mousemove', (e) => {
    const { clientX: x, clientY: y } = e;

    const target = findRedirectTargetAt(x, y);
    if (target) {
      positionOverlayOver(target, REDIRECT_OVERLAY_PAD);
    } else {
      hideOverlay();
    }
  }, { passive: true });

  // clicks on overlay → redirect
  overlay.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    redirectWeighted();
  });

  // keep overlay honest on layout changes
  window.addEventListener('scroll', hideOverlay, { passive: true });
  window.addEventListener('resize', hideOverlay);

  // document click for the copy badge (302)
  document.addEventListener("click", async (e) => {
    const { clientX: x, clientY: y } = e;
    const elCopy = q(SEL_COPY);
    if (hit(elCopy, x, y)) {
      await copyCoupon("I-UNREAD-IT-ALL");
      try { if (window.Analytics) window.Analytics.capture('coupon_copy_clicked', { path: location.pathname }); } catch {}
      showCopiedBadge(elCopy);
    }
  });

  /* === LOGIN-GATE: disable .hold-up, .inbox with tooltip + redirect (per-element messages) === */

  // Per-selector config: selector, tooltip position, and custom message
  const GATED_CONFIG = [
    { sel: '.hold-up', pos: 'top',   message: 'Holdup can be accessed with books. Login to experience.' },
    { sel: '.inbox',   pos: 'right', message: 'Login to use your inbox.' },
  ];

  const GAP = 6, PAD = 6, RADIUS = 4;
  const SHOW_POSITION_IN_TEXT = false; // append (top/right/left/bottom) to the text

  let loginTooltipEl = null;

  function createLoginTooltip() {
    const el = document.createElement("div");
    el.className = "login-tooltip";
    el.setAttribute("role", "tooltip");
    el.style.position = "fixed";
    el.style.background = "#000";
    el.style.color = "#fff";
    el.style.padding = `${PAD}px`;
    el.style.borderRadius = `${RADIUS}px`;
    el.style.fontSize = "13px";
    el.style.whiteSpace = "nowrap";
    el.style.pointerEvents = "none";
    el.style.zIndex = "2147483647";
    el.style.visibility = "hidden";
    document.body.appendChild(el);
    return el;
  }

  // Hide any existing .tooltip when hovering gated features
  function hideNativeTooltips() {
    document.querySelectorAll('.tooltip').forEach(t => {
      t.style.visibility = 'hidden';
    });
  }

  function setLoginTooltipText(message, position) {
    if (!loginTooltipEl) return;
    const label = (SHOW_POSITION_IN_TEXT && position) ? ` (${position})` : "";
    loginTooltipEl.textContent = message + label;
  }

  function positionLoginTooltip(target, position = "top") {
    const rect = target.getBoundingClientRect();
    const tRect = loginTooltipEl.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;

    let top, left;

    switch (position) {
      case "left":
        top = rect.top + (rect.height - tRect.height) / 2;
        left = rect.left - GAP - tRect.width;
        break;
      case "right":
        top = rect.top + (rect.height - tRect.height) / 2;
        left = rect.right + GAP;
        break;
      case "bottom":
        top = rect.bottom + GAP;
        left = rect.left + (rect.width - tRect.width) / 2;
        break;
      case "top":
      default:
        top = rect.top - GAP - tRect.height;
        left = rect.left + (rect.width - tRect.width) / 2;
        break;
    }

    // Clamp to viewport
    if (left < 4) left = 4;
    if (left + tRect.width > vw - 4) left = Math.max(4, vw - tRect.width - 4);
    if (top < 4) top = 4;
    if (top + tRect.height > vh - 4) top = Math.max(4, vh - tRect.height - 4);

    loginTooltipEl.style.left = `${Math.round(left)}px`;
    loginTooltipEl.style.top = `${Math.round(top)}px`;
  }

  function showLoginTooltip(target, message, position = "top") {
    if (!loginTooltipEl) loginTooltipEl = createLoginTooltip();
    hideNativeTooltips(); // hide .tooltip on hover
    setLoginTooltipText(message, position);

    // measurable
    loginTooltipEl.style.visibility = "hidden";
    loginTooltipEl.offsetWidth;

    positionLoginTooltip(target, position);
    loginTooltipEl.style.visibility = "visible";
  }

  function hideLoginTooltip() {
    if (loginTooltipEl) loginTooltipEl.style.visibility = "hidden";
  }

  function makeElementLookDisabled(el) {
    el.setAttribute("aria-disabled", "true");
    el.style.cursor = "pointer";
    if (!el.dataset._dimApplied) {
      // el.style.opacity = (parseFloat(getComputedStyle(el).opacity) || 1) * 0.7;
      el.dataset._dimApplied = "1";
    }
  }

  function gateElement(el, pos, message) {
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
    makeElementLookDisabled(el);

    const go = (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      redirectWeighted();
    };

    el.addEventListener("click", go);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") go(e);
    });

    el.addEventListener("mouseenter", () => showLoginTooltip(el, message, pos));
    el.addEventListener("mouseleave", hideLoginTooltip);
    el.addEventListener("focus", () => showLoginTooltip(el, message, pos));
    el.addEventListener("blur", hideLoginTooltip);

    window.addEventListener("scroll", hideLoginTooltip, { passive: true });
    window.addEventListener("resize", hideLoginTooltip);
  }

  function initLoginGate() {
    GATED_CONFIG.forEach(({ sel, pos, message }) => {
      document.querySelectorAll(sel).forEach((el) => gateElement(el, pos || "top", message));
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initLoginGate);
  } else {
    initLoginGate();
  }
})();









// letter by letter typing animation

(function () {
  // ===== Tunables =====
  var CONTAINER_SELECTOR = '.mainContent';
  var START_DELAY_MS     = 100;    // minimum delay before even considering start
  var QUIET_WINDOW_MS    = 500;    // must be no DOM changes for this long
  var MIN_TEXT_LEN       = 200;    // don’t start until there’s at least this much text
  var MAX_WAIT_MS        = 5000;   // safety: start anyway after this much waiting

  var WORD_DELAY_MS      = 5;     // stagger between words (fast)
  var WORD_FADE_MS       = 500;    // how long each word takes to fade in
  var INSTANT_FINISH_KEY = 'Escape';

  // Expose live tuning if you want
  if (typeof window !== 'undefined') {
    window.typeConfig = { start: START_DELAY_MS, wordDelay: WORD_DELAY_MS, fade: WORD_FADE_MS };
  }

  // Hide ASAP to avoid flash before wrapping; keep layout stable
  function hideEarly() {
    var c = document.querySelector(CONTAINER_SELECTOR);
    if (!c || c.dataset._wordfadeInit === '1') return;
    c.dataset._wordfadeInit = '1';
    c.dataset._oldInlineStyle = c.getAttribute('style') || '';
    c.style.setProperty('visibility', 'hidden', 'important'); // invisible but keeps layout
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { hideEarly(); init(); });
  } else {
    hideEarly(); init();
  }

  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;

    var started = false;
    var firstPossibleStart = Date.now() + ((window.typeConfig && window.typeConfig.start) || START_DELAY_MS);
    var lastMutation = Date.now();

    // Track when your app stops mutating the DOM
    var mo = new MutationObserver(function () { lastMutation = Date.now(); });
    mo.observe(container, { childList: true, subtree: true, characterData: true });

    // Manual override: dispatch when your app is ready
    window.addEventListener('typing:go', function () { tryStart(true); });

    var forceTimer = setTimeout(function () { tryStart(true); }, MAX_WAIT_MS);
    tickCheck();

    function tickCheck() {
      if (started) return;
      var now = Date.now();
      if (now < firstPossibleStart) { return setTimeout(tickCheck, firstPossibleStart - now); }
      if (!hasEnoughContent(container)) { return setTimeout(tickCheck, 100); }
      if (now - lastMutation < QUIET_WINDOW_MS) { return setTimeout(tickCheck, QUIET_WINDOW_MS); }
      tryStart(false);
    }

    function tryStart(force) {
      if (started) return;
      if (!force) {
        if (!hasEnoughContent(container)) return tickCheck();
        if (Date.now() - lastMutation < QUIET_WINDOW_MS) return tickCheck();
      }
      started = true;
      clearTimeout(forceTimer);
      mo.disconnect();
      beginWordFade(container);
    }
  }

  function hasEnoughContent(container) {
    var txt = (container.textContent || '').trim();
    return txt.length >= MIN_TEXT_LEN;
  }

  function beginWordFade(container) {
    // Restore EXACT inline style the element had
    var containerStyle = container.dataset._oldInlineStyle || '';
    if (containerStyle) container.setAttribute('style', containerStyle);
    else container.removeAttribute('style');
    delete container.dataset._oldInlineStyle;

    // 1) Collect text nodes (skip script/style/noscript)
    var walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (node) {
          if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
          var p = node.parentNode; if (!p) return NodeFilter.FILTER_REJECT;
          var tag = p.nodeName.toLowerCase();
          if (tag === 'script' || tag === 'style' || tag === 'noscript') return NodeFilter.FILTER_REJECT;
          // ignore pure-whitespace nodes so we don’t create junk spans
          if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    // 2) Replace words with span-wrapped words; preserve whitespace as text nodes
    var wordSpans = [];
    var toProcess = [];
    var n; while (n = walker.nextNode()) toProcess.push(n);

    toProcess.forEach(function (textNode) {
      var text = textNode.nodeValue;
      var parts = text.split(/(\s+)/); // capture spaces as separate tokens
      var frag = document.createDocumentFragment();
      for (var i = 0; i < parts.length; i++) {
        var token = parts[i];
        if (i % 2 === 1) {
          // whitespace token: keep as text node
          frag.appendChild(document.createTextNode(token));
        } else if (token.length) {
          // word token: wrap
          var span = document.createElement('span');
          span.textContent = token;
          span.style.opacity = '0';
          span.style.transition = 'opacity ' + ((window.typeConfig && window.typeConfig.fade) || WORD_FADE_MS) + 'ms ease';
          // prevent awkward line height jumps
          span.style.display = 'inline-block';
          span.style.willChange = 'opacity';
          frag.appendChild(span);
          wordSpans.push(span);
        }
      }
      textNode.parentNode.replaceChild(frag, textNode);
    });

    // 3) Reveal container (still invisible words)
    container.style.visibility = 'visible';

    if (!wordSpans.length) return;

    var skip = false;
    window.addEventListener('keydown', function (e) {
      if (e.key === INSTANT_FINISH_KEY) {
        skip = true;
        for (var i = 0; i < wordSpans.length; i++) {
          wordSpans[i].style.transition = 'none';
          wordSpans[i].style.opacity = '1';
        }
      }
    });

    // 4) Staggered fade of words
    var delay = Math.max(0, (window.typeConfig && window.typeConfig.wordDelay) || WORD_DELAY_MS);
    // Use rAF to start smooth, then setTimeout chain for cadence
    var i = 0;
    function revealNextBatch(ts) {
      if (skip) return;
      // Reveal a small batch per frame to keep it zippy
      var BATCH = 8; // fast visual ramp; tweak if you want more/less burst
      for (var k = 0; k < BATCH && i < wordSpans.length; k++, i++) {
        (function (idx) {
          setTimeout(function () {
            if (!skip) wordSpans[idx].style.opacity = '1';
          }, idx * delay);
        })(i);
      }
      if (i < wordSpans.length && !skip) requestAnimationFrame(revealNextBatch);
    }
    requestAnimationFrame(revealNextBatch);
  }
})();
