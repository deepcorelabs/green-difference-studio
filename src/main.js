import "nouislider/dist/nouislider.css";
import "./styles.css";

import iro from "@jaames/iro";
import noUiSlider from "nouislider";
import { detectExportSupport, recordBufferedFrames } from "./export.js";
import { ChromaKeyRenderer } from "./shaderPipeline.js";
import {
  clamp,
  estimateFrameCount,
  findBufferedFrame,
  formatTime,
  frameToTime,
  timeToFrame,
} from "./timeline.js";

const DEFAULT_FPS = 30;
const SEEK_TIMEOUT_MS = 4000;

const el = {
  videoInput: document.querySelector("#video-input"),
  sourceDropZone: document.querySelector("#source-drop-zone"),
  dropHint: document.querySelector("#drop-hint"),
  processButton: document.querySelector("#process-button"),
  exportWebmButton: document.querySelector("#export-webm-button"),
  exportAlphaButton: document.querySelector("#export-alpha-button"),
  playToggle: document.querySelector("#play-toggle"),
  playIcon: document.querySelector("#play-icon"),
  pauseIcon: document.querySelector("#pause-icon"),
  stepBackward: document.querySelector("#step-backward"),
  stepForward: document.querySelector("#step-forward"),
  sourceCanvas: document.querySelector("#source-canvas"),
  processedCanvas: document.querySelector("#processed-canvas"),
  sourceVideo: document.querySelector("#source-video"),
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
  spillOutput: document.querySelector("#spill-output"),
  despillOutput: document.querySelector("#despill-output"),
  busyOverlay: document.querySelector("#busy-overlay"),
  busyTitle: document.querySelector("#busy-title"),
  busyDetail: document.querySelector("#busy-detail"),
  processedViewer: document.querySelector("#processed-viewer"),
  colorPickerMount: document.querySelector("#color-picker-mount"),
  colorPickerPopover: document.querySelector("#color-picker-popover"),
  customSwatch: document.querySelector("#custom-swatch"),
  wrapExportWebm: document.querySelector("#wrap-export-webm"),
  wrapExportAlpha: document.querySelector("#wrap-export-alpha"),
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
  width: 0,
  height: 0,
  duration: 0,
  fps: DEFAULT_FPS,
  frameCount: 0,
  playing: false,
  processing: false,
  abortProcessing: false,
  exporting: false,
  bufferedFrames: [],
  rafId: 0,
  scrubbing: false,
  playbackRate: 1,
};

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

function getSettings() {
  const [low, high] = thresholdSlider.get(true);
  return {
    thresholdLow: low,
    thresholdHigh: high,
    spillSuppression: spillSlider.get(true),
    despillLift: despillSlider.get(true),
  };
}

function syncOutputs() {
  const s = getSettings();
  el.thresholdOutput.textContent = `${s.thresholdLow.toFixed(3)} \u2013 ${s.thresholdHigh.toFixed(3)}`;
  el.spillOutput.textContent = s.spillSuppression.toFixed(3);
  el.despillOutput.textContent = s.despillLift.toFixed(3);
}

function applySettings() {
  syncOutputs();
  renderer.updateSettings(getSettings());
  drawCurrentFrame();
}

thresholdSlider.on("update", applySettings);
spillSlider.on("update", applySettings);
despillSlider.on("update", applySettings);

// ── Helpers ──

function setStatus(msg, busy = false) {
  el.statusText.textContent = msg;
  el.statusDot.classList.toggle("busy", busy);
}

function showBusy(title, detail) {
  el.busyTitle.textContent = title;
  el.busyDetail.textContent = detail;
  el.busyOverlay.hidden = false;
}

function hideBusy() {
  el.busyOverlay.hidden = true;
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
  el.metaInfo.textContent = `${state.width}\u00d7${state.height}  ${state.fps.toFixed(1)}fps  ${state.frameCount}f`;
  el.totalTime.textContent = formatTime(state.duration);
}

const busy = () => state.processing || state.exporting;

function updateButtons() {
  const hasVideo = Boolean(state.sourceUrl);
  const hasBuffer = state.bufferedFrames.length > 0;

  el.processButton.textContent = state.processing ? "Cancel" : "Process Frames";
  el.processButton.disabled = !hasVideo || state.exporting;

  el.playToggle.disabled = !hasVideo || busy();
  el.stepBackward.disabled = !hasVideo || busy();
  el.stepForward.disabled = !hasVideo || busy();
  el.exportWebmButton.disabled = !hasBuffer || busy() || !exportSupport.color.supported;
  el.exportAlphaButton.disabled = !hasBuffer || busy() || !exportSupport.alpha.supported;

  el.wrapExportWebm.dataset.tip = !exportSupport.color.supported ? "WebM export not supported in this browser." : (!hasBuffer ? "Process frames first to enable export." : "");
  el.wrapExportAlpha.dataset.tip = !exportSupport.alpha.supported ? "Alpha WebM export not supported in this browser." : (!hasBuffer ? "Process frames first to enable export." : "");

  el.playIcon.hidden = state.playing;
  el.pauseIcon.hidden = !state.playing;

  el.sourceDropZone.classList.toggle("has-video", hasVideo);
}

function updateProgress(progress, total = state.frameCount, current = state.bufferedFrames.length) {
  const pct = Math.round(progress * 100);
  el.processingFill.style.width = `${pct}%`;
  el.processStatusText.textContent = total > 0 ? `${current} / ${total} frames` : `0 / 0 frames`;
}

function updateExportUI() {
  const parts = [];
  parts.push(exportSupport.color.supported ? `Color: ${exportSupport.color.mimeType}` : "Color WebM: unavailable");
  parts.push(exportSupport.alpha.supported ? "Alpha: available" : "Alpha: unavailable");
  el.exportSupport.textContent = parts.join(" \u00b7 ");
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

let pendingSeek = null;
let seekLock = false;

async function scrubTo(ratio) {
  setPlayhead(ratio);
  el.currentTime.textContent = formatTime(ratio * state.duration);
  pendingSeek = ratio * state.duration;
  if (seekLock) return;
  seekLock = true;
  while (pendingSeek !== null) {
    const t = pendingSeek;
    pendingSeek = null;
    try { await seekVideo(t); drawCurrentFrame(); } catch { /* skip */ }
  }
  seekLock = false;
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
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
  document.addEventListener("touchmove", onMove, { passive: false });
  document.addEventListener("touchend", onUp);
}

el.timelineContainer.addEventListener("mousedown", onTLDown);
el.timelineContainer.addEventListener("touchstart", onTLDown, { passive: false });

// ── Thumbnails ──

async function generateThumbnails() {
  const canvas = el.timelineThumbs;
  const rect = el.timelineContainer.getBoundingClientRect();
  const totalW = Math.round(rect.width);
  const totalH = Math.round(rect.height);
  canvas.width = totalW;
  canvas.height = totalH;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0a0e12";
  ctx.fillRect(0, 0, totalW, totalH);
  if (!state.width || !state.height || !state.duration) return;

  const thumbH = totalH;
  const thumbW = Math.round(thumbH * (state.width / state.height));
  const count = Math.max(1, Math.ceil(totalW / thumbW));

  for (let i = 0; i < count; i++) {
    const time = Math.min((i / count) * state.duration, state.duration - 0.01);
    try {
      await seekVideo(time);
      ctx.drawImage(el.sourceVideo, Math.round(i * thumbW), 0, thumbW, thumbH);
    } catch { /* skip */ }
  }
  await seekVideo(0);
  drawBufferTimeline();
}

function drawBufferTimeline() {
  const canvas = el.timelineBuffer;
  const rect = el.timelineContainer.getBoundingClientRect();
  canvas.width = Math.round(rect.width);
  canvas.height = 3;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!state.duration || !state.bufferedFrames.length) return;

  ctx.fillStyle = "rgba(114, 255, 159, 0.8)";
  for (const frame of state.bufferedFrames) {
    const x = (frame.time / state.duration) * canvas.width;
    ctx.fillRect(x - 0.5, 0, 1.5, 3);
  }
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
  sourceCtx.drawImage(el.sourceVideo, 0, 0, state.width, state.height);
}

function drawBufferedPreview(t) {
  const f = findBufferedFrame(state.bufferedFrames, t, state.fps);
  if (!f) { renderer.renderPreview(); return; }
  const ctx = el.processedCanvas.getContext("2d", { alpha: true });
  ctx.clearRect(0, 0, state.width, state.height);
  ctx.drawImage(f.bitmap, 0, 0, state.width, state.height);
}

function drawCurrentFrame() {
  if (!state.sourceUrl) return;
  drawSourceFrame();
  if (!state.playing && state.bufferedFrames.length) drawBufferedPreview(el.sourceVideo.currentTime);
  else renderer.renderPreview();
  updateTimeline(el.sourceVideo.currentTime);
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
  if (!state.sourceUrl || busy()) return;
  if (state.playing) { await pausePlayback(); drawCurrentFrame(); return; }
  state.playing = true;
  el.sourceVideo.playbackRate = state.playbackRate;
  await el.sourceVideo.play();
  updateButtons();
  playbackLoop();
}

async function stepFrame(dir) {
  if (!state.sourceUrl || busy()) return;
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
  state.bufferedFrames.forEach((f) => f.bitmap.close?.());
  state.bufferedFrames = [];
  updateProgress(0, state.frameCount, 0);
  drawBufferTimeline();
  updateButtons();
}

// ── Load ──

async function inferFps() {
  try {
    const s = el.sourceVideo.captureStream?.();
    const [t] = s?.getVideoTracks?.() ?? [];
    const fps = t?.getSettings?.().frameRate;
    t?.stop(); s?.getTracks?.().forEach((tr) => tr.stop());
    return Number.isFinite(fps) && fps > 0 ? fps : DEFAULT_FPS;
  } catch { return DEFAULT_FPS; }
}

async function loadVideo(file) {
  await pausePlayback();
  resetBuffer();
  if (state.sourceUrl) { URL.revokeObjectURL(state.sourceUrl); state.sourceUrl = null; }

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
  state.fps = await inferFps();
  state.frameCount = estimateFrameCount(state.duration, state.fps);
  setCanvasSize(el.sourceVideo.videoWidth, el.sourceVideo.videoHeight);
  renderer.setSource(el.sourceVideo);
  updateMeta();

  setStatus("Generating thumbnails...", true);
  await generateThumbnails();
  await seekVideo(0);
  drawCurrentFrame();
  updateButtons();
  setStatus("Ready.");
}

async function handleFile(file) {
  if (!file) return;
  try { await loadVideo(file); } catch (e) { console.error(e); setStatus(e.message || "Load failed."); }
}

// ── Process ──

async function processVideo() {
  if (!state.sourceUrl || state.processing) return;
  await pausePlayback();
  resetBuffer();
  state.processing = true;
  state.abortProcessing = false;
  updateButtons();
  showBusy("Processing Frames", "Please be patient...");
  setStatus("Processing...", true);
  const total = Math.max(1, state.frameCount);

  try {
    for (let i = 0; i < total; i++) {
      if (state.abortProcessing) {
        setStatus("Processing cancelled.");
        break;
      }
      const time = Math.min(frameToTime(i, state.fps), Math.max(0, state.duration - 0.001));
      await seekVideo(time);
      drawSourceFrame();
      renderer.renderPreview();
      const bitmap = await renderer.captureFrame({ alpha: true });
      state.bufferedFrames.push({ time, bitmap });
      updateProgress((i + 1) / total, total, i + 1);
      el.busyDetail.textContent = `Frame ${i + 1} / ${total} (${Math.round(((i + 1) / total) * 100)}%)`;
      if (i % 8 === 0) {
        drawBufferTimeline();
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    drawBufferTimeline();
    if (!state.abortProcessing) setStatus("Processing complete. Ready for export.");
  } catch (e) { console.error(e); setStatus(e.message || "Processing failed."); }
  finally { state.processing = false; state.abortProcessing = false; hideBusy(); updateButtons(); drawCurrentFrame(); }
}

// ── Export ──

function downloadBlob(blob, name) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(u), 2000);
}

async function exportVideo({ alpha }) {
  if (!state.bufferedFrames.length) return;
  const sup = alpha ? exportSupport.alpha : exportSupport.color;
  if (!sup.supported) { setStatus(alpha ? "Alpha WebM unavailable." : "WebM unavailable."); return; }
  state.exporting = true;
  updateButtons();
  const label = alpha ? "Alpha WebM" : "WebM";
  showBusy(`Exporting ${label}`, "Encoding... please be patient.");
  setStatus(`Exporting ${label.toLowerCase()}...`, true);

  try {
    const blob = await recordBufferedFrames({
      frames: state.bufferedFrames, width: state.width, height: state.height,
      fps: state.fps, mimeType: sup.mimeType, alpha,
      onProgress: (p) => { updateProgress(p, state.frameCount); el.busyDetail.textContent = `Encoding... ${Math.round(p * 100)}%`; },
    });
    const safe = (state.sourceName || "out").replace(/\.[^.]+$/, "").replace(/[^a-z0-9\-_]+/gi, "_").toLowerCase();
    downloadBlob(blob, `${safe}${alpha ? "_alpha" : ""}.webm`);
    setStatus(`${label} exported.`);
  } catch (e) { console.error(e); setStatus(e.message || "Export failed."); }
  finally { state.exporting = false; hideBusy(); updateButtons(); drawCurrentFrame(); }
}

// ── Events ──

el.videoInput.addEventListener("change", (e) => { handleFile(e.target.files?.[0]); });
["dragenter", "dragover"].forEach((n) => el.sourceDropZone.addEventListener(n, (e) => { e.preventDefault(); el.sourceDropZone.classList.add("drag-active"); }));
["dragleave", "dragend"].forEach((n) => el.sourceDropZone.addEventListener(n, (e) => { e.preventDefault(); el.sourceDropZone.classList.remove("drag-active"); }));
el.sourceDropZone.addEventListener("drop", (e) => { e.preventDefault(); el.sourceDropZone.classList.remove("drag-active"); handleFile(e.dataTransfer?.files?.[0]); });
el.playToggle.addEventListener("click", togglePlayback);
el.stepBackward.addEventListener("click", () => stepFrame(-1));
el.stepForward.addEventListener("click", () => stepFrame(1));
el.processButton.addEventListener("click", () => {
  if (state.processing) {
    state.abortProcessing = true;
  } else {
    processVideo();
  }
});
el.exportWebmButton.addEventListener("click", () => exportVideo({ alpha: false }));
el.exportAlphaButton.addEventListener("click", () => exportVideo({ alpha: true }));
el.sourceVideo.addEventListener("ended", () => { pausePlayback().then(() => drawCurrentFrame()).catch(console.error); });

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

// ── Init ──

updateExportUI();
updateMeta();
updateButtons();
updateProgress(0, 0);
syncOutputs();
