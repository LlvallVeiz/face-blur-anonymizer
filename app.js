/**
 * face-blur-anonymizer — browser app (no build step).
 *
 * Pipeline: load image -> grayscale + histogram equalisation -> Haar
 * cascade face detection (Viola-Jones, via OpenCV.js) -> Gaussian blur
 * inside each padded face rectangle -> show side by side, download PNG.
 *
 * Everything runs locally in the browser. OpenCV.js is vendored in
 * vendor/opencv.js (the official 4.9.0 build from docs.opencv.org — see
 * vendor/README.md for provenance and SHA-256) and the cascade file is
 * vendored in assets/, so the app works fully offline. No image ever
 * leaves the device.
 */
import { blurKernelSize, padRect, meanAbsDiffInRect, meanAbsDiffOutsideRects } from './src/geometry.js';

const OPENCV_JS_URL = 'vendor/opencv.js';
const CASCADE_LOCAL_URL = 'assets/haarcascade_frontalface_default.xml';
const CASCADE_CDN_URL =
  'https://raw.githubusercontent.com/opencv/opencv/4.9.0/data/haarcascades/haarcascade_frontalface_default.xml';
const SAMPLE_URL = 'assets/lena.jpg';

// Detection parameters (OpenCV Haar tutorial defaults, see docs/RESEARCH.md).
const SCALE_FACTOR = 1.1;
const MIN_NEIGHBORS = 5;
const MIN_FACE_SIZE = 30;

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const fileInput = $('fileInput');
const sampleBtn = $('sampleBtn');
const strengthEl = $('strength');
const paddingEl = $('padding');
const showBoxesEl = $('showBoxes');
const anonymizeBtn = $('anonymizeBtn');
const downloadBtn = $('downloadBtn');
const originalCanvas = $('originalCanvas');
const resultCanvas = $('resultCanvas');
const overlayCanvas = $('overlayCanvas');
const reportEl = $('report');
const reportText = $('reportText');

let cv = null;            // OpenCV.js namespace, once initialised
let faceCascade = null;   // cv.CascadeClassifier, once loaded
let imageName = 'image';  // base name used for the downloaded file
let lastFaces = [];       // padded face rects of the last run
let lastRunMs = 0;

/** Verification hook: the Playwright harness reads window.__faceBlur. */
window.__faceBlur = { ready: false, faces: [], metrics: null, error: null };

function setStatus(text) {
  statusEl.textContent = text;
}

/** Load a script tag and resolve when it has executed. */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });
}

/** Fetch a URL as bytes and write it into the Emscripten virtual FS. */
async function fetchToFs(url, fsPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  cv.FS_createDataFile('/', fsPath, buf, true, false, false);
}

/** Initialise OpenCV.js and the Haar cascade. Runs once at page load. */
async function initOpenCv() {
  // The onRuntimeInitialized hook MUST be registered before the script
  // loads: OpenCV.js (Emscripten) calls it once the WASM runtime is up,
  // and registering it afterwards is a race that usually loses.
  // INITIAL_MEMORY caps the WASM heap at 64 MB (the build default is far
  // larger). Face detection + Gaussian blur on a 512x512 photo needs only
  // a few MB, and the cap keeps the app alive on low-memory machines.
  const runtimeReady = new Promise((resolve) => {
    window.Module = {
      INITIAL_MEMORY: 64 * 1024 * 1024,
      onRuntimeInitialized: () => resolve(window.cv),
    };
  });
  await loadScript(OPENCV_JS_URL);
  cv = await runtimeReady;

  // Cascade: prefer the local copy shipped in assets/ (works offline after
  // cloning); fall back to the OpenCV GitHub raw file.
  try {
    await fetchToFs(CASCADE_LOCAL_URL, 'haarcascade_frontalface_default.xml');
  } catch (e) {
    setStatus(`Local cascade not found, fetching from CDN… (${e.message})`);
    await fetchToFs(CASCADE_CDN_URL, 'haarcascade_frontalface_default.xml');
  }
  faceCascade = new cv.CascadeClassifier();
  if (!faceCascade.load('haarcascade_frontalface_default.xml')) {
    throw new Error('CascadeClassifier.load() failed');
  }
  window.__faceBlur.ready = true;
  setStatus('OpenCV ready — load a photo or the sample, then press Anonymize.');
}

/** Draw an image (HTMLImageElement / blob URL) onto the original canvas. */
async function loadImageIntoCanvas(src, name) {
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error(`could not load image ${name}`));
    img.src = src;
  });
  originalCanvas.width = img.naturalWidth;
  originalCanvas.height = img.naturalHeight;
  resultCanvas.width = img.naturalWidth;
  resultCanvas.height = img.naturalHeight;
  overlayCanvas.width = img.naturalWidth;
  overlayCanvas.height = img.naturalHeight;
  const ctx = originalCanvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  // Clear any previous result.
  resultCanvas.getContext('2d').drawImage(img, 0, 0);
  overlayCanvas.getContext('2d').clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  imageName = name.replace(/\.[^.]+$/, '') || 'image';
  lastFaces = [];
  window.__faceBlur.faces = [];
  window.__faceBlur.metrics = null;
  downloadBtn.disabled = true;
  reportEl.hidden = true;
  anonymizeBtn.disabled = false;
  setStatus(`Loaded “${name}” (${img.naturalWidth}×${img.naturalHeight}). Press Anonymize.`);
}

/** Detect faces in the original canvas. Returns plain {x,y,width,height} rects. */
function detectFaces() {
  const src = cv.imread(originalCanvas);
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  cv.equalizeHist(gray, gray);
  const faces = new cv.RectVector();
  const minSize = new cv.Size(MIN_FACE_SIZE, MIN_FACE_SIZE);
  faceCascade.detectMultiScale(gray, faces, SCALE_FACTOR, MIN_NEIGHBORS, 0, minSize);
  const out = [];
  for (let i = 0; i < faces.size(); i++) {
    const r = faces.get(i);
    out.push({ x: r.x, y: r.y, width: r.width, height: r.height });
  }
  src.delete(); gray.delete(); faces.delete(); minSize.delete();
  return out;
}

/** Blur every padded face rectangle in place on the result canvas. */
function blurFaces(faces, strength, padding) {
  const src = cv.imread(resultCanvas);
  const w = src.cols;
  const h = src.rows;
  const padded = faces.map((r) => padRect(r, padding, w, h));
  for (const r of padded) {
    const k = blurKernelSize(r.width, strength);
    const roi = src.roi(new cv.Rect(r.x, r.y, r.width, r.height));
    const blurred = new cv.Mat();
    cv.GaussianBlur(roi, blurred, new cv.Size(k, k), 0, 0, cv.BORDER_DEFAULT);
    blurred.copyTo(roi);
    roi.delete(); blurred.delete();
  }
  cv.imshow(resultCanvas, src);
  src.delete();
  return padded;
}

/** Draw green rectangles around the padded face regions on the overlay. */
function drawBoxes(rects) {
  const ctx = overlayCanvas.getContext('2d');
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (!showBoxesEl.checked) return;
  ctx.strokeStyle = '#20a145';
  ctx.lineWidth = Math.max(2, Math.round(overlayCanvas.width / 256));
  for (const r of rects) {
    ctx.strokeRect(r.x, r.y, r.width, r.height);
  }
}

/** Compare original vs. result pixels: blur must change faces, not the rest. */
function measureChange(paddedRects) {
  const octx = originalCanvas.getContext('2d');
  const rctx = resultCanvas.getContext('2d');
  const w = originalCanvas.width;
  const h = originalCanvas.height;
  const orig = octx.getImageData(0, 0, w, h).data;
  const res = rctx.getImageData(0, 0, w, h).data;
  const inside = paddedRects.map((r) => meanAbsDiffInRect(orig, res, w, r));
  return {
    meanAbsDiffInside: inside,
    meanAbsDiffInsideAvg: inside.length ? inside.reduce((a, b) => a + b, 0) / inside.length : 0,
    meanAbsDiffOutside: meanAbsDiffOutsideRects(orig, res, w, h, paddedRects),
  };
}

async function anonymize() {
  if (!cv || !faceCascade) return;
  anonymizeBtn.disabled = true;
  setStatus('Detecting faces…');
  // Let the status paint before the (synchronous) OpenCV work starts.
  await new Promise((r) => setTimeout(r, 30));
  const t0 = performance.now();
  // Start from a fresh copy of the original so re-runs don't stack blur.
  resultCanvas.getContext('2d').drawImage(originalCanvas, 0, 0);
  const faces = detectFaces();
  const strength = strengthEl.value / 100;
  const padding = paddingEl.value / 100;
  const padded = blurFaces(faces, strength, padding);
  drawBoxes(padded);
  lastRunMs = performance.now() - t0;
  lastFaces = padded;
  const metrics = measureChange(padded);
  const kernelSizes = padded.map((r) => blurKernelSize(r.width, strength));
  const report = {
    image: imageName,
    imageSize: [originalCanvas.width, originalCanvas.height],
    facesDetected: faces.length,
    faces,
    paddedFaces: padded,
    blurStrength: strength,
    padding,
    kernelSizes,
    detectionMs: Math.round(lastRunMs),
    meanAbsDiffInsideAvg: Number(metrics.meanAbsDiffInsideAvg.toFixed(2)),
    meanAbsDiffInside: metrics.meanAbsDiffInside.map((v) => Number(v.toFixed(2))),
    meanAbsDiffOutside: Number(metrics.meanAbsDiffOutside.toFixed(4)),
  };
  window.__faceBlur.faces = faces;
  window.__faceBlur.metrics = report;
  reportText.textContent = JSON.stringify(report, null, 2);
  reportEl.hidden = false;
  downloadBtn.disabled = faces.length === 0;
  anonymizeBtn.disabled = false;
  setStatus(
    faces.length === 0
      ? 'No faces detected — try another photo.'
      : `${faces.length} face${faces.length > 1 ? 's' : ''} detected and blurred ` +
        `in ${Math.round(lastRunMs)} ms. Mean pixel change inside face: ` +
        `${report.meanAbsDiffInsideAvg}, outside: ${report.meanAbsDiffOutside}.`,
  );
}

function downloadResult() {
  resultCanvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${imageName}-blurred.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, 'image/png');
}

function syncLabels() {
  $('strengthOut').textContent = `${strengthEl.value}%`;
  $('paddingOut').textContent = `${paddingEl.value}%`;
}

strengthEl.addEventListener('input', syncLabels);
paddingEl.addEventListener('input', syncLabels);
showBoxesEl.addEventListener('change', () => drawBoxes(lastFaces));
fileInput.addEventListener('change', () => {
  const f = fileInput.files[0];
  if (!f) return;
  loadImageIntoCanvas(URL.createObjectURL(f), f.name).catch((e) => {
    window.__faceBlur.error = String(e);
    setStatus(`Error: ${e.message}`);
  });
});
sampleBtn.addEventListener('click', () => {
  loadImageIntoCanvas(SAMPLE_URL, 'lena.jpg').catch((e) => {
    window.__faceBlur.error = String(e);
    setStatus(`Error: ${e.message}`);
  });
});
anonymizeBtn.addEventListener('click', () => {
  anonymize().catch((e) => {
    window.__faceBlur.error = String(e);
    setStatus(`Error: ${e.message}`);
    anonymizeBtn.disabled = false;
  });
});
downloadBtn.addEventListener('click', downloadResult);

syncLabels();
initOpenCv().catch((e) => {
  window.__faceBlur.error = String(e);
  setStatus(`Failed to initialise OpenCV: ${e.message}.`);
});
