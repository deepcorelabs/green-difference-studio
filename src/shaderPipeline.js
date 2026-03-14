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

varying vec2 vUv;

void main() {
  vec4 sampleColor = texture2D(uTexture, vUv);
  float reference = max(sampleColor.r, sampleColor.b);
  float difference = sampleColor.g - reference;
  float alpha = 1.0 - smoothstep(uThresholdLow, uThresholdHigh, difference);

  float spillAmount = max(sampleColor.g - max(sampleColor.r, sampleColor.b), 0.0);
  float spillFactor = 1.0 - smoothstep(0.0, max(uSpillSuppression, 0.0001), spillAmount);
  float edgeMask = spillFactor * (1.0 - alpha);
  vec3 neutralized = vec3(
    sampleColor.r + uDespillLift * edgeMask,
    mix(sampleColor.g, reference, edgeMask),
    sampleColor.b + uDespillLift * edgeMask * 0.55
  );

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
    this.video = null;

    this.setSize(this.size.width, this.size.height);
  }

  setSource(video) {
    this.video = video;
    if (this.videoTexture) {
      this.videoTexture.dispose();
    }

    this.videoTexture = new THREE.VideoTexture(video);
    this.videoTexture.colorSpace = THREE.SRGBColorSpace;
    this.videoTexture.minFilter = THREE.LinearFilter;
    this.videoTexture.magFilter = THREE.LinearFilter;
    this.videoTexture.generateMipmaps = false;

    this.uniforms.uTexture.value = this.videoTexture;
  }

  setSize(width, height) {
    this.size.width = width;
    this.size.height = height;

    this.renderer.setSize(width, height, false);
    this.processedCanvas.width = width;
    this.processedCanvas.height = height;
    this.exportCanvas.width = width;
    this.exportCanvas.height = height;
  }

  updateSettings(settings) {
    this.uniforms.uThresholdLow.value = settings.thresholdLow;
    this.uniforms.uThresholdHigh.value = settings.thresholdHigh;
    this.uniforms.uSpillSuppression.value = settings.spillSuppression;
    this.uniforms.uDespillLift.value = settings.despillLift;
  }

  renderPreview() {
    if (!this.videoTexture) {
      return;
    }

    this.videoTexture.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
    this.processedContext.clearRect(0, 0, this.size.width, this.size.height);
    this.processedContext.drawImage(this.renderer.domElement, 0, 0, this.size.width, this.size.height);
  }

  renderInto(canvas, { alphaBackground = false } = {}) {
    if (!this.videoTexture) {
      return;
    }

    const context = canvas.getContext("2d", { alpha: true });
    this.videoTexture.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
    context.clearRect(0, 0, canvas.width, canvas.height);

    if (!alphaBackground) {
      context.fillStyle = "#050709";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }

    context.drawImage(this.renderer.domElement, 0, 0, canvas.width, canvas.height);
  }

  async captureFrame({ alpha = false } = {}) {
    this.renderInto(this.exportCanvas, { alphaBackground: alpha });
    return createImageBitmap(this.exportCanvas);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.videoTexture?.dispose();
    this.renderer.dispose();
  }
}
