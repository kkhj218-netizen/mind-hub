(() => {
  const highlightModeBtn = document.querySelector("#highlightModeBtn");
  const highlighterCanvas = document.querySelector("#highlighterCanvas");

  if (!highlightModeBtn || !highlighterCanvas || typeof state === "undefined" || typeof el === "undefined") return;

  const originalMakeCropDataUrl = makeCropDataUrl;
  const ctx = highlighterCanvas.getContext("2d");

  state.highlightStrokes = [];
  state.highlightBoxes = [];
  state.highlightCurrent = null;
  state.highlightDrawing = false;
  state.highlightPointerId = null;

  function markerWidth() {
    const b = imageRectWithinStage();
    return Math.max(22, Math.min(38, b.w * 0.075));
  }

  function resizeHighlighterCanvas() {
    const rect = el.imageStage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    highlighterCanvas.width = Math.max(1, Math.round(rect.width * dpr));
    highlighterCanvas.height = Math.max(1, Math.round(rect.height * dpr));
    highlighterCanvas.style.width = `${rect.width}px`;
    highlighterCanvas.style.height = `${rect.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redrawHighlights();
  }

  function drawStroke(points) {
    if (!points?.length) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(255, 224, 46, 0.46)";
    ctx.lineWidth = markerWidth();
    ctx.globalCompositeOperation = "source-over";
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    if (points.length === 1) ctx.lineTo(points[0].x + 0.01, points[0].y + 0.01);
    ctx.stroke();
    ctx.restore();
  }

  function redrawHighlights() {
    const rect = el.imageStage.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    state.highlightStrokes.forEach(drawStroke);
    if (state.highlightCurrent?.length) drawStroke(state.highlightCurrent);
  }

  function clearHighlights(clearSelection = true) {
    state.highlightStrokes = [];
    state.highlightBoxes = [];
    state.highlightCurrent = null;
    state.highlightDrawing = false;
    redrawHighlights();
    if (clearSelection) {
      state.selection = null;
      drawSelection(null);
    }
    if (state.mode === "highlight") updateHighlightStatus();
  }

  function getHighlightPoint(evt) {
    return pointInImage(getStagePoint(evt));
  }

  function strokeDistance(points) {
    if (!points || points.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }
    return total;
  }

  function boxForStroke(points) {
    const image = imageRectWithinStage();
    const width = markerWidth();
    const paddingX = width * 0.95;
    const paddingY = width * 0.86;
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const left = clamp(Math.min(...xs) - paddingX, image.x, image.x + image.w);
    const right = clamp(Math.max(...xs) + paddingX, image.x, image.x + image.w);
    const top = clamp(Math.min(...ys) - paddingY, image.y, image.y + image.h);
    const bottom = clamp(Math.max(...ys) + paddingY, image.y, image.y + image.h);
    return { x: left, y: top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) };
  }

  function unionBoxes(boxes) {
    if (!boxes.length) return null;
    const left = Math.min(...boxes.map(b => b.x));
    const top = Math.min(...boxes.map(b => b.y));
    const right = Math.max(...boxes.map(b => b.x + b.w));
    const bottom = Math.max(...boxes.map(b => b.y + b.h));
    return { x: left, y: top, w: right - left, h: bottom - top };
  }

  function syncHiddenSelection() {
    state.selection = unionBoxes(state.highlightBoxes);
    drawSelection(state.selection);
    updateHighlightStatus();
  }

  function updateHighlightStatus() {
    const count = state.highlightBoxes.length;
    if (!count) {
      el.selectionStatus.textContent = "문장 위를 형광펜처럼 한 줄씩 슥 그어주세요.";
      el.extractBtn.disabled = true;
      return;
    }
    el.selectionStatus.textContent = `형광펜 ${count}줄 선택됨 · 더 긋거나 바로 문장 추출을 눌러주세요.`;
    el.extractBtn.disabled = false;
  }

  function activateHighlightMode() {
    state.mode = "highlight";
    el.manualModeBtn.classList.remove("active");
    el.autoModeBtn.classList.remove("active");
    highlightModeBtn.classList.add("active");
    el.editorModeTitle.textContent = "형광펜처럼 문장 위를 그어주세요";
    el.editorHint.textContent = "가져올 문장을 한 줄씩 손가락으로 슥 그으세요. 글자보다 조금 넓게 그으면 인식이 더 정확해요.";
    el.imageStage.classList.add("highlight-mode");
    highlighterCanvas.classList.remove("hidden");
    resetSelection();
    clearHighlights(false);
    requestAnimationFrame(resizeHighlighterCanvas);
    updateHighlightStatus();
  }

  function leaveHighlightMode() {
    highlightModeBtn.classList.remove("active");
    el.imageStage.classList.remove("highlight-mode");
    highlighterCanvas.classList.add("hidden");
    clearHighlights(false);
    state.highlightBoxes = [];
    state.highlightStrokes = [];
  }

  highlightModeBtn.addEventListener("click", activateHighlightMode);

  el.manualModeBtn.addEventListener("click", () => {
    if (state.mode !== "highlight") leaveHighlightMode();
  });
  el.autoModeBtn.addEventListener("click", () => {
    if (state.mode !== "highlight") leaveHighlightMode();
  });

  el.imageStage.addEventListener("pointerdown", (evt) => {
    if (state.mode !== "highlight" || !state.file) return;
    evt.preventDefault();
    evt.stopImmediatePropagation();

    state.highlightDrawing = true;
    state.highlightPointerId = evt.pointerId;
    state.highlightCurrent = [getHighlightPoint(evt)];
    try { el.imageStage.setPointerCapture(evt.pointerId); } catch {}
    redrawHighlights();
  }, true);

  el.imageStage.addEventListener("pointermove", (evt) => {
    if (state.mode !== "highlight" || !state.highlightDrawing) return;
    evt.preventDefault();
    evt.stopImmediatePropagation();

    const p = getHighlightPoint(evt);
    const points = state.highlightCurrent || [];
    const last = points[points.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 1.5) points.push(p);
    state.highlightCurrent = points;
    redrawHighlights();
  }, true);

  function finishHighlight(evt) {
    if (state.mode !== "highlight" || !state.highlightDrawing) return;
    evt.preventDefault();
    evt.stopImmediatePropagation();

    const points = state.highlightCurrent || [];
    state.highlightDrawing = false;
    state.highlightPointerId = null;
    try { el.imageStage.releasePointerCapture(evt.pointerId); } catch {}

    if (strokeDistance(points) >= 8) {
      state.highlightStrokes.push(points);
      state.highlightBoxes.push(boxForStroke(points));
    }
    state.highlightCurrent = null;
    redrawHighlights();
    syncHiddenSelection();
  }

  el.imageStage.addEventListener("pointerup", finishHighlight, true);
  el.imageStage.addEventListener("pointercancel", finishHighlight, true);

  el.resetSelectionBtn.addEventListener("click", () => {
    if (state.mode === "highlight") {
      clearHighlights(false);
      state.selection = null;
      drawSelection(null);
      updateHighlightStatus();
    }
  });

  el.samePhotoBtn.addEventListener("click", () => {
    if (state.mode === "highlight") {
      clearHighlights(false);
      state.selection = null;
      drawSelection(null);
      requestAnimationFrame(resizeHighlighterCanvas);
    }
  });

  el.bookImage.addEventListener("load", () => {
    if (state.mode === "highlight") {
      clearHighlights(false);
      requestAnimationFrame(resizeHighlighterCanvas);
    }
  });

  function mergeLineBoxes(boxes) {
    const sorted = boxes.map(b => ({ ...b })).sort((a, b) => a.y - b.y || a.x - b.x);
    const merged = [];

    for (const box of sorted) {
      const last = merged[merged.length - 1];
      if (!last) {
        merged.push(box);
        continue;
      }
      const overlap = Math.min(last.y + last.h, box.y + box.h) - Math.max(last.y, box.y);
      const minH = Math.min(last.h, box.h);
      if (overlap > minH * 0.45) {
        const left = Math.min(last.x, box.x);
        const top = Math.min(last.y, box.y);
        const right = Math.max(last.x + last.w, box.x + box.w);
        const bottom = Math.max(last.y + last.h, box.y + box.h);
        last.x = left;
        last.y = top;
        last.w = right - left;
        last.h = bottom - top;
      } else {
        merged.push(box);
      }
    }
    return merged;
  }

  function expandNaturalBox(box) {
    const padX = Math.max(14, box.sw * 0.025);
    const padY = Math.max(10, box.sh * 0.14);
    const sx = clamp(box.sx - padX, 0, state.imageNatural.w);
    const sy = clamp(box.sy - padY, 0, state.imageNatural.h);
    const right = clamp(box.sx + box.sw + padX, 0, state.imageNatural.w);
    const bottom = clamp(box.sy + box.sh + padY, 0, state.imageNatural.h);
    return { sx, sy, sw: Math.max(1, right - sx), sh: Math.max(1, bottom - sy) };
  }

  function preprocessForOCR(canvas) {
    try {
      const c = canvas.getContext("2d", { willReadFrequently: true });
      const imageData = c.getImageData(0, 0, canvas.width, canvas.height);
      const d = imageData.data;
      for (let i = 0; i < d.length; i += 4) {
        const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const v = Math.max(0, Math.min(255, (g - 128) * 1.16 + 128));
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      c.putImageData(imageData, 0, 0);
    } catch {}
  }

  async function makeHighlightCropDataUrl() {
    if (!state.highlightBoxes.length) throw new Error("형광펜으로 문장을 먼저 선택해 주세요.");

    const lineBoxes = mergeLineBoxes(state.highlightBoxes);
    const natural = lineBoxes.map(selectionToNatural).map(expandNaturalBox).sort((a, b) => a.sy - b.sy);
    const maxNaturalWidth = Math.max(...natural.map(b => b.sw));

    // 작은 글자는 확대하고, 매우 큰 이미지만 적당히 축소합니다.
    const scale = Math.min(2.2, 2200 / maxNaturalWidth);
    const safeScale = Math.max(0.7, scale);
    const sidePad = Math.round(32 * safeScale);
    const gap = Math.round(30 * safeScale);
    const outWidth = Math.max(1, Math.round(maxNaturalWidth * safeScale) + sidePad * 2);
    const heights = natural.map(b => Math.max(1, Math.round(b.sh * safeScale)));
    const outHeight = Math.max(1, heights.reduce((a, b) => a + b, 0) + gap * Math.max(0, natural.length - 1) + sidePad * 2);

    const canvas = el.cropCanvas;
    canvas.width = outWidth;
    canvas.height = outHeight;
    const out = canvas.getContext("2d", { willReadFrequently: true });
    out.imageSmoothingEnabled = true;
    if ("imageSmoothingQuality" in out) out.imageSmoothingQuality = "high";
    out.fillStyle = "#ffffff";
    out.fillRect(0, 0, outWidth, outHeight);

    let y = sidePad;
    natural.forEach((b, index) => {
      const dw = Math.max(1, Math.round(b.sw * safeScale));
      const dh = heights[index];
      out.drawImage(el.bookImage, b.sx, b.sy, b.sw, b.sh, sidePad, y, dw, dh);
      y += dh + gap;
    });

    preprocessForOCR(canvas);
    return canvas.toDataURL("image/jpeg", 0.98);
  }

  makeCropDataUrl = async function() {
    if (state.mode === "highlight") return makeHighlightCropDataUrl();
    return originalMakeCropDataUrl();
  };

  if (window.ResizeObserver) {
    new ResizeObserver(() => {
      if (state.mode === "highlight") resizeHighlighterCanvas();
    }).observe(el.imageStage);
  } else {
    window.addEventListener("resize", () => {
      if (state.mode === "highlight") resizeHighlighterCanvas();
    });
  }
})();
