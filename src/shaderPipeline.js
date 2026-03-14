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
uniform float uThresholdLow;
uniform float uThresholdHigh;
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

varying vec2 vUv;

vec3 rgbToYCbCr(vec3 color) {
  float y = dot(color, vec3(0.299, 0.587, 0.114));
  float cb = 0.5 + (color.b - y) * 0.565;
  float cr = 0.5 + (color.r - y) * 0.713;
  return vec3(y, cb, cr);
}

float computeAutoKeyAlpha(vec3 color) {
  float reference = max(color.r, color.b);
  float difference = color.g - reference;
  return 1.0 - smoothstep(uThresholdLow, uThresholdHigh, difference);
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

void main() {
  vec4 sampleColor = texture2D(uTexture, vUv);
  float alpha = computeChokedAlphaAt(vUv);
  alpha = applyFeather(vUv, alpha);
  alpha = clamp(alpha, 0.0, 1.0);

  if (uViewMode > 1.5) {
    gl_FragColor = vec4(sampleColor.rgb, 1.0);
    return;
  }

  float reference = max(sampleColor.r, sampleColor.b);
  float spillAmount = max(sampleColor.g - max(sampleColor.r, sampleColor.b), 0.0);
  float spillFactor = 1.0 - smoothstep(0.0, max(uSpillSuppression, 0.0001), spillAmount);
  float edgeMask = spillFactor * (1.0 - alpha);
  vec3 neutralized = vec3(
    sampleColor.r + uDespillLift * edgeMask,
    mix(sampleColor.g, reference, edgeMask),
    sampleColor.b + uDespillLift * edgeMask * 0.55
  );

  float lumBefore = dot(sampleColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  float lumAfter = dot(neutralized, vec3(0.2126, 0.7152, 0.0722));
  neutralized *= lumBefore / max(lumAfter, 0.001);
  neutralized = clamp(neutralized, 0.0, 1.0);

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

    this.uniforms = {
      uTexture: { value: null },
      uThresholdLow: { value: 0.1 },
      uThresholdHigh: { value: 0.2 },
      uSpillSuppression: { value: 0.12 },
      uDespillLift: { value: 0.08 },
      uChoke: { value: 0 },
      uFeather: { value: 0 },
      uViewMode: { value: 0 },
      uUseSampledKey: { value: 0 },
      uKeyColorCount: { value: 0 },
      uSampleSimilarity: { value: 0.1 },
      uKeyColors: { value: Array.from({ length: 5 }, () => new THREE.Vector3(0, 1, 0)) },
      uTexelSize: { value: new THREE.Vector2(1 / this.size.width, 1 / this.size.height) },
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

  updateSettings(settings) {
    this.uniforms.uThresholdLow.value = settings.thresholdLow;
    this.uniforms.uThresholdHigh.value = settings.thresholdHigh;
    this.uniforms.uSpillSuppression.value = settings.spillSuppression;
    this.uniforms.uDespillLift.value = settings.despillLift;
    this.uniforms.uChoke.value = settings.choke ?? 0;
    this.uniforms.uFeather.value = settings.feather ?? 0;
    this.uniforms.uViewMode.value = settings.viewMode ?? 0;
    this.uniforms.uUseSampledKey.value = settings.useSampledKey ? 1 : 0;
    this.uniforms.uKeyColorCount.value = settings.keyColors?.length ?? 0;
    this.uniforms.uSampleSimilarity.value = settings.sampleSimilarity ?? 0.1;

    for (let i = 0; i < 5; i += 1) {
      const color = settings.keyColors?.[i] ?? [0, 1, 0];
      this.uniforms.uKeyColors.value[i].set(color[0], color[1], color[2]);
    }
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

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this._disposeTextures();
    this.renderer.dispose();
  }
}
