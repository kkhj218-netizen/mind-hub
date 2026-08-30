(() => {
  if (!window.Tesseract) return;

  const originalRecognize = window.Tesseract.recognize?.bind(window.Tesseract);
  const originalCreateWorker = window.Tesseract.createWorker?.bind(window.Tesseract);
  if (!originalRecognize || !originalCreateWorker) return;

  const KNOWN_LATIN = new Set([
    "AI", "AR", "VR", "XR", "IT", "CEO", "CFO", "CTO", "COO",
    "ETF", "GDP", "CPI", "PCE", "PPI", "PMI", "EPS", "PER", "PBR",
    "ROE", "ROI", "SNS", "SEO", "OCR", "PWA", "PDF", "URL", "API",
    "USB", "CPU", "GPU", "RAM", "ROM", "HTML", "CSS", "JS", "TS",
    "USD", "KRW", "EUR", "JPY", "US", "UK", "EU", "S&P", "NASDAQ"
  ]);

  const workers = {
    blockBi: null,
    blockKor: null,
    lineKor: null
  };

  const blockProgress = {
    logger: null,
    pass: 0,
    total: 1
  };

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function normalizeText(text = "") {
    return String(text)
      .normalize("NFC")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/[\r\n]+/g, " ")
      .replace(/[|¦]{2,}/g, " ")
      .replace(/[_~^`\\]+/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\s+([,.!?;:])/g, "$1")
      .replace(/([\(\[“‘])\s+/g, "$1")
      .replace(/\s+([\)\]”’])/g, "$1")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function analyzeText(input = "") {
    const text = normalizeText(input);
    const hangul = (text.match(/[가-힣]/g) || []).length;
    const jamo = (text.match(/[ㄱ-ㅎㅏ-ㅣ]/g) || []).length;
    const latin = (text.match(/[A-Za-z]/g) || []).length;
    const digits = (text.match(/\d/g) || []).length;
    const weird = (text.match(/[{}<>_=~^`\\|¦]/g) || []).length;
    const chars = [...text].filter(ch => !/\s/.test(ch)).length || 1;

    const latinTokens = text.match(/[A-Za-z][A-Za-z&+.-]{0,14}/g) || [];
    const suspiciousLatin = latinTokens.filter(token => {
      const bare = token.replace(/[^A-Za-z]/g, "");
      if (!bare) return false;
      if (KNOWN_LATIN.has(token.toUpperCase())) return false;
      if (bare.length >= 6) return false;
      return true;
    });

    const attachedDigits = (text.match(/[가-힣]\d{2,}|\d{2,}[가-힣]/g) || []).length;
    const koreanHeavy = hangul >= 6 && hangul >= latin * 1.15;

    return {
      text,
      hangul,
      jamo,
      latin,
      digits,
      weird,
      chars,
      latinTokens,
      suspiciousLatin,
      attachedDigits,
      koreanHeavy,
      hangulRatio: hangul / chars
    };
  }

  function candidateScore(result) {
    const data = result?.data || {};
    const a = analyzeText(data.text || "");
    if (!a.text) return -1000;

    const confidence = Number(data.confidence || 0);
    let score = confidence * 0.62;
    score += a.hangulRatio * 34;
    score += Math.min(8, a.hangul / 10);
    score -= a.weird * 8;
    score -= a.jamo * (a.koreanHeavy ? 5 : 1.5);
    score -= a.attachedDigits * 8;

    if (a.koreanHeavy) {
      score -= a.suspiciousLatin.length * 11;
      score -= Math.max(0, a.latin - 2) * 0.45;
    }

    return score;
  }

  function needsKoreanRescue(result) {
    const data = result?.data || {};
    const a = analyzeText(data.text || "");
    const confidence = Number(data.confidence || 0);
    if (!a.text || !a.koreanHeavy) return false;
    return (
      confidence < 79 ||
      a.suspiciousLatin.length > 0 ||
      a.jamo > 0 ||
      a.weird > 0 ||
      a.attachedDigits > 0
    );
  }

  function cleanupKoreanText(input = "") {
    let text = normalizeText(input);
    const a = analyzeText(text);

    if (a.koreanHeavy) {
      text = text.replace(/(^|[\s(\[“‘])([A-Za-z][A-Za-z&+.-]{0,4})(?=$|[\s,.!?;:)\]”’])/g, (all, lead, token) => {
        if (KNOWN_LATIN.has(token.toUpperCase())) return `${lead}${token}`;
        return lead;
      });

      text = text.replace(/(^|\s)[ㄱ-ㅎㅏ-ㅣ]{1,4}(?=\s|[,.!?]|$)/g, " ");

      text = text.replace(/([가-힣])\d{3,}(?=\s|[,.!?]|$)/g, "$1");
      text = text.replace(/(^|\s)\d{3,}([가-힣])/g, "$1$2");
      text = text.replace(/[=<>]/g, " ");

      text = text.replace(/([가-힣])\s+(은|는|이|가|을|를|의|에|와|과|도|만|로|으로|에서|에게|보다|까지|부터)(?=\s|[,.!?;:]|$)/g, "$1$2");
      text = text.replace(/([가-힣])\s+(이다|이며|이고|이라|라고|한다|했다|된다|됐다)(?=\s|[,.!?;:]|$)/g, "$1$2");
    }

    return normalizeText(text)
      .replace(/\s+([,.!?;:])/g, "$1")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function cleanedResult(result) {
    if (!result) return result;
    const text = cleanupKoreanText(result?.data?.text || "");
    return {
      ...result,
      data: {
        ...(result.data || {}),
        text
      }
    };
  }

  async function getKorWorker(kind = "line") {
    const key = kind === "line" ? "lineKor" : "blockKor";
    if (!workers[key]) {
      workers[key] = originalCreateWorker("kor", 1, {})
        .then(async worker => {
          await worker.setParameters({
            tessedit_pageseg_mode: kind === "line" ? "7" : "6",
            preserve_interword_spaces: "1"
          });
          return worker;
        })
        .catch(err => {
          workers[key] = null;
          throw err;
        });
    }
    return workers[key];
  }

  async function getBlockBiWorker() {
    if (!workers.blockBi) {
      workers.blockBi = originalCreateWorker("kor+eng", 1, {
        logger: (m) => {
          if (!blockProgress.logger) return;
          if (m?.status === "recognizing text" && typeof m.progress === "number") {
            blockProgress.logger({
              ...m,
              progress: clamp((blockProgress.pass + m.progress) / blockProgress.total, 0, 1)
            });
          } else if (blockProgress.pass === 0) {
            blockProgress.logger(m);
          }
        }
      })
        .then(async worker => {
          await worker.setParameters({
            tessedit_pageseg_mode: "6",
            preserve_interword_spaces: "1"
          });
          return worker;
        })
        .catch(err => {
          workers.blockBi = null;
          throw err;
        });
    }
    return workers.blockBi;
  }

  async function sourceToCanvas(source) {
    if (source instanceof HTMLCanvasElement) {
      const c = document.createElement("canvas");
      c.width = source.width;
      c.height = source.height;
      c.getContext("2d").drawImage(source, 0, 0);
      return c;
    }

    if (source instanceof HTMLImageElement || source instanceof ImageBitmap) {
      const c = document.createElement("canvas");
      c.width = source.naturalWidth || source.width;
      c.height = source.naturalHeight || source.height;
      c.getContext("2d").drawImage(source, 0, 0, c.width, c.height);
      return c;
    }

    if (typeof source === "string") {
      const img = new Image();
      img.decoding = "async";
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = source;
      });
      const c = document.createElement("canvas");
      c.width = img.naturalWidth || img.width;
      c.height = img.naturalHeight || img.height;
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      return c;
    }

    throw new Error("OCR 이미지 변환에 실패했습니다.");
  }

  function cloneCanvas(source) {
    const c = document.createElement("canvas");
    c.width = source.width;
    c.height = source.height;
    c.getContext("2d").drawImage(source, 0, 0);
    return c;
  }

  function makeSoftVariant(source) {
    const c = cloneCanvas(source);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, c.width, c.height);
    const d = imageData.data;

    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const v = clamp(Math.round((g - 128) * 1.42 + 132), 0, 255);
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }

    ctx.putImageData(imageData, 0, 0);
    return c;
  }

  function otsuThreshold(gray) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
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

  function makeBinaryVariant(source) {
    const c = cloneCanvas(source);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, c.width, c.height);
    const d = imageData.data;
    const gray = new Uint8Array(c.width * c.height);
    let borderSum = 0;
    let borderCount = 0;

    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const p = y * c.width + x;
        const i = p * 4;
        const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
        gray[p] = g;
        if (x < c.width * 0.04 || x > c.width * 0.96 || y < c.height * 0.08 || y > c.height * 0.92) {
          borderSum += g;
          borderCount++;
        }
      }
    }

    const threshold = otsuThreshold(gray);
    const darkBackground = (borderCount ? borderSum / borderCount : 220) < 145;

    for (let p = 0; p < gray.length; p++) {
      const isText = darkBackground ? gray[p] > threshold : gray[p] < threshold;
      const v = isText ? 0 : 255;
      const i = p * 4;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }

    ctx.putImageData(imageData, 0, 0);
    return c;
  }

  function makeVariants(source) {
    return [source, makeSoftVariant(source), makeBinaryVariant(source)];
  }

  async function preciseBlockRecognize(image, langs, options = {}) {
    let source;
    try {
      source = await sourceToCanvas(image);
    } catch (err) {
      const fallback = await originalRecognize(image, langs, options);
      return cleanedResult(fallback);
    }

    const variants = makeVariants(source);
    const worker = await getBlockBiWorker();
    const candidates = [];
    blockProgress.logger = options?.logger || null;
    blockProgress.total = 4;

    for (let i = 0; i < variants.length; i++) {
      blockProgress.pass = i;
      const result = await worker.recognize(variants[i]);
      candidates.push(result);
    }

    let best = candidates.sort((a, b) => candidateScore(b) - candidateScore(a))[0];

    if (needsKoreanRescue(best)) {
      try {
        blockProgress.pass = 3;
        const korWorker = await getKorWorker("block");
        const rescue = await korWorker.recognize(source);
        candidates.push(rescue);
        best = candidates.sort((a, b) => candidateScore(b) - candidateScore(a))[0];
      } catch (err) {
        console.warn("한글 전용 보정 OCR을 건너뜁니다.", err);
      }
    }

    if (blockProgress.logger) {
      blockProgress.logger({ status: "recognizing text", progress: 1 });
    }
    blockProgress.logger = null;
    return cleanedResult(best);
  }

  window.Tesseract.recognize = async function(image, langs, options) {
    try {
      if (typeof state !== "undefined" && state.mode !== "highlight") {
        return await preciseBlockRecognize(image, langs || "kor+eng", options || {});
      }
    } catch (err) {
      console.warn("정밀 블록 OCR 실패, 기본 OCR로 전환합니다.", err);
    }

    const fallback = await originalRecognize(image, langs, options);
    return cleanedResult(fallback);
  };

  window.Tesseract.createWorker = async function(...args) {
    const worker = await originalCreateWorker(...args);
    const originalWorkerRecognize = worker.recognize.bind(worker);

    worker.recognize = async function(image, ...recognizeArgs) {
      const primary = await originalWorkerRecognize(image, ...recognizeArgs);
      let best = primary;

      if (typeof state !== "undefined" && state.mode === "highlight" && needsKoreanRescue(primary)) {
        try {
          const korWorker = await getKorWorker("line");
          const rescue = await korWorker.recognize(image);
          if (candidateScore(rescue) > candidateScore(primary)) best = rescue;
        } catch (err) {
          console.warn("형광펜 한글 전용 보정 OCR을 건너뜁니다.", err);
        }
      }

      return cleanedResult(best);
    };

    return worker;
  };

  try {
    if (typeof selectionToNatural === "function") {
      const originalSelectionToNatural = selectionToNatural;
      selectionToNatural = function(sel) {
        const b = originalSelectionToNatural(sel);
        if (!b || typeof state === "undefined") return b;

        const maxW = state.imageNatural?.w || (b.sx + b.sw);
        const maxH = state.imageNatural?.h || (b.sy + b.sh);
        const isHighlight = state.mode === "highlight";
        const padX = Math.max(3, b.sw * (isHighlight ? 0.018 : 0.012));
        const padY = Math.max(4, b.sh * (isHighlight ? 0.22 : 0.08));
        const left = clamp(b.sx - padX, 0, maxW);
        const top = clamp(b.sy - padY, 0, maxH);
        const right = clamp(b.sx + b.sw + padX, 0, maxW);
        const bottom = clamp(b.sy + b.sh + padY, 0, maxH);

        return {
          sx: left,
          sy: top,
          sw: Math.max(1, right - left),
          sh: Math.max(1, bottom - top)
        };
      };
    }
  } catch (err) {
    console.warn("OCR 영역 여백 보정을 적용하지 못했습니다.", err);
  }

  try {
    if (typeof makeCropDataUrl === "function") {
      const previousMakeCropDataUrl = makeCropDataUrl;
      makeCropDataUrl = async function() {
        if (typeof state !== "undefined" && state.mode === "highlight") {
          return previousMakeCropDataUrl();
        }
        if (!state?.selection) throw new Error("선택 영역이 없습니다.");

        const b = selectionToNatural(state.selection);
        const targetScale = clamp(2200 / Math.max(1, b.sw), 1, 2.6);
        const scale = Math.min(targetScale, 2800 / Math.max(1, b.sw));
        const canvas = el.cropCanvas;
        canvas.width = Math.max(1, Math.round(b.sw * scale));
        canvas.height = Math.max(1, Math.round(b.sh * scale));
        const c = canvas.getContext("2d", { willReadFrequently: true });
        c.fillStyle = "#fff";
        c.fillRect(0, 0, canvas.width, canvas.height);
        c.imageSmoothingEnabled = true;
        c.imageSmoothingQuality = "high";
        c.drawImage(el.bookImage, b.sx, b.sy, b.sw, b.sh, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", 0.94);
      };
    }
  } catch (err) {
    console.warn("고해상도 OCR crop을 적용하지 못했습니다.", err);
  }

  function installOcrTools() {
    const quote = document.querySelector("#quoteText");
    const panel = document.querySelector("#ocrPanel");
    if (!quote || !panel || document.querySelector("#ocrPrecisionTools")) return;

    const field = quote.closest(".field");
    if (!field) return;

    const wrap = document.createElement("div");
    wrap.id = "ocrPrecisionTools";
    wrap.innerHTML = `
      <div class="ocr-precision-row">
        <button id="retryOcrBtn" class="ocr-mini-btn" type="button">↻ 다시 인식</button>
        <button id="showCropBtn" class="ocr-mini-btn" type="button">▣ 원본 영역 보기</button>
        <span class="ocr-edit-hint">틀린 글자는 위 문장에서 바로 수정할 수 있어요.</span>
      </div>
      <div id="ocrCropPreview" class="ocr-crop-preview" hidden>
        <img id="ocrCropImage" alt="OCR에 사용한 원본 선택 영역" />
      </div>
    `;
    field.insertAdjacentElement("afterend", wrap);

    const style = document.createElement("style");
    style.textContent = `
      .ocr-precision-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:-2px 0 18px}
      .ocr-mini-btn{appearance:none;border:1px solid #d8dde7;background:#fff;color:#273244;border-radius:10px;padding:9px 11px;font-size:13px;font-weight:700;cursor:pointer}
      .ocr-mini-btn:active{transform:translateY(1px)}
      .ocr-edit-hint{font-size:12px;color:#8a93a3;flex:1;min-width:180px}
      .ocr-crop-preview{margin:-7px 0 18px;padding:10px;border:1px solid #e4e8ef;border-radius:12px;background:#f8fafc;overflow:auto;max-height:260px}
      .ocr-crop-preview img{display:block;max-width:100%;height:auto;margin:0 auto;border-radius:8px}
    `;
    document.head.appendChild(style);

    const retry = document.querySelector("#retryOcrBtn");
    const show = document.querySelector("#showCropBtn");
    const preview = document.querySelector("#ocrCropPreview");
    const img = document.querySelector("#ocrCropImage");

    retry?.addEventListener("click", () => {
      if (!el?.extractBtn || el.extractBtn.disabled) {
        if (typeof toast === "function") toast("선택 영역을 먼저 지정해 주세요.");
        return;
      }
      preview.hidden = true;
      show.textContent = "▣ 원본 영역 보기";
      el.extractBtn.click();
    });

    show?.addEventListener("click", () => {
      if (!state?.cropDataUrl) {
        if (typeof toast === "function") toast("먼저 문장을 한 번 추출해 주세요.");
        return;
      }
      const willShow = preview.hidden;
      preview.hidden = !willShow;
      if (willShow) img.src = state.cropDataUrl;
      show.textContent = willShow ? "▴ 원본 영역 닫기" : "▣ 원본 영역 보기";
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installOcrTools, { once: true });
  } else {
    installOcrTools();
  }

  window.BookOCR = {
    normalizeText,
    cleanupKoreanText,
    analyzeText,
    candidateScore,
    needsKoreanRescue
  };
})();
