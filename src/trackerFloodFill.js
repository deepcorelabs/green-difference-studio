/**
 * CPU-based tracker mask with contour softening.
 *
 * All "keep" trackers are unioned into a single keep mask.
 * All "discard" trackers are unioned into a single discard mask.
 * Then discard is subtracted from keep.
 * Finally the combined mask gets contour softening (3-zone alpha).
 *
 * Three zones:
 *   - INSIDE  (dist > +border): alpha = 255 (fully opaque)
 *   - BORDER  (-border … +border): use the original chroma-keyed alpha
 *   - OUTSIDE (dist < -border): alpha = 0  (fully transparent)
 *
 * The border width is configurable (default 15px each side = 30px soft band).
 */

const BORDER_PX = 15;

/**
 * @param {ImageData} imageData — processed frame (RGBA), modified in place.
 * @param {{ x: number, y: number, mode: "keep"|"discard", strength: number }[]} trackers
 */
export function applyTrackerFloodFill(imageData, trackers) {
  if (!trackers.length) return;

  const { data, width, height } = imageData;
  const len = width * height;

  // Extract original alpha for border-zone preservation
  const origAlpha = new Uint8Array(len);
  for (let i = 0; i < len; i++) origAlpha[i] = data[i * 4 + 3];

  // Separate trackers by mode
  const keepTrackers = trackers.filter(t => t.mode === "keep");
  const discardTrackers = trackers.filter(t => t.mode === "discard");
  const keepAutoInvert = keepTrackers.some(t => t.autoInvert);
  const discardAutoInvert = discardTrackers.some(t => t.autoInvert);

  // Build union masks
  const keepMask = new Uint8Array(len);
  const discardMask = new Uint8Array(len);

  for (const tracker of keepTrackers) {
    const seedX = Math.round(tracker.x * (width - 1));
    const seedY = Math.round(tracker.y * (height - 1));
    if (seedX < 0 || seedX >= width || seedY < 0 || seedY >= height) continue;
    const tol = Math.round(Math.max(tracker.strength ?? 0.15, 0.02) * 255);
    const blob = floodFill(origAlpha, width, height, seedX, seedY, tol);
    for (let i = 0; i < len; i++) if (blob[i]) keepMask[i] = 1;
  }

  for (const tracker of discardTrackers) {
    const seedX = Math.round(tracker.x * (width - 1));
    const seedY = Math.round(tracker.y * (height - 1));
    if (seedX < 0 || seedX >= width || seedY < 0 || seedY >= height) continue;
    const tol = Math.round(Math.max(tracker.strength ?? 0.15, 0.02) * 255);
    const blob = floodFill(origAlpha, width, height, seedX, seedY, tol);
    for (let i = 0; i < len; i++) if (blob[i]) discardMask[i] = 1;
  }

  // Subtract discard from keep
  if (discardTrackers.length && keepTrackers.length) {
    for (let i = 0; i < len; i++) {
      if (discardMask[i]) keepMask[i] = 0;
    }
  }

  // Apply keep mask with contour softening
  if (keepTrackers.length) {
    const dist = computeDistanceField(keepMask, width, height, BORDER_PX);
    const border = BORDER_PX;
    for (let i = 0; i < len; i++) {
      const d = dist[i];
      if (d > border) {
        data[i * 4 + 3] = 255;
      } else if (d > -border) {
        data[i * 4 + 3] = origAlpha[i];
      } else if (keepAutoInvert) {
        data[i * 4 + 3] = 0;
      }
    }
  }

  // Apply discard mask with contour softening
  if (discardTrackers.length && !keepTrackers.length) {
    const dist = computeDistanceField(discardMask, width, height, BORDER_PX);
    const border = BORDER_PX;
    for (let i = 0; i < len; i++) {
      const d = dist[i];
      if (d > border) {
        data[i * 4 + 3] = 0;
      } else if (d > -border) {
        data[i * 4 + 3] = origAlpha[i];
      } else if (discardAutoInvert) {
        // Outside discard + auto invert — force opaque
        data[i * 4 + 3] = 255;
      }
    }
  }
}

/**
 * BFS flood fill. Returns a Uint8Array mask (1 = in blob, 0 = not).
 */
function floodFill(alpha, width, height, seedX, seedY, tol) {
  const len = width * height;
  const mask = new Uint8Array(len);
  const seedIdx = seedY * width + seedX;
  const seedVal = alpha[seedIdx];

  const queue = new Int32Array(len);
  let head = 0, tail = 0;

  mask[seedIdx] = 1;
  queue[tail++] = seedIdx;

  while (head < tail) {
    const idx = queue[head++];
    const px = idx % width;
    const py = (idx - px) / width;

    if (px + 1 < width) {
      const n = idx + 1;
      if (!mask[n] && Math.abs(alpha[n] - seedVal) <= tol) { mask[n] = 1; queue[tail++] = n; }
    }
    if (px - 1 >= 0) {
      const n = idx - 1;
      if (!mask[n] && Math.abs(alpha[n] - seedVal) <= tol) { mask[n] = 1; queue[tail++] = n; }
    }
    if (py + 1 < height) {
      const n = idx + width;
      if (!mask[n] && Math.abs(alpha[n] - seedVal) <= tol) { mask[n] = 1; queue[tail++] = n; }
    }
    if (py - 1 >= 0) {
      const n = idx - width;
      if (!mask[n] && Math.abs(alpha[n] - seedVal) <= tol) { mask[n] = 1; queue[tail++] = n; }
    }
  }

  return mask;
}

/**
 * Compute signed distance from the blob boundary.
 * Positive = inside blob, negative = outside.
 * Clamped to ±maxDist for performance (only BFS up to maxDist pixels).
 *
 * Uses dual-BFS: one from contour outward (outside), one inward (inside).
 */
function computeDistanceField(mask, width, height, maxDist) {
  const len = width * height;
  const dist = new Float32Array(len);

  const outerQueue = [];
  const innerQueue = [];
  const visited = new Uint8Array(len);

  for (let i = 0; i < len; i++) {
    dist[i] = mask[i] ? maxDist + 1 : -(maxDist + 1);
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const v = mask[i];
      let isContour = false;
      if (x > 0 && mask[i - 1] !== v) isContour = true;
      if (!isContour && x < width - 1 && mask[i + 1] !== v) isContour = true;
      if (!isContour && y > 0 && mask[i - width] !== v) isContour = true;
      if (!isContour && y < height - 1 && mask[i + width] !== v) isContour = true;

      if (isContour) {
        dist[i] = v ? 0.5 : -0.5;
        visited[i] = 1;
        if (v) {
          innerQueue.push(i);
        } else {
          outerQueue.push(i);
        }
      }
    }
  }

  bfsDistance(outerQueue, dist, visited, mask, width, height, maxDist, -1);
  bfsDistance(innerQueue, dist, visited, mask, width, height, maxDist, 1);

  return dist;
}

/**
 * BFS from seed queue, setting distances incrementally.
 * sign: -1 for outside (negative dist), +1 for inside (positive dist)
 */
function bfsDistance(seedQueue, dist, visited, mask, width, height, maxDist, sign) {
  let current = seedQueue;
  let level = 1;

  while (current.length > 0 && level <= maxDist) {
    const next = [];
    for (let q = 0; q < current.length; q++) {
      const idx = current[q];
      const px = idx % width;
      const py = (idx - px) / width;

      const neighbors = [];
      if (px + 1 < width) neighbors.push(idx + 1);
      if (px - 1 >= 0) neighbors.push(idx - 1);
      if (py + 1 < height) neighbors.push(idx + width);
      if (py - 1 >= 0) neighbors.push(idx - width);

      for (let n = 0; n < neighbors.length; n++) {
        const ni = neighbors[n];
        if (visited[ni]) continue;
        const inBlob = mask[ni];
        if (sign > 0 && !inBlob) continue;
        if (sign < 0 && inBlob) continue;
        visited[ni] = 1;
        dist[ni] = sign * level;
        next.push(ni);
      }
    }
    current = next;
    level++;
  }
}
