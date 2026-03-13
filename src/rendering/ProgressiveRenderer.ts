import * as THREE from "three";

/**
 * Progressive Renderer
 * - Idle 상태에서 매 프레임 샘플을 누적하여 고품질 렌더링
 * - Monte Carlo 샘플링으로 soft shadow 계산
 */
export class ProgressiveRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.Camera;

  // Render targets for ping-pong accumulation
  private accumTarget: THREE.WebGLRenderTarget;
  private tempTarget: THREE.WebGLRenderTarget;

  // Blend quad
  private blendScene: THREE.Scene;
  private blendCamera: THREE.OrthographicCamera;
  private blendMaterial: THREE.ShaderMaterial;
  private blendQuad: THREE.Mesh;

  // State
  private frameCount: number = 0;
  private isActive: boolean = false;
  private maxSamples: number = 128;

  // Callbacks
  private onFrameUpdate?: (frame: number, maxFrames: number) => void;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    const size = renderer.getSize(new THREE.Vector2());
    const width = size.x;
    const height = size.y;

    // Create render targets
    const rtOptions: THREE.RenderTargetOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.FloatType, // HDR accumulation
    };

    this.accumTarget = new THREE.WebGLRenderTarget(width, height, rtOptions);
    this.tempTarget = new THREE.WebGLRenderTarget(width, height, rtOptions);

    // Create blend scene
    this.blendScene = new THREE.Scene();
    this.blendCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.blendMaterial = new THREE.ShaderMaterial({
      uniforms: {
        accumTex: { value: null },
        newSampleTex: { value: null },
        weight: { value: 1.0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D accumTex;
        uniform sampler2D newSampleTex;
        uniform float weight;
        varying vec2 vUv;
        void main() {
          vec4 accum = texture2D(accumTex, vUv);
          vec4 newSample = texture2D(newSampleTex, vUv);
          gl_FragColor = mix(accum, newSample, weight);
        }
      `,
    });

    this.blendQuad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this.blendMaterial
    );
    this.blendScene.add(this.blendQuad);
  }

  /**
   * 렌더 타겟 리사이즈
   */
  resize(width: number, height: number): void {
    this.accumTarget.setSize(width, height);
    this.tempTarget.setSize(width, height);
    this.reset();
  }

  /**
   * Progressive rendering 시작
   */
  start(): void {
    this.isActive = true;
    this.frameCount = 0;
  }

  /**
   * Progressive rendering 중지 및 리셋
   */
  reset(): void {
    this.isActive = false;
    this.frameCount = 0;
  }

  /**
   * 현재 활성 상태 확인
   */
  isRendering(): boolean {
    return this.isActive && this.frameCount < this.maxSamples;
  }

  /**
   * 최대 샘플 수 설정
   */
  setMaxSamples(samples: number): void {
    this.maxSamples = samples;
  }

  /**
   * 프레임 업데이트 콜백 설정
   */
  setOnFrameUpdate(callback: (frame: number, maxFrames: number) => void): void {
    this.onFrameUpdate = callback;
  }

  /**
   * 현재 프레임 번호 반환 (셰이더에서 랜덤 시드로 사용)
   */
  getFrameCount(): number {
    return this.frameCount;
  }

  /**
   * 매 프레임 호출 - 새 샘플 렌더링 및 누적
   * @returns true if still rendering, false if complete
   */
  render(): boolean {
    if (!this.isActive || this.frameCount >= this.maxSamples) {
      return false;
    }

    // 1. 새 샘플을 tempTarget에 렌더링
    this.renderer.setRenderTarget(this.tempTarget);
    this.renderer.render(this.scene, this.camera);

    // 2. 누적 블렌딩
    if (this.frameCount === 0) {
      // 첫 프레임: 직접 복사
      this.blendMaterial.uniforms.weight.value = 1.0;
    } else {
      // 이후 프레임: 가중 평균
      this.blendMaterial.uniforms.weight.value = 1.0 / (this.frameCount + 1);
    }

    this.blendMaterial.uniforms.accumTex.value = this.accumTarget.texture;
    this.blendMaterial.uniforms.newSampleTex.value = this.tempTarget.texture;

    // Ping-pong: accumTarget과 tempTarget 교환
    const swapTarget = this.accumTarget;
    this.accumTarget = this.tempTarget;
    this.tempTarget = swapTarget;

    // 블렌딩 결과를 accumTarget에 저장
    this.renderer.setRenderTarget(this.accumTarget);
    this.renderer.render(this.blendScene, this.blendCamera);

    // 3. 화면에 표시
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.blendScene, this.blendCamera);

    this.frameCount++;

    if (this.onFrameUpdate) {
      this.onFrameUpdate(this.frameCount, this.maxSamples);
    }

    return this.frameCount < this.maxSamples;
  }

  /**
   * 현재 누적 결과를 화면에 표시 (렌더링 없이)
   */
  display(): void {
    if (this.frameCount > 0) {
      this.blendMaterial.uniforms.accumTex.value = this.accumTarget.texture;
      this.blendMaterial.uniforms.newSampleTex.value = this.accumTarget.texture;
      this.blendMaterial.uniforms.weight.value = 0.0;

      this.renderer.setRenderTarget(null);
      this.renderer.render(this.blendScene, this.blendCamera);
    }
  }

  dispose(): void {
    this.accumTarget.dispose();
    this.tempTarget.dispose();
    this.blendMaterial.dispose();
    this.blendQuad.geometry.dispose();
  }
}
