/**
 * documentDetect.js — on-device document quad detection + perspective warp.
 *
 * No OpenCV. Runs on a downscaled ImageData (~280px wide) so live preview
 * can hit 8–12 Hz on mid phones. Capture uses the same quad scaled onto
 * the full-resolution frame, then a homography warp + mild auto-levels.
 *
 * Public API:
 *   detectDocumentQuad(imageData) -> { corners, score, area } | null
 *   lerpCorners(from, to, t)
 *   warpPerspective(source, corners, opts) -> HTMLCanvasElement
 *   enhanceDocument(canvas, mode) -> HTMLCanvasElement
 *   canvasToJpegDataUrl(canvas, quality)
 */

const DETECT_W = 280;
const MIN_AREA = 0.12;
const MAX_AREA = 0.94;

export function drawVideoFrame(video, canvas) {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, w, h);
  return canvas;
}

export function downscaleForDetect(sourceCanvas) {
  const srcW = sourceCanvas.width;
  const srcH = sourceCanvas.height;
  if (!srcW || !srcH) return null;
  const scale = DETECT_W / srcW;
  const w = DETECT_W;
  const h = Math.max(32, Math.round(srcH * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(sourceCanvas, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/**
 * @returns {{ corners: {x:number,y:number}[], score: number, area: number } | null}
 * corners are normalized 0–1 in TL, TR, BR, BL order.
 */
export function detectDocumentQuad(imageData) {
  if (!imageData?.width) return null;
  const W = imageData.width;
  const H = imageData.height;
  const gray = toGray(imageData);
  boxBlurInPlace(gray, W, H, 2);
  const binary = adaptiveThreshold(gray, W, H, 15, 6);

  // Paper is usually the bright blob. If the frame is mostly bright already
  // (white desk), invert so the document still separates.
  const brightFrac = countOn(binary) / (W * H);
  if (brightFrac > 0.82) invertBinary(binary);

  floodFillBorders(binary, W, H); // paint background 0
  const { areaPx, minX, minY, maxX, maxY, xs, ys } = collectBlob(binary, W, H);
  const area = areaPx / (W * H);
  if (area < MIN_AREA || area > MAX_AREA) return null;

  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  if (bw < W * 0.22 || bh < H * 0.22) return null;

  const cornersPx = extremaCorners(xs, ys);
  const ordered = orderCorners(cornersPx);
  if (!ordered) return null;

  const quadArea = quadPolygonArea(ordered);
  const bboxArea = bw * bh;
  const rectangularity = bboxArea > 0 ? quadArea / bboxArea : 0;
  if (rectangularity < 0.55) return null;

  const aspect = edgeAspect(ordered);
  if (aspect < 0.28 || aspect > 3.6) return null;

  const fill = areaPx / Math.max(1, quadArea);
  // Score: prefer a large, rectangular page that fills its quad.
  const score = clamp01(
    0.35 * smoothstep(MIN_AREA, 0.45, area)
    + 0.35 * smoothstep(0.55, 0.92, rectangularity)
    + 0.20 * smoothstep(0.55, 0.92, clamp01(fill))
    + 0.10 * (1 - Math.abs(Math.log(aspect / 0.75)) / 2),
  );

  if (score < 0.28) return null;

  const corners = ordered.map((p) => ({ x: p.x / W, y: p.y / H }));
  return { corners, score, area };
}

export function lerpCorners(from, to, t) {
  if (!from) return to;
  if (!to) return from;
  return from.map((a, i) => ({
    x: a.x + (to[i].x - a.x) * t,
    y: a.y + (to[i].y - a.y) * t,
  }));
}

export function cornersMoved(a, b) {
  if (!a || !b) return 1;
  let max = 0;
  for (let i = 0; i < 4; i++) {
    const dx = a[i].x - b[i].x;
    const dy = a[i].y - b[i].y;
    max = Math.max(max, Math.hypot(dx, dy));
  }
  return max;
}

/**
 * Warp a source canvas/image so `corners` (normalized) become a rectangle.
 */
export function warpPerspective(source, corners, { maxEdge = 1600 } = {}) {
  const srcW = source.width || source.naturalWidth || source.videoWidth;
  const srcH = source.height || source.naturalHeight || source.videoHeight;
  const px = corners.map((c) => ({ x: c.x * srcW, y: c.y * srcH }));
  const [tl, tr, br, bl] = px;
  const widthTop = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const widthBot = Math.hypot(br.x - bl.x, br.y - bl.y);
  const heightL = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const heightR = Math.hypot(br.x - tr.x, br.y - tr.y);
  let outW = Math.round(Math.max(widthTop, widthBot));
  let outH = Math.round(Math.max(heightL, heightR));
  const longest = Math.max(outW, outH);
  if (longest > maxEdge) {
    const s = maxEdge / longest;
    outW = Math.max(32, Math.round(outW * s));
    outH = Math.max(32, Math.round(outH * s));
  }
  outW = Math.max(32, outW);
  outH = Math.max(32, outH);

  const srcPts = [tl, tr, br, bl];
  const dstPts = [
    { x: 0, y: 0 },
    { x: outW - 1, y: 0 },
    { x: outW - 1, y: outH - 1 },
    { x: 0, y: outH - 1 },
  ];
  // Inverse map: dest -> source so we sample cleanly.
  const Hinv = computeHomography(dstPts, srcPts);

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext('2d');
  const dest = ctx.createImageData(outW, outH);

  const srcCanvas = source instanceof HTMLCanvasElement
    ? source
    : drawToCanvas(source);
  const sctx = srcCanvas.getContext('2d', { willReadFrequently: true });
  const srcData = sctx.getImageData(0, 0, srcW, srcH).data;

  const d = dest.data;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const p = applyHomography(Hinv, x, y);
      const rgba = sampleBilinear(srcData, srcW, srcH, p.x, p.y);
      const i = (y * outW + x) * 4;
      d[i] = rgba[0];
      d[i + 1] = rgba[1];
      d[i + 2] = rgba[2];
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(dest, 0, 0);
  return out;
}

export function enhanceDocument(canvas, mode = 'auto') {
  if (mode === 'off') return canvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = img.data;
  const n = data.length / 4;
  const lum = new Uint8Array(n);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    lum[p] = (data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722) | 0;
  }
  const lo = percentile(lum, 0.03);
  const hi = Math.max(lo + 16, percentile(lum, 0.98));
  const scale = 255 / (hi - lo);
  const bw = mode === 'bw';
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    let r = clampByte((data[i] - lo) * scale);
    let g = clampByte((data[i + 1] - lo) * scale);
    let b = clampByte((data[i + 2] - lo) * scale);
    // Mild extra contrast around midtones for text.
    r = contrastAround(r, 1.12);
    g = contrastAround(g, 1.12);
    b = contrastAround(b, 1.12);
    if (bw) {
      const y = (r * 0.2126 + g * 0.7152 + b * 0.0722) | 0;
      data[i] = data[i + 1] = data[i + 2] = y;
    } else {
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function canvasToJpegDataUrl(canvas, quality = 0.88) {
  return canvas.toDataURL('image/jpeg', quality);
}

export function pageAspectHint(corners) {
  if (!corners) return 'portrait';
  const [tl, tr, br, bl] = corners;
  const w = (Math.hypot(tr.x - tl.x, tr.y - tl.y) + Math.hypot(br.x - bl.x, br.y - bl.y)) / 2;
  const h = (Math.hypot(bl.x - tl.x, bl.y - tl.y) + Math.hypot(br.x - tr.x, br.y - tr.y)) / 2;
  return w > h ? 'landscape' : 'portrait';
}

// ── internals ──────────────────────────────────────────────────────────────

function toGray(imageData) {
  const { data, width, height } = imageData;
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    out[p] = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
  }
  return out;
}

function boxBlurInPlace(buf, w, h, radius) {
  const tmp = new Float32Array(buf.length);
  const n = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += buf[y * w + clampInt(k, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / n;
      const leave = buf[y * w + clampInt(x - radius, 0, w - 1)];
      const enter = buf[y * w + clampInt(x + radius + 1, 0, w - 1)];
      sum += enter - leave;
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += tmp[clampInt(k, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      buf[y * w + x] = sum / n;
      const leave = tmp[clampInt(y - radius, 0, h - 1) * w + x];
      const enter = tmp[clampInt(y + radius + 1, 0, h - 1) * w + x];
      sum += enter - leave;
    }
  }
}

function adaptiveThreshold(gray, w, h, window, C) {
  const integral = new Float64Array((w + 1) * (h + 1));
  const iw = w + 1;
  for (let y = 1; y <= h; y++) {
    let rowSum = 0;
    for (let x = 1; x <= w; x++) {
      rowSum += gray[(y - 1) * w + (x - 1)];
      integral[y * iw + x] = integral[(y - 1) * iw + x] + rowSum;
    }
  }
  const out = new Uint8Array(w * h);
  const half = (window / 2) | 0;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(h - 1, y + half);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(w - 1, x + half);
      const count = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        integral[(y1 + 1) * iw + (x1 + 1)]
        - integral[y0 * iw + (x1 + 1)]
        - integral[(y1 + 1) * iw + x0]
        + integral[y0 * iw + x0];
      out[y * w + x] = gray[y * w + x] >= sum / count - C ? 1 : 0;
    }
  }
  return out;
}

function invertBinary(bin) {
  for (let i = 0; i < bin.length; i++) bin[i] = bin[i] ? 0 : 1;
}

function countOn(bin) {
  let n = 0;
  for (let i = 0; i < bin.length; i++) n += bin[i];
  return n;
}

function floodFillBorders(bin, w, h) {
  const stack = [];
  const pushIf = (x, y) => {
    const i = y * w + x;
    if (bin[i] === 1) {
      bin[i] = 0;
      stack.push(x, y);
    }
  };
  for (let x = 0; x < w; x++) {
    pushIf(x, 0);
    pushIf(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    pushIf(0, y);
    pushIf(w - 1, y);
  }
  while (stack.length) {
    const y = stack.pop();
    const x = stack.pop();
    if (x > 0) pushIf(x - 1, y);
    if (x + 1 < w) pushIf(x + 1, y);
    if (y > 0) pushIf(x, y - 1);
    if (y + 1 < h) pushIf(x, y + 1);
  }
}

function collectBlob(bin, w, h) {
  const xs = [];
  const ys = [];
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (!bin[row + x]) continue;
      xs.push(x);
      ys.push(y);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return { areaPx: xs.length, minX, minY, maxX, maxY, xs, ys };
}

function extremaCorners(xs, ys) {
  let tl = { s: Infinity, x: 0, y: 0 };
  let br = { s: -Infinity, x: 0, y: 0 };
  let tr = { s: -Infinity, x: 0, y: 0 };
  let bl = { s: Infinity, x: 0, y: 0 };
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    const y = ys[i];
    const add = x + y;
    const sub = x - y;
    if (add < tl.s) tl = { s: add, x, y };
    if (add > br.s) br = { s: add, x, y };
    if (sub > tr.s) tr = { s: sub, x, y };
    if (sub < bl.s) bl = { s: sub, x, y };
  }
  return [
    { x: tl.x, y: tl.y },
    { x: tr.x, y: tr.y },
    { x: br.x, y: br.y },
    { x: bl.x, y: bl.y },
  ];
}

function orderCorners(pts) {
  if (!pts || pts.length !== 4) return null;
  const sorted = [...pts].sort((a, b) => a.y - b.y);
  const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
  const bot = sorted.slice(2, 4).sort((a, b) => a.x - b.x);
  const ordered = [top[0], top[1], bot[1], bot[0]];
  if (quadPolygonArea(ordered) < 8) return null;
  return ordered;
}

function quadPolygonArea(pts) {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a) / 2;
}

function edgeAspect(pts) {
  const [tl, tr, br, bl] = pts;
  const w = (Math.hypot(tr.x - tl.x, tr.y - tl.y) + Math.hypot(br.x - bl.x, br.y - bl.y)) / 2;
  const h = (Math.hypot(bl.x - tl.x, bl.y - tl.y) + Math.hypot(br.x - tr.x, br.y - tr.y)) / 2;
  return h === 0 ? 99 : w / h;
}

function computeHomography(src, dst) {
  // Solve for h0..h7 mapping src -> dst (8x8).
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const x = src[i].x;
    const y = src[i].y;
    const u = dst[i].x;
    const v = dst[i].y;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve8(A, b);
  return [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1],
  ];
}

function applyHomography(H, x, y) {
  const w = H[2][0] * x + H[2][1] * y + H[2][2];
  return {
    x: (H[0][0] * x + H[0][1] * y + H[0][2]) / w,
    y: (H[1][0] * x + H[1][1] * y + H[1][2]) / w,
  };
}

function solve8(A, b) {
  // Gaussian elimination with partial pivot.
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    let best = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r][col]);
      if (v > best) {
        best = v;
        piv = r;
      }
    }
    if (piv !== col) {
      const tmp = M[col];
      M[col] = M[piv];
      M[piv] = tmp;
    }
    const diag = M[col][col] || 1e-12;
    for (let c = col; c <= n; c++) M[col][c] /= diag;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (!f) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

function sampleBilinear(data, w, h, x, y) {
  if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) {
    const xi = clampInt(x | 0, 0, w - 1);
    const yi = clampInt(y | 0, 0, h - 1);
    const i = (yi * w + xi) * 4;
    return [data[i], data[i + 1], data[i + 2], 255];
  }
  const x0 = x | 0;
  const y0 = y | 0;
  const fx = x - x0;
  const fy = y - y0;
  const i00 = (y0 * w + x0) * 4;
  const i10 = i00 + 4;
  const i01 = i00 + w * 4;
  const i11 = i01 + 4;
  const mix = (a, b, t) => a + (b - a) * t;
  return [
    mix(mix(data[i00], data[i10], fx), mix(data[i01], data[i11], fx), fy),
    mix(mix(data[i00 + 1], data[i10 + 1], fx), mix(data[i01 + 1], data[i11 + 1], fx), fy),
    mix(mix(data[i00 + 2], data[i10 + 2], fx), mix(data[i01 + 2], data[i11 + 2], fx), fy),
    255,
  ];
}

function drawToCanvas(img) {
  const c = document.createElement('canvas');
  c.width = img.width || img.naturalWidth || img.videoWidth;
  c.height = img.height || img.naturalHeight || img.videoHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}

function percentile(arr, p) {
  const copy = Array.from(arr).sort((a, b) => a - b);
  const i = clampInt(Math.floor(p * (copy.length - 1)), 0, copy.length - 1);
  return copy[i];
}

function contrastAround(v, amount) {
  return clampByte(((v / 255 - 0.5) * amount + 0.5) * 255);
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function clampByte(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}
function clampInt(v, lo, hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v | 0;
}
function smoothstep(a, b, x) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
