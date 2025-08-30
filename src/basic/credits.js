document.addEventListener("DOMContentLoaded", () => {
  /* ===========================
     Helpers
     =========================== */
  function getCookie(name) {
    const match = document.cookie.match(new RegExp("(^|;\\s*)" + name + "=([^;]*)"));
    return match ? decodeURIComponent(match[2]) : null;
  }

  async function postJSON(url, payload, token) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    return { ok: res.ok, status: res.status, data };
  }

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const randomDelayMs = () => 5000 + Math.floor(Math.random() * 5001); // 5–10s

  // Inject minimal spinner CSS once
  (() => {
    if (document.getElementById("paynow-spinner-style")) return;
    const style = document.createElement("style");
    style.id = "paynow-spinner-style";
    style.textContent = `
      @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
      .spinner { animation: spin 1s linear infinite; }
    `;
    document.head.appendChild(style);
  })();

  // --- Modal helpers ---
  const modal = document.getElementById("paymentStatusModal");
  const dialog = modal?.querySelector(".psm-dialog");
  const closeBtn = modal?.querySelector(".psm-close");
  const okBtn = modal?.querySelector("#psm-ok");
  const iconEl = modal?.querySelector("#psm-icon");
  const titleEl = modal?.querySelector("#psm-title");
  const msgEl = modal?.querySelector("#psm-message");
  const modeEl = modal?.querySelector("#psm-mode");
  const amtEl = modal?.querySelector("#psm-amount");
  const methodEl = modal?.querySelector("#psm-method");
  const codeRow = modal?.querySelector("#psm-code-row");
  const codeEl = modal?.querySelector("#psm-code");
  const creditsRow = modal?.querySelector("#psm-credits-row");
  const creditsEl = modal?.querySelector("#psm-credits");

  let lastFocusBeforeModal = null;

  function setStatusVisuals(status) {
    iconEl.classList.remove("success", "logged", "error", "warn");
    let icon = "ℹ️";
    let title = "Payment Status";
    switch (status) {
      case "success":
        icon = "✅"; iconEl.classList.add("success"); title = "Success";
        break;
      case "logged":
        icon = "📝"; iconEl.classList.add("logged"); title = "Logged";
        break;
      case "unauthorized":
        icon = "⚠️"; iconEl.classList.add("warn"); title = "Sign In Required";
        break;
      case "error":
      default:
        icon = "⛔"; iconEl.classList.add("error"); title = "Something went wrong";
    }
    iconEl.textContent = icon;
    titleEl.textContent = title;
  }

  function openStatusModal(params) {
    if (!modal) return;
    lastFocusBeforeModal = document.activeElement;

    const {
      status = "success",
      message = "",
      mode = "payment",
      amount = "",
      payment_method = "",
      code = "",
      credits_added = ""
    } = params || {};

    setStatusVisuals(status);
    msgEl.textContent = message || "";

    modeEl.textContent = mode ? mode : "—";
    amtEl.textContent = amount ? `$${Number(amount).toFixed(2)}` : "—";
    methodEl.textContent = payment_method || (mode === "coupon" ? "—" : "UPI");

    if (mode === "coupon") {
      codeRow.style.display = code ? "" : "none";
      codeEl.textContent = code || "—";
      creditsRow.style.display = credits_added ? "" : "none";
      creditsEl.textContent = credits_added ? `$${credits_added}` : "—";
    } else {
      codeRow.style.display = "none";
      creditsRow.style.display = "none";
    }

    modal.setAttribute("aria-hidden", "false");
    setTimeout(() => (okBtn || closeBtn)?.focus(), 0);
    document.addEventListener("keydown", onEscClose, { once: true });
  }

  function closeStatusModal() {
    if (!modal) return;
    modal.setAttribute("aria-hidden", "true");
    (lastFocusBeforeModal && lastFocusBeforeModal.focus) && lastFocusBeforeModal.focus();
  }

  function onEscClose(e) {
    if (e.key === "Escape") closeStatusModal();
  }

  closeBtn?.addEventListener("click", closeStatusModal);
  okBtn?.addEventListener("click", closeStatusModal);
  modal?.addEventListener("click", (e) => {
    if (e.target === modal) closeStatusModal();
  });

  function getActivePaymentMethod(options) {
    const active = options.find(o => o.classList.contains("active") && !o.classList.contains("applyCoupon"));
    if (!active) return "UPI";
    return active.dataset.method?.trim() || active.textContent.trim() || "UPI";
  }

  const MAX_INT_PART = 1_000_000;

  /* ===========================
     PART 1: Pretty amount input
     =========================== */
  const section         = document.querySelector(".inputAmountSection");
  const input           = document.querySelector(".inputAmount");
  const dollarAmount    = document.querySelector(".dollarAmount");
  const noteAmount      = document.querySelector(".noteAmount");
  const headingAmount   = document.querySelector(".headingAmount");
  const noteToInput     = document.querySelector(".noteToInput");
  const payNowButtonTxt = document.querySelector(".payNowButtonText");
  const payNowBtn       = document.querySelector(".payNowButton") || payNowButtonTxt?.closest("button");
  const payNowIcon      = document.querySelector(".payNowIcon");
  const options         = Array.from(document.querySelectorAll(".pOptions .option"));

  // === inline error helpers ===
  const errorEl = document.querySelector(".errorMessage");
  const showInlineError = (html) => {
    if (!errorEl) return;
    errorEl.innerHTML = html;
    errorEl.classList.remove("hidden");
  };
  const clearInlineError = () => {
    if (!errorEl) return;
    errorEl.innerHTML = "";
    errorEl.classList.add("hidden");
  };

  let overlay;
  let overlayEnabled = true;

  // === Pay Now enable/disable visual logic ===
  const setBtnDisabledVisuals = (disabled) => {
    if (!payNowBtn) return;
    payNowBtn.disabled = !!disabled;
    payNowBtn.style.opacity = disabled ? "0.6" : "";
    payNowBtn.style.pointerEvents = disabled ? "none" : "";
  };

  const isZeroOrEmpty = (raw) => {
    if (!raw) return true; // empty
    const n = Number(raw);
    if (!Number.isFinite(n)) return true;
    return n === 0;
  };

  const updatePayNowButtonState = () => {
    if (!payNowBtn || !input) return;

    if (!overlayEnabled) {
      // coupon mode → always enabled visuals
      setBtnDisabledVisuals(false);
      return;
    }

    const raw = (input.value || "").trim();
    const disable = isZeroOrEmpty(raw);
    setBtnDisabledVisuals(disable);
  };

  // === Loading state for Pay Now ===
  const remember = {
    text: payNowButtonTxt?.textContent || "Pay Now",
    iconClass: payNowIcon?.className || "ph ph-lock-laminated payNowIcon",
  };

  const enterLoadingState = () => {
    if (!payNowBtn) return;
    // Disable strongly while loading
    setBtnDisabledVisuals(true);
    // Icon → spinner
    if (payNowIcon) {
      payNowIcon.className = "ph ph-spinner-gap payNowIcon spinner";
      payNowIcon.setAttribute("aria-hidden", "true");
    }
    // Text → Processing
    if (payNowButtonTxt) payNowButtonTxt.textContent = "Processing…";
  };

  const exitLoadingState = () => {
    if (!payNowBtn) return;
    // Restore icon/text
    if (payNowIcon) {
      payNowIcon.className = remember.iconClass;
    }
    if (payNowButtonTxt) payNowButtonTxt.textContent = remember.text;
    // Re-evaluate disabled visuals by current mode/value
    updatePayNowButtonState();
  };

  if (section && input) {
    overlay = document.createElement("span");
    overlay.className = "formattedAmountOverlay";
    overlay.setAttribute("aria-hidden", "true");

    section.style.position = section.style.position || "relative";

    const applyCaretColor = () => {
      const caretCol = getComputedStyle(section).color || "#fff";
      input.style.caretColor = caretCol;
    };

    input.style.position = "relative";
    input.style.zIndex   = "1";
    input.style.background = "transparent";
    input.style.color       = "transparent";
    input.style.webkitTextFillColor = "transparent";
    input.style.outline     = "none";
    input.autocomplete      = "off";
    input.inputMode         = "decimal";
    input.spellcheck        = false;
    applyCaretColor();

    Object.assign(overlay.style, {
      position: "absolute",
      zIndex: "0",
      whiteSpace: "pre",
      pointerEvents: "none",
      left: "0px",
      top: "0px",
    });

    input.after(overlay);

    const alignOverlay = () => {
      const cs = getComputedStyle(input);
      overlay.style.left          = input.offsetLeft + "px";
      overlay.style.top           = (input.offsetTop) - 8 + "px";
      overlay.style.width         = input.offsetWidth + "px";
      overlay.style.height        = input.offsetHeight + "px";
      overlay.style.lineHeight    = cs.lineHeight;
      overlay.style.fontFamily    = cs.fontFamily;
      overlay.style.fontSize      = cs.fontSize;
      overlay.style.fontWeight    = cs.fontWeight;
      overlay.style.letterSpacing = cs.letterSpacing;
      overlay.style.padding       = cs.padding;
      applyCaretColor();
    };

    window.addEventListener("resize", () => { alignOverlay(); updatePayNowButtonState(); });
    window.addEventListener("load",  () => { alignOverlay(); updatePayNowButtonState(); });
    alignOverlay();

    // --- Formatting overlay ---
    function renderFormatted(value) {
      if (!overlayEnabled) return;
      if (!value) {
        overlay.innerHTML =
          `<span class="amt-whole muted">0</span><span class="amt-dec muted">.00</span>`;
        return;
      }
      const hasDot = value.includes(".");
      let tail = "";
      if (!hasDot) {
        tail = ".00";
      } else {
        const [, frac = ""] = value.split(".");
        if (frac.length === 0) tail = "00";
        else if (frac.length === 1) tail = "0";
        else tail = "";
      }
      overlay.innerHTML = [
        `<span class="amt-bold">${value}</span>`,
        tail ? `<span class="amt-dec muted">${tail}</span>` : ``,
      ].join("");
    }
    renderFormatted("");

    // --- Input guards (NO auto-clamp) ---
    const onlyAllowedChars = /^[0-9.]*$/;

    function wouldBeValidAmountString(str) {
      if (!onlyAllowedChars.test(str)) return false;
      const firstDot = str.indexOf(".");
      if (firstDot !== -1 && str.indexOf(".", firstDot + 1) !== -1) return false; // multiple dots
      if (firstDot !== -1) {
        const frac = str.slice(firstDot + 1);
        if (frac.length > 2) return false; // more than 2 decimals
      }
      const intPart = str.split(".")[0];
      if (intPart && Number(intPart) > MAX_INT_PART) return false;
      return true;
    }

    function computeNextValue(current, data, start, end, inputType) {
      if (inputType && inputType.startsWith("delete")) {
        return current.slice(0, start) + current.slice(end);
      }
      return current.slice(0, start) + (data || "") + current.slice(end);
    }

    input.addEventListener("beforeinput", (e) => {
      if (!overlayEnabled) return; // coupon mode
      const t = e.target;
      const start = t.selectionStart ?? t.value.length;
      const end   = t.selectionEnd ?? t.value.length;

      if (e.inputType && (e.inputType.startsWith("history") || e.inputType === "insertCompositionText")) return;

      if (e.inputType?.startsWith("insert")) {
        const proposed = computeNextValue(t.value, e.data, start, end, e.inputType);
        if (!wouldBeValidAmountString(proposed)) {
          e.preventDefault();
          return;
        }
        const dotIdx = t.value.indexOf(".");
        const caretInInt = dotIdx === -1 ? start : start <= dotIdx;
        if (caretInInt && /^\d$/.test(e.data || "")) {
          const nextInt = proposed.split(".")[0];
          if (Number(nextInt) > MAX_INT_PART) {
            e.preventDefault();
            return;
          }
        }
        return;
      }

      if (e.inputType?.startsWith("delete")) {
        const proposed = computeNextValue(t.value, e.data, start, end, e.inputType);
        if (!wouldBeValidAmountString(proposed)) return;
      }
    });

    input.addEventListener("input", () => {
      if (overlayEnabled) {
        let v = input.value;
        if (!onlyAllowedChars.test(v)) v = v.replace(/[^0-9.]/g, "");
        const firstDot = v.indexOf(".");
        if (firstDot !== -1) {
          v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, "");
          const frac = v.slice(firstDot + 1);
          if (frac.length > 2) v = v.slice(0, firstDot + 1) + frac.slice(0, 2);
        }
        const intPart = v.split(".")[0];
        if (intPart && Number(intPart) > MAX_INT_PART) {
          let trimmed = intPart;
          while (trimmed && Number(trimmed) > MAX_INT_PART) trimmed = trimmed.slice(0, -1);
          v = trimmed + (firstDot !== -1 ? v.slice(firstDot) : "");
        }
        if (v !== input.value) {
          const pos = v.length;
          input.value = v;
          input.setSelectionRange(pos, pos);
        }
        renderFormatted(input.value);
      } else {
        input.value = input.value.toUpperCase();
      }
      clearInlineError();
      updatePayNowButtonState();
    });

    input.addEventListener("focus", () => {
      if (overlayEnabled && !input.value) renderFormatted("");
    });

    input.addEventListener("blur", () => {
      if (overlayEnabled && !input.value) renderFormatted("");
    });

    section.addEventListener("click", () => input.focus());
  }

  /* ===========================
     PART 2: Payment option toggles
     =========================== */
  if (options.length) {
    options.forEach((opt) => {
      opt.addEventListener("click", () => {
        options.forEach((o) => o.classList.remove("active"));
        opt.classList.add("active");

        clearInlineError();

        if (opt.classList.contains("applyCoupon")) {
          overlayEnabled = false;
          if (overlay) overlay.style.display = "none";
          if (dollarAmount) dollarAmount.style.display = "none";
          if (noteAmount) noteAmount.style.display = "none";

          input.style.color = "#000";
          input.style.webkitTextFillColor = "";
          input.value = input.value.toUpperCase();
          input.inputMode = "text";
          input.placeholder = "COUPON-CODE";

          if (headingAmount) headingAmount.textContent = "i have a coupon";
          if (noteToInput) noteToInput.textContent = "to redeem to my account.";
          if (payNowButtonTxt) payNowButtonTxt.textContent = "Redeem Coupon";
        } else {
          overlayEnabled = true;
          if (overlay) overlay.style.display = "";
          if (dollarAmount) dollarAmount.style.display = "";
          if (noteAmount) noteAmount.style.display = "";

          input.style.color = "transparent";
          input.style.webkitTextFillColor = "transparent";
          input.inputMode = "decimal";
          renderFormatted(input.value);

          if (headingAmount) headingAmount.textContent = "let's add";
          if (noteToInput) noteToInput.textContent = "credits to my account.";
          if (payNowButtonTxt) payNowButtonTxt.textContent = "Pay Now";
        }

        updatePayNowButtonState();
      });
    });
  }

  /* ===========================
     PART 3: Action (Make Payment / Redeem Coupon)
     =========================== */
  if (payNowBtn) {
    updatePayNowButtonState();

    payNowBtn.addEventListener("click", async () => {
      if (payNowBtn.disabled) return;

      clearInlineError();

      const token = getCookie("authToken");
      if (!token) {
        openStatusModal({ status: "unauthorized", message: "Please sign in to continue.", mode: "payment" });
        return;
      }

      const base = window.API_URLS?.PAYMENT;
      if (!base) {
        openStatusModal({ status: "error", message: "Payment service is not configured.", mode: "payment" });
        return;
      }

      // COUPON MODE
      if (!overlayEnabled) {
        const code = (input.value || "").trim().toUpperCase();
        if (!code) {
          openStatusModal({ status: "error", message: "Please enter a valid coupon code.", mode: "coupon" });
          return;
        }

        enterLoadingState();
        try {
          await sleep(randomDelayMs()); // delay BEFORE sending request
          const { ok, status, data } = await postJSON(`${base}redeem-coupon/`, { code }, token);

          if (ok) {
            openStatusModal({
              status: data?.status || "success",
              message: data?.message || "Coupon processed.",
              code,
              credits_added: data?.credits_added || "",
              mode: "coupon",
            });
            return;
          }

          const msg =
            data?.message ||
            (status === 400 && "Invalid coupon payload.") ||
            (status === 401 && "You are not authorized.") ||
            (status === 403 && "This coupon cannot be redeemed right now.") ||
            (status === 404 && "Coupon not found or inactive.") ||
            "Something went wrong while redeeming the coupon.";
          openStatusModal({ status: "error", message: msg, code, mode: "coupon" });
        } finally {
          exitLoadingState();
        }
        return;
      }

      // AMOUNT MODE
      const raw = (input.value || "").trim();
      if (!raw || !/^\d+(\.\d{0,2})?$/.test(raw)) {
        openStatusModal({ status: "error", message: "Enter a valid amount (max 2 decimals).", mode: "payment" });
        return;
      }

      if (Number(raw) === 0) {
        showInlineError("Amount must be greater than $0");
        return;
      }

      const [intPartStr] = raw.split(".");
      if (Number(intPartStr) > MAX_INT_PART) {
        openStatusModal({
          status: "error",
          message: `Integer part cannot exceed ${MAX_INT_PART.toLocaleString()}.`,
          mode: "payment",
        });
        return;
      }

      const amount = Number(raw);
      if (!Number.isFinite(amount) || amount <= 0) {
        openStatusModal({ status: "error", message: "Enter a valid amount greater than 0.", mode: "payment" });
        return;
      }

      if (amount < 5) {
        showInlineError("Amount must be greater than $5");
        return;
      }

      enterLoadingState();
      try {
        await sleep(randomDelayMs()); // delay BEFORE sending request

        const method = getActivePaymentMethod(options);
        const { ok, data, status } = await postJSON(
          `${base}initiate/`,
          { amount: Number(amount.toFixed(2)), payment_method: method },
          token
        );

        if (ok) {
          openStatusModal({
            status: data?.status || "success",
            message: data?.message || "Thanks! We’ve logged your payment intent.",
            amount: amount.toFixed(2),
            payment_method: method,
            mode: "payment",
          });
          return;
        }

        const msg =
          data?.message ||
          (status === 401 && "You are not authorized.") ||
          "We couldn't initiate the payment. Please try again.";
        openStatusModal({
          status: "error",
          message: msg,
          amount: amount.toFixed(2),
          payment_method: method,
          mode: "payment",
        });
      } finally {
        exitLoadingState();
      }
    });
  }
});
