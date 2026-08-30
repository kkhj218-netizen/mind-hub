(() => {
  const highlightModeBtn = document.querySelector("#highlightModeBtn");
  const highlighterCanvas = document.querySelector("#highlighterCanvas");

  if (!highlightModeBtn || !highlighterCanvas || typeof state === "undefined" || typeof el === "undefined") return;

  const originalMakeCropDataUrl = makeCropDataUrl;
  const ctx = highlighterCanvas.getContext("2d");
  let workerPromise = null;

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
    const padX = width * 0.55;
    const padY = width * 0.48;
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const left = clamp(Math.min(...xs) - padX, image.x, image.x + image.w);
    const right = clamp(Math.max(...xs) + padX, image.x, image.x + image.w);
    const top = clamp(Math.min(...ys) - padY, image.y, image.y + image.h);
    const bottom = clamp(Math.max(...ys) + padY, image.y, image.y + image.h);
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
    el.editorHint.textContent = "가져올 문장을 한 줄씩 손가락으로 슥 그으세요. 색 배경·흰 글씨도 자동 보정해 읽습니다.";
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

  function makeOriginalLineCanvas(naturalBox) {
    const targetH = 120;
    const scale = Math.max(1, Math.min(4, targetH / Math.max(1, naturalBox.sh)));
    const limitedScale = Math.min(scale, 2200 / Math.max(1, naturalBox.sw));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(naturalBox.sw * limitedScale));
    canvas.height = Math.max(1, Math.round(naturalBox.sh * limitedScale));
    const c = canvas.getContext("2d", { willReadFrequently: true });
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = "high";
    c.drawImage(el.bookImage, naturalBox.sx, naturalBox.sy, naturalBox.sw, naturalBox.sh, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function otsuThreshold(gray) {
    const hist = new Array(256).fill(0);
    for (const v of gray) hist[v]++;
    const total = gray.length;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0;
    let wB = 0;
    let maxVariance = -1;
    let threshold = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const variance = wB * wF * (mB - mF) * (mB - mF);
      if (variance > maxVariance) {
        maxVariance = variance;
        threshold = t;
      }
    }
    return threshold;
  }

  function makeOCRVariants(source) {
    const w = source.width;
    const h = source.height;
    const src = source.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h);
    const gray = new Uint8Array(w * h);
    let borderSum = 0;
    let borderCount = 0;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        const i = p * 4;
        const g = Math.round(0.299 * src.data[i] + 0.587 * src.data[i + 1] + 0.114 * src.data[i + 2]);
        gray[p] = g;
        if (x < Math.max(2, w * 0.04) || x > w * 0.96 || y < Math.max(2, h * 0.08) || y > h * 0.92) {
          borderSum += g;
          borderCount++;
        }
      }
    }

    const bgMean = borderCount ? borderSum / borderCount : 200;
    const threshold = otsuThreshold(gray);
    const enhanced = document.createElement("canvas");
    enhanced.width = w;
    enhanced.height = h;
    const ec = enhanced.getContext("2d", { willReadFrequently: true });
    const ei = ec.createImageData(w, h);
    const binary = document.createElement("canvas");
    binary.width = w;
    binary.height = h;
    const bc = binary.getContext("2d", { willReadFrequently: true });
    const bi = bc.createImageData(w, h);
    const darkBackground = bgMean < 150;

    for (let p = 0; p < gray.length; p++) {
      const g = gray[p];
      const contrast = Math.max(0, Math.min(255, (g - 128) * 1.55 + 128));
      const isText = darkBackground ? g > threshold : g < threshold;
      const b = isText ? 0 : 255;
      const i = p * 4;
      ei.data[i] = ei.data[i + 1] = ei.data[i + 2] = darkBackground ? 255 - contrast : contrast;
      ei.data[i + 3] = 255;
      bi.data[i] = bi.data[i + 1] = bi.data[i + 2] = b;
      bi.data[i + 3] = 255;
    }
    ec.putImageData(ei, 0, 0);
    bc.putImageData(bi, 0, 0);
    return [enhanced, binary];
  }

  function cleanText(text) {
    return (text || "").replace(/[\r\n]+/g, " ").replace(/\s{2,}/g, " ").replace(/^\s*[|¦]+\s*/, "").trim();
  }

  function resultScore(data) {
    const text = cleanText(data?.text || "");
    if (!text) return -999;
    const confidence = Number(data?.confidence || 0);
    const hangul = (text.match(/[가-힣]/g) || []).length;
    const latin = (text.match(/[A-Za-z]/g) || []).length;
    const weird = (text.match(/[|_=<>~^`\\]/g) || []).length;
    return confidence + Math.min(12, hangul * 0.18) - weird * 3 - Math.max(0, latin - hangul * 0.7) * 0.25;
  }

  async function getWorker() {
    if (!workerPromise) {
      workerPromise = Tesseract.createWorker("kor+eng", 1, {
        logger: (m) => {
          if (state.mode === "highlight" && m.status === "recognizing text" && typeof m.progress === "number") {
            el.ocrProgressText.textContent = `${Math.max(1, Math.round(m.progress * 100))}%`;
          }
        }
      }).then(async worker => {
        await worker.setParameters({ tessedit_pageseg_mode: "7", preserve_interword_spaces: "1" });
        return worker;
      }).catch(err => {
        workerPromise = null;
        throw err;
      });
    }
    return workerPromise;
  }

  function buildSavedCrop(lineCanvases) {
    const maxW = Math.max(...lineCanvases.map(c => c.width));
    const gap = 16;
    const totalH = lineCanvases.reduce((s, c) => s + c.height, 0) + gap * Math.max(0, lineCanvases.length - 1);
    const canvas = el.cropCanvas;
    canvas.width = maxW;
    canvas.height = totalH;
    const c = canvas.getContext("2d");
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, canvas.width, canvas.height);
    let y = 0;
    for (const line of lineCanvases) {
      c.drawImage(line, 0, y);
      y += line.height + gap;
    }
    return canvas.toDataURL("image/jpeg", 0.92);
  }

  async function makeHighlightCropDataUrl() {
    if (!state.highlightBoxes.length) throw new Error("형광펜으로 문장을 먼저 선택해 주세요.");
    const boxes = mergeLineBoxes(state.highlightBoxes).map(selectionToNatural).sort((a, b) => a.sy - b.sy);
    const lines = boxes.map(makeOriginalLineCanvas);
    return buildSavedCrop(lines);
  }

  async function extractHighlightText() {
    if (!state.highlightBoxes.length) {
      toast("형광펜으로 문장을 먼저 선택해 주세요.");
      return;
    }

    el.ocrPanel.classList.remove("hidden");
    el.ocrLoading.classList.remove("hidden");
    el.extractBtn.disabled = true;
    el.ocrProgressText.textContent = "OCR 준비";
    el.quoteText.value = "";
    el.ocrPanel.scrollIntoView({ behavior: "smooth", block: "start" });

    try {
      if (!window.Tesseract) throw new Error("OCR 엔진을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.");
      const boxes = mergeLineBoxes(state.highlightBoxes).map(selectionToNatural).sort((a, b) => a.sy - b.sy);
      const lineCanvases = boxes.map(makeOriginalLineCanvas);
      state.cropDataUrl = buildSavedCrop(lineCanvases);
      const worker = await getWorker();
      const lines = [];
      const totalRuns = lineCanvases.length * 2;
      let completed = 0;

      for (const lineCanvas of lineCanvases) {
        const variants = makeOCRVariants(lineCanvas);
        let best = null;
        for (const variant of variants) {
          const result = await worker.recognize(variant);
          completed++;
          const score = resultScore(result.data);
          if (!best || score > best.score) best = { score, data: result.data };
          el.ocrProgressText.textContent = `${Math.round((completed / totalRuns) * 100)}%`;
        }
        const text = cleanText(best?.data?.text || "");
        if (text) lines.push(text);
      }

      const combined = lines.join(" ").replace(/\s{2,}/g, " ").trim();
      el.quoteText.value = combined;
      el.ocrProgressText.textContent = combined ? "완료" : "인식 결과 없음";
      if (!combined) toast("글자를 잘 찾지 못했어요. 문장 가운데를 따라 조금 더 정확히 그어보세요.");
    } catch (err) {
      console.error(err);
      el.ocrProgressText.textContent = "오류";
      toast(err.message || "OCR 중 오류가 발생했습니다.");
    } finally {
      el.ocrLoading.classList.add("hidden");
      el.extractBtn.disabled = !state.highlightBoxes.length;
    }
  }

  el.extractBtn.addEventListener("click", (evt) => {
    if (state.mode !== "highlight") return;
    evt.preventDefault();
    evt.stopImmediatePropagation();
    extractHighlightText();
  }, true);

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
