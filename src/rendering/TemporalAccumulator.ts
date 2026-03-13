import * as THREE from "three";

/**
 * Temporal Accumulator
 * 프레임별 렌더링 결과를 누적하여 품질 향상
 * Ping-pong 버퍼 사용
 */
export class TemporalAccumulator {
  private renderer: THREE.WebGLRenderer;

  // Ping-pong 렌더 타겟
  private pingTarget: THREE.WebGLRenderTarget;
  private pongTarget: THREE.WebGLRenderTarget;
  private currentTarget: 0 | 1 = 0;

  // 블렌딩용 풀스크린 쿼드
  private blendScene: THREE.Scene;
  private blendCamera: THREE.OrthographicCamera;
  private blendMaterial: THREE.ShaderMaterial;
  private blendQuad: THREE.Mesh;

  // 최종 출력용
  private outputScene: THREE.Scene;
  private outputMaterial: THREE.ShaderMaterial;
  private outputQuad: THREE.Mesh;

  // 상태
  private frameCount: number = 0;
  private isAccumulating: boolean = false;

  constructor(renderer: THREE.WebGLRenderer, width: number, height: number) {
    this.renderer = renderer;

    // 렌더 타겟 생성 (Float 타입으로 정밀도 유지)
    const targetOptions: THREE.RenderTargetOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,  // 메모리 절약
    };

    this.pingTarget = new THREE.WebGLRenderTarget(width, height, targetOptions);
    this.pongTarget = new THREE.WebGLRenderTarget(width, height, targetOptions);

    // 블렌딩 셰이더: wwwtyro 방식 - 누적합에 새 샘플 더하기
    this.blendMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uPrevFrame: { value: null },
        uNewFrame: { value: null },
        uWeight: { value: 1.0 / 128.0 },  // 1/totalFrames
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform sampler2D uPrevFrame;
        uniform sampler2D uNewFrame;
        uniform float uWeight;
        varying vec2 vUv;

        void main() {
          vec4 prev = texture2D(uPrevFrame, vUv);
          vec4 curr = texture2D(uNewFrame, vUv);

          // wwwtyro 방식: 누적합 += 새샘플 * weight
          // 최종 결과는 0~1 범위로 자동 수렴
          gl_FragColor = vec4(prev.rgb + curr.rgb * uWeight, 1.0);
        }
      `,
    });

    this.blendScene = new THREE.Scene();
    this.blendCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.blendQuad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this.blendMaterial
    );
    this.blendScene.add(this.blendQuad);

    // 출력용 셰이더 (그냥 텍스처 표시)
    this.outputMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: null },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform sampler2D uTexture;
        varying vec2 vUv;

        void main() {
          gl_FragColor = texture2D(uTexture, vUv);
        }
      `,
    });

    this.outputScene = new THREE.Scene();
    this.outputQuad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this.outputMaterial
    );
    this.outputScene.add(this.outputQuad);
  }

  /**
   * 누적 시작 (리셋)
   * @param maxFrames 총 누적 프레임 수 (weight = 1/maxFrames)
   */
  start(maxFrames: number = 128): void {
    this.frameCount = 0;
    this.isAccumulating = true;
    this.currentTarget = 0;

    // weight 설정: 1/totalFrames
    this.blendMaterial.uniforms.uWeight.value = 1.0 / maxFrames;

    // 버퍼를 검은색으로 클리어 (누적 시작점)
    const prevClearColor = this.renderer.getClearColor(new THREE.Color());
    const prevClearAlpha = this.renderer.getClearAlpha();

    this.renderer.setClearColor(0x000000, 1);
    this.renderer.setRenderTarget(this.pingTarget);
    this.renderer.clear();
    this.renderer.setRenderTarget(this.pongTarget);
    this.renderer.clear();
    this.renderer.setRenderTarget(null);

    this.renderer.setClearColor(prevClearColor, prevClearAlpha);
  }

  /**
   * 누적 중단
   */
  stop(): void {
    this.isAccumulating = false;
  }

  /**
   * 새 프레임 렌더링 후 누적
   * @param renderScene 메인 씬 렌더링 함수
   */
  accumulate(
    scene: THREE.Scene,
    camera: THREE.Camera,
    tempTarget: THREE.WebGLRenderTarget
  ): void {
    if (!this.isAccumulating) return;

    this.frameCount++;

    // 1. 새 프레임을 임시 타겟에 렌더링
    this.renderer.setRenderTarget(tempTarget);
    this.renderer.render(scene, camera);

    // 2. 이전 결과와 블렌딩
    const srcTarget = this.currentTarget === 0 ? this.pingTarget : this.pongTarget;
    const dstTarget = this.currentTarget === 0 ? this.pongTarget : this.pingTarget;

    this.blendMaterial.uniforms.uPrevFrame.value = srcTarget.texture;
    this.blendMaterial.uniforms.uNewFrame.value = tempTarget.texture;
    // uWeight는 생성자에서 설정됨 (1/totalFrames)

    this.renderer.setRenderTarget(dstTarget);
    this.renderer.render(this.blendScene, this.blendCamera);

    // 3. 타겟 스왑
    this.currentTarget = this.currentTarget === 0 ? 1 : 0;

    this.renderer.setRenderTarget(null);
  }

  /**
   * 누적된 결과를 화면에 출력
   */
  render(): void {
    const resultTarget = this.currentTarget === 0 ? this.pingTarget : this.pongTarget;
    this.outputMaterial.uniforms.uTexture.value = resultTarget.texture;
    this.renderer.render(this.outputScene, this.blendCamera);
  }

  /**
   * 현재 프레임 수
   */
  getFrameCount(): number {
    return this.frameCount;
  }

  /**
   * 누적 중인지 확인
   */
  isActive(): boolean {
    return this.isAccumulating;
  }

  /**
   * 리사이즈
   */
  resize(width: number, height: number): void {
    this.pingTarget.setSize(width, height);
    this.pongTarget.setSize(width, height);
  }

  /**
   * 리소스 해제
   */
  dispose(): void {
    this.pingTarget.dispose();
    this.pongTarget.dispose();
    this.blendMaterial.dispose();
    this.blendQuad.geometry.dispose();
    this.outputMaterial.dispose();
    this.outputQuad.geometry.dispose();
  }
}
