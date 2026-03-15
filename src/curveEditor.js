const HANDLE_RADIUS = 5;
const HIT_RADIUS = 10;
const PAD = 8;

function monotoneCubicInterpolate(points, count) {
  const n = points.length;
  if (n === 0) return new Float32Array(count);
  if (n === 1) {
    const out = new Float32Array(count);
    out.fill(points[0].y);
    return out;
  }

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);

  // Secants
  const deltas = [];
  const slopes = [];
  for (let i = 0; i < n - 1; i++) {
    deltas.push(xs[i + 1] - xs[i]);
    slopes.push((ys[i + 1] - ys[i]) / deltas[i]);
  }

  // Tangents (Fritsch-Carlson monotone)
  const tangents = new Float32Array(n);
  tangents[0] = slopes[0];
  tangents[n - 1] = slopes[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slopes[i - 1] * slopes[i] <= 0) {
      tangents[i] = 0;
    } else {
      tangents[i] = (slopes[i - 1] + slopes[i]) / 2;
    }
  }

  // Enforce monotonicity
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(slopes[i]) < 1e-8) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
    } else {
      const alpha = tangents[i] / slopes[i];
      const beta = tangents[i + 1] / slopes[i];
      const mag = alpha * alpha + beta * beta;
      if (mag > 9) {
        const tau = 3 / Math.sqrt(mag);
        tangents[i] = tau * alpha * slopes[i];
        tangents[i + 1] = tau * beta * slopes[i];
      }
    }
  }

  // Evaluate
  const out = new Float32Array(count);
  for (let s = 0; s < count; s++) {
    const x = s / (count - 1);
    // Find segment
    let seg = n - 2;
    for (let i = 0; i < n - 1; i++) {
      if (x <= xs[i + 1]) { seg = i; break; }
    }

    const h = deltas[seg];
    const t = h > 0 ? (x - xs[seg]) / h : 0;
    const t2 = t * t;
    const t3 = t2 * t;

    // Hermite basis
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;

    out[s] = Math.max(0, Math.min(1,
      h00 * ys[seg] + h10 * h * tangents[seg] + h01 * ys[seg + 1] + h11 * h * tangents[seg + 1],
    ));
  }
  return out;
}

export class CurveEditor {
  constructor(container, { points, onChange } = {}) {
    this.points = points ?? [
      { x: 0.0, y: 1.0 },
      { x: 0.05, y: 1.0 },
      { x: 0.15, y: 0.0 },
      { x: 1.0, y: 0.0 },
    ];
    this.onChange = onChange ?? (() => {});
    this.dragIndex = -1;
    this.lut = new Uint8Array(256);

    this.canvas = document.createElement("canvas");
    this.canvas.className = "curve-canvas";
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");

    this._resize();
    this._bindEvents();
    this._computeLUT();
    this._draw();

    this._resizeObserver = new ResizeObserver(() => {
      this._resize();
      this._draw();
    });
    this._resizeObserver.observe(container);
  }

  _resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.w = rect.width;
    this.h = rect.height;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _toCanvas(p) {
    const iw = this.w - PAD * 2;
    const ih = this.h - PAD * 2;
    return { cx: PAD + p.x * iw, cy: PAD + (1 - p.y) * ih };
  }

  _fromCanvas(cx, cy) {
    const iw = this.w - PAD * 2;
    const ih = this.h - PAD * 2;
    return {
      x: Math.max(0, Math.min(1, (cx - PAD) / iw)),
      y: Math.max(0, Math.min(1, 1 - (cy - PAD) / ih)),
    };
  }

  _hitTest(cx, cy) {
    for (let i = this.points.length - 1; i >= 0; i--) {
      const { cx: px, cy: py } = this._toCanvas(this.points[i]);
      if (Math.hypot(cx - px, cy - py) <= HIT_RADIUS) return i;
    }
    return -1;
  }

  _bindEvents() {
    const getPos = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return { cx: clientX - rect.left, cy: clientY - rect.top };
    };

    this.canvas.addEventListener("mousedown", (e) => {
      const { cx, cy } = getPos(e);
      this.dragIndex = this._hitTest(cx, cy);
      if (this.dragIndex >= 0) e.preventDefault();
    });

    this.canvas.addEventListener("dblclick", (e) => {
      const { cx, cy } = getPos(e);
      const hit = this._hitTest(cx, cy);

      if (hit >= 0) {
        // Remove point (keep at least 2)
        if (this.points.length > 2 && hit !== 0 && hit !== this.points.length - 1) {
          this.points.splice(hit, 1);
          this._update();
        }
      } else {
        // Add point
        const p = this._fromCanvas(cx, cy);
        // Insert sorted by x
        let idx = this.points.findIndex((pt) => pt.x > p.x);
        if (idx < 0) idx = this.points.length;
        this.points.splice(idx, 0, p);
        this._update();
      }
    });

    const onMove = (e) => {
      if (this.dragIndex < 0) return;
      e.preventDefault();
      const { cx, cy } = getPos(e);
      const p = this._fromCanvas(cx, cy);

      // Lock first/last point x positions
      if (this.dragIndex === 0) {
        p.x = 0;
      } else if (this.dragIndex === this.points.length - 1) {
        p.x = 1;
      } else {
        // Constrain between neighbours
        const prev = this.points[this.dragIndex - 1];
        const next = this.points[this.dragIndex + 1];
        p.x = Math.max(prev.x + 0.001, Math.min(next.x - 0.001, p.x));
      }

      this.points[this.dragIndex] = p;
      this._update();
    };

    const onUp = () => { this.dragIndex = -1; };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    this.canvas.addEventListener("touchstart", (e) => {
      const { cx, cy } = getPos(e);
      this.dragIndex = this._hitTest(cx, cy);
      if (this.dragIndex >= 0) e.preventDefault();
    }, { passive: false });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);
  }

  _update() {
    this._computeLUT();
    this._draw();
    this.onChange(this.lut);
  }

  _computeLUT() {
    const sorted = [...this.points].sort((a, b) => a.x - b.x);
    const values = monotoneCubicInterpolate(sorted, 256);
    for (let i = 0; i < 256; i++) {
      this.lut[i] = Math.round(values[i] * 255);
    }
  }

  getLUT() {
    return this.lut;
  }

  getPoints() {
    return this.points.map((p) => ({ ...p }));
  }

  _draw() {
    const { ctx, w, h } = this;
    const iw = w - PAD * 2;
    const ih = h - PAD * 2;

    ctx.fillStyle = "rgba(8, 12, 16, 0.95)";
    ctx.fillRect(0, 0, w, h);

    // Grid inside padded area
    ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const gx = PAD + (i / 4) * iw;
      const gy = PAD + (i / 4) * ih;
      ctx.beginPath(); ctx.moveTo(gx, PAD); ctx.lineTo(gx, PAD + ih); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(PAD, gy); ctx.lineTo(PAD + iw, gy); ctx.stroke();
    }

    // Diagonal reference
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(PAD, PAD + ih); ctx.lineTo(PAD + iw, PAD); ctx.stroke();
    ctx.setLineDash([]);

    // Curve from LUT
    ctx.strokeStyle = "rgba(114, 255, 159, 0.85)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 256; i++) {
      const cx = PAD + (i / 255) * iw;
      const cy = PAD + (1 - this.lut[i] / 255) * ih;
      if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
    }
    ctx.stroke();

    // Filled area under curve
    ctx.lineTo(PAD + iw, PAD + ih);
    ctx.lineTo(PAD, PAD + ih);
    ctx.closePath();
    ctx.fillStyle = "rgba(114, 255, 159, 0.04)";
    ctx.fill();

    // Control points
    for (let i = 0; i < this.points.length; i++) {
      const { cx, cy } = this._toCanvas(this.points[i]);
      ctx.beginPath();
      ctx.arc(cx, cy, HANDLE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = i === this.dragIndex ? "#ffffff" : "rgba(114, 255, 159, 0.95)";
      ctx.fill();
      ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Axis labels
    ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
    ctx.font = "9px 'IBM Plex Mono', monospace";
    ctx.textAlign = "left";
    ctx.fillText("keep", PAD + 1, PAD + 9);
    ctx.fillText("remove", PAD + 1, PAD + ih - 2);
    ctx.textAlign = "right";
    ctx.fillText("green diff", PAD + iw - 1, PAD + ih - 2);
  }
}
