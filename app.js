const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const state = {
  mode: "manual",
  file: null,
  imageNatural: { w: 0, h: 0 },
  selection: null,
  dragging: false,
  start: null,
  interaction: null,
  interactionStart: null,
  selectionStart: null,
  cropDataUrl: "",
  installPrompt: null,
  db: null
};

const el = {
  manualModeBtn: $("#manualModeBtn"),
  autoModeBtn: $("#autoModeBtn"),
  emptyState: $("#emptyState"),
  editorState: $("#editorState"),
  cameraInput: $("#cameraInput"),
  galleryInput: $("#galleryInput"),
  changePhotoBtn: $("#changePhotoBtn"),
  bookImage: $("#bookImage"),
  imageStage: $("#imageStage"),
  selectionBox: $("#selectionBox"),
  resetSelectionBtn: $("#resetSelectionBtn"),
  extractBtn: $("#extractBtn"),
  selectionStatus: $("#selectionStatus"),
  editorModeTitle: $("#editorModeTitle"),
  editorHint: $("#editorHint"),
  autoBadge: $("#autoBadge"),
  ocrPanel: $("#ocrPanel"),
  ocrLoading: $("#ocrLoading"),
  ocrProgressText: $("#ocrProgressText"),
  quoteText: $("#quoteText"),
  bookTitle: $("#bookTitle"),
  pageNumber: $("#pageNumber"),
  authorName: $("#authorName"),
  memoText: $("#memoText"),
  tagsText: $("#tagsText"),
  samePhotoBtn: $("#samePhotoBtn"),
  saveQuoteBtn: $("#saveQuoteBtn"),
  saveStatus: $("#saveStatus"),
  cropCanvas: $("#cropCanvas"),
  libraryList: $("#libraryList"),
  libraryEmpty: $("#libraryEmpty"),
  quoteCount: $("#quoteCount"),
  searchInput: $("#searchInput"),
  goCaptureBtn: $("#goCaptureBtn"),
  installBtn: $("#installBtn"),
  toast: $("#toast")
};

function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.toast.classList.remove("show"), 1800);
}

function setMode(mode) {
  state.mode = mode;
  el.manualModeBtn.classList.toggle("active", mode === "manual");
  el.autoModeBtn.classList.toggle("active", mode === "auto");
  if (mode === "manual") {
    el.editorModeTitle.textContent = "손가락으로 문장을 감싸주세요";
    el.editorHint.textContent = "문장을 드래그해 선택한 뒤, 박스를 끌어 이동하거나 모서리 점으로 크기를 조절할 수 있어요.";
  } else {
    el.editorModeTitle.textContent = "밑줄 후보를 자동으로 찾아볼게요";
    el.editorHint.textContent = "사진 속 긴 가로선을 찾아 문장 영역을 자동 선택합니다. 실험 기능이라 수동 조정이 필요할 수 있어요.";
    if (state.file) detectUnderlineCandidate();
  }
}

el.manualModeBtn.addEventListener("click", () => setMode("manual"));
el.autoModeBtn.addEventListener("click", () => setMode("auto"));

function openFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    toast("이미지 파일을 선택해 주세요.");
    return;
  }
  state.file = file;
  const url = URL.createObjectURL(file);
  el.bookImage.onload = () => {
    state.imageNatural = { w: el.bookImage.naturalWidth, h: el.bookImage.naturalHeight };
    URL.revokeObjectURL(url);
    el.emptyState.classList.add("hidden");
    el.editorState.classList.remove("hidden");
    resetSelection();
    requestAnimationFrame(() => {
      if (state.mode === "auto") detectUnderlineCandidate();
    });
  };
  el.bookImage.src = url;
}
[el.cameraInput, el.galleryInput].forEach(input => {
  input.addEventListener("change", (e) => {
    openFile(e.target.files?.[0]);
    input.value = "";
  });
});
el.changePhotoBtn.addEventListener("click", () => el.galleryInput.click());

function getStagePoint(evt) {
  const rect = el.imageStage.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(rect.width, evt.clientX - rect.left)),
    y: Math.max(0, Math.min(rect.height, evt.clientY - rect.top))
  };
}

function drawSelection(sel) {
  if (!sel || sel.w < 4 || sel.h < 4) {
    el.selectionBox.classList.add("hidden");
    el.extractBtn.disabled = true;
    return;
  }
  el.selectionBox.style.left = sel.x + "px";
  el.selectionBox.style.top = sel.y + "px";
  el.selectionBox.style.width = sel.w + "px";
  el.selectionBox.style.height = sel.h + "px";
  el.selectionBox.classList.remove("hidden");
  el.extractBtn.disabled = false;
  el.selectionStatus.textContent = `선택 영역 ${Math.round(sel.w)} × ${Math.round(sel.h)}px · 추출 버튼을 눌러주세요.`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pointInImage(point) {
  const b = imageRectWithinStage();
  return {
    x: clamp(point.x, b.x, b.x + b.w),
    y: clamp(point.y, b.y, b.y + b.h)
  };
}

function handleName(target) {
  if (!target?.classList?.contains("handle")) return null;
  if (target.classList.contains("h1")) return "nw";
  if (target.classList.contains("h2")) return "ne";
  if (target.classList.contains("h3")) return "se";
  if (target.classList.contains("h4")) return "sw";
  return null;
}

function resizedSelection(handle, p) {
  const b = imageRectWithinStage();
  const s = state.selectionStart;
  const minSize = 28;
  let left = s.x;
  let top = s.y;
  let right = s.x + s.w;
  let bottom = s.y + s.h;

  if (handle.includes("w")) left = clamp(p.x, b.x, right - minSize);
  if (handle.includes("e")) right = clamp(p.x, left + minSize, b.x + b.w);
  if (handle.includes("n")) top = clamp(p.y, b.y, bottom - minSize);
  if (handle.includes("s")) bottom = clamp(p.y, top + minSize, b.y + b.h);

  return { x: left, y: top, w: right - left, h: bottom - top };
}

el.imageStage.addEventListener("pointerdown", (evt) => {
  if (!state.file) return;
  evt.preventDefault();

  state.dragging = true;
  state.interactionStart = getStagePoint(evt);
  state.selectionStart = state.selection ? { ...state.selection } : null;

  const handle = handleName(evt.target);
  if (handle && state.selection) {
    state.interaction = `resize-${handle}`;
  } else if (state.selection && evt.target.closest?.("#selectionBox")) {
    state.interaction = "move";
  } else {
    state.interaction = "create";
    state.start = pointInImage(state.interactionStart);
    state.selection = { x: state.start.x, y: state.start.y, w: 0, h: 0 };
  }

  el.imageStage.setPointerCapture(evt.pointerId);
  drawSelection(state.selection);
});

el.imageStage.addEventListener("pointermove", (evt) => {
  if (!state.dragging) return;
  evt.preventDefault();
  const raw = getStagePoint(evt);
  const p = pointInImage(raw);
  const b = imageRectWithinStage();

  if (state.interaction === "create") {
    const x = Math.min(state.start.x, p.x);
    const y = Math.min(state.start.y, p.y);
    const w = Math.abs(p.x - state.start.x);
    const h = Math.abs(p.y - state.start.y);
    state.selection = { x, y, w, h };
  } else if (state.interaction === "move" && state.selectionStart) {
    const dx = raw.x - state.interactionStart.x;
    const dy = raw.y - state.interactionStart.y;
    state.selection = {
      ...state.selectionStart,
      x: clamp(state.selectionStart.x + dx, b.x, b.x + b.w - state.selectionStart.w),
      y: clamp(state.selectionStart.y + dy, b.y, b.y + b.h - state.selectionStart.h)
    };
  } else if (state.interaction?.startsWith("resize-") && state.selectionStart) {
    state.selection = resizedSelection(state.interaction.replace("resize-", ""), p);
  }

  drawSelection(state.selection);
});

function finishDrag(evt) {
  if (!state.dragging) return;
  state.dragging = false;
  state.interaction = null;
  state.interactionStart = null;
  state.selectionStart = null;
  try { el.imageStage.releasePointerCapture(evt.pointerId); } catch {}
  if (state.selection?.w >= 4 && state.selection?.h >= 4) {
    el.selectionStatus.textContent = "선택 완료 · 박스를 끌어 이동하거나 모서리 점을 드래그해 크기를 조절할 수 있어요.";
  }
}
el.imageStage.addEventListener("pointerup", finishDrag);
el.imageStage.addEventListener("pointercancel", finishDrag);

function resetSelection() {
  state.selection = null;
  el.selectionBox.classList.add("hidden");
  el.extractBtn.disabled = true;
  el.selectionStatus.textContent = "먼저 문장 영역을 선택해 주세요.";
}
el.resetSelectionBtn.addEventListener("click", () => {
  resetSelection();
  if (state.mode === "auto") detectUnderlineCandidate();
});

function imageRectWithinStage() {
  const stageRect = el.imageStage.getBoundingClientRect();
  const imgRect = el.bookImage.getBoundingClientRect();
  return {
    x: imgRect.left - stageRect.left,
    y: imgRect.top - stageRect.top,
    w: imgRect.width,
    h: imgRect.height
  };
}

function selectionToNatural(sel) {
  const imgRect = imageRectWithinStage();
  const ix = Math.max(imgRect.x, sel.x);
  const iy = Math.max(imgRect.y, sel.y);
  const ix2 = Math.min(imgRect.x + imgRect.w, sel.x + sel.w);
  const iy2 = Math.min(imgRect.y + imgRect.h, sel.y + sel.h);
  const w = Math.max(1, ix2 - ix);
  const h = Math.max(1, iy2 - iy);

  const sx = (ix - imgRect.x) / imgRect.w * state.imageNatural.w;
  const sy = (iy - imgRect.y) / imgRect.h * state.imageNatural.h;
  const sw = w / imgRect.w * state.imageNatural.w;
  const sh = h / imgRect.h * state.imageNatural.h;
  return { sx, sy, sw, sh };
}

async function makeCropDataUrl() {
  if (!state.selection) throw new Error("선택 영역이 없습니다.");
  const { sx, sy, sw, sh } = selectionToNatural(state.selection);
  const maxW = 1800;
  const scale = Math.min(1, maxW / sw);
  const canvas = el.cropCanvas;
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(el.bookImage, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  // OCR 대비 향상을 위한 가벼운 그레이스케일/대비 보정
  try {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
      const v = Math.max(0, Math.min(255, (g - 128) * 1.25 + 128));
      d[i] = d[i+1] = d[i+2] = v;
    }
    ctx.putImageData(imageData, 0, 0);
  } catch {}
  return canvas.toDataURL("image/jpeg", 0.9);
}

async function extractText() {
  if (!state.selection) return;
  el.ocrPanel.classList.remove("hidden");
  el.ocrLoading.classList.remove("hidden");
  el.extractBtn.disabled = true;
  el.ocrProgressText.textContent = "0%";
  el.quoteText.value = "";
  el.ocrPanel.scrollIntoView({ behavior: "smooth", block: "start" });

  try {
    state.cropDataUrl = await makeCropDataUrl();
    if (!window.Tesseract) throw new Error("OCR 엔진을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.");

    const result = await Tesseract.recognize(state.cropDataUrl, "kor+eng", {
      logger: (m) => {
        if (m.status === "recognizing text" && typeof m.progress === "number") {
          el.ocrProgressText.textContent = Math.round(m.progress * 100) + "%";
        } else if (m.status) {
          const labels = {
            "loading tesseract core": "OCR 준비",
            "initializing tesseract": "OCR 초기화",
            "loading language traineddata": "한글 데이터 준비",
            "initializing api": "인식 준비"
          };
          el.ocrProgressText.textContent = labels[m.status] || "";
        }
      }
    });

    const clean = (result?.data?.text || "")
      .replace(/\s*\n\s*/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();

    el.quoteText.value = clean;
    el.ocrProgressText.textContent = clean ? "완료" : "인식 결과 없음";
    if (!clean) toast("글자를 잘 찾지 못했어요. 영역을 조금 넓혀 다시 시도해보세요.");
  } catch (err) {
    console.error(err);
    el.ocrProgressText.textContent = "오류";
    toast(err.message || "OCR 중 오류가 발생했습니다.");
  } finally {
    el.ocrLoading.classList.add("hidden");
    el.extractBtn.disabled = false;
  }
}
el.extractBtn.addEventListener("click", extractText);

async function detectUnderlineCandidate() {
  if (!state.file || !el.bookImage.complete) return;
  el.autoBadge.classList.remove("hidden");
  el.autoBadge.textContent = "밑줄 후보 탐색 중…";
  await new Promise(r => setTimeout(r, 40));

  try {
    const imgRect = imageRectWithinStage();
    const sampleW = Math.min(900, state.imageNatural.w);
    const scale = sampleW / state.imageNatural.w;
    const sampleH = Math.max(1, Math.round(state.imageNatural.h * scale));
    const c = document.createElement("canvas");
    c.width = sampleW; c.height = sampleH;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(el.bookImage, 0, 0, sampleW, sampleH);
    const d = ctx.getImageData(0,0,sampleW,sampleH).data;

    const rowScores = new Array(sampleH).fill(0);
    const margin = Math.floor(sampleW * 0.08);

    for (let y = 0; y < sampleH; y++) {
      let run = 0, best = 0;
      for (let x = margin; x < sampleW - margin; x++) {
        const i = (y*sampleW + x)*4;
        const g = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
        if (g < 115) { run++; best = Math.max(best, run); }
        else run = 0;
      }
      rowScores[y] = best;
    }

    let bestY = -1, bestScore = 0;
    rowScores.forEach((s,y) => {
      if (s > bestScore) { bestScore = s; bestY = y; }
    });

    // 너무 긴 수평선만 후보로 간주 (페이지 폭의 24% 이상)
    if (bestY >= 0 && bestScore > sampleW * 0.24) {
      const displayY = imgRect.y + (bestY / sampleH) * imgRect.h;
      const bandH = Math.max(52, imgRect.h * 0.12);
      const sel = {
        x: imgRect.x + imgRect.w * 0.08,
        y: Math.max(imgRect.y, displayY - bandH),
        w: imgRect.w * 0.84,
        h: Math.min(bandH * 1.08, imgRect.y + imgRect.h - Math.max(imgRect.y, displayY - bandH))
      };
      state.selection = sel;
      drawSelection(sel);
      el.autoBadge.textContent = "밑줄 후보를 선택했어요";
      el.selectionStatus.textContent = "자동 선택 결과입니다. 필요하면 손가락으로 다시 선택하세요.";
      setTimeout(() => el.autoBadge.classList.add("hidden"), 1500);
    } else {
      resetSelection();
      el.autoBadge.textContent = "뚜렷한 밑줄을 못 찾았어요";
      el.selectionStatus.textContent = "자동 탐지에 실패했어요. 손가락으로 직접 영역을 선택해 주세요.";
      setTimeout(() => el.autoBadge.classList.add("hidden"), 1800);
    }
  } catch (e) {
    console.error(e);
    el.autoBadge.classList.add("hidden");
  }
}

el.samePhotoBtn.addEventListener("click", () => {
  el.quoteText.value = "";
  el.memoText.value = "";
  el.tagsText.value = "";
  el.ocrPanel.classList.add("hidden");
  resetSelection();
  el.editorState.scrollIntoView({ behavior: "smooth", block: "start" });
  if (state.mode === "auto") detectUnderlineCandidate();
});

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("sentence-collector-db", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("quotes")) {
        const store = db.createObjectStore("quotes", { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function dbPut(item) {
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction("quotes", "readwrite");
    tx.objectStore("quotes").put(item);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
function dbAll() {
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction("quotes", "readonly");
    const req = tx.objectStore("quotes").getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
function dbDelete(id) {
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction("quotes", "readwrite");
    tx.objectStore("quotes").delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

el.saveQuoteBtn.addEventListener("click", async () => {
  const quote = el.quoteText.value.trim();
  const book = el.bookTitle.value.trim();
  if (!quote) { toast("저장할 문장을 입력해 주세요."); return; }
  if (!book) { toast("책 제목을 입력해 주세요."); el.bookTitle.focus(); return; }

  const item = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    quote,
    book,
    page: el.pageNumber.value.trim(),
    author: el.authorName.value.trim(),
    memo: el.memoText.value.trim(),
    tags: el.tagsText.value.split(",").map(v => v.trim()).filter(Boolean).slice(0, 12),
    crop: state.cropDataUrl,
    createdAt: new Date().toISOString()
  };
  try {
    await dbPut(item);
    el.saveStatus.textContent = "저장했습니다.";
    toast("문장을 저장했어요.");
    await renderLibrary();
    el.quoteText.value = "";
    el.memoText.value = "";
    el.tagsText.value = "";
  } catch (e) {
    console.error(e);
    toast("저장 중 오류가 발생했습니다.");
  }
});

function escapeHTML(str="") {
  return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
async function renderLibrary(filter="") {
  const items = (await dbAll()).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  el.quoteCount.textContent = items.length;
  const q = filter.trim().toLowerCase();
  const filtered = q ? items.filter(i => {
    const hay = [i.book, i.author, i.quote, i.memo, ...(i.tags || [])].join(" ").toLowerCase();
    return hay.includes(q);
  }) : items;

  el.libraryList.innerHTML = filtered.map(item => `
    <article class="quote-card" data-id="${escapeHTML(item.id)}">
      <div class="book-line">
        <strong>${escapeHTML(item.book)}</strong>
        <span class="page">${item.page ? "p. " + escapeHTML(item.page) : ""}</span>
      </div>
      <blockquote>“${escapeHTML(item.quote)}”</blockquote>
      ${item.memo ? `<p class="memo">${escapeHTML(item.memo)}</p>` : ""}
      ${(item.tags || []).length ? `<div class="tags">${item.tags.map(t => `<span class="tag">#${escapeHTML(t)}</span>`).join("")}</div>` : ""}
      ${item.crop ? `<img class="thumb" src="${item.crop}" alt="저장한 문장 영역" />` : ""}
      <div class="card-actions">
        <button class="mini-btn copy-btn" type="button">복사</button>
        <button class="mini-btn danger delete-btn" type="button">삭제</button>
      </div>
    </article>
  `).join("");

  el.libraryEmpty.classList.toggle("hidden", filtered.length !== 0 || q !== "");
  if (!filtered.length && q) {
    el.libraryList.innerHTML = `<div class="empty-library"><div>🔎</div><h3>검색 결과가 없어요</h3><p>다른 검색어를 입력해보세요.</p></div>`;
  }

  $$(".copy-btn").forEach(btn => btn.addEventListener("click", async (e) => {
    const card = e.target.closest(".quote-card");
    const item = items.find(i => i.id === card.dataset.id);
    try {
      await navigator.clipboard.writeText(`${item.quote}\n— ${item.book}${item.page ? ` p.${item.page}` : ""}`);
      toast("문장을 복사했어요.");
    } catch { toast("복사를 지원하지 않는 브라우저예요."); }
  }));

  $$(".delete-btn").forEach(btn => btn.addEventListener("click", async (e) => {
    const card = e.target.closest(".quote-card");
    if (!confirm("이 문장을 삭제할까요?")) return;
    await dbDelete(card.dataset.id);
    toast("삭제했습니다.");
    renderLibrary(el.searchInput.value);
  }));
}

el.searchInput.addEventListener("input", () => renderLibrary(el.searchInput.value));

function showView(id) {
  $$(".view").forEach(v => v.classList.toggle("active", v.id === id));
  $$(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.view === id));
  if (id === "libraryView") renderLibrary(el.searchInput.value);
  window.scrollTo({ top: 0, behavior: "smooth" });
}
$$(".nav-btn").forEach(btn => btn.addEventListener("click", () => showView(btn.dataset.view)));
el.goCaptureBtn.addEventListener("click", () => showView("captureView"));

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  state.installPrompt = e;
  el.installBtn.classList.remove("hidden");
});
el.installBtn.addEventListener("click", async () => {
  if (!state.installPrompt) return;
  state.installPrompt.prompt();
  await state.installPrompt.userChoice;
  state.installPrompt = null;
  el.installBtn.classList.add("hidden");
});

async function init() {
  try {
    state.db = await openDB();
    await renderLibrary();
  } catch (e) {
    console.error(e);
    toast("기기 저장소를 열지 못했습니다.");
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(console.error);
  }
}
init();
