/**
 * CPU-based flood fill for tracker keep/discard masks.
 *
 * Operates on the alpha channel of an ImageData.
 * For each active tracker, flood-fills from the tracker pixel position
 * into the contiguous alpha region the tracker sits in.
 *
 * "keep"    → sets filled pixels to alpha 255 (opaque)
 * "discard" → sets filled pixels to alpha 0   (transparent)
 *
 * The fill stays within the alpha blob the seed is in — it won't cross
 * edges where alpha changes sharply beyond the tolerance.
 */

/**
 * @param {ImageData} imageData — the processed frame (RGBA). Modified in place.
 * @param {{ x: number, y: number, mode: "keep"|"discard", strength: number }[]} trackers
 *   x,y are normalised 0-1 coordinates.  strength controls tolerance (0–1).
 */
export function applyTrackerFloodFill(imageData, trackers) {
  if (!trackers.length) return;

  const { data, width, height } = imageData;
  const len = width * height;

  // Extract alpha channel into a flat Uint8 for fast reads
  const alpha = new Uint8Array(len);
  for (let i = 0; i < len; i++) alpha[i] = data[i * 4 + 3];

  // Shared visited bitset (one bit per pixel)
  const visited = new Uint8Array(len);

  for (const tracker of trackers) {
    const seedX = Math.round(tracker.x * (width - 1));
    const seedY = Math.round(tracker.y * (height - 1));
    if (seedX < 0 || seedX >= width || seedY < 0 || seedY >= height) continue;

    const seedIdx = seedY * width + seedX;
    const seedAlpha = alpha[seedIdx];
    const isKeep = tracker.mode === "keep";

    // Tolerance in alpha units (0-255).  strength 0.15 → ~38 levels
    const tol = Math.round(Math.max(tracker.strength ?? 0.15, 0.02) * 255);

    // Target alpha for this fill
    const target = isKeep ? 255 : 0;

    // Early-out: if the seed is already at the target alpha, and isn't
    // in a region that meaningfully differs, skip expensive fill.
    // (But still fill — the user expects it to work.)

    // BFS flood fill with tolerance
    visited.fill(0);
    const queue = new Int32Array(len); // circular queue of pixel indices
    let head = 0, tail = 0;

    visited[seedIdx] = 1;
    queue[tail++] = seedIdx;

    while (head < tail) {
      const idx = queue[head++];
      const px = idx % width;
      const py = (idx - px) / width;

      // Set this pixel's alpha to target
      data[idx * 4 + 3] = target;

      // Check 4-connected neighbours
      // Right
      if (px + 1 < width) {
        const nIdx = idx + 1;
        if (!visited[nIdx] && Math.abs(alpha[nIdx] - seedAlpha) <= tol) {
          visited[nIdx] = 1;
          queue[tail++] = nIdx;
        }
      }
      // Left
      if (px - 1 >= 0) {
        const nIdx = idx - 1;
        if (!visited[nIdx] && Math.abs(alpha[nIdx] - seedAlpha) <= tol) {
          visited[nIdx] = 1;
          queue[tail++] = nIdx;
        }
      }
      // Down
      if (py + 1 < height) {
        const nIdx = idx + width;
        if (!visited[nIdx] && Math.abs(alpha[nIdx] - seedAlpha) <= tol) {
          visited[nIdx] = 1;
          queue[tail++] = nIdx;
        }
      }
      // Up
      if (py - 1 >= 0) {
        const nIdx = idx - width;
        if (!visited[nIdx] && Math.abs(alpha[nIdx] - seedAlpha) <= tol) {
          visited[nIdx] = 1;
          queue[tail++] = nIdx;
        }
      }
    }
  }
}
