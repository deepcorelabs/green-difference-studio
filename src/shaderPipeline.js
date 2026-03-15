import * as THREE from "three";

const vertexShader = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const fragmentShader = `
uniform sampler2D uTexture;
uniform sampler2D uCurveLUT;
uniform float uSpillSuppression;
uniform float uDespillLift;
uniform float uChoke;
uniform float uFeather;
uniform float uViewMode;
uniform float uUseSampledKey;
uniform float uKeyColorCount;
uniform float uSampleSimilarity;
uniform vec3 uKeyColors[5];
uniform vec2 uTexelSize;
uniform vec2 uHueRange;
uniform float uSatFloor;
uniform vec2 uLightRange;
uniform float uDespillDepth;
uniform vec2 uTrackerPositions[4];
uniform float uTrackerModes[4];
uniform float uTrackerStrengths[4];
uniform float uTrackerCount;
uniform float uTrackerThreshold;

varying vec2 vUv;

float quickKeyAlpha(vec2 uv) {
  vec3 c = texture2D(uTexture, uv).rgb;
  float diff = clamp(c.g - max(c.r, c.b), 0.0, 1.0);
  return texture2D(uCurveLUT, vec2(diff, 0.5)).r;
}

float sampleRingMinAlpha(vec2 uv, vec2 r) {
  float mn = quickKeyAlpha(uv + vec2(r.x, 0.0));
  mn = min(mn, quickKeyAlpha(uv - vec2(r.x, 0.0)));
  mn = min(mn, quickKeyAlpha(uv + vec2(0.0, r.y)));
  mn = min(mn, quickKeyAlpha(uv - vec2(0.0, r.y)));
  mn = min(mn, quickKeyAlpha(uv + r));
  mn = min(mn, quickKeyAlpha(uv + vec2(-r.x, r.y)));
  mn = min(mn, quickKeyAlpha(uv + vec2(r.x, -r.y)));
  mn = min(mn, quickKeyAlpha(uv - r));
  return mn;
}

vec3 rgbToHsl(vec3 c) {
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  float l = (mx + mn) * 0.5;
  if (mx == mn) return vec3(0.0, 0.0, l);
  float d = mx - mn;
  float s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
  float h;
  if (mx == c.r) h = mod((c.g - c.b) / d, 6.0);
  else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
  else h = (c.r - c.g) / d + 4.0;
  return vec3(h * 60.0, s, l);
}

float computeHslMask(vec3 color) {
  vec3 hsl = rgbToHsl(color);
  float hueLo = smoothstep(uHueRange.x - 10.0, uHueRange.x, hsl.x);
  float hueHi = smoothstep(uHueRange.y, uHueRange.y + 10.0, hsl.x);
  float hueMask = hueLo * (1.0 - hueHi);
  float satMask = smoothstep(uSatFloor - 0.05, uSatFloor, hsl.y);
  float lightLo = smoothstep(uLightRange.x - 0.03, uLightRange.x, hsl.z);
  float lightHi = smoothstep(uLightRange.y, uLightRange.y + 0.03, hsl.z);
  float lightMask = lightLo * (1.0 - lightHi);
  return hueMask * satMask * lightMask;
}

vec3 rgbToYCbCr(vec3 color) {
  float y = dot(color, vec3(0.299, 0.587, 0.114));
  float cb = 0.5 + (color.b - y) * 0.565;
  float cr = 0.5 + (color.r - y) * 0.713;
  return vec3(y, cb, cr);
}

float computeAutoKeyAlpha(vec3 color) {
  float reference = max(color.r, color.b);
  float difference = clamp(color.g - reference, 0.0, 1.0);
  float curveAlpha = texture2D(uCurveLUT, vec2(difference, 0.5)).r;
  float hslMask = computeHslMask(color);
  return mix(1.0, curveAlpha, hslMask);
}

float computeSampledKeyAlpha(vec3 color) {
  vec2 chroma = rgbToYCbCr(color).yz;
  float minDist = 10.0;
  for (int i = 0; i < 5; i++) {
    if (float(i) >= uKeyColorCount) {
      break;
    }
    vec2 keyChroma = rgbToYCbCr(uKeyColors[i]).yz;
    minDist = min(minDist, distance(chroma, keyChroma));
  }
  float high = max(uSampleSimilarity, 0.0001);
  float low = max(high * 0.35, 0.0);
  return smoothstep(low, high, minDist);
}

float computeBaseAlphaAt(vec2 uv) {
  vec3 color = texture2D(uTexture, uv).rgb;
  if (uUseSampledKey > 0.5 && uKeyColorCount > 0.5) {
    return computeSampledKeyAlpha(color);
  }
  return computeAutoKeyAlpha(color);
}

float computeChokedAlphaAt(vec2 uv) {
  float alpha = computeBaseAlphaAt(uv);
  if (abs(uChoke) < 0.001) {
    return alpha;
  }

  float absChoke = abs(uChoke);
  vec2 radius = uTexelSize * max(absChoke, 0.5);
  float a1 = computeBaseAlphaAt(uv + vec2(radius.x, 0.0));
  float a2 = computeBaseAlphaAt(uv - vec2(radius.x, 0.0));
  float a3 = computeBaseAlphaAt(uv + vec2(0.0, radius.y));
  float a4 = computeBaseAlphaAt(uv - vec2(0.0, radius.y));
  float a5 = computeBaseAlphaAt(uv + vec2(radius.x, radius.y));
  float a6 = computeBaseAlphaAt(uv + vec2(-radius.x, radius.y));
  float a7 = computeBaseAlphaAt(uv + vec2(radius.x, -radius.y));
  float a8 = computeBaseAlphaAt(uv - radius);

  float morphed;
  if (uChoke > 0.0) {
    morphed = max(alpha, max(max(a1, a2), max(max(a3, a4), max(max(a5, a6), max(a7, a8)))));
  } else {
    morphed = min(alpha, min(min(a1, a2), min(min(a3, a4), min(min(a5, a6), min(a7, a8)))));
  }

  float blend = clamp(absChoke, 0.0, 1.0);
  return mix(alpha, morphed, blend);
}

float applyFeather(vec2 uv, float alpha) {
  if (uFeather < 0.001) {
    return alpha;
  }

  vec2 radius = uTexelSize * max(uFeather, 1.0) * 0.75;
  float total = alpha;
  total += computeChokedAlphaAt(uv + vec2(radius.x, 0.0));
  total += computeChokedAlphaAt(uv - vec2(radius.x, 0.0));
  total += computeChokedAlphaAt(uv + vec2(0.0, radius.y));
  total += computeChokedAlphaAt(uv - vec2(0.0, radius.y));
  total += computeChokedAlphaAt(uv + vec2(radius.x, radius.y));
  total += computeChokedAlphaAt(uv + vec2(-radius.x, radius.y));
  total += computeChokedAlphaAt(uv + vec2(radius.x, -radius.y));
  total += computeChokedAlphaAt(uv - radius);

  return total / 9.0;
}

float alphaSimilarity(float a, float b, float strength) {
  return 1.0 - smoothstep(strength, strength * 2.0, abs(a - b));
}

// Fixed number of steps per segment so connectivity does not depend on distance (no fake radial).
// Same step density for near and far pixels = true contiguous region, not a distance falloff.
float pathConfidence(vec2 fromUv, vec2 toUv, float strength) {
  const float steps = 64.0;
  float pathMin = 1.0;
  vec2 prevUv = fromUv;
  for (float s = 1.0; s <= 64.0; s += 1.0) {
    vec2 currUv = mix(fromUv, toUv, s / steps);
    float prevA = quickKeyAlpha(prevUv);
    float currA = quickKeyAlpha(currUv);
    pathMin = min(pathMin, alphaSimilarity(prevA, currA, strength));
    prevUv = currUv;
  }
  return smoothstep(0.2, 0.8, pathMin);
}

// Flood-fill style: pixel is connected if ANY path from tracker is contiguous
// (direct or L-shaped), so we don't get a single-ray "cone" / radial falloff.
float trackerConnectivity(vec2 pixelUv, vec2 trackerUv, float strength, float mode) {
  float refAlpha   = quickKeyAlpha(trackerUv);
  float pixelAlpha = quickKeyAlpha(pixelUv);
  float edge = max(strength * 0.35, 0.02);

  float inRange = 0.0;
  if (mode > 0.5) {
    float cutoff = refAlpha - strength;
    inRange = smoothstep(cutoff - edge, cutoff + edge, pixelAlpha);
  } else {
    float cutoff = refAlpha + strength;
    inRange = 1.0 - smoothstep(cutoff - edge, cutoff + edge, pixelAlpha);
  }

  if (inRange < 0.01) return 0.0;

  // Multiple routes: direct, L via (pixel.x, tracker.y), L via (tracker.x, pixel.y)
  vec2 viaX = vec2(pixelUv.x, trackerUv.y);
  vec2 viaY = vec2(trackerUv.x, pixelUv.y);
  float cDirect = pathConfidence(trackerUv, pixelUv, strength);
  float cViaX   = min(pathConfidence(trackerUv, viaX, strength), pathConfidence(viaX, pixelUv, strength));
  float cViaY   = min(pathConfidence(trackerUv, viaY, strength), pathConfidence(viaY, pixelUv, strength));
  float pathConf = max(cDirect, max(cViaX, cViaY));

  return inRange * pathConf;
}

void main() {
  vec4 sampleColor = texture2D(uTexture, vUv);

  // 1. Choke + Feather FIRST
  float alpha = computeChokedAlphaAt(vUv);
  alpha = applyFeather(vUv, alpha);
  alpha = clamp(alpha, 0.0, 1.0);

  // 2. Apply tracker keep/discard masks
  for (int i = 0; i < 4; i++) {
    if (float(i) >= uTrackerCount) break;
    float mode = uTrackerModes[i];
    float strength = max(uTrackerStrengths[i], 0.001);
    if (abs(mode) < 0.5) continue;
    float conn = trackerConnectivity(vUv, uTrackerPositions[i], strength, mode);
    if (mode > 0.5) {
      alpha = mix(alpha, 1.0, conn);
    } else {
      alpha = mix(alpha, 0.0, conn);
    }
  }

  if (uViewMode > 1.5) {
    gl_FragColor = vec4(sampleColor.rgb, 1.0);
    return;
  }

  // 3. Despill — choke-like inner-glow for color correction depth
  float spillAmount = max(sampleColor.g - max(sampleColor.r, sampleColor.b), 0.0);
  float spillFactor = 1.0 - smoothstep(0.0, max(uSpillSuppression, 0.0001), spillAmount);
  float edgeProximity = 1.0 - alpha;
  if (uDespillDepth > 0.5) {
    float d = uDespillDepth;
    float a1 = sampleRingMinAlpha(vUv, uTexelSize * max(d * 0.33, 0.5));
    float a2 = sampleRingMinAlpha(vUv, uTexelSize * max(d * 0.66, 0.5));
    float a3 = sampleRingMinAlpha(vUv, uTexelSize * d);
    float depthProximity = (1.0 - a1) * 0.5 + (1.0 - a2) * 0.33 + (1.0 - a3) * 0.17;
    edgeProximity = max(edgeProximity, depthProximity);
  }
  float edgeMask = spillFactor * edgeProximity;

  float greenCeiling = (sampleColor.r + sampleColor.b) * 0.5;
  float correctedGreen = mix(sampleColor.g, min(sampleColor.g, greenCeiling), edgeMask);
  float greenRemoved = sampleColor.g - correctedGreen;
  float lift = greenRemoved * uDespillLift;
  vec3 neutralized = clamp(vec3(
    sampleColor.r + lift,
    correctedGreen + lift,
    sampleColor.b + lift
  ), 0.0, 1.0);

  if (uViewMode > 0.5) {
    gl_FragColor = vec4(vec3(alpha), 1.0);
    return;
  }

  gl_FragColor = vec4(neutralized, alpha);
}
`;

export class ChromaKeyRenderer {
  constructor({ processedCanvas }) {
    this.processedCanvas = processedCanvas;
    this.processedContext = processedCanvas.getContext("2d", { alpha: true });
    this.size = { width: 1280, height: 720 };

    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Default LUT: smoothstep(0.0, 0.15) equivalent
    const defaultLUT = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      const s = t < 0 ? 0 : t > 0.15 ? 1 : t / 0.15;
      defaultLUT[i] = Math.round((1 - s * s * (3 - 2 * s)) * 255);
    }
    this.curveLUTTexture = new THREE.DataTexture(defaultLUT, 256, 1, THREE.RedFormat, THREE.UnsignedByteType);
    this.curveLUTTexture.minFilter = THREE.LinearFilter;
    this.curveLUTTexture.magFilter = THREE.LinearFilter;
    this.curveLUTTexture.needsUpdate = true;

    this.uniforms = {
      uTexture: { value: null },
      uCurveLUT: { value: this.curveLUTTexture },
      uSpillSuppression: { value: 2 },
      uDespillLift: { value: 1 },
      uChoke: { value: 0 },
      uFeather: { value: 0 },
      uViewMode: { value: 0 },
      uUseSampledKey: { value: 0 },
      uKeyColorCount: { value: 0 },
      uSampleSimilarity: { value: 0.1 },
      uKeyColors: { value: Array.from({ length: 5 }, () => new THREE.Vector3(0, 1, 0)) },
      uTexelSize: { value: new THREE.Vector2(1 / this.size.width, 1 / this.size.height) },
      uDespillDepth: { value: 5 },
      uTrackerPositions: { value: Array.from({ length: 4 }, () => new THREE.Vector2(0, 0)) },
      uTrackerModes: { value: new Float32Array(4) },
      uTrackerStrengths: { value: new Float32Array([0.15, 0.15, 0.15, 0.15]) },
      uTrackerCount: { value: 0 },
      uTrackerThreshold: { value: 0.15 },
      uHueRange: { value: new THREE.Vector2(80, 160) },
      uSatFloor: { value: 0.15 },
      uLightRange: { value: new THREE.Vector2(0.05, 0.95) },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
    });

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(this.mesh);

    this.exportCanvas = document.createElement("canvas");
    this.exportContext = this.exportCanvas.getContext("2d", { alpha: true });
    this.videoTexture = null;
    this.imageTexture = null;
    this.video = null;

    this.setSize(this.size.width, this.size.height);
  }

  _disposeTextures() {
    if (this.videoTexture) { this.videoTexture.dispose(); this.videoTexture = null; }
    if (this.imageTexture) { this.imageTexture.dispose(); this.imageTexture = null; }
    this.uniforms.uTexture.value = null;
  }

  setSource(video) {
    this._disposeTextures();
    this.video = video;

    this.videoTexture = new THREE.VideoTexture(video);
    this.videoTexture.colorSpace = THREE.SRGBColorSpace;
    this.videoTexture.minFilter = THREE.LinearFilter;
    this.videoTexture.magFilter = THREE.LinearFilter;
    this.videoTexture.generateMipmaps = false;

    this.uniforms.uTexture.value = this.videoTexture;
  }

  setImageSource(img) {
    this._disposeTextures();
    this.video = null;

    this.imageTexture = new THREE.Texture(img);
    this.imageTexture.colorSpace = THREE.SRGBColorSpace;
    this.imageTexture.minFilter = THREE.LinearFilter;
    this.imageTexture.magFilter = THREE.LinearFilter;
    this.imageTexture.generateMipmaps = false;
    this.imageTexture.needsUpdate = true;

    this.uniforms.uTexture.value = this.imageTexture;
  }

  updateTrackers(trackers, threshold) {
    const count = Math.min(trackers.length, 4);
    this.uniforms.uTrackerCount.value = count;
    this.uniforms.uTrackerThreshold.value = threshold ?? 0.15;
    for (let i = 0; i < 4; i++) {
      if (i < count) {
        this.uniforms.uTrackerPositions.value[i].set(trackers[i].x, trackers[i].y);
        this.uniforms.uTrackerModes.value[i] = trackers[i].mode === "keep" ? 1 : trackers[i].mode === "discard" ? -1 : 0;
        this.uniforms.uTrackerStrengths.value[i] = trackers[i].strength ?? 0.15;
      } else {
        this.uniforms.uTrackerPositions.value[i].set(0, 0);
        this.uniforms.uTrackerModes.value[i] = 0;
        this.uniforms.uTrackerStrengths.value[i] = 0.15;
      }
    }
  }

  setSize(width, height) {
    this.size.width = width;
    this.size.height = height;

    this.renderer.setSize(width, height, false);
    this.processedCanvas.width = width;
    this.processedCanvas.height = height;
    this.exportCanvas.width = width;
    this.exportCanvas.height = height;
    this.uniforms.uTexelSize.value.set(1 / width, 1 / height);
  }

  updateCurveLUT(lutData) {
    this.curveLUTTexture.image.data.set(lutData);
    this.curveLUTTexture.needsUpdate = true;
  }

  updateSettings(settings) {
    if (settings.curveLUT) this.updateCurveLUT(settings.curveLUT);
    this.uniforms.uSpillSuppression.value = settings.spillSuppression;
    this.uniforms.uDespillLift.value = settings.despillLift;
    this.uniforms.uChoke.value = settings.choke ?? 0;
    this.uniforms.uFeather.value = settings.feather ?? 0;
    this.uniforms.uViewMode.value = settings.viewMode ?? 0;
    this.uniforms.uUseSampledKey.value = settings.useSampledKey ? 1 : 0;
    this.uniforms.uKeyColorCount.value = settings.keyColors?.length ?? 0;
    this.uniforms.uSampleSimilarity.value = settings.sampleSimilarity ?? 0.1;
    this.uniforms.uDespillDepth.value = settings.despillDepth ?? 0;

    if (settings.hueRange) this.uniforms.uHueRange.value.set(settings.hueRange[0], settings.hueRange[1]);
    this.uniforms.uSatFloor.value = settings.satFloor ?? 0.15;
    if (settings.lightRange) this.uniforms.uLightRange.value.set(settings.lightRange[0], settings.lightRange[1]);

    for (let i = 0; i < 5; i += 1) {
      const color = settings.keyColors?.[i] ?? [0, 1, 0];
      this.uniforms.uKeyColors.value[i].set(color[0], color[1], color[2]);
    }
  }

  renderPreviewFromCanvas(canvas, { viewModeOverride } = {}) {
    if (!this._scrubTexture) {
      this._scrubTexture = new THREE.CanvasTexture(canvas);
      this._scrubTexture.colorSpace = THREE.NoColorSpace;
      this._scrubTexture.minFilter = THREE.LinearFilter;
      this._scrubTexture.magFilter = THREE.LinearFilter;
      this._scrubTexture.generateMipmaps = false;
    } else {
      this._scrubTexture.image = canvas;
    }
    this._scrubTexture.needsUpdate = true;

    const prev = this.uniforms.uTexture.value;
    const previousViewMode = this.uniforms.uViewMode.value;
    if (typeof viewModeOverride === "number") {
      this.uniforms.uViewMode.value = viewModeOverride;
    }

    this.uniforms.uTexture.value = this._scrubTexture;
    this.renderer.render(this.scene, this.camera);
    this.processedContext.clearRect(0, 0, this.size.width, this.size.height);
    this.processedContext.drawImage(this.renderer.domElement, 0, 0, this.size.width, this.size.height);

    this.uniforms.uTexture.value = prev;
    this.uniforms.uViewMode.value = previousViewMode;
  }

  renderPreview({ viewModeOverride } = {}) {
    const tex = this.uniforms.uTexture.value;
    if (!tex) return;

    const previousViewMode = this.uniforms.uViewMode.value;
    if (typeof viewModeOverride === "number") {
      this.uniforms.uViewMode.value = viewModeOverride;
    }

    tex.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
    this.processedContext.clearRect(0, 0, this.size.width, this.size.height);
    this.processedContext.drawImage(this.renderer.domElement, 0, 0, this.size.width, this.size.height);

    this.uniforms.uViewMode.value = previousViewMode;
  }

  renderInto(canvas, { alphaBackground = false, viewModeOverride } = {}) {
    const tex = this.uniforms.uTexture.value;
    if (!tex) return;

    const context = canvas.getContext("2d", { alpha: true });
    const previousViewMode = this.uniforms.uViewMode.value;
    if (typeof viewModeOverride === "number") {
      this.uniforms.uViewMode.value = viewModeOverride;
    }
    tex.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
    context.clearRect(0, 0, canvas.width, canvas.height);

    if (!alphaBackground) {
      context.fillStyle = "#050709";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }

    context.drawImage(this.renderer.domElement, 0, 0, canvas.width, canvas.height);
    this.uniforms.uViewMode.value = previousViewMode;
  }

  async captureFrame({ alpha = false, viewModeOverride } = {}) {
    this.renderInto(this.exportCanvas, { alphaBackground: alpha, viewModeOverride });
    return createImageBitmap(this.exportCanvas);
  }

  /** Synchronous capture — returns an ImageData directly, no GPU roundtrip allocation. */
  captureFrameSync({ alpha = false, viewModeOverride } = {}) {
    this.renderInto(this.exportCanvas, { alphaBackground: alpha, viewModeOverride });
    return this.exportContext.getImageData(0, 0, this.exportCanvas.width, this.exportCanvas.height);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this._disposeTextures();
    this.renderer.dispose();
  }
}
