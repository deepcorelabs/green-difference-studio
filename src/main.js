import "nouislider/dist/nouislider.css";
import "./styles.css";

import iro from "@jaames/iro";
import noUiSlider from "nouislider";
import { Muxer, ArrayBufferTarget } from "webm-muxer";
import { CurveEditor } from "./curveEditor.js";
import { detectExportSupport } from "./export.js";
import { ChromaKeyRenderer } from "./shaderPipeline.js";
import {
  clamp,
  estimateFrameCount,
  formatTime,
  frameToTime,
  timeToFrame,
} from "./timeline.js";

const DEFAULT_FPS = 30;
const SEEK_TIMEOUT_MS = 4000;

const el = {
  app: document.querySelector(".app"),
  videoInput: document.querySelector("#video-input"),
  sourceDropZone: document.querySelector("#source-drop-zone"),
  replaceMediaButton: document.querySelector("#replace-media-button"),
  dropHint: document.querySelector("#drop-hint"),
  processButton: document.querySelector("#process-button"),
  exportWebmButton: document.querySelector("#export-webm-button"),
  exportAlphaButton: document.querySelector("#export-alpha-button"),
  exportPngButton: document.querySelector("#export-png-button"),
  exportAlphaPngButton: document.querySelector("#export-alpha-png-button"),
  playToggle: document.querySelector("#play-toggle"),
  playTogglePath: document.querySelector("#play-toggle-path"),
  goToStart: document.querySelector("#go-to-start"),
  stepBackward: document.querySelector("#step-backward"),
  stepForward: document.querySelector("#step-forward"),
  loopToggle: document.querySelector("#loop-toggle"),
  sourceCanvas: document.querySelector("#source-canvas"),
  processedCanvas: document.querySelector("#processed-canvas"),
  sourceVideo: document.querySelector("#source-video"),
  sourceImage: document.querySelector("#source-image"),
  videoName: document.querySelector("#video-name"),
  metaInfo: document.querySelector("#meta-info"),
  currentTime: document.querySelector("#current-time"),
  totalTime: document.querySelector("#total-time"),
  statusDot: document.querySelector("#status-dot"),
  statusText: document.querySelector("#status-text"),
  processingFill: document.querySelector("#processing-fill"),
  processStatusText: document.querySelector("#process-status-text"),
  exportSupport: document.querySelector("#export-support"),
  timelineContainer: document.querySelector("#timeline-container"),
  timelineThumbs: document.querySelector("#timeline-thumbs"),
  timelineBuffer: document.querySelector("#timeline-buffer"),
  timelinePlayed: document.querySelector("#timeline-played"),
  timelinePlayhead: document.querySelector("#timeline-playhead"),
  thresholdOutput: document.querySelector("#threshold-output"),
  thresholdSliderMount: document.querySelector("#threshold-slider"),
  curveEditorMount: document.querySelector("#curve-editor-mount"),
  spillOutput: document.querySelector("#spill-output"),
  despillOutput: document.querySelector("#despill-output"),
  despillDepthOutput: document.querySelector("#despill-depth-output"),
  chokeOutput: document.querySelector("#choke-output"),
  featherOutput: document.querySelector("#feather-output"),
  hueOutput: document.querySelector("#hue-output"),
  satOutput: document.querySelector("#sat-output"),
  lightOutput: document.querySelector("#light-output"),
  busyOverlay: document.querySelector("#busy-overlay"),
  busyTitle: document.querySelector("#busy-title"),
  busyDetail: document.querySelector("#busy-detail"),
  busyProgressFill: document.querySelector("#busy-progress-fill"),
  busyCancelButton: document.querySelector("#busy-cancel-button"),
  processedViewer: document.querySelector("#processed-viewer"),
  colorPickerMount: document.querySelector("#color-picker-mount"),
  colorPickerPopover: document.querySelector("#color-picker-popover"),
  customSwatch: document.querySelector("#custom-swatch"),
  exportTrigger: document.querySelector("#export-trigger"),
  exportDropdown: document.querySelector("#export-dropdown"),
  sampleHelp: document.querySelector("#sample-help"),
  sampleSwatches: document.querySelector("#sample-swatches"),
  pickSampleButton: document.querySelector("#pick-sample-button"),
  sampleSimilarityGroup: document.querySelector("#sample-similarity-group"),
  sampleSimilarityOutput: document.querySelector("#sample-similarity-output"),
  recordTrackerBtn: document.querySelector("#record-tracker-btn"),
  trackerList: document.querySelector("#tracker-list"),
  countdownOverlay: document.querySelector("#countdown-overlay"),
  countdownNumber: document.querySelector("#countdown-number"),
};

const sourceCtx = el.sourceCanvas.getContext("2d", { alpha: false });
const renderer = new ChromaKeyRenderer({ processedCanvas: el.processedCanvas });
const exportSupport = detectExportSupport();
const BACKGROUND_CLASSES = [
  "processed-bg-dark-checker",
  "processed-bg-light-checker",
  "processed-bg-gray",
  "processed-bg-black",
  "processed-bg-white",
  "processed-bg-custom",
];

const state = {
  sourceUrl: null,
  sourceName: "",
  isImage: false,
  width: 0,
  height: 0,
  duration: 0,
  fps: DEFAULT_FPS,
  frameCount: 0,
  playing: false,
  processing: false,
  abortProcessing: false,
  exporting: false,
  processedFramesCount: 0,
  colorWebmBlob: null,
  matteWebmBlob: null,
  rafId: 0,
  scrubbing: false,
  playbackRate: 1,
  loop: false,
  viewMode: "composite",
  restoreViewMode: "composite",
  keyMode: "auto",
  samplingActive: false,
  sampleSimilarity: 0.1,
  sampledColors: [],
  frameCache: [],
  trackers: [],
  recording: false,
};

// ── Threshold Mode ──

let thresholdMode = "simple"; // "simple" | "advanced"

const curveEditor = new CurveEditor(document.querySelector("#curve-editor-mount"), {
  onChange: () => { if (thresholdMode === "advanced") applySettings(); },
});

function smoothstepLUT(low, high) {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    if (t <= low) { lut[i] = 255; }
    else if (t >= high) { lut[i] = 0; }
    else {
      const s = (t - low) / (high - low);
      lut[i] = Math.round((1 - s * s * (3 - 2 * s)) * 255);
    }
  }
  return lut;
}

// ── noUiSlider ──

const thresholdSlider = noUiSlider.create(document.querySelector("#threshold-slider"), {
  start: [0.0, 0.15],
  connect: true,
  range: { min: 0, max: 1 },
  step: 0.0001,
});

const spillSlider = noUiSlider.create(document.querySelector("#spill-slider"), {
  start: [0.12],
  connect: [true, false],
  range: { min: 0, max: 2 },
  step: 0.001,
});

const despillSlider = noUiSlider.create(document.querySelector("#despill-slider"), {
  start: [0.08],
  connect: [true, false],
  range: { min: 0, max: 1 },
  step: 0.001,
});

const despillDepthSlider = noUiSlider.create(document.querySelector("#despill-depth-slider"), {
  start: [0],
  connect: [true, false],
  range: { min: 0, max: 200 },
  step: 0.1,
});

const chokeSlider = noUiSlider.create(document.querySelector("#choke-slider"), {
  start: [0],
  connect: [true, false],
  range: { min: -2, max: 2 },
  step: 0.001,
});

const featherSlider = noUiSlider.create(document.querySelector("#feather-slider"), {
  start: [0],
  connect: [true, false],
  range: { min: 0, max: 8 },
  step: 0.05,
});

const hueSlider = noUiSlider.create(document.querySelector("#hue-slider"), {
  start: [80, 160],
  connect: true,
  range: { min: 0, max: 360 },
  step: 1,
});

const satSlider = noUiSlider.create(document.querySelector("#sat-slider"), {
  start: [0.15],
  connect: [true, false],
  range: { min: 0, max: 1 },
  step: 0.01,
});

const lightSlider = noUiSlider.create(document.querySelector("#light-slider"), {
  start: [0.05, 0.95],
  connect: true,
  range: { min: 0, max: 1 },
  step: 0.01,
});

const sampleSimilaritySlider = noUiSlider.create(document.querySelector("#sample-similarity-slider"), {
  start: [0.1],
  connect: [true, false],
  range: { min: 0, max: 0.5 },
  step: 0.001,
});

function getSettings() {
  let curveLUT;
  if (thresholdMode === "simple") {
    const [low, high] = thresholdSlider.get(true);
    curveLUT = smoothstepLUT(low, high);
  } else {
    curveLUT = curveEditor.getLUT();
  }
  return {
    curveLUT,
    spillSuppression: spillSlider.get(true),
    despillLift: despillSlider.get(true),
    despillDepth: despillDepthSlider.get(true),
    choke: chokeSlider.get(true),
    feather: featherSlider.get(true),
    hueRange: hueSlider.get(true),
    satFloor: satSlider.get(true),
    lightRange: lightSlider.get(true),
    viewMode: state.viewMode === "alpha" ? 1 : state.viewMode === "source" ? 2 : 0,
    useSampledKey: state.keyMode === "sampled" && state.sampledColors.length > 0,
    sampleSimilarity: state.sampleSimilarity,
    keyColors: state.sampledColors.map((color) => [color.r / 255, color.g / 255, color.b / 255]),
  };
}

function syncOutputs() {
  const s = getSettings();
  if (thresholdMode === "simple") {
    const [low, high] = thresholdSlider.get(true);
    el.thresholdOutput.textContent = `${low.toFixed(3)} \u2013 ${high.toFixed(3)}`;
  }
  el.spillOutput.textContent = s.spillSuppression.toFixed(3);
  el.despillOutput.textContent = s.despillLift.toFixed(3);
  el.despillDepthOutput.textContent = s.despillDepth.toFixed(1);
  el.chokeOutput.textContent = s.choke.toFixed(3);
  el.featherOutput.textContent = s.feather.toFixed(2);
  el.hueOutput.textContent = `${Math.round(s.hueRange[0])} \u2013 ${Math.round(s.hueRange[1])}`;
  el.satOutput.textContent = s.satFloor.toFixed(2);
  el.lightOutput.textContent = `${s.lightRange[0].toFixed(2)} \u2013 ${s.lightRange[1].toFixed(2)}`;
  el.sampleSimilarityOutput.textContent = `${(s.sampleSimilarity * 100).toFixed(1)}%`;
}

function invalidateBuffer(reason) {
  if ((!state.colorWebmBlob && !state.matteWebmBlob) || state.processing || state.exporting) return;
  resetBuffer();
  setStatus(reason ?? "Settings changed. Reprocess to export.");
}

function applySettings({ invalidate = true } = {}) {
  if (invalidate) {
    invalidateBuffer("Key settings changed. Reprocess to export.");
  }
  syncOutputs();
  renderer.updateSettings(getSettings());
  drawCurrentFrame();
}

thresholdSlider.on("update", () => { if (thresholdMode === "simple") applySettings(); });
spillSlider.on("update", applySettings);
despillSlider.on("update", applySettings);
despillDepthSlider.on("update", applySettings);
chokeSlider.on("update", applySettings);
featherSlider.on("update", applySettings);
hueSlider.on("update", applySettings);
satSlider.on("update", applySettings);
lightSlider.on("update", applySettings);
sampleSimilaritySlider.on("update", (values) => {
  state.sampleSimilarity = Number(values[0]);
  applySettings();
});

document.querySelectorAll("[data-threshold-mode]").forEach((tab) => {
  tab.addEventListener("click", () => {
    thresholdMode = tab.dataset.thresholdMode;
    document.querySelectorAll("[data-threshold-mode]").forEach((t) => t.classList.toggle("active", t === tab));
    el.thresholdSliderMount.hidden = thresholdMode !== "simple";
    el.thresholdOutput.hidden = thresholdMode !== "simple";
    el.curveEditorMount.hidden = thresholdMode !== "advanced";
    applySettings();
  });
});

// ── Helpers ──

function setStatus(msg, busy = false) {
  el.statusText.textContent = msg;
  el.statusDot.classList.toggle("busy", busy);
}

function showBusy(title, detail, { cancelable = false } = {}) {
  el.busyTitle.textContent = title;
  el.busyDetail.textContent = detail;
  setBusyProgress(0, 0, 0);
  el.busyCancelButton.hidden = !cancelable;
  el.busyOverlay.hidden = false;
}

function setBusyProgress(progress, current, total) {
  el.busyProgressFill.style.width = `${Math.round(progress * 100)}%`;
  el.busyDetail.textContent = total > 0
    ? `Frame ${current} / ${total} (${Math.round(progress * 100)}%)`
    : "Please be patient...";
}

function hideBusy() {
  el.busyOverlay.hidden = true;
}

function setBusyMessage(title, detail, { cancelable } = {}) {
  if (title != null) el.busyTitle.textContent = title;
  if (detail != null) el.busyDetail.textContent = detail;
  if (typeof cancelable === "boolean") {
    el.busyCancelButton.hidden = !cancelable;
  }
}

function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function setCanvasSize(w, h) {
  state.width = w;
  state.height = h;
  el.sourceCanvas.width = w;
  el.sourceCanvas.height = h;
  renderer.setSize(w, h);
  const ar = `${w} / ${h}`;
  el.sourceCanvas.style.aspectRatio = ar;
  el.processedCanvas.style.aspectRatio = ar;
}

function updateMeta() {
  el.videoName.textContent = state.sourceName || "";
  if (!state.sourceUrl) {
    el.metaInfo.textContent = "";
    el.currentTime.textContent = "--:--";
    el.totalTime.textContent = "--:--";
    return;
  }
  if (state.isImage) {
    el.metaInfo.textContent = `${state.width}\u00d7${state.height}`;
    el.currentTime.textContent = "";
    el.totalTime.textContent = "";
  } else {
    el.metaInfo.textContent = `${state.width}\u00d7${state.height}  ${state.fps.toFixed(1)}fps  ${state.frameCount}f`;
    el.totalTime.textContent = formatTime(state.duration);
  }
}

const busy = () => state.processing || state.exporting;

function updateButtons() {
  const hasSource = Boolean(state.sourceUrl);
  const hasBuffer = state.colorWebmBlob != null || state.matteWebmBlob != null;

  el.replaceMediaButton.textContent = hasSource ? "Replace Media" : "Upload Media";

  el.goToStart.disabled = !hasSource || state.isImage || busy();
  el.loopToggle.disabled = !hasSource || state.isImage;
  el.loopToggle.classList.toggle("active", state.loop);

  if (state.isImage) {
    el.processButton.disabled = true;
    el.playToggle.disabled = true;
    el.stepBackward.disabled = true;
    el.stepForward.disabled = true;
    el.exportWebmButton.disabled = true;
    el.exportAlphaButton.disabled = true;
    el.exportPngButton.disabled = !hasSource;
    el.exportAlphaPngButton.disabled = !hasSource;
    el.exportPngButton.hidden = false;
    el.exportAlphaPngButton.hidden = false;
    el.exportWebmButton.hidden = true;
    el.exportAlphaButton.hidden = true;
  } else {
    el.processButton.textContent = state.processing ? "Cancel" : "Process";
    el.processButton.disabled = !hasSource || state.exporting;
    el.playToggle.disabled = !hasSource || busy();
    el.stepBackward.disabled = !hasSource || busy();
    el.stepForward.disabled = !hasSource || busy();
    el.exportWebmButton.disabled = !hasBuffer || busy() || !exportSupport.color.supported;
    el.exportAlphaButton.disabled = !hasBuffer || busy() || !exportSupport.alpha.supported;
    el.exportPngButton.disabled = true;
    el.exportAlphaPngButton.disabled = true;
    el.exportPngButton.hidden = true;
    el.exportAlphaPngButton.hidden = true;
    el.exportWebmButton.hidden = false;
    el.exportAlphaButton.hidden = false;
  }

  // Enable the Export trigger button if any export option is available
  const anyExportAvailable = !el.exportWebmButton.disabled || !el.exportAlphaButton.disabled
    || !el.exportPngButton.disabled || !el.exportAlphaPngButton.disabled;
  el.exportTrigger.disabled = !anyExportAvailable;

  el.playTogglePath.setAttribute(
    "d",
    state.playing ? "M7 5H10V19H7V5ZM14 5H17V19H14V5Z" : "M8 5.5V18.5L18 12L8 5.5Z",
  );

  el.sourceDropZone.classList.toggle("has-video", hasSource);
  el.recordTrackerBtn.disabled = !hasSource || state.recording || busy();
}

function updateProgress(progress, total = state.frameCount, current = state.processedFramesCount) {
  const pct = Math.round(progress * 100);
  el.processingFill.style.width = `${pct}%`;
  el.processStatusText.textContent = current > 0 ? `${current} frames (${pct}%)` : `0 frames`;
}

function updateExportUI() {
  const parts = [];
  parts.push(exportSupport.color.supported ? `Color: ${exportSupport.color.mimeType}` : "Color WebM: unavailable");
  parts.push(exportSupport.alpha.supported ? "Matte: available" : "Matte: unavailable");
  el.exportSupport.textContent = parts.join(" \u00b7 ");
}

function renderSampleSwatches() {
  if (!state.sampledColors.length) {
    el.sampleSwatches.innerHTML = '<span class="sample-empty">No sampled colors yet.</span>';
  } else {
    el.sampleSwatches.innerHTML = state.sampledColors
      .map(
        (color, index) =>
          `<button class="sample-swatch" data-sample-index="${index}" title="Remove sample ${index + 1}">
            <span class="sample-chip" style="background:${color.hex}"></span>
            <span>${index + 1}</span>
          </button>`,
      )
      .join("");
  }

  el.sampleHelp.textContent =
    state.keyMode === "sampled"
      ? (state.samplingActive
        ? `Crosshair armed. Click source or processed viewer to pick (${state.sampledColors.length}/5).`
        : "Use Pick Color to arm the crosshair. Click a swatch to remove it.")
      : "Sample mode disabled. Switch to Use Samples to pick colors from the source viewer.";

  const canSample = state.keyMode === "sampled" && Boolean(state.sourceUrl) && state.sampledColors.length < 5;
  // Auto-stop picking when we hit 5
  if (state.samplingActive && !canSample) state.samplingActive = false;
  el.sampleSimilarityGroup.hidden = state.keyMode !== "sampled";
  el.pickSampleButton.disabled = state.keyMode !== "sampled" || !Boolean(state.sourceUrl) || state.sampledColors.length >= 5;
  el.pickSampleButton.textContent = state.samplingActive ? "Stop Picking" : "Pick Color";
  el.pickSampleButton.classList.toggle("active", state.samplingActive);
  el.sourceDropZone.classList.toggle("sample-mode", state.samplingActive && canSample);
  el.processedCanvas.classList.toggle("sample-mode-canvas", state.samplingActive && canSample);
}

function setViewMode(mode) {
  state.viewMode = mode;
  document.querySelectorAll("[data-view-mode]").forEach((btn) => btn.classList.toggle("active", btn.dataset.viewMode === mode));
  renderer.updateSettings(getSettings());
  drawCurrentFrame();
}

function setKeyMode(mode) {
  state.keyMode = mode;
  state.samplingActive = false;
  document.querySelectorAll("[data-key-mode]").forEach((btn) => btn.classList.toggle("active", btn.dataset.keyMode === mode));
  invalidateBuffer("Key mode changed. Reprocess to export.");
  renderSampleSwatches();
  renderer.updateSettings(getSettings());
  drawCurrentFrame();
}

function setImageMode(isImage) {
  state.isImage = isImage;
  el.app.classList.toggle("image-mode", isImage);
}

// ── Timeline ──

function setPlayhead(ratio) {
  const p = `${clamp(ratio, 0, 1) * 100}%`;
  el.timelinePlayhead.style.left = p;
  el.timelinePlayed.style.width = p;
}

function updateTimeline(sec) {
  if (!state.sourceUrl) return;
  const r = state.duration > 0 ? clamp(sec / state.duration, 0, 1) : 0;
  if (!state.scrubbing) setPlayhead(r);
  el.currentTime.textContent = formatTime(sec);
}

function timelineRatio(evt) {
  const rect = el.timelineContainer.getBoundingClientRect();
  const x = evt.touches ? evt.touches[0].clientX : evt.clientX;
  return clamp((x - rect.left) / rect.width, 0, 1);
}

let lastScrubRatio = 0;

function findNearestCacheFrame(time) {
  const cache = state.frameCache;
  if (!cache.length) return null;
  let lo = 0, hi = cache.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cache[mid].time <= time) lo = mid;
    else hi = mid - 1;
  }
  if (lo + 1 < cache.length && Math.abs(cache[lo + 1].time - time) < Math.abs(cache[lo].time - time)) {
    return cache[lo + 1];
  }
  return cache[lo];
}

function scrubTo(ratio) {
  lastScrubRatio = ratio;
  setPlayhead(ratio);
  el.currentTime.textContent = formatTime(ratio * state.duration);

  if (state.frameCache.length > 0) {
    const frame = findNearestCacheFrame(ratio * state.duration);
    if (frame) {
      sourceCtx.clearRect(0, 0, state.width, state.height);
      sourceCtx.drawImage(frame.bitmap, 0, 0, state.width, state.height);
      renderer.renderPreview();
    }
  }
}

function onTLDown(e) {
  if (!state.sourceUrl || busy()) return;
  e.preventDefault();
  state.scrubbing = true;
  el.timelineContainer.classList.add("scrubbing");
  if (state.playing) { state.playing = false; el.sourceVideo.pause(); cancelPlaybackLoop(); updateButtons(); }
  scrubTo(timelineRatio(e));
  const onMove = (ev) => { ev.preventDefault(); scrubTo(timelineRatio(ev)); };
  const onUp = () => {
    state.scrubbing = false;
    el.timelineContainer.classList.remove("scrubbing");
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    document.removeEventListener("touchmove", onMove);
    document.removeEventListener("touchend", onUp);
    // After scrub ends, seek video element to match for full-res frame stepping
    seekVideo(lastScrubRatio * state.duration).then(() => drawCurrentFrame()).catch(() => {});
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
  document.addEventListener("touchmove", onMove, { passive: false });
  document.addEventListener("touchend", onUp);
}

el.timelineContainer.addEventListener("mousedown", onTLDown);
el.timelineContainer.addEventListener("touchstart", onTLDown, { passive: false });

// ── Frame Cache ──

const CACHE_WIDTH = 320;

function clearFrameCache() {
  state.frameCache.forEach((f) => f.bitmap?.close());
  state.frameCache = [];
}

async function buildFrameCache() {
  clearFrameCache();

  const cacheH = Math.round(CACHE_WIDTH * state.height / state.width);
  const cacheCanvas = document.createElement("canvas");
  cacheCanvas.width = CACHE_WIDTH;
  cacheCanvas.height = cacheH;
  const cacheCtx = cacheCanvas.getContext("2d");

  showBusy("Preparing Video", "Building frame cache...", { cancelable: false });
  const approxTotal = Math.max(1, state.frameCount);

  // Frame 0
  await seekVideo(0);
  cacheCtx.drawImage(el.sourceVideo, 0, 0, CACHE_WIDTH, cacheH);
  state.frameCache.push({ time: el.sourceVideo.currentTime, bitmap: await createImageBitmap(cacheCanvas) });

  // Play through remaining frames
  while (!el.sourceVideo.ended) {
    const meta = await nextVideoFrame();
    if (!meta) break;

    cacheCtx.drawImage(el.sourceVideo, 0, 0, CACHE_WIDTH, cacheH);
    state.frameCache.push({ time: meta.mediaTime, bitmap: await createImageBitmap(cacheCanvas) });

    if (state.duration > 0) {
      const p = meta.mediaTime / state.duration;
      setBusyProgress(p, state.frameCache.length, approxTotal);
      el.busyDetail.textContent = `Frame ${state.frameCache.length} / ~${approxTotal}`;
    }
  }

  // Derive real FPS/frame count from what we actually got
  if (state.frameCache.length > 1 && state.duration > 0) {
    state.fps = state.frameCache.length / state.duration;
    state.frameCount = state.frameCache.length;
    updateMeta();
  }

  hideBusy();
  buildThumbnailsFromCache();
  await seekVideo(0);
}

function buildThumbnailsFromCache() {
  const canvas = el.timelineThumbs;
  const rect = el.timelineContainer.getBoundingClientRect();
  const totalW = Math.round(rect.width);
  const totalH = Math.round(rect.height);
  canvas.width = totalW;
  canvas.height = totalH;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0a0e12";
  ctx.fillRect(0, 0, totalW, totalH);

  if (!state.frameCache.length || !state.duration) return;

  const thumbH = totalH;
  const thumbW = Math.round(thumbH * (state.width / state.height));
  const count = Math.max(1, Math.ceil(totalW / thumbW));

  for (let i = 0; i < count; i++) {
    const targetTime = (i / count) * state.duration;
    const frame = findNearestCacheFrame(targetTime);
    if (frame) {
      ctx.drawImage(frame.bitmap, Math.round(i * thumbW), 0, thumbW, thumbH);
    }
  }
  drawBufferTimeline();
}

function drawBufferTimeline() {
  const canvas = el.timelineBuffer;
  const rect = el.timelineContainer.getBoundingClientRect();
  canvas.width = Math.round(rect.width);
  canvas.height = 3;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!state.duration || !state.processedFramesCount) return;

  ctx.fillStyle = "rgba(114, 255, 159, 0.8)";
  const ratio = state.processedFramesCount / state.frameCount;
  ctx.fillRect(0, 0, ratio * canvas.width, 3);
}

// ── Seek ──

async function seekVideo(seconds) {
  const target = clamp(seconds, 0, Math.max(0, state.duration - 0.001));
  if (Math.abs(el.sourceVideo.currentTime - target) < 0.001) return;
  await new Promise((resolve) => {
    let tid;
    const done = () => { clearTimeout(tid); el.sourceVideo.removeEventListener("seeked", done); el.sourceVideo.removeEventListener("error", done); resolve(); };
    tid = setTimeout(done, SEEK_TIMEOUT_MS);
    el.sourceVideo.addEventListener("seeked", done, { once: true });
    el.sourceVideo.addEventListener("error", done, { once: true });
    el.sourceVideo.currentTime = target;
  });
  if (el.sourceVideo.paused) await new Promise((r) => setTimeout(r, 10));
}

// ── Draw ──

function drawSourceFrame() {
  if (!state.sourceUrl) return;
  sourceCtx.clearRect(0, 0, state.width, state.height);
  const src = state.isImage ? el.sourceImage : el.sourceVideo;
  sourceCtx.drawImage(src, 0, 0, state.width, state.height);
  drawTrackerOverlays();
}

function drawTrackerOverlays() {
  if (!state.trackers.length) return;
  for (const tracker of state.trackers) {
    if (tracker.samples.length < 2) continue;
    sourceCtx.save();
    sourceCtx.strokeStyle = "rgba(114, 255, 159, 0.7)";
    sourceCtx.lineWidth = 2;
    sourceCtx.lineJoin = "round";
    sourceCtx.beginPath();
    const s0 = tracker.samples[0];
    sourceCtx.moveTo(s0.x * state.width, s0.y * state.height);
    for (let i = 1; i < tracker.samples.length; i++) {
      const s = tracker.samples[i];
      sourceCtx.lineTo(s.x * state.width, s.y * state.height);
    }
    sourceCtx.stroke();
    // Draw start and end dots
    const first = tracker.samples[0];
    const last = tracker.samples[tracker.samples.length - 1];
    sourceCtx.fillStyle = "rgba(114, 255, 159, 0.9)";
    sourceCtx.beginPath();
    sourceCtx.arc(first.x * state.width, first.y * state.height, 4, 0, Math.PI * 2);
    sourceCtx.fill();
    sourceCtx.fillStyle = "rgba(255, 100, 100, 0.9)";
    sourceCtx.beginPath();
    sourceCtx.arc(last.x * state.width, last.y * state.height, 4, 0, Math.PI * 2);
    sourceCtx.fill();
    sourceCtx.restore();
  }
}

function drawCurrentFrame() {
  if (!state.sourceUrl) return;
  syncTrackerUniforms();
  drawSourceFrame();
  renderer.renderPreview();
  if (!state.isImage) updateTimeline(el.sourceVideo.currentTime);
}

// ── Playback ──

function cancelPlaybackLoop() { if (state.rafId) { cancelAnimationFrame(state.rafId); state.rafId = 0; } }

function playbackLoop() {
  if (!state.playing) return;
  drawCurrentFrame();
  state.rafId = requestAnimationFrame(playbackLoop);
}

async function pausePlayback() {
  state.playing = false;
  el.sourceVideo.pause();
  cancelPlaybackLoop();
  updateButtons();
}

async function togglePlayback() {
  if (!state.sourceUrl || state.isImage || busy()) return;
  if (state.playing) { await pausePlayback(); drawCurrentFrame(); return; }
  state.playing = true;
  el.sourceVideo.playbackRate = state.playbackRate;
  await el.sourceVideo.play();
  updateButtons();
  playbackLoop();
}

async function stepFrame(dir) {
  if (!state.sourceUrl || state.isImage || busy()) return;
  await pausePlayback();
  const cur = timeToFrame(el.sourceVideo.currentTime, state.fps);
  const tgt = clamp(cur + dir, 0, Math.max(0, state.frameCount - 1));
  await seekVideo(frameToTime(tgt, state.fps));
  drawCurrentFrame();
}

// ── Speed ──

document.querySelectorAll(".speed-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const rate = parseFloat(btn.dataset.speed);
    if (!Number.isFinite(rate) || rate <= 0) return;
    state.playbackRate = rate;
    el.sourceVideo.playbackRate = rate;
    document.querySelectorAll(".speed-btn").forEach((b) => b.classList.toggle("active", b === btn));
  });
});

// ── Buffer ──

function resetBuffer() {
  state.processedFramesCount = 0;
  state.colorWebmBlob = null;
  state.matteWebmBlob = null;
  updateProgress(0, state.frameCount, 0);
  drawBufferTimeline();
  updateButtons();
}

// ── Load ──

async function loadVideo(file) {
  await pausePlayback();
  resetBuffer();
  clearFrameCache();
  state.sampledColors = [];
  state.keyMode = "auto";
  state.samplingActive = false;
  state.viewMode = "composite";
  if (state.sourceUrl) { URL.revokeObjectURL(state.sourceUrl); state.sourceUrl = null; }

  el.sourceImage.removeAttribute("src");
  setImageMode(false);

  state.sourceName = file.name;
  state.sourceUrl = URL.createObjectURL(file);
  el.sourceVideo.src = state.sourceUrl;
  el.videoInput.value = "";
  setStatus("Loading...", true);

  await new Promise((resolve, reject) => {
    const ok = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error("Cannot open this file as video.")); };
    const cleanup = () => { el.sourceVideo.removeEventListener("loadedmetadata", ok); el.sourceVideo.removeEventListener("error", fail); };
    el.sourceVideo.addEventListener("loadedmetadata", ok, { once: true });
    el.sourceVideo.addEventListener("error", fail, { once: true });
  });

  state.duration = el.sourceVideo.duration;
  state.fps = DEFAULT_FPS;
  state.frameCount = estimateFrameCount(state.duration, state.fps);
  setCanvasSize(el.sourceVideo.videoWidth, el.sourceVideo.videoHeight);
  renderer.setSource(el.sourceVideo);
  updateMeta();

  setStatus("Building frame cache...", true);
  await buildFrameCache();
  renderSampleSwatches();
  setKeyMode("auto");
  setViewMode("composite");
  drawCurrentFrame();
  updateButtons();
  setStatus("Ready.");
}

async function loadImage(file) {
  await pausePlayback();
  resetBuffer();
  clearFrameCache();
  state.sampledColors = [];
  state.keyMode = "auto";
  state.samplingActive = false;
  state.viewMode = "composite";
  if (state.sourceUrl) { URL.revokeObjectURL(state.sourceUrl); state.sourceUrl = null; }

  el.sourceVideo.removeAttribute("src");
  el.sourceVideo.load();

  state.sourceName = file.name;
  state.sourceUrl = URL.createObjectURL(file);
  el.videoInput.value = "";
  setStatus("Loading image...", true);

  const img = el.sourceImage;
  img.src = state.sourceUrl;
  await new Promise((resolve, reject) => {
    img.onload = () => { img.onload = null; img.onerror = null; resolve(); };
    img.onerror = () => { img.onload = null; img.onerror = null; reject(new Error("Cannot load image.")); };
  });

  state.duration = 0;
  state.fps = 0;
  state.frameCount = 0;
  setCanvasSize(img.naturalWidth, img.naturalHeight);
  renderer.setImageSource(img);
  setImageMode(true);
  updateMeta();
  renderSampleSwatches();
  setKeyMode("auto");
  setViewMode("composite");
  drawCurrentFrame();
  updateButtons();
  setStatus("Ready.");
}

async function handleFile(file) {
  if (!file) return;
  const isImage = file.type.startsWith("image/");
  try {
    if (isImage) {
      await loadImage(file);
    } else {
      await loadVideo(file);
    }
  } catch (e) { console.error(e); setStatus(e.message || "Load failed."); }
}

function sampleColorFromSourceEvent(event, fromProcessed = false) {
  if (!state.sourceUrl || state.keyMode !== "sampled" || !state.samplingActive) return;
  if (state.sampledColors.length >= 5) return;

  // Always sample from the SOURCE canvas — even when clicking on the processed viewer.
  // The processed view is a keyed composite, so we want the original color, not the
  // despilled/neutralized output. We just map the click position to source coordinates.
  const refEl = fromProcessed ? el.processedCanvas : el.sourceCanvas;
  const rect = refEl.getBoundingClientRect();
  const x = Math.floor(clamp((event.clientX - rect.left) / rect.width, 0, 1) * state.width);
  const y = Math.floor(clamp((event.clientY - rect.top) / rect.height, 0, 1) * state.height);

  drawSourceFrame();
  const pixel = sourceCtx.getImageData(x, y, 1, 1).data;
  const r = pixel[0], g = pixel[1], b = pixel[2];
  const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  const color = { r, g, b, hex };

  state.sampledColors = [...state.sampledColors.slice(-4), color];
  // Do NOT deactivate — keep picking mode persistent
  renderSampleSwatches();
  invalidateBuffer("Sampled colors changed. Reprocess to export.");
  renderer.updateSettings(getSettings());
  drawCurrentFrame();
}

// ── Process ──

/**
 * Advance the video by exactly one frame using play → requestVideoFrameCallback → pause.
 * The decoder keeps its sequential state between cycles, so each frame is O(1) to decode.
 * Returns the callback metadata (includes mediaTime) or null if video ended / timed out.
 */
function nextVideoFrame() {
  return new Promise((resolve) => {
    if (el.sourceVideo.ended) { resolve(null); return; }

    let tid;
    let rvfcHandle;

    const cleanup = () => {
      clearTimeout(tid);
      el.sourceVideo.removeEventListener("ended", onEnded);
    };

    const onFrame = (_now, meta) => {
      cleanup();
      el.sourceVideo.pause();
      resolve(meta);
    };

    const onEnded = () => {
      cleanup();
      if (rvfcHandle != null) el.sourceVideo.cancelVideoFrameCallback(rvfcHandle);
      resolve(null);
    };

    tid = setTimeout(() => {
      el.sourceVideo.pause();
      el.sourceVideo.removeEventListener("ended", onEnded);
      if (rvfcHandle != null) el.sourceVideo.cancelVideoFrameCallback(rvfcHandle);
      resolve(null);
    }, 5000);

    el.sourceVideo.addEventListener("ended", onEnded, { once: true });
    rvfcHandle = el.sourceVideo.requestVideoFrameCallback(onFrame);
    el.sourceVideo.play().catch(() => { cleanup(); resolve(null); });
  });
}

async function processVideo() {
  if (!state.sourceUrl || state.isImage || state.processing) return;
  if (typeof VideoEncoder === "undefined") {
    setStatus("VideoEncoder API not available in this browser.");
    return;
  }
  if (!el.sourceVideo.requestVideoFrameCallback) {
    setStatus("requestVideoFrameCallback not supported in this browser.");
    return;
  }

  await pausePlayback();
  resetBuffer();
  state.processing = true;
  state.abortProcessing = false;
  updateButtons();
  showBusy("Processing & Encoding", "", { cancelable: true });
  setStatus("Processing...", true);

  const total = Math.max(1, state.frameCount);
  const fps = state.fps || 30;
  const width = state.width;
  const height = state.height;
  const bitrate = Math.min(18_000_000, Math.max(4_000_000, width * height * fps * 2));
  const keyInterval = Math.max(1, Math.round(fps * 2));

  const codec = "vp8";
  const muxCodec = "V_VP8";

  // --- Color+Alpha WebM via MediaRecorder (Chrome's VP8/VP9 encoder handles alpha natively) ---
  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = width;
  colorCanvas.height = height;
  const colorCtx = colorCanvas.getContext("2d", { alpha: true });
  const colorStream = colorCanvas.captureStream(0);
  const colorTrack = colorStream.getVideoTracks()[0];
  const hasRequestFrame = typeof colorTrack?.requestFrame === "function";

  // Grab audio from source video and add to the output stream
  try {
    const srcStream = el.sourceVideo.captureStream ? el.sourceVideo.captureStream() : el.sourceVideo.mozCaptureStream?.();
    if (srcStream) {
      for (const audioTrack of srcStream.getAudioTracks()) {
        colorStream.addTrack(audioTrack);
      }
    }
  } catch { /* no audio available */ }

  const colorMimeType = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp9", "video/webm;codecs=vp8,opus", "video/webm;codecs=vp8", "video/webm"]
    .find((m) => MediaRecorder.isTypeSupported(m)) || "video/webm";

  const colorRecorder = new MediaRecorder(colorStream, {
    mimeType: colorMimeType,
    videoBitsPerSecond: bitrate,
  });
  const colorChunks = [];
  colorRecorder.ondataavailable = (e) => { if (e.data.size > 0) colorChunks.push(e.data); };
  const colorRecorderDone = new Promise((resolve, reject) => {
    colorRecorder.onstop = () => resolve(new Blob(colorChunks, { type: colorMimeType }));
    colorRecorder.onerror = (e) => reject(e.error ?? new Error("MediaRecorder failed"));
  });
  colorRecorder.start();

  // --- Standalone Matte WebM via VideoEncoder (no alpha needed, fast) ---
  const matteTarget = new ArrayBufferTarget();
  const matteMuxer = new Muxer({ target: matteTarget, video: { codec: muxCodec, width, height } });
  const matteEncoder = new VideoEncoder({
    output: (chunk, meta) => matteMuxer.addVideoChunk(chunk, meta),
    error: (e) => console.error("Matte encoder:", e),
  });
  matteEncoder.configure({ codec, width, height, bitrate, framerate: fps });

  const renderCanvas = document.createElement("canvas");
  renderCanvas.width = width;
  renderCanvas.height = height;

  let frameIndex = 0;
  let latestMediaTime = 0;
  const frameDurationMs = 1000 / fps;

  function encodeCurrentFrame(timestampUs, mediaTimeSec) {
    drawSourceFrame();
    const keyFrame = frameIndex % keyInterval === 0;

    renderer.renderInto(colorCanvas, { alphaBackground: true, viewModeOverride: 0 });
    if (hasRequestFrame) colorTrack.requestFrame();

    renderer.renderInto(renderCanvas, { alphaBackground: false, viewModeOverride: 1 });
    const mf = new VideoFrame(renderCanvas, { timestamp: timestampUs, alpha: "discard" });
    matteEncoder.encode(mf, { keyFrame });
    mf.close();

    frameIndex++;
    latestMediaTime = mediaTimeSec;
    state.processedFramesCount = frameIndex;
    const progress = state.duration > 0 ? Math.min(1, mediaTimeSec / state.duration) : 0;
    updateProgress(progress, frameIndex, frameIndex);
    setBusyProgress(progress, frameIndex, frameIndex);
    if (frameIndex % 15 === 0) drawBufferTimeline();
  }

  try {
    await seekVideo(0);

    // Use performance.now() to pace frames at the correct real-time rate.
    // MediaRecorder timestamps = wall-clock time between requestFrame() calls,
    // so we must wait exactly one frame duration between calls.
    let wallClockStart = performance.now();
    encodeCurrentFrame(Math.round(el.sourceVideo.currentTime * 1_000_000), el.sourceVideo.currentTime);

    let lastMediaTime = el.sourceVideo.currentTime;
    const safetyLimit = total * 2;

    while (!el.sourceVideo.ended && !state.abortProcessing && frameIndex < safetyLimit) {
      const meta = await nextVideoFrame();
      if (!meta) break;

      if (Math.abs(meta.mediaTime - lastMediaTime) < 0.0005) continue;
      lastMediaTime = meta.mediaTime;

      // Wait until the correct wall-clock moment for this frame
      const targetWallTime = wallClockStart + meta.mediaTime * 1000;
      const now = performance.now();
      const waitMs = targetWallTime - now;
      if (waitMs > 1) await new Promise((r) => setTimeout(r, Math.round(waitMs)));

      encodeCurrentFrame(Math.round(meta.mediaTime * 1_000_000), meta.mediaTime);

      // Backpressure: if matte encoder falls behind, wait
      while (matteEncoder.encodeQueueSize > 8) {
        await new Promise((r) => setTimeout(r, 1));
      }
    }

    if (!state.abortProcessing) {
      setBusyProgress(1, frameIndex, frameIndex);

      // Stop MediaRecorder and wait for it to finalize the alpha WebM
      setBusyMessage("Finalizing", "Encoding WebM + Alpha... this may take a moment.", { cancelable: false });
      await nextPaint();
      await new Promise((r) => setTimeout(r, 50));
      if (colorRecorder.state !== "inactive") colorRecorder.stop();
      state.colorWebmBlob = await colorRecorderDone;

      // Flush matte encoder
      setBusyMessage("Finalizing", "Building matte export...", { cancelable: false });
      await nextPaint();
      await new Promise((r) => setTimeout(r, 50));
      await matteEncoder.flush();
      matteMuxer.finalize();
      state.matteWebmBlob = new Blob([matteTarget.buffer], { type: "video/webm" });

      // Update state with real FPS and frame count
      if (frameIndex > 1 && state.duration > 0) {
        state.fps = frameIndex / state.duration;
        state.frameCount = frameIndex;
        updateMeta();
      }
      drawBufferTimeline();
      setStatus(`Done. ${frameIndex} frames at ${state.fps.toFixed(2)} fps.`);
    }
  } catch (e) {
    console.error(e);
    setStatus(e.message || "Processing failed.");
  } finally {
    el.sourceVideo.pause();
    try { if (colorRecorder.state !== "inactive") colorRecorder.stop(); } catch { /* */ }
    try { matteEncoder.close(); } catch { /* */ }
    state.processing = false;
    state.abortProcessing = false;
    hideBusy();
    updateButtons();
    drawCurrentFrame();
  }
}

// ── Export ──

function downloadBlob(blob, name) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(u), 2000);
}

async function exportVideo({ alpha }) {
  const blob = alpha ? state.matteWebmBlob : state.colorWebmBlob;
  if (!blob) { setStatus("Export not available."); return; }
  const label = alpha ? "Matte WebM" : "Color WebM";
  const safe = (state.sourceName || "out").replace(/\.[^.]+$/, "").replace(/[^a-z0-9\-_]+/gi, "_").toLowerCase();
  downloadBlob(blob, `${safe}${alpha ? "_alpha" : ""}.webm`);
  setStatus(`${label} exported.`);
}

function exportImagePng({ matte }) {
  if (!state.sourceUrl || !state.isImage) return;
  drawSourceFrame();
  const canvas = document.createElement("canvas");
  canvas.width = state.width;
  canvas.height = state.height;
  // matte = true → render B&W alpha matte (viewMode 1), matte = false → composite with alpha (viewMode 0)
  renderer.renderInto(canvas, { alphaBackground: !matte, viewModeOverride: matte ? 1 : 0 });
  const safeName = (state.sourceName || "image").replace(/\.[^.]+$/, "").replace(/[^a-z0-9\-_]+/gi, "_").toLowerCase();
  canvas.toBlob((blob) => {
    if (!blob) return;
    downloadBlob(blob, `${safeName}${matte ? "_matte" : ""}.png`);
  }, "image/png");
}

// ── Events ──

el.videoInput.addEventListener("change", (e) => { handleFile(e.target.files?.[0]); });
el.replaceMediaButton.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  el.videoInput.click();
});
["dragenter", "dragover"].forEach((n) => el.sourceDropZone.addEventListener(n, (e) => { e.preventDefault(); el.sourceDropZone.classList.add("drag-active"); }));
["dragleave", "dragend"].forEach((n) => el.sourceDropZone.addEventListener(n, (e) => { e.preventDefault(); el.sourceDropZone.classList.remove("drag-active"); }));
el.sourceDropZone.addEventListener("drop", (e) => { e.preventDefault(); el.sourceDropZone.classList.remove("drag-active"); handleFile(e.dataTransfer?.files?.[0]); });
el.sourceDropZone.addEventListener("click", (e) => {
  if (state.keyMode !== "sampled" || !state.sourceUrl || !state.samplingActive) return;
  e.preventDefault();
  e.stopPropagation();
  sampleColorFromSourceEvent(e, false);
});
el.processedCanvas.addEventListener("click", (e) => {
  if (state.keyMode !== "sampled" || !state.sourceUrl || !state.samplingActive) return;
  e.preventDefault();
  e.stopPropagation();
  sampleColorFromSourceEvent(e, true);
});
el.goToStart.addEventListener("click", async () => {
  if (!state.sourceUrl || state.isImage || busy()) return;
  await pausePlayback();
  await seekVideo(0);
  drawCurrentFrame();
});
el.playToggle.addEventListener("click", togglePlayback);
el.stepBackward.addEventListener("click", () => stepFrame(-1));
el.stepForward.addEventListener("click", () => stepFrame(1));
el.loopToggle.addEventListener("click", () => {
  state.loop = !state.loop;
  el.sourceVideo.loop = state.loop;
  updateButtons();
});
el.processButton.addEventListener("click", () => {
  if (state.processing) {
    state.abortProcessing = true;
  } else {
    processVideo();
  }
});
el.busyCancelButton.addEventListener("click", () => { state.abortProcessing = true; });
el.exportWebmButton.addEventListener("click", () => { closeExportDropdown(); exportVideo({ alpha: false }); });
el.exportAlphaButton.addEventListener("click", () => { closeExportDropdown(); exportVideo({ alpha: true }); });
el.exportPngButton.addEventListener("click", () => { closeExportDropdown(); exportImagePng({ matte: false }); });
el.exportAlphaPngButton.addEventListener("click", () => { closeExportDropdown(); exportImagePng({ matte: true }); });

el.exportTrigger.addEventListener("click", (e) => {
  e.stopPropagation();
  el.exportDropdown.classList.toggle("open");
});

function closeExportDropdown() {
  el.exportDropdown.classList.remove("open");
}

document.addEventListener("click", (e) => {
  if (!e.target.closest(".export-dropdown-wrap")) closeExportDropdown();
});
el.sourceVideo.addEventListener("ended", () => {
  if (state.loop && state.playing) {
    seekVideo(0).then(() => {
      el.sourceVideo.play();
      drawCurrentFrame();
    }).catch(console.error);
  } else {
    pausePlayback().then(() => drawCurrentFrame()).catch(console.error);
  }
});
document.querySelectorAll("[data-view-mode]").forEach((btn) => {
  if (btn.dataset.viewMode === "source") {
    const activateSourcePreview = (event) => {
      event.preventDefault();
      state.restoreViewMode = state.viewMode === "source" ? "composite" : state.viewMode;
      setViewMode("source");
    };
    const deactivateSourcePreview = () => {
      if (state.viewMode === "source") {
        setViewMode(state.restoreViewMode || "composite");
      }
    };

    btn.addEventListener("mousedown", activateSourcePreview);
    btn.addEventListener("touchstart", activateSourcePreview, { passive: false });
    btn.addEventListener("mouseup", deactivateSourcePreview);
    btn.addEventListener("mouseleave", deactivateSourcePreview);
    btn.addEventListener("touchend", deactivateSourcePreview);
    btn.addEventListener("touchcancel", deactivateSourcePreview);
    window.addEventListener("mouseup", deactivateSourcePreview);
    window.addEventListener("touchend", deactivateSourcePreview);
  } else {
    btn.addEventListener("click", () => {
      state.restoreViewMode = btn.dataset.viewMode;
      setViewMode(btn.dataset.viewMode);
    });
  }
});
document.querySelectorAll("[data-key-mode]").forEach((btn) => btn.addEventListener("click", () => setKeyMode(btn.dataset.keyMode)));
el.pickSampleButton.addEventListener("click", () => {
  if (state.keyMode !== "sampled" || !state.sourceUrl) return;
  state.samplingActive = !state.samplingActive;
  renderSampleSwatches();
});
el.sampleSwatches.addEventListener("click", (event) => {
  const button = event.target.closest("[data-sample-index]");
  if (!button) return;
  const index = Number(button.dataset.sampleIndex);
  if (!Number.isInteger(index)) return;
  state.sampledColors.splice(index, 1);
  state.sampledColors = [...state.sampledColors];
  renderSampleSwatches();
  invalidateBuffer("Sampled colors changed. Reprocess to export.");
  renderer.updateSettings(getSettings());
  drawCurrentFrame();
});

window.addEventListener("keydown", (e) => {
  const tag = document.activeElement?.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || document.activeElement?.classList.contains('noUi-handle')) return;

  if (e.code === "Space") {
    e.preventDefault();
    togglePlayback();
  } else if (e.code === "ArrowLeft") {
    e.preventDefault();
    stepFrame(e.shiftKey ? -10 : -1);
  } else if (e.code === "ArrowRight") {
    e.preventDefault();
    stepFrame(e.shiftKey ? 10 : 1);
  } else if (e.code === "Escape") {
    if (state.processing) state.abortProcessing = true;
  } else if (e.code === "Home") {
    e.preventDefault();
    if (state.sourceUrl && !state.isImage && !busy()) {
      pausePlayback().then(() => seekVideo(0)).then(() => drawCurrentFrame()).catch(() => {});
    }
  } else if (e.code === "KeyL") {
    if (state.sourceUrl && !state.isImage) {
      state.loop = !state.loop;
      el.sourceVideo.loop = state.loop;
      updateButtons();
    }
  }
});

// ── Background ──

let customColor = "#e04080";

const colorPicker = new iro.ColorPicker(el.colorPickerMount, {
  width: 160,
  color: customColor,
  borderWidth: 1,
  borderColor: "rgba(255,255,255,0.1)",
  layoutDirection: "vertical",
  layout: [
    { component: iro.ui.Wheel, options: { wheelLightness: false } },
    { component: iro.ui.Slider, options: { sliderType: "value" } },
  ],
});

colorPicker.on("color:change", (color) => {
  customColor = color.hexString;
  el.customSwatch.style.background = customColor;
  const active = document.querySelector('.bg-btn.active');
  if (active?.dataset.bg === "custom") {
    el.processedViewer.style.setProperty("--custom-bg", customColor);
  }
});

function setProcessedBackground(mode) {
  const v = el.processedViewer;
  v.classList.remove(...BACKGROUND_CLASSES);
  v.removeAttribute("style");

  setTimeout(() => {
    switch (mode) {
      case "dark-checker": v.classList.add("processed-bg-dark-checker"); break;
      case "light-checker": v.classList.add("processed-bg-light-checker"); break;
      case "gray": v.classList.add("processed-bg-gray"); break;
      case "black": v.classList.add("processed-bg-black"); break;
      case "white": v.classList.add("processed-bg-white"); break;
      case "custom":
        v.classList.add("processed-bg-custom");
        v.style.setProperty("--custom-bg", customColor);
        break;
    }
  }, 1);

  document.querySelectorAll(".bg-btn").forEach((b) => b.classList.toggle("active", b.dataset.bg === mode));
}

document.querySelectorAll(".bg-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    setProcessedBackground(btn.dataset.bg);
    if (btn.dataset.bg === "custom") {
      const rect = btn.getBoundingClientRect();
      el.colorPickerPopover.style.top = `${rect.bottom + 8}px`;
      el.colorPickerPopover.style.left = `${rect.right - 184}px`; // 160 width + 24 padding
      el.colorPickerPopover.showPopover();
    }
  });
});

setProcessedBackground("dark-checker");
renderSampleSwatches();
setViewMode("composite");
setKeyMode("auto");

// ── Trackers ──

function renderTrackerList() {
  if (!state.trackers.length) {
    el.trackerList.innerHTML = "";
    return;
  }
  el.trackerList.innerHTML = state.trackers
    .map((t, i) =>
      `<div class="tracker-item">
        <span class="tracker-item-name"><span class="tracker-dot"></span>${t.name}</span>
        <div class="tracker-mode-group">
          <button class="tracker-mode-btn ${t.mode === "keep" ? "active keep" : ""}" data-tracker-idx="${i}" data-tmode="keep" title="Keep region">K</button>
          <button class="tracker-mode-btn ${t.mode === "discard" ? "active discard" : ""}" data-tracker-idx="${i}" data-tmode="discard" title="Discard region">D</button>
          <button class="tracker-delete" data-tracker-index="${i}" title="Delete">&times;</button>
        </div>
      </div>`,
    )
    .join("");
}

function getTrackerPositionAtTime(tracker, time) {
  const s = tracker.samples;
  if (!s.length) return null;
  if (time <= s[0].t) return { x: s[0].x, y: s[0].y };
  if (time >= s[s.length - 1].t) return { x: s[s.length - 1].x, y: s[s.length - 1].y };
  let lo = 0, hi = s.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (s[mid].t <= time) lo = mid; else hi = mid;
  }
  const a = s[lo], b = s[hi];
  const t = (time - a.t) / (b.t - a.t);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function syncTrackerUniforms() {
  const time = state.isImage ? 0 : el.sourceVideo.currentTime;
  const active = [];
  for (const tracker of state.trackers) {
    if (tracker.mode === "off" || !tracker.samples.length) continue;
    const pos = getTrackerPositionAtTime(tracker, time);
    if (pos) active.push({ x: pos.x, y: 1.0 - pos.y, mode: tracker.mode });
    if (active.length >= 4) break;
  }
  renderer.updateTrackers(active, 0.15);
}

el.trackerList.addEventListener("click", (e) => {
  // Mode toggle
  const modeBtn = e.target.closest("[data-tmode]");
  if (modeBtn) {
    const idx = Number(modeBtn.dataset.trackerIdx);
    const mode = modeBtn.dataset.tmode;
    if (Number.isInteger(idx) && state.trackers[idx]) {
      state.trackers[idx].mode = state.trackers[idx].mode === mode ? "off" : mode;
      renderTrackerList();
      syncTrackerUniforms();
      drawCurrentFrame();
    }
    return;
  }

  // Delete
  const delBtn = e.target.closest("[data-tracker-index]");
  if (!delBtn) return;
  const idx = Number(delBtn.dataset.trackerIndex);
  if (!Number.isInteger(idx)) return;
  state.trackers.splice(idx, 1);
  renderTrackerList();
  syncTrackerUniforms();
  drawCurrentFrame();
});

function showCountdown() {
  return new Promise((resolve) => {
    el.countdownOverlay.hidden = false;
    let count = 3;
    el.countdownNumber.textContent = count;
    el.countdownNumber.style.animation = "none";
    void el.countdownNumber.offsetWidth;
    el.countdownNumber.style.animation = "";

    const tick = () => {
      count--;
      if (count > 0) {
        el.countdownNumber.textContent = count;
        el.countdownNumber.style.animation = "none";
        void el.countdownNumber.offsetWidth;
        el.countdownNumber.style.animation = "";
        setTimeout(tick, 1000);
      } else {
        el.countdownNumber.textContent = "GO";
        el.countdownNumber.style.animation = "none";
        void el.countdownNumber.offsetWidth;
        el.countdownNumber.style.animation = "";
        setTimeout(() => {
          el.countdownOverlay.hidden = true;
          resolve();
        }, 500);
      }
    };
    setTimeout(tick, 1000);
  });
}

function getTrackerNormPos(e) {
  const targets = [el.sourceCanvas, el.processedCanvas];
  for (const canvas of targets) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
      return {
        x: clamp((clientX - rect.left) / rect.width, 0, 1),
        y: clamp((clientY - rect.top) / rect.height, 0, 1),
      };
    }
  }
  return null;
}

function showTrackerInstructions() {
  return new Promise((resolve) => {
    const modal = document.querySelector("#tracker-instructions");
    const startBtn = document.querySelector("#tracker-instructions-start");
    const cancelBtn = document.querySelector("#tracker-instructions-cancel");
    modal.hidden = false;

    const cleanup = () => { modal.hidden = true; startBtn.removeEventListener("click", onStart); cancelBtn.removeEventListener("click", onCancel); };
    const onStart = () => { cleanup(); resolve(true); };
    const onCancel = () => { cleanup(); resolve(false); };
    startBtn.addEventListener("click", onStart);
    cancelBtn.addEventListener("click", onCancel);
  });
}

function drawLiveTrail(samples, currentIndex) {
  const trailLength = 30;
  const startIdx = Math.max(0, currentIndex - trailLength);
  if (currentIndex - startIdx < 2) return;

  sourceCtx.save();
  sourceCtx.lineWidth = 2;
  sourceCtx.lineJoin = "round";
  sourceCtx.lineCap = "round";

  for (let i = startIdx + 1; i <= currentIndex; i++) {
    const s = samples[i];
    const prev = samples[i - 1];
    if (!s || !prev) continue;
    // Skip segments where either end is untracked
    if (s.x == null || prev.x == null) continue;

    const fade = (i - startIdx) / (currentIndex - startIdx);
    sourceCtx.strokeStyle = `rgba(114, 255, 159, ${fade * 0.8})`;
    sourceCtx.beginPath();
    sourceCtx.moveTo(prev.x * state.width, prev.y * state.height);
    sourceCtx.lineTo(s.x * state.width, s.y * state.height);
    sourceCtx.stroke();
  }

  // Current position dot
  const cur = samples[currentIndex];
  if (cur && cur.x != null) {
    sourceCtx.fillStyle = "rgba(255, 255, 255, 0.9)";
    sourceCtx.beginPath();
    sourceCtx.arc(cur.x * state.width, cur.y * state.height, 5, 0, Math.PI * 2);
    sourceCtx.fill();
    sourceCtx.strokeStyle = "rgba(114, 255, 159, 0.8)";
    sourceCtx.lineWidth = 1.5;
    sourceCtx.stroke();
  }

  sourceCtx.restore();
}

async function startTrackerRecording() {
  if (!state.sourceUrl || state.isImage || state.recording) return;

  await pausePlayback();

  const proceed = await showTrackerInstructions();
  if (!proceed) return;

  state.recording = true;
  el.app.classList.add("tracker-recording");
  updateButtons();

  await seekVideo(0);
  el.sourceVideo.playbackRate = 0.5;
  el.sourceVideo.muted = false;
  drawCurrentFrame();

  const samples = [];
  let lastX = null;
  let lastY = null;
  let mouseDown = false;
  let playbackStarted = false;

  const onMove = (e) => {
    const pos = getTrackerNormPos(e);
    if (pos) { lastX = pos.x; lastY = pos.y; }
  };
  const onDown = (e) => {
    if (e.button !== 0 && !e.touches) return;
    mouseDown = true;
    const pos = getTrackerNormPos(e);
    if (pos) { lastX = pos.x; lastY = pos.y; }
    // First mousedown starts playback
    if (!playbackStarted) {
      playbackStarted = true;
      beginPlayback();
    }
  };
  const onUp = () => { mouseDown = false; };

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mousedown", onDown);
  document.addEventListener("mouseup", onUp);
  document.addEventListener("touchstart", onDown, { passive: true });
  document.addEventListener("touchmove", onMove, { passive: true });
  document.addEventListener("touchend", onUp);

  let playbackResolve;
  const playbackPromise = new Promise((resolve) => { playbackResolve = resolve; });

  function beginPlayback() {
    el.sourceVideo.addEventListener("ended", () => playbackResolve(), { once: true });

    const onFrame = (_now, metadata) => {
      const mediaTime = metadata ? metadata.mediaTime : el.sourceVideo.currentTime;

      if (mouseDown && lastX != null) {
        samples.push({ t: mediaTime, x: lastX, y: lastY });
      } else {
        samples.push({ t: mediaTime, x: null, y: null });
      }

      drawSourceFrame();
      drawLiveTrail(samples, samples.length - 1);
      renderer.renderPreview();
      updateTimeline(mediaTime);

      if (!el.sourceVideo.ended && !el.sourceVideo.paused) {
        el.sourceVideo.requestVideoFrameCallback(onFrame);
      }
    };

    el.sourceVideo.requestVideoFrameCallback(onFrame);
    el.sourceVideo.play().catch(() => playbackResolve());
  }

  await playbackPromise;

  // Cleanup listeners
  document.removeEventListener("mousemove", onMove);
  document.removeEventListener("mousedown", onDown);
  document.removeEventListener("mouseup", onUp);
  document.removeEventListener("touchstart", onDown);
  document.removeEventListener("touchmove", onMove);
  document.removeEventListener("touchend", onUp);

  el.sourceVideo.pause();
  el.sourceVideo.playbackRate = state.playbackRate;
  state.recording = false;
  el.app.classList.remove("tracker-recording");

  // Interpolate gaps between tracked segments
  const tracked = [];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (s.x != null) {
      tracked.push(s);
    } else {
      let prevIdx = -1, nextIdx = -1;
      for (let j = i - 1; j >= 0; j--) { if (samples[j].x != null) { prevIdx = j; break; } }
      for (let j = i + 1; j < samples.length; j++) { if (samples[j].x != null) { nextIdx = j; break; } }
      if (prevIdx >= 0 && nextIdx >= 0) {
        const p = samples[prevIdx], n = samples[nextIdx];
        const t = (i - prevIdx) / (nextIdx - prevIdx);
        tracked.push({ t: s.t, x: p.x + (n.x - p.x) * t, y: p.y + (n.y - p.y) * t });
      } else if (prevIdx >= 0) {
        tracked.push({ t: s.t, x: samples[prevIdx].x, y: samples[prevIdx].y });
      }
    }
  }

  if (tracked.length > 0) {
    state.trackers.push({ name: `Tracker ${state.trackers.length + 1}`, samples: tracked, mode: "off" });
  }

  renderTrackerList();
  updateButtons();
  await seekVideo(0);
  drawCurrentFrame();
}

el.recordTrackerBtn.addEventListener("click", startTrackerRecording);

// ── Init ──

updateExportUI();
updateMeta();
updateButtons();
updateProgress(0, 0);
syncOutputs();

// Welcome modal
const welcomeModal = document.querySelector("#welcome-modal");
const welcomeDemo = document.querySelector("#welcome-demo");

async function loadDemoFile() {
  welcomeModal.hidden = true;
  try {
    const res = await fetch("/input.mp4");
    const blob = await res.blob();
    await handleFile(new File([blob], "input.mp4", { type: "video/mp4" }));
    el.sourceVideo.muted = false;
    togglePlayback();
  } catch (e) {
    console.error("Demo load failed:", e);
    setStatus("Could not load demo file.");
  }
}

fetch("/input.mp4", { method: "HEAD" }).then((res) => {
  if (res.ok) {
    welcomeModal.hidden = false;
    welcomeDemo.addEventListener("click", loadDemoFile);
  }
}).catch(() => {});

el.videoInput.addEventListener("change", () => { welcomeModal.hidden = true; }, { once: true });
