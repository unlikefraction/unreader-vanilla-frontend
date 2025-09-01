/*******************************
 * Unreader — Add a Book (createBook.js)
 *******************************/

/* ================================
   HELPERS
===================================*/
// Use API_URLS from global (populated by src/apiUrls.js)
const API_URLS = (typeof window !== 'undefined' && window.API_URLS) ? window.API_URLS : {};
function getCookie(name) {
  // Escape special regex characters in the cookie name
  const escaped = name.replace(/([.*+?^${}()|[\]\\])/g, "\\$1");
  const match = document.cookie.match(new RegExp("(?:^|; )" + escaped + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : null;
}

function debounce(fn, delay) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

function setStep(n) {
  document.querySelectorAll(".stepDot").forEach(d => {
    const stepNum = Number(d.dataset.step);
    d.classList.toggle("active", stepNum === n);
    d.classList.toggle("stepCompleted", stepNum < n);
  });
  ["step1", "step2", "step3"].forEach((id, i) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = (i + 1 === n) ? "" : "none";
    el.classList.toggle("stepCompleted", (i + 1) < n);
  });
}

function showOverlay(msg = "Please wait...") {
  const o = document.getElementById("loadingOverlay");
  if (!o) return;
  o.style.display = "flex";
  const t = o.querySelector(".loadingText");
  if (t) t.textContent = msg;
}
function hideOverlay() {
  const o = document.getElementById("loadingOverlay");
  if (o) o.style.display = "none";
}

/* ================================
   CONSTANTS / STATE
===================================*/
const DEFAULT_THUMBNAIL =
  "https://books.google.com/books/content?id=ZnagEAAAQBAJ&printsec=frontcover&img=1&zoom=6&edge=curl";

let uploadedFileUrl   = "";
let uploadedFilename  = "";
let pickedDetails     = null;
let selectedOath      = "fire_oath";
let lastClickedItemEl = null;

/* NEW: Step 2 overrides */
let customCoverUrl = "";   // uploaded cover image URL (if any)
let titleOverride  = "";   // edited title (if any)

/* Track outside-click handler for inline title editing */
let titleDocHandler = null;

/* Auto-pick flow flags for Step 2 */
let autoPickArmed = false;       // set true when we land in Step 2 with derived metadata
let autoPickInProgress = false;  // true while we are default-selecting + checking backend
let pendingCheckCount = 0;       // number of in-flight backend existence checks

/* ================================
   STEP 1 — Upload
===================================*/
const dropZone     = document.getElementById("dropZone");
const fileInput    = document.getElementById("fileInput");
const uploadStatus = document.getElementById("uploadStatus");
const dzHint       = document.getElementById("dzHint");

["dragenter", "dragover"].forEach(evt => {
  dropZone.addEventListener(evt, e => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add("hover");
  });
});
["dragleave", "drop"].forEach(evt => {
  dropZone.addEventListener(evt, e => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove("hover");
  });
});
dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("drop", e => {
  e.preventDefault();
  const f = [...e.dataTransfer.files].find(f => /\.epub$/i.test(f.name));
  if (!f) return alert("Drop a .epub file");

  const maxSize = 30 * 1024 * 1024; // 30 MB
  if (f.size > maxSize) {
    return alert("File is too large! Maximum allowed size is 30 MB.");
  }

  handleUpload(f);
});

fileInput.addEventListener("change", () => {
  const f = fileInput.files[0];
  if (!f) return;

  if (!/\.epub$/i.test(f.name)) return alert("Please choose a .epub");

  const maxSize = 30 * 1024 * 1024; // 30 MB
  if (f.size > maxSize) {
    alert("File is too large! Maximum allowed size is 30 MB.");
    fileInput.value = ""; // clear the input
    return;
  }

  handleUpload(f);
});

/* ================================
   NEW — EPUB metadata fetch + search text derivation
===================================*/
async function fetchEpubMetadata(epubUrl, token) {
  try {
    showOverlay("Reading EPUB metadata…");
    const res = await fetch(`${API_URLS.BOOK}epub-metadata/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ epub_url: epubUrl })
    });
    const data = await res.json().catch(() => ({}));
    hideOverlay();

    if (!res.ok) {
      let msg = "Couldn't read EPUB metadata.";
      if (res.status === 400) msg = "EPUB URL invalid or private; using file name.";
      if (res.status === 401) msg = "Auth failed while reading metadata; using file name.";
      if (res.status === 413) msg = "EPUB is too large for metadata parse; using file name.";
      if (res.status === 502) msg = "Server couldn't fetch the EPUB; using file name.";
      console.warn("EPUB metadata error:", data || res.statusText);
      searchStatus.textContent = msg;
      return null;
    }

    return data; // { source_url, metadata: {...} }
  } catch (err) {
    hideOverlay();
    console.error("EPUB metadata network error:", err);
    searchStatus.textContent = "Network error while extracting metadata; using file name.";
    return null;
  }
}

function deriveSearchTextFromMetadata(meta, fallbackNameNoExt) {
  if (!meta || !meta.metadata) return fallbackNameNoExt;

  const m = meta.metadata;
  const title = (m.title || "").trim();
  const authors = Array.isArray(m.authors) ? m.authors.filter(Boolean).map(a => a.trim()).filter(Boolean) : [];

  if (title && authors.length) {
    return `${title} by ${authors.join(", ")}`;
  }
  if (title && !authors.length) {
    return title;
  }
  return fallbackNameNoExt;
}

async function handleUpload(file) {
  const token = getCookie("authToken");
  if (!token) {
    alert("You're not logged in. Please log in first.");
    return;
  }

  uploadedFilename = file.name.replace(/\.epub$/i, "");
  uploadStatus.innerHTML = `<span class="spinner"></span> Uploading ${file.name}…`;
  dzHint.textContent = file.name;

  try {
    const form = new FormData();
    form.append("book_file", file);

    showOverlay("Uploading EPUB…");
    const res = await fetch(`${API_URLS.BOOK}assets/upload/`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` },
      body: form
    });
    hideOverlay();

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      uploadStatus.textContent = `Upload failed (${res.status}).`;
      console.error("Upload error:", data);
      return;
    }

    uploadedFileUrl = data.files?.[file.name];
    uploadStatus.textContent = "✅ Uploaded.";

    // fetch EPUB metadata using the uploaded URL
    const meta = await fetchEpubMetadata(uploadedFileUrl, token);

    // derive what we put in Step 2’s search box
    const derivedText = deriveSearchTextFromMetadata(meta, uploadedFilename);
    uploadedFilename = derivedText;

    // proceed to Step 2
    initStep2();
    setStep(2);

    // Decide whether to auto-pick based on presence of metadata from backend
    const haveGoodMeta = !!(meta && meta.metadata && (
      (meta.metadata.title && String(meta.metadata.title).trim()) ||
      (Array.isArray(meta.metadata.authors) && meta.metadata.authors.length > 0)
    ));

    if (searchInput.value.trim() && haveGoodMeta) {
      autoPickArmed = true;
      toggleSearchArea(false); // keep hidden while we auto-select
      await doSearch(searchInput.value.trim());
    } else {
      // No metadata from backend — reveal search so user can select manually
      toggleSearchArea(true);
    }

  } catch (err) {
    hideOverlay();
    console.error(err);
    uploadStatus.textContent = "Unexpected error while uploading.";
  }
}

/* ================================
   STEP 2 — Choose book (+ edit cover/title)
===================================*/
const searchInput  = document.getElementById("searchInput");
const bookList     = document.getElementById("bookList");
const pickedBox    = document.getElementById("pickedBox");
const searchStatus = document.getElementById("searchStatus");

/* cover upload (image) — shared helpers */
const ACCEPTED_IMAGE_TYPES = [
  "image/png", "image/webp", "image/jpeg", "image/jpg"
];
const MAX_COVER_BYTES = 10 * 1024 * 1024; // 10MB

async function uploadCoverImage(file) {
  const token = getCookie("authToken");
  if (!token) {
    alert("You're not logged in. Please log in first.");
    return null;
  }
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    alert("Please select a PNG, WEBP, or JPEG image.");
    return null;
  }
  if (file.size > MAX_COVER_BYTES) {
    alert("Cover image too large. Max 10 MB.");
    return null;
  }

  try {
    showOverlay("Uploading cover image…");
    const form = new FormData();
    form.append("book_file", file);

    const res = await fetch(`${API_URLS.BOOK}assets/upload/`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` },
      body: form
    });
    const data = await res.json().catch(() => ({}));
    hideOverlay();

    if (!res.ok) {
      console.error("Cover upload error:", data);
      alert(`Cover upload failed (${res.status}).`);
      return null;
    }

    const url = data.files?.[file.name] || "";
    return url || null;
  } catch (err) {
    hideOverlay();
    console.error("Cover upload network error:", err);
    alert("Network error while uploading cover.");
    return null;
  }
}

function initStep2() {
  searchInput.value = uploadedFilename || "";
  bookList.innerHTML = "";
  pickedBox.className = "pickedBox bookSelected";
  pickedBox.innerHTML = `
    <div class="book-cover-main-div"> 
      <button id="editCoverBtn" class="editCoverBtn" title="Change cover"> 
        <i class="ph ph-pencil-simple skeleton-hide"></i>
      </button>
      <div class="book-cover editable-cover"> 
        <div class="book-inside"></div>
        <div class="book-image skeleton-ui">
          <img id="pickedCoverImg" src="${DEFAULT_THUMBNAIL}" alt="Cover loading"> 
          <div class="effect"></div>
          <div class="light"></div>
          <input type="file" id="coverFileInput" accept="image/png, image/webp, image/jpeg, image/jpg" style="display:none" />
        </div>
      </div>
    </div>

    <div class="pickedMeta"> 
      <div class="mataDeta skeleton-ui"> 
        <h4 class="titleRow"> 
          <input id="pickedTitleInput" class="editableTitle skeleton-ui" type="text" value="" placeholder="Enter title" readonly />
          <button id="editTitleBtn" class="editTitleBtn" title="Edit title" style="margin-left:8px"> 
            <i class="ph ph-pencil-simple skeleton-hide"></i>
          </button>
        </h4>
        <p class="skeleton-ui" style="height: 20px;"></p>
      </div>
      <div>
        <button id="confirmBookBtn" class="btn skeleton-ui" disabled>yes, continue   →</button>
        <button id="selectAnotherBtn" class="btn secondary skeleton-ui" style="margin-left: 8px;">no, show me options</button>
      </div>
    </div>
  `;
  // By default keep search hidden; if there is no search text, show it for manual entry
  toggleSearchArea(!searchInput.value.trim());

  // Reveal search if user clicks "select another"
  const selectAnotherBtn = document.getElementById("selectAnotherBtn");
  selectAnotherBtn?.addEventListener("click", () => {
    autoPickArmed = false;
    autoPickInProgress = false;
    toggleSearchArea(true);
    try { searchInput?.focus(); } catch {}
  });
}

searchInput.addEventListener("input", debounce(e => {
  const q = e.target.value.trim();
  // User is typing a new query — disable auto-pick behavior and ensure search is visible
  autoPickArmed = false;
  toggleSearchArea(true);
  if (!q) { bookList.innerHTML = ""; return; }
  doSearch(q);
}, 300));

async function doSearch(q) {
  try {
    searchStatus.textContent = "";
    bookList.innerHTML = `<div class="status"><span class="spinner"></span> Searching…</div>`;
    const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}`);
    if (!r.ok) throw new Error(`Books API ${r.status}`);
    const data = await r.json();
    await renderSearch(data.items || []);
  } catch (err) {
    console.error(err);
    bookList.innerHTML = "";
    searchStatus.textContent = "Problem searching Google Books.";
  }
}

function getYear(publishedDate = "") {
  const m = publishedDate.match(/\d{4}/);
  return m ? m[0] : "";
}

async function renderSearch(items) {
  bookList.innerHTML = "";
  if (!items.length) {
    bookList.innerHTML = `<div class="status">No results. Try refining your title.</div>`;
    // If nothing came back, make sure search is visible for trying again
    toggleSearchArea(true);
    return;
  }
  let firstEl = null;
  items.forEach(item => {
    const info    = item.volumeInfo || {};
    const img     = (info.imageLinks && (info.imageLinks.thumbnail || info.imageLinks.smallThumbnail)) || DEFAULT_THUMBNAIL;
    const title   = info.title || "Untitled";
    const authors = (info.authors || []).join(", ") || "Unknown author";
    const year    = getYear(info.publishedDate || "");

    const el = document.createElement("div");
    el.className = "bookItem";
    el.innerHTML = `
      <img src="${img}" alt="${title}"/>
      <div class="meta">
        <h3>${title}</h3>
        <p>${authors}${year ? ` • ${year}` : ""}</p>
      </div>
      <i class="ph ph-check-circle bookTick" aria-hidden="true"></i>
    `;
    el.addEventListener("click", () => selectBook(item, el));
    bookList.appendChild(el);
    if (!firstEl) firstEl = el;
  });

  // Auto-pick the first book if armed (initial flow with derived metadata)
  if (autoPickArmed && firstEl) {
    // ensure we only do this once for the initial load
    autoPickArmed = false;
    autoPickInProgress = true;
    const firstItem = items[0];
    // Render selection UI and await backend check (selectBook returns a promise)
    try { await selectBook(firstItem, firstEl); }
    finally {
      autoPickInProgress = false;
      // Hide the entire search section after both Google fetch and backend check complete
      toggleSearchArea(false);
    }
  }
}

function selectBook(book, el) {
  if (lastClickedItemEl) lastClickedItemEl.classList.remove("active");
  el.classList.add("active");
  lastClickedItemEl = el;

  // Reset overrides when selecting a new book
  customCoverUrl = "";
  titleOverride  = "";

  // Clean up prior outside-click handler, if any
  if (titleDocHandler) {
    document.removeEventListener("mousedown", titleDocHandler, true);
    titleDocHandler = null;
  }

  const info = book.volumeInfo || {};
  const year = getYear(info.publishedDate || "");
  pickedDetails = {
    imageUrl: (info.imageLinks && (info.imageLinks.thumbnail || info.imageLinks.smallThumbnail)) || DEFAULT_THUMBNAIL,
    title: info.title || "",
    authors: (info.authors || []).join("|"),
    google_books_id: book.id,
    subtitle: info.subtitle || "",
    publisher: info.publisher || "",
    published_date: info.publishedDate || "",
    language: info.language || "en"
  };

  pickedBox.className = "pickedBox bookSelected";
  pickedBox.innerHTML = `
    <div class="book-cover-main-div">
      <button id="editCoverBtn" class="editCoverBtn" title="Change cover">
        <i class="ph ph-pencil-simple"></i>
      </button>
      <div class="book-cover editable-cover">
        <div class="book-inside"></div>
        <div class="book-image">
          <img id="pickedCoverImg" src="${pickedDetails.imageUrl}" alt="Cover of ${pickedDetails.title}">
          <div class="effect"></div>
          <div class="light"></div>
          <input type="file" id="coverFileInput" accept="image/png, image/webp, image/jpeg, image/jpg" style="display:none" />
        </div>
      </div>
    </div>

    <div class="pickedMeta">
      <div class="mataDeta">
        <h4 class="titleRow">
          <input
            id="pickedTitleInput"
            class="editableTitle"
            type="text"
            value="${escapeHtmlAttr(pickedDetails.title)}"
            placeholder="Enter title"
            readonly
          />
          <button id="editTitleBtn" class="editTitleBtn" title="Edit title" style="margin-left:8px">
            <i class="ph ph-pencil-simple"></i>
          </button>
        </h4>
        <p>${pickedDetails.authors ? pickedDetails.authors.replace(/\|/g, ", ") : "Unknown author"}${year ? ` • ${year}` : ""}</p>
      </div>
      <div>
        <button id="confirmBookBtn" class="btn">yes, continue   →</button>
        <button id="selectAnotherBtn" class="btn secondary" style="margin-left: 8px;">no, show options</button>
      </div>
    </div>
  `;

  // Wire up cover edit
  const editCoverBtn = document.getElementById("editCoverBtn");
  const coverInput   = document.getElementById("coverFileInput");
  const coverImgEl   = document.getElementById("pickedCoverImg");

  editCoverBtn?.addEventListener("click", () => coverInput?.click());
  coverInput?.addEventListener("change", async () => {
    const f = coverInput.files?.[0];
    if (!f) return;
    const url = await uploadCoverImage(f);
    if (url) {
      customCoverUrl = url;
      coverImgEl.src = url;
      pickedDetails.imageUrl = url;
    }
    coverInput.value = "";
  });

  // Wire up inline title editing
  const titleInput = document.getElementById("pickedTitleInput");
  const titleBtn   = document.getElementById("editTitleBtn");
  let preEditTitle = pickedDetails.title;

  const enableTitleEdit = () => {
    if (!titleInput) return;
    preEditTitle = titleOverride || pickedDetails.title || "";
    titleInput.readOnly = false;
    titleInput.classList.add("isEditing");
    titleInput.focus();
    titleInput.setSelectionRange(0, titleInput.value.length);
  };

  const commitTitleEdit = () => {
    if (!titleInput) return;
    const newTitle = titleInput.value.trim();
    if (newTitle) {
      titleOverride = newTitle;
      pickedDetails.title = newTitle;
    } else {
      titleInput.value = preEditTitle;
    }
    titleInput.readOnly = true;
    titleInput.classList.remove("isEditing");
  };

  const revertTitleEdit = () => {
    if (!titleInput) return;
    titleInput.value = preEditTitle;
    titleInput.readOnly = true;
    titleInput.classList.remove("isEditing");
  };

  titleInput?.addEventListener("click", () => {
    if (titleInput.readOnly) enableTitleEdit();
  });
  titleBtn?.addEventListener("click", enableTitleEdit);

  titleInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitTitleEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      revertTitleEdit();
    }
  });

  // Outside click closes editing
  titleDocHandler = (e) => {
    if (!titleInput) return;
    if (titleInput.readOnly) return;
    const isInside = titleInput.contains(e.target) || titleBtn.contains(e.target);
    if (!isInside) {
      commitTitleEdit();
    }
  };
  document.addEventListener("mousedown", titleDocHandler, true);

  // === NEW: check if this book already exists on backend; if yes, use that title/cover ===
  // Apply skeleton while we check the backend for existing mapping
  applyPickedSkeleton(true);
  pendingCheckCount++;
  const p = checkAndApplyExistingBook(pickedDetails.google_books_id)
    .finally(() => {
      pendingCheckCount = Math.max(0, pendingCheckCount - 1);
      if (pendingCheckCount === 0) {
        applyPickedSkeleton(false);
      }
    });

  // Wire up the secondary action to reveal search
  const selectAnotherBtn = document.getElementById("selectAnotherBtn");
  selectAnotherBtn?.addEventListener("click", () => {
    autoPickArmed = false;
    autoPickInProgress = false;
    applyPickedSkeleton(false);
    toggleSearchArea(true);
    try { searchInput?.focus(); } catch {}
  });

  // Return the backend check promise so callers (auto-pick flow) can await
  return p;
}

/* Check if the selected Google Books ID already exists; if so, use its title & cover */
async function checkAndApplyExistingBook(googleBooksId) {
  try {
    const token = getCookie("authToken");
    const headers = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const url = `${API_URLS.BOOK}check/${encodeURIComponent(googleBooksId)}/`;
    const res = await fetch(url, { headers });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.warn("Book check failed:", res.status, data);
      return;
    }

    if (data && data.exists) {
      const newTitle = (data.title || "").trim() || pickedDetails.title;
      const newCover = (data.cover_image_url || "").trim() || pickedDetails.imageUrl;

      // Update model
      pickedDetails.title = newTitle;
      pickedDetails.imageUrl = newCover;

      // If user hasn't uploaded a custom cover, reflect backend cover
      if (!customCoverUrl && newCover) {
        const coverImgEl = document.getElementById("pickedCoverImg");
        if (coverImgEl) coverImgEl.src = newCover;
      }

      // Only update title input if not actively editing
      const titleInput = document.getElementById("pickedTitleInput");
      if (titleInput && titleInput.readOnly) {
        titleInput.value = newTitle;
      }
    }
  } catch (err) {
    console.error("Error checking existing book:", err);
  }
}

// Simple HTML attribute escaper to keep input value safe
function escapeHtmlAttr(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

document.addEventListener("click", e => {
  if (e.target && e.target.id === "confirmBookBtn") {
    if (!pickedDetails || !uploadedFileUrl) {
      alert("Pick a book and upload an EPUB first.");
      return;
    }
    // Clean outside-click handler for title before moving on
    if (titleDocHandler) {
      document.removeEventListener("mousedown", titleDocHandler, true);
      titleDocHandler = null;
    }
    initStep3();
    setStep(3);
  }
});

/* -----------------------------
   UI helpers: search visibility + skeletons
------------------------------*/
function toggleSearchArea(show) {
  const searchSection = document.getElementById("searchSection");
  if (searchSection) {
    searchSection.style.display = show ? "" : "none";
    return;
  }
  // Fallback if wrapper missing
  const label = document.getElementById("searchLabel") || searchInput?.previousElementSibling;
  if (label) label.style.display = show ? "" : "none";
  if (searchInput) searchInput.style.display = show ? "" : "none";
  if (bookList) bookList.style.display = show ? "" : "none";
  if (searchStatus) searchStatus.style.display = show ? "" : "none";
}

function applyPickedSkeleton(on) {
  const root = pickedBox;
  if (!root) return;
  const cover = root.querySelector('.book-image');
  const title = root.querySelector('#pickedTitleInput');
  const author = root.querySelector('.pickedMeta .mataDeta p');
  const metaBox = root.querySelector('.pickedMeta .mataDeta');
  const yesBtn = root.querySelector('#confirmBookBtn');
  const noBtn  = root.querySelector('#selectAnotherBtn');
  const pencils = root.querySelectorAll('.editCoverBtn i, .editTitleBtn i');

  const targets = [cover, metaBox, title, author, yesBtn, noBtn].filter(Boolean);
  targets.forEach(el => {
    if (on) el.classList.add('skeleton-ui'); else el.classList.remove('skeleton-ui');
    if (el.tagName === 'BUTTON') el.disabled = !!on;
  });
  pencils.forEach(i => {
    if (on) i.classList.add('skeleton-hide'); else i.classList.remove('skeleton-hide');
  });
}

/* ================================
   STEP 3 — Oath + Create
===================================*/
const oathTabs     = document.getElementById("oathTabs");
const oathBadge    = document.getElementById("oathBadge");
const oathCopy     = document.getElementById("oathCopy");
const oathImg      = document.getElementById("oathImg");
const takeOathBtn  = document.getElementById("takeOathBtn");
const createStatus = document.getElementById("createStatus");

/* price + gradient map per oath */
const OATHS = {
  whisper_oath: {
    label: "Whisper Oath",
    price: 1,
    gradient: "linear-gradient(90deg, #0C3C57 0%, #2B769C 49.5%, #689BAF 100%)"
  },
  fire_oath: {
    label: "Fire Oath",
    price: 4,
    gradient: "linear-gradient(90deg, #070302 0%, #9F0E01 49.5%, #FD9A2E 100%)"
  },
  blood_oath: {
    label: "Blood Oath",
    price: 10,
    gradient: "linear-gradient(90deg, #29160D 0%, #972219 49.5%, #91160F 100%)"
  }
};

function ordinal(n) {
  const s = ["th","st","nd","rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function formatBadgeDate(d = new Date()) {
  const day = ordinal(d.getDate());
  const month = d.toLocaleString(undefined, { month: "long" });
  const year = d.getFullYear();
  return `${day} ${month}, ${year}`;
}

function initStep3() {
  /* tabs */
  oathTabs.innerHTML = "";
  Object.entries(OATHS).forEach(([value, meta]) => {
    const b = document.createElement("button");
    b.className = "oathTab" + (value === selectedOath ? " active" : "");
    b.textContent = meta.label;
    b.addEventListener("click", () => {
      selectedOath = value;
      document.querySelectorAll(".oathTab").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      renderOathCopy();
    });
    oathTabs.appendChild(b);
  });

  renderOathCopy();
}

function renderOathCopy() {
  const { label, price, gradient } = OATHS[selectedOath];

  // date badge + full gradient
  oathBadge.textContent = formatBadgeDate(new Date());
  oathBadge.style.background = gradient;

  // oath image
  const oathKey = selectedOath.toLowerCase();
  if (["fire_oath", "whisper_oath", "blood_oath"].includes(oathKey)) {
    oathImg.src = `/assets/${oathKey.replace("_", "")}.webp`;
  }

  // username (capitalize first letter)
  let username = (localStorage.getItem("name") || "").trim();
  username = username ? username.charAt(0).toUpperCase() + username.slice(1) : "—";

  const title = pickedDetails?.title || "the selected book";

  // extract first two colors from the full gradient
  const firstTwo = gradient.match(/#[0-9A-Fa-f]{3,6}/g)?.slice(0, 2) || ["#000", "#000"];
  const twoColorGradient = `linear-gradient(90deg, ${firstTwo[0]} 0%, ${firstTwo[1]} 50%)`;

  const labelHTML = `<span style="
      background: ${twoColorGradient};
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      color: transparent;
    ">${label}</span>`;

  oathCopy.innerHTML = `I, <strong>${username}</strong>, hereby take the <strong>${labelHTML}</strong> to read “<u>${title}</u>”, and <strong>wager $${price}</strong>, which I shall receive if, and only if, I complete the book.`;
}

takeOathBtn.addEventListener("click", createBookOnBackend);

async function createBookOnBackend() {
  const token = getCookie("authToken");
  if (!token) {
    alert("Please log in to continue.");
    return;
  }

  takeOathBtn.disabled = true;
  takeOathBtn.innerHTML = `<span class="spinner"></span> Processing…`;
  createStatus.textContent = "";
  showOverlay("Creating your book…");

  const payload = {
    title: titleOverride || pickedDetails.title,
    authors: pickedDetails.authors,
    google_books_id: pickedDetails.google_books_id,
    book_file_url: uploadedFileUrl,
    oath: selectedOath,
    subtitle: pickedDetails.subtitle,
    cover_image_url: customCoverUrl || pickedDetails.imageUrl, // prefer uploaded/checked cover
    publisher: pickedDetails.publisher,
    published_date: pickedDetails.published_date,
    isbns: "",
    language: pickedDetails.language
  };

  try {
    const res = await fetch(`${API_URLS.BOOK}create/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    hideOverlay();

    if (!res.ok) {
      console.error("Create Book Error:", data);
      createStatus.textContent = data?.detail || "Error creating book.";
      takeOathBtn.disabled = false;
      takeOathBtn.textContent = "I take the oath, continue →";
      return;
    }

    createStatus.textContent = "✅ Done. Redirecting…";
    setTimeout(() => {
      window.location.href = `/bookDetails.html?id=${data.book_id}`;
    }, 600);

  } catch (err) {
    hideOverlay();
    console.error(err);
    createStatus.textContent = "Network error while creating the book.";
    takeOathBtn.disabled = false;
    takeOathBtn.textContent = "I take the oath, continue →";
  }
}
