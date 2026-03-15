# Green Difference Studio

A browser-based chroma key (green screen) video processor with real-time preview, GPU-accelerated rendering, and WebM export with alpha transparency.

<!-- Replace with an actual screenshot or screen recording -->
![Demo](https://deepcorelabs.com/tools/green-difference-studio/)

## Features

### Chroma Keying

- **Auto Green** detection or manual **color sampling** (click the source viewport to pick key colors)
- **Hue Range** slider for fine-tuning which greens to remove
- **Saturation Floor** and **Light Range** controls for handling shadows and highlights
- **Edge Feather** for soft, natural edges
- Advanced mode with **curve editor** for custom threshold falloff

### Color Recovery

- **Spill Suppression** removes green color bleed from subjects
- **Despill Lift** recovers natural skin tones
- **Despill Depth** controls how many pixel radii are sampled for spill correction

### Matte Refinement

- **Choke / Feather** morphological operations for expanding or contracting the matte edge
- Real-time **Alpha** preview mode to inspect the matte quality

### Trackers

- **Tween Tracker** — place a static tracker point, drag to reposition on any frame
- **Mouse Tracker** — record a moving tracker by playing the video and holding first mouse button on the subject (mouse up is off)
- Per-tracker **Keep** / **Discard** modes with flood-fill-based alpha masking
- **Auto Invert Remaining** — automatically discard (or keep) everything outside the tracked region
- **Tolerance** control per tracker for fine-tuning flood fill sensitivity
- **On/Off keyframes** — toggle trackers on and off at specific times
- Numbered circle indicators with **GSAP-powered smooth animation** between frames
- **Drag & drop** indicators from either viewport to reposition
- **Keyframe lane** in the timeline showing all tracker keyframes

### Video Playback

- Frame-accurate **scrubbing** with thumbnail timeline
- **Step forward/backward** (arrow keys, shift+arrow for 10 frames)
- **Playback speed** control (0.25x, 0.5x, 1x, 2x)
- **Loop** toggle (L key)
- **Mute** toggle (M key)
- **Background frame cache** — built progressively after upload, no blocking wait

### Export

- **Color + Alpha WebM** — VP8/VP9 with embedded alpha channel
- **Standalone Matte WebM** — grayscale matte as a separate file
- **PNG export** for single images (color + alpha)
- Processing progress bar with **cancel** support (Escape key)

### Background Options

- Checkerboard transparency preview
- Solid colors (dark, mid-gray, light)
- Custom color picker

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `Left` / `Right` | Step 1 frame |
| `Shift + Left/Right` | Step 10 frames |
| `Home` | Go to start |
| `L` | Toggle loop |
| `M` | Toggle mute |
| `Escape` | Cancel processing |
| `Delete` | Delete selected keyframe |

## Tech Stack

- **[Three.js](https://threejs.org/)** — WebGL fragment shader for GPU-accelerated chroma keying
- **[GSAP](https://gsap.com/)** — smooth tracker indicator animations
- **[iro.js](https://iro.js.org/)** — color picker widget
- **[noUiSlider](https://refreshless.com/nouislider/)** — range slider controls
- **[webm-muxer](https://github.com/nicokoenig/webm-muxer)** — WebM muxing for matte export
- **WebCodecs API** — hardware-accelerated video encoding
- **MediaRecorder API** — alpha-channel WebM recording

## Getting Started

### Development

Requires [Node.js](https://nodejs.org/) 18+ for the build tooling.

```bash
git clone https://github.com/deepcorelabs/green-difference-studio.git
cd green-difference-studio
npm install
npm run dev
```

Open `http://localhost:5173` in a Chromium-based browser (Chrome, Edge, Brave).

### Build for Production

```bash
npm run build
```

This outputs a flat `dist/` folder containing static HTML, CSS, and JS — no server-side dependencies. Upload the contents of `dist/` to any static hosting (Nginx, Apache, S3, Cloudflare Pages, etc.).

### Demo Video

The app can auto-load a demo video on first visit. To enable this:

1. Place a `demo.mp4` file alongside `index.html` in your hosting root, **or**
2. Create a GitHub Release tagged `v1.0.0` and upload the video as `demo.mp4` — the app falls back to this URL automatically

## Browser Support

Requires a modern Chromium-based browser with support for:

- WebGL 2.0
- WebCodecs API (`VideoEncoder`)
- `requestVideoFrameCallback`
- MediaRecorder with VP8/VP9 alpha

**Recommended:** Chrome 94+, Edge 94+

Firefox and Safari have partial support — chroma keying and preview work, but video export may be unavailable.

## Contributing

Want to help improve this tool? Here's the current roadmap — PRs and ideas welcome!

### TODO

1. **Masks** — Brush, primitive shape, polygonal, and lasso mask tools that act as alpha or despill keepers/blockers, with feathered/blurred edges (garbage matte / luminance mask support)
2. **Automatic motion tracking** — Add to the current manual trackers real frame-by-frame point tracking (e.g. Lucas-Kanade or correlation-based)
3. **Image sequence export** — Export as PNG+Alpha sequence or JPG matte sequence, not just WebM
4. **Undo/Redo** — Full history stack for all parameter changes, tracker edits, and mask operations
5. **Worker-based flood fill** — Offload the CPU-heavy tracker flood fill and distance field computation to Web Workers for faster processing on multi-core machines
6. **Batch processing** — Queue multiple videos and process them sequentially with saved presets
7. **CorridorKey in the browser** — one can dream... 😏

## License

[MIT](LICENSE) — use it however you want.
