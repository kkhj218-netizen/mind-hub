(() => {
  if (!window.Tesseract?.recognize) return;

  const originalRecognize = window.Tesseract.recognize.bind(window.Tesseract);

  function clampNum(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function mergeLineBoxes(boxes) {
    const sorted = (boxes || []).map(b => ({ ...b })).sort((a, b) => a.y - b.y || a.x - b.x);
    const merged = [];
    for (const box of sorted) {
      const last = merged[merged.length - 1];
      if (!last) {
        merged.push(box);
        continue;
      }
      const overlap = Math.min(last.y + last.h, box.y + box.h) - Math.max(last.y, box.y);
      const minH = Math.min(last.h, box.h);
      if (overlap > minH * 0.42) {
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

  function expandDisplayBox(box) {
    const r = imageRectWithinStage();
    const px = Math.max(8, box.w * 0.025);
    const py = Math.max(10, box.h * 0.42);
    const left = clampNum(box.x - px, r.x, r.x + r.w);
    const top = clampNum(box.y - py, r.y, r.y + r.h);
    const right = clampNum(box.x + box.w + px, r.x, r.x + r.w);
    const bottom = clampNum(box.y + box.h + py, r.y, r.y + r.h);
    return { x: left, y: top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) };
  }

  function makeLineCanvas(displayBox, kind = "soft") {
    const b = selectionToNatural(expandDisplayBox(displayBox));

    // 한글 획이 충분히 커지도록 한 줄 높이를 최소 150px 정도로 확대한다.
    const targetHeight = kind === "binary" ? 180 : 160;
    const byHeight = targetHeight / Math.max(1, b.sh);
    const byWidth = 2500 / Math.max(1, b.sw);
    const scale = clampNum(Math.min(byHeight, byWidth), 1.15, 4.0);

    const padX = 24;
    const padY = 20;
    const contentW = Math.max(1, Math.round(b.sw * scale));
    const contentH = Math.max(1, Math.round(b.sh * scale));
    const canvas = document.createElement("canvas");
    canvas.width = contentW + padX * 2;
    canvas.height = contentH + padY * 2;
    const c = canvas.getContext("2d", { willReadFrequently: true });

    c.fillStyle = "#fff";
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = "high";
    c.drawImage(el.bookImage, b.sx, b.sy, b.sw, b.sh, padX, padY, contentW, contentH);

    const imageData = c.getImageData(0, 0, canvas.width, canvas.height);
    const d = imageData.data;
    const gray = new Uint8ClampedArray(canvas.width * canvas.height);

    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      gray[p] = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    }

    if (kind === "soft") {
      // 과한 이진화는 얇은 한글 획을 날릴 수 있어 부드러운 대비 보정을 기본으로 사용한다.
      for (let i = 0, p = 0; i < d.length; i += 4, p++) {
        const g = gray[p];
        const v = clampNum(Math.round((g - 128) * 1.34 + 132), 0, 255);
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 255;
      }
    } else if (kind === "binary") {
      // 페이지 그림자/조명 얼룩에 강하도록 블록별 평균을 이용한 간단한 적응형 이진화.
      const w = canvas.width;
      const h = canvas.height;
      const integral = new Float64Array((w + 1) * (h + 1));
      for (let y = 1; y <= h; y++) {
        let row = 0;
        for (let x = 1; x <= w; x++) {
          row += gray[(y - 1) * w + (x - 1)];
          integral[y * (w + 1) + x] = integral[(y - 1) * (w + 1) + x] + row;
        }
      }
      const radius = Math.max(10, Math.round(Math.min(w, h) * 0.055));
      for (let y = 0; y < h; y++) {
        const y1 = Math.max(0, y - radius);
        const y2 = Math.min(h - 1, y + radius);
        for (let x = 0; x < w; x++) {
          const x1 = Math.max(0, x - radius);
          const x2 = Math.min(w - 1, x + radius);
          const A = integral[y1 * (w + 1) + x1];
          const B = integral[y1 * (w + 1) + (x2 + 1)];
          const C = integral[(y2 + 1) * (w + 1) + x1];
          const D = integral[(y2 + 1) * (w + 1) + (x2 + 1)];
          const area = (x2 - x1 + 1) * (y2 - y1 + 1);
          const mean = (D - B - C + A) / area;
          const g = gray[y * w + x];
          const v = g < mean - 13 ? 0 : 255;
          const i = (y * w + x) * 4;
          d[i] = d[i + 1] = d[i + 2] = v;
          d[i + 3] = 255;
        }
      }
    }

    c.putImageData(imageData, 0, 0);
    return canvas;
  }

  function normalizeOCRText(text = "") {
    return String(text)
      .normalize("NFC")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\s*\n\s*/g, " ")
      .replace(/\s+([,.!?;:])/g, "$1")
      .replace(/([\(\[“‘])\s+/g, "$1")
      .replace(/\s+([\)\]”’])/g, "$1")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function textQuality(result) {
    const text = normalizeOCRText(result?.data?.text || "");
    if (!text) return -999;

    const confidence = Number(result?.data?.confidence || 0);
    const chars = [...text];
    let hangul = 0;
    let good = 0;
    let junk = 0;

    for (const ch of chars) {
      if (/[가-힣]/.test(ch)) hangul++;
      if (/[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9\s.,!?;:'"“”‘’()\[\]·%+\-–—/]/.test(ch)) good++;
      if (/[|{}<>_^~=\\]/.test(ch)) junk++;
    }

    const len = Math.max(1, chars.length);
    const goodRatio = good / len;
    const hangulRatio = hangul / len;
    const junkRatio = junk / len;

    // confidence를 중심으로 하되, 한글 문장답지 않은 특수문자 결과는 감점한다.
    return confidence * 0.72 + goodRatio * 20 + hangulRatio * 12 - junkRatio * 32 + Math.min(6, len / 14);
  }

  function mappedOptions(options, passIndex, totalPasses) {
    const userLogger = options?.logger;
    if (!userLogger) return options || {};
    return {
      ...(options || {}),
      logger: (m) => {
        if (m?.status === "recognizing text" && typeof m.progress === "number") {
          userLogger({ ...m, progress: clampNum((passIndex + m.progress) / totalPasses, 0, 1) });
        } else if (passIndex === 0) {
          userLogger(m);
        }
      }
    };
  }

  async function recognizeCandidate(canvas, langs, options, passIndex, totalPasses) {
    return originalRecognize(canvas.toDataURL("image/png"), langs, mappedOptions(options, passIndex, totalPasses));
  }

  async function preciseHighlightRecognize(langs, options) {
    const lineBoxes = mergeLineBoxes(state.highlightBoxes).sort((a, b) => a.y - b.y || a.x - b.x);
    if (!lineBoxes.length) throw new Error("형광펜으로 선택한 문장이 없습니다.");

    const outputs = [];
    let passIndex = 0;
    // 기본 2회 판독 + 품질이 낮은 줄만 3차 판독 가능. 진행률 계산은 넉넉히 3회 기준.
    const totalPasses = Math.max(1, lineBoxes.length * 3);

    for (const box of lineBoxes) {
      const soft = makeLineCanvas(box, "soft");
      const binary = makeLineCanvas(box, "binary");

      const a = await recognizeCandidate(soft, langs, options, passIndex++, totalPasses);
      const b = await recognizeCandidate(binary, langs, options, passIndex++, totalPasses);
      const candidates = [a, b];

      let best = candidates.sort((x, y) => textQuality(y) - textQuality(x))[0];

      // 두 방식 모두 애매한 경우 원본 확대본을 세 번째로 읽어서 구제한다.
      if (textQuality(best) < 76) {
        const raw = makeLineCanvas(box, "raw");
        const c = await recognizeCandidate(raw, langs, options, passIndex++, totalPasses);
        candidates.push(c);
        best = candidates.sort((x, y) => textQuality(y) - textQuality(x))[0];
      } else {
        passIndex++;
      }

      outputs.push({
        text: normalizeOCRText(best?.data?.text || ""),
        confidence: Number(best?.data?.confidence || 0),
        source: best
      });
    }

    const text = outputs.map(o => o.text).filter(Boolean).join(" ").replace(/\s{2,}/g, " ").trim();
    const confidence = outputs.length
      ? outputs.reduce((sum, o) => sum + o.confidence, 0) / outputs.length
      : 0;

    const base = outputs[0]?.source || { data: {} };
    return {
      ...base,
      data: {
        ...(base.data || {}),
        text,
        confidence
      }
    };
  }

  window.Tesseract.recognize = async function(image, langs, options) {
    try {
      if (typeof state !== "undefined" && state.mode === "highlight" && state.highlightBoxes?.length) {
        return await preciseHighlightRecognize(langs, options);
      }
    } catch (err) {
      console.warn("정밀 OCR 실패, 기본 OCR로 전환합니다.", err);
    }
    return originalRecognize(image, langs, options);
  };
})();
