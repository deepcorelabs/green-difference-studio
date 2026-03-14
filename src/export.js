const COLOR_MIME_CANDIDATES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

const ALPHA_MIME_CANDIDATES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
];

export function detectExportSupport() {
  const mediaRecorderAvailable = typeof MediaRecorder !== "undefined";

  const colorMimeType =
    mediaRecorderAvailable && COLOR_MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  const alphaMimeType =
    mediaRecorderAvailable && ALPHA_MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate));

  return {
    color: {
      supported: Boolean(colorMimeType),
      mimeType: colorMimeType ?? null,
    },
    alpha: {
      supported: Boolean(alphaMimeType),
      mimeType: alphaMimeType ?? null,
      note: alphaMimeType
        ? "Transparent WebM capture is experimental and depends on browser codec support."
        : "Transparent WebM export is unavailable in this browser.",
    },
  };
}

function nextAnimationFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function recordBufferedFrames({
  frames,
  width,
  height,
  fps,
  mimeType,
  alpha = false,
  onProgress,
}) {
  if (!frames.length) {
    throw new Error("No processed frames are buffered yet.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { alpha: true });
  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: Math.min(18_000_000, Math.max(4_000_000, width * height * fps * 2)),
  });

  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  const stopPromise = new Promise((resolve, reject) => {
    recorder.onerror = (event) => reject(event.error ?? new Error("MediaRecorder failed."));
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
  });

  recorder.start();

  for (let index = 0; index < frames.length; index += 1) {
    context.clearRect(0, 0, width, height);

    if (!alpha) {
      context.fillStyle = "#050709";
      context.fillRect(0, 0, width, height);
    }

    context.drawImage(frames[index].bitmap, 0, 0, width, height);
    onProgress?.((index + 1) / frames.length);

    await nextAnimationFrame();
    await sleep(1000 / fps);
  }

  recorder.stop();
  return stopPromise;
}
