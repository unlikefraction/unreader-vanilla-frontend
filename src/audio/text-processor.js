// -------text-processor.js (preserving full HTML + per-word spans)-------

export class TextProcessor {
  constructor(textFile, timingFile, offsetMs = 0, pageKey = null) {
    this.textFile = textFile;
    this.timingFile = timingFile;
    this.offsetMs = offsetMs;
    this.wordTimings = null;
    this.wordSpans = [];
    this.referenceWords = 10;

    const key = pageKey ?? `${textFile}|${timingFile}|${offsetMs}`;
    this.pageId = this.#slugify(key);

    this.container = null;
  }

  #slugify(s) {
    return String(s)
      .toLowerCase()
      .replace(/^[a-z]+:\/\/+/i, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "");
  }

  #ensureMainContent() {
    let containerDiv = document.querySelector(".mainContainer");
    if (!containerDiv) {
      containerDiv = document.createElement("div");
      containerDiv.className = "mainContainer";
      document.body.appendChild(containerDiv);
      printl?.(`🔧 Created <div.mainContainer>`);
    }

    // accept any tag; upgrade legacy <p> to <div>
    let el = containerDiv.querySelector(`[data-page-id="${this.pageId}"]`);
    if (!el) {
      el = document.createElement("div");
      el.className = "mainContent";
      el.dataset.pageId = this.pageId;
      el.id = `mainContent-${this.pageId}`;
      el.style.position = el.style.position || "relative";
      containerDiv.appendChild(el);
      printl?.(`🔧 Created <div.mainContent> for pageId=${this.pageId} inside mainContainer`);
    } else if (el.tagName.toLowerCase() === "p") {
      const replacement = document.createElement("div");
      for (const { name, value } of [...el.attributes]) replacement.setAttribute(name, value);
      replacement.classList.add("mainContent");
      el.replaceWith(replacement);
      el = replacement;
      printl?.("♻️ Replaced legacy <p.mainContent> with <div.mainContent> for valid HTML.");
    }

    this.container = el;
  }

  async separateTextPreservingMarkup() {
    this.#ensureMainContent();

    const response = await fetch(this.textFile);
    const rawHtml = await response.text();

    const htmlContent = (window.DOMPurify ? DOMPurify.sanitize(rawHtml, { RETURN_TRUSTED_TYPE: false }) : rawHtml);

    const tempRoot = document.createElement("div");
    tempRoot.innerHTML = htmlContent;

    this.container.innerHTML = "";
    this.wordSpans = [];

    // strip dangerous/irrelevant nodes
    ["script","style","noscript","template"].forEach(sel => tempRoot.querySelectorAll(sel).forEach(n => n.remove()));

    // ignore all styling coming from backend transcript
    // remove inline styles, classes, and common presentational attributes
    const PRESENTATIONAL_ATTRS = [
      "style", "class", "bgcolor", "color", "background", "align",
      "border", "cellpadding", "cellspacing", "width", "height",
      "hspace", "vspace", "face", "size"
    ];
    tempRoot.querySelectorAll('*').forEach((el) => {
      PRESENTATIONAL_ATTRS.forEach(attr => el.removeAttribute(attr));
    });

    // walk text nodes and wrap words
    const BLOCKED = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
    const walker = document.createTreeWalker(
      tempRoot,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentNode;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (BLOCKED.has(parent.nodeName)) return NodeFilter.FILTER_REJECT;
          if (!/\S/.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const WORD_RE = /[\p{L}\p{N}’']+/u;
    const TOKENIZE_RE = /[\p{L}\p{N}’']+|[^\p{L}\p{N}’']+/gu;

    let globalIndex = 0;
    const nodesToProcess = [];
    while (walker.nextNode()) nodesToProcess.push(walker.currentNode);

    nodesToProcess.forEach((textNode) => {
      const parts = textNode.nodeValue.match(TOKENIZE_RE);
      if (!parts) return;

      const frag = document.createDocumentFragment();

      parts.forEach((part) => {
        if (WORD_RE.test(part)) {
          const span = document.createElement("span");
          span.className = "word";
          span.textContent = part;

          const normalized = part.toLocaleLowerCase().normalize("NFKC")
            .replace(/[^\p{L}\p{N}’']+/gu, "");
          span.dataset.originalWord = normalized;
          span.dataset.index = String(globalIndex++);

          this.wordSpans.push(span);
          frag.appendChild(span);
        } else {
          frag.appendChild(document.createTextNode(part));
        }
      });

      textNode.parentNode.replaceChild(frag, textNode);
    });

    while (tempRoot.firstChild) this.container.appendChild(tempRoot.firstChild);

    printl?.(`📝 Total words wrapped: ${this.wordSpans.length}`);
    printl?.(`✅ Preserved full HTML structure (links, images, headings, lists).`);
    printl?.(`⏱️ Offset applied: ${this.offsetMs}ms (affects timings, not DOM).`);
  }

  // Back-compat alias (old callers still invoke separateText)
  async separateText() {
    return this.separateTextPreservingMarkup();
  }

  // Optional ingest APIs used by MultiPageReader fallbacks
  setWordTimings(words) { this.wordTimings = Array.isArray(words) ? words : []; }
  async ingestWordTimings(words) { this.setWordTimings(words); }
  async ingestWordTimingsFromBackend(words) { this.setWordTimings(words); }

  async loadWordTimings() {
    const response = await fetch(this.timingFile);
    this.wordTimings = await response.json();
    printl?.(`🎵 Loaded ${this.wordTimings.length} word timings`);

    const offsetSeconds = this.offsetMs / 1000;
    this.wordTimings = this.wordTimings.map((timing) => ({
      ...timing,
      time_start: Math.max(0, timing.time_start + offsetSeconds),
      time_end: Math.max(0, timing.time_end + offsetSeconds),
    }));

    if (this.offsetMs !== 0) {
      printl?.(`🔧 Applied ${this.offsetMs}ms offset to all timings`);
    }
  }

  getAudioContext(timingIndex, contextSize = 10) {
    const context = [];
    const startIndex = Math.max(0, timingIndex - contextSize);
    const endIndex = Math.min(this.wordTimings.length - 1, timingIndex + contextSize);
    for (let i = startIndex; i <= endIndex; i++) {
      if (i !== timingIndex && this.wordTimings[i]) {
        context.push(this.wordTimings[i].word.toLowerCase().replace(/[^\p{L}\p{N}’']+/gu, ""));
      }
    }
    return context;
  }

  getTextContext(spanIndex, contextSize = this.referenceWords) {
    const context = [];
    const startIndex = Math.max(0, spanIndex - contextSize);
    const endIndex = Math.min(this.wordSpans.length - 1, spanIndex + contextSize);
    for (let i = startIndex; i <= endIndex; i++) {
      if (i !== spanIndex && this.wordSpans[i]?.dataset.originalWord) {
        context.push(this.wordSpans[i].dataset.originalWord);
      }
    }
    return context;
  }

  calculateContextSimilarity(audioContext, textContext) {
    if (audioContext.length === 0 && textContext.length === 0) return 1.0;
    if (audioContext.length === 0 || textContext.length === 0) return 0.0;

    let matchCount = 0;
    const totalWords = Math.max(audioContext.length, textContext.length);

    audioContext.forEach((audioWord) => {
      if (textContext.includes(audioWord)) matchCount++;
    });

    const positionalMatches = Math.min(audioContext.length, textContext.length);
    let positionalMatchCount = 0;
    for (let i = 0; i < positionalMatches; i++) {
      if (audioContext[i] === textContext[i]) positionalMatchCount++;
    }

    const generalScore = matchCount / totalWords;
    const positionalScore = positionalMatchCount / positionalMatches;
    return generalScore * 0.6 + positionalScore * 0.4;
  }

  findBestWordMatch(targetWord, timingIndex, searchCenter = null, lastHighlightedIndex = 0) {
    const cleanTarget = targetWord.toLocaleLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}’']+/gu, "");

    const centerIndex = searchCenter ?? lastHighlightedIndex;
    const searchStart = Math.max(0, centerIndex - this.referenceWords);
    const searchEnd = Math.min(this.wordSpans.length, centerIndex + this.referenceWords + 1);

    const audioContext = this.getAudioContext(timingIndex);

    let bestMatch = { index: -1, probability: 0, wordScore: 0, contextScore: 0 };

    for (let i = searchStart; i < searchEnd; i++) {
      const span = this.wordSpans[i];
      if (span?.dataset.originalWord) {
        const wordScore = cleanTarget === span.dataset.originalWord ? 1.0 : 0.0;
        const textContext = this.getTextContext(i);
        const contextScore = this.calculateContextSimilarity(audioContext, textContext);
        const totalProbability = wordScore * 0.4 + contextScore * 0.6;

        if (totalProbability > bestMatch.probability) {
          bestMatch = { index: i, probability: totalProbability, wordScore, contextScore };
        }
      }
    }

    const threshold = bestMatch.wordScore === 1.0 ? 0.2 : 0.3;
    return bestMatch.probability > threshold ? bestMatch : { index: -1, probability: 0 };
  }

  async init() {
    await this.separateTextPreservingMarkup();
    await this.loadWordTimings();
  }
}
