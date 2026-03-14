# Green Difference Studio -- Improvements Plan

## Principles

- **Responsiveness is sacred.** Preview and scrubbing must stay instant. If a feature slows them down, it runs only at export time or behind a toggle.
- **Inspection before correction.** Users need to *see* what's wrong (alpha view, zoom, buffer indicators) before they can fix it (choke, feather, despill). Ship inspection tools first.
- **Progressive disclosure.** Keep the default UI simple. Advanced controls live behind a collapsible section so the tool doesn't intimidate newcomers.
- **Cancel everything.** Any operation longer than 1 second must be cancellable.

---

## NOW -- Ship Next

Small, high-impact changes. No rendering architecture changes. Can be done in a single session.

### 1. Keyboard Shortcuts
| Key | Action |
|-----|--------|
| Space | Play / Pause |
| Left | Previous frame |
| Right | Next frame |
| Shift+Left | Jump 10 frames back |
| Shift+Right | Jump 10 frames forward |
| Escape | Cancel processing/export |

- Suppress when focus is inside a slider, input, or color picker.
- Show key hints in button `title` attributes for discoverability.
- **Effort: S**

### 2. Processing Cancel Button
- Replace the disabled "Process All Frames" button text with "Cancel" during processing/export.
- Set an `aborted` flag checked each iteration of the processing loop; break cleanly and keep already-buffered frames.
- This is *not optional*. Right now, the user is trapped during long runs with no escape.
- **Effort: S**

### 3. Export Disabled-State Tooltips
- Wrap export buttons in a container with a CSS-only tooltip (works on disabled elements, unlike `title`).
- Show *"Process frames first"* when no buffer exists.
- Show *"Codec not supported in this browser"* when `exportSupport` reports unavailable.
- Clicking a disabled export button should briefly pulse the Process button green to guide the user.
- **Effort: S**

### 4. Regroup Process + Progress into Bottom Bar
The "Buffered / Progress" counters and the "Process" button are currently stranded in the sidebar, far from the timeline they relate to. Move them together into a compact inline group at the right side of the transport bar.

Layout: `[transport controls] [time] [meta] ---- [0/240 buffered | 0%] [Process]`

- Collapse the separate Buffered/Progress labels into one line: `128 / 240 frames`.
- Show the meter bar inline or replace it with a thin progress stripe under the timeline (reuse the `timeline-played` pattern).
- Reclaim sidebar space for keying controls.
- **Effort: M**

### 5. Buffered-Frame Indicators on Timeline
- Draw a 3px-tall bar at the top of the timeline canvas showing which frames are in `state.bufferedFrames`.
- Color: accent green at ~40% opacity. Gaps where frames are missing stay transparent.
- Updates live during processing, giving the user a progress visualization that's more intuitive than a percentage.
- **Effort: S**

---

## NEXT -- Second Pass

Features that require shader or rendering changes but no architectural rewrites.

### 6. Alpha Matte Preview Mode
Add a 3-way toggle above the processed viewer: **Composite** | **Alpha** | **Source**.

- **Composite** (default): current behavior.
- **Alpha**: render the alpha channel as a grayscale image (white = opaque, black = transparent). This is the single most useful diagnostic for dialing in threshold/spill values.
- **Source**: pass-through the original frame for quick A/B comparison.

Implementation: add a `uViewMode` uniform to the fragment shader. In alpha mode, output `vec4(alpha, alpha, alpha, 1.0)`. In source mode, output the unmodified sample. No extra render passes needed.

- **Effort: M**

### 7. Multi-Color Eyedropper Sampling
Allow users to click up to 5 points on the **source** viewer to sample target key colors.

- Display sampled colors as small numbered swatches in the sidebar.
- Click a swatch to remove it. Click the source canvas to add one.
- Pass sampled colors as `uniform vec3 uKeyColors[5]` + `uniform int uKeyColorCount` to the shader.
- Compute keying as `min(distance(pixel, color[i]))` across all samples, in a perceptual color space (YCbCr or normalized chroma).
- Keep the current green-difference algorithm as the default "Auto Green" mode. Eyedropper mode is an alternative, not a replacement.
- **Effort: L**

### 8. Matte Choke + Edge Feather
These are one feature, not two. They should share a single UI group and be implemented together.

- **Choke** slider: `-4` to `+4` pixel range. Negative shrinks (erode), positive expands (dilate) the alpha mask.
- **Feather** slider: `0` to `8` pixel range. Gaussian blur applied only to the alpha channel edges.
- Implementation: requires a **two-pass** approach.
  1. Pass 1: current chroma key shader outputs raw alpha to a render target.
  2. Pass 2: reads the alpha texture, applies morphological erode/dilate + edge-aware blur, composites the final output.
- For preview, run at half resolution if performance is a concern; export at full resolution.
- **Effort: L**

### 9. Luma-Preserving Despill
The current despill darkens the image because it removes green channel energy without compensating luminance.

Fix in the fragment shader:
1. Compute luminance before despill: `float lumBefore = dot(rgb, vec3(0.2126, 0.7152, 0.0722))`.
2. Apply despill.
3. Compute luminance after: `float lumAfter = dot(despilled, ...)`.
4. Scale RGB to restore: `despilled *= lumBefore / max(lumAfter, 0.001)`.

This is a single-pass shader change, no extra textures or passes needed. High impact for minimal effort.

- **Effort: S**

---

## LATER -- Substantial Work

Features that require meaningful architecture investment or new interaction paradigms.

### 10. Zoom & Pan on Viewers
- Mouse wheel to zoom (clamp 1x--8x), click-drag to pan.
- Apply via CSS `transform: scale() translate()` on the canvas wrapper, not by re-rendering at higher resolution.
- Double-click to reset to fit.
- Both viewers should zoom/pan in sync (linked) with an option to unlink.
- **Effort: M**

### 11. Garbage Matte (Rectangle Crop)
- Draggable rectangle overlay on the source viewer.
- Pass corner coordinates as uniforms; the shader discards (alpha = 0) anything outside the rect.
- Start with rectangle only. Polygon/bezier masking is a separate future feature.
- **Effort: M**

### 12. In/Out Point Processing
- Add draggable in/out markers on the timeline.
- "Process" only processes the range between markers instead of the full clip.
- Massively speeds up iteration when the user only cares about a specific section.
- **Effort: M**

### 13. Streaming Export Pipeline
The current approach buffers every frame as an `ImageBitmap` in RAM. A 30-second 1080p clip at 30fps is ~900 frames, each ~8MB uncompressed = **~7GB**. This will crash.

Replace with a streaming pipeline:
1. Process frames in batches of ~30.
2. Feed each batch to a WebM muxer (e.g. `webm-muxer` library) or `VideoEncoder`.
3. Release `ImageBitmap` references immediately after encoding.
4. Accumulate encoded chunks into a single `Blob` at the end.

Keep the current "buffer all" mode as an option for short clips where interactive scrubbing of processed frames is desired.

- **Effort: L**

### 14. WebCodecs Decode + Encode
Replace the `<video>` element seeking hack with `VideoDecoder` for frame-accurate decoding and `VideoEncoder` for output.

- Benefits: faster-than-realtime processing, no dropped frames, no seek timeout hacks.
- Risks: not available in all browsers (Firefox lacks support as of early 2026). Must keep `<video>` + `MediaRecorder` as fallback.
- Gate behind `typeof VideoDecoder !== 'undefined'` feature detection.
- **Effort: XL**

### 15. Web Worker + OffscreenCanvas
Move the processing/export pipeline (not preview) to a Web Worker.

- Transfer the `OffscreenCanvas` to the worker.
- Worker receives settings snapshots via `postMessage`, processes frames, posts progress events back.
- Main thread stays responsive during heavy processing.
- Start with export-only offloading before attempting to move preview rendering.
- **Effort: XL**

---

## SOMEDAY -- Nice to Have

Ideas that add polish but aren't critical path. Implement opportunistically.

| Idea | Notes |
|------|-------|
| **Preset system** | Save/load named settings (threshold, spill, choke, etc.) for common scenarios. JSON import/export. |
| **Split/Wipe view** | Draggable vertical divider to compare source vs processed. Useful but the Alpha toggle may cover most of this need. |
| **Background compositing** | Preview keyed subject over an uploaded image or video, not just solid/checker. Partially done (solid/checker already exists). |
| **Difference overlay** | Diagnostic mode highlighting only pixels changed by the shader. Niche but useful for debugging. |
| **Batch file processing** | Drop multiple clips, process them all with the same settings. |
| **PNG sequence export** | Export individual PNG frames as a zip archive. Useful for compositing in external tools. |
| **Despill radius** | Neighbor-sampling despill for deep green bounce. Expensive; only worthwhile after luma-preserving despill ships. |
| **Undo/Redo** | Ctrl+Z to revert slider changes. Requires a settings history stack. |

---

## Effort Key

| Size | Meaning |
|------|---------|
| **S** | < 1 hour. Single-file change, no new dependencies. |
| **M** | 1--4 hours. Touches 2--3 files, may need new UI elements or a shader uniform. |
| **L** | Half day to full day. New render pass, new interaction system, or significant refactor. |
| **XL** | Multi-day. New architecture, new APIs, fallback paths, and thorough testing. |
