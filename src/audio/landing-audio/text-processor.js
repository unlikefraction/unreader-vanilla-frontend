// ------- text-processor.js (preserving full HTML + per-word spans) -------

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
    }

    let el = containerDiv.querySelector(`[data-page-id="${this.pageId}"]`);
    if (!el) {
      el = document.createElement("div");
      el.className = "mainContent";
      el.dataset.pageId = this.pageId;
      el.id = `mainContent-${this.pageId}`;
      el.style.position = el.style.position || "relative";
      containerDiv.appendChild(el);
    } else if (el.tagName.toLowerCase() === "p") {
      const replacement = document.createElement("div");
      for (const { name, value } of [...el.attributes]) replacement.setAttribute(name, value);
      replacement.classList.add("mainContent");
      el.replaceWith(replacement);
      el = replacement;
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

    ["script", "style", "noscript", "template"].forEach(sel =>
      tempRoot.querySelectorAll(sel).forEach(n => n.remove())
    );

    const BLOCKED = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
    const walker = document.createTreeWalker(tempRoot, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentNode;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (BLOCKED.has(parent.nodeName)) return NodeFilter.FILTER_REJECT;
        if (!/\S/.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let globalIndex = 0;
    const nodesToProcess = [];
    while (walker.nextNode()) nodesToProcess.push(walker.currentNode);

    nodesToProcess.forEach((textNode) => {
      const text = textNode.nodeValue;
      const parts = text.match(/[^ ]+| +/g);
      if (!parts) return;

      const frag = document.createDocumentFragment();

      parts.forEach((part) => {
        if (/^ +$/.test(part)) {
          frag.appendChild(document.createTextNode(part));
          return;
        }

        const span = document.createElement("span");
        span.className = "word";
        span.textContent = part;

        const normalized = part
          .toLocaleLowerCase()
          .normalize("NFKC")
          .replace(/[^\p{L}\p{N}’']+/gu, "");

        if (normalized.length > 0) {
          span.dataset.originalWord = normalized;
        } else {
          span.dataset.skip = "true"; // mark non-matchable
        }

        span.dataset.index = String(globalIndex++);
        this.wordSpans.push(span);
        frag.appendChild(span);
      });

      textNode.parentNode.replaceChild(frag, textNode);
    });

    while (tempRoot.firstChild) this.container.appendChild(tempRoot.firstChild);
  }

  async separateText() {
    return this.separateTextPreservingMarkup();
  }

  setWordTimings(words) { this.wordTimings = Array.isArray(words) ? words : []; }
  async ingestWordTimings(words) { this.setWordTimings(words); }
  async ingestWordTimingsFromBackend(words) { this.setWordTimings(words); }

  async loadWordTimings() {
    const response = await fetch(this.timingFile);
    this.wordTimings = await response.json();

    const offsetSeconds = this.offsetMs / 1000;
    this.wordTimings = this.wordTimings.map((timing) => ({
      ...timing,
      time_start: Math.max(0, timing.time_start + offsetSeconds),
      time_end: Math.max(0, timing.time_end + offsetSeconds),
    }));
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
      if (!span || span.dataset.skip === "true") continue;

      const wordScore = cleanTarget === span.dataset.originalWord ? 1.0 : 0.0;
      const textContext = this.getTextContext(i);
      const contextScore = this.calculateContextSimilarity(audioContext, textContext);
      const totalProbability = wordScore * 0.4 + contextScore * 0.6;

      if (totalProbability > bestMatch.probability) {
        bestMatch = { index: i, probability: totalProbability, wordScore, contextScore };
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
