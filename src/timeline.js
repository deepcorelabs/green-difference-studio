export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds)) {
    return "00:00.000";
  }

  const totalMilliseconds = Math.round(seconds * 1000);
  const minutes = Math.floor(totalMilliseconds / 60000);
  const remainder = totalMilliseconds % 60000;
  const secs = Math.floor(remainder / 1000);
  const milliseconds = remainder % 1000;

  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

export function estimateFrameCount(duration, fps) {
  if (!Number.isFinite(duration) || !Number.isFinite(fps) || fps <= 0) {
    return 0;
  }

  return Math.max(1, Math.round(duration * fps));
}

export function timeToFrame(time, fps) {
  if (!Number.isFinite(time) || !Number.isFinite(fps) || fps <= 0) {
    return 0;
  }

  return Math.round(time * fps);
}

export function frameToTime(frame, fps) {
  if (!Number.isFinite(frame) || !Number.isFinite(fps) || fps <= 0) {
    return 0;
  }

  return frame / fps;
}

export function findBufferedFrame(bufferedFrames, time, fps) {
  if (!bufferedFrames.length) {
    return null;
  }

  const index = clamp(timeToFrame(time, fps), 0, bufferedFrames.length - 1);
  return bufferedFrames[index] ?? null;
}
