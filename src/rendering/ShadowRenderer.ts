import * as THREE from "three";
import { DEMAtlas, TileInfo } from "./DEMAtlas";

// 셰이더 코드
const shadowVertexShader = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`;

const shadowFragmentShader = `
precision highp float;

uniform sampler2D uDEMAtlas;
uniform sampler2D uAccumTex;
uniform vec3 uSunDirection;
uniform vec2 uAtlasSize;
uniform float uPixelScale;
uniform float uFrameWeight;  // 1/frameCount

varying vec2 vUv;

// Amanatides-Woo ray marching
float traceShadow(vec2 startUV, float startElevation) {
  vec2 sunDir2D = normalize(uSunDirection.xz);
  float sunAltitude = uSunDirection.y;

  if (sunAltitude < 0.05) return 0.0;  // 태양이 너무 낮으면 그림자

  vec2 pixelSize = 1.0 / uAtlasSize;
  vec2 p0 = startUV * uAtlasSize;
  vec2 p = floor(p0);
  vec2 stp = sign(sunDir2D);

  // tMax: 다음 픽셀 경계까지의 파라미터 거리
  vec2 tMax = step(0.0, sunDir2D) * (1.0 - fract(p0))
            + (1.0 - step(0.0, sunDir2D)) * fract(p0);
  tMax /= abs(sunDir2D) + 0.0001;

  // tDelta: 픽셀 하나를 통과하는 데 필요한 거리
  vec2 tDelta = 1.0 / (abs(sunDir2D) + 0.0001);

  float rayHeight = startElevation;
  float t = 0.0;

  for (int i = 0; i < 512; i++) {
    // 다음 픽셀로 이동
    if (tMax.x < tMax.y) {
      t = tMax.x;
      tMax.x += tDelta.x;
      p.x += stp.x;
    } else {
      t = tMax.y;
      tMax.y += tDelta.y;
      p.y += stp.y;
    }

    vec2 texCoord = (p + 0.5) * pixelSize;

    // 경계 체크
    if (texCoord.x < 0.0 || texCoord.x > 1.0 ||
        texCoord.y < 0.0 || texCoord.y > 1.0) {
      return 1.0;  // 경계 밖 = 태양에 도달
    }

    // 지형 높이 샘플링
    float terrainHeight = texture2D(uDEMAtlas, texCoord).r;

    // Ray 높이 계산 (거리에 따라 상승)
    float distance = t * uPixelScale;
    rayHeight = startElevation + distance * sunAltitude * 50.0;

    // 충돌 체크
    if (terrainHeight > rayHeight) {
      return 0.0;  // 그림자
    }

    // 너무 멀리 가면 중단
    if (t > 500.0) break;
  }

  return 1.0;  // 태양에 도달
}

void main() {
  vec4 accum = texture2D(uAccumTex, vUv);
  float elevation = texture2D(uDEMAtlas, vUv).r;

  // 바다는 그림자 계산 안 함
  if (elevation < 1.0) {
    gl_FragColor = vec4(accum.rgb + vec3(uFrameWeight), 1.0);
    return;
  }

  float shadow = traceShadow(vUv, elevation);

  // 누적
  gl_FragColor = vec4(accum.rgb + vec3(shadow * uFrameWeight), 1.0);
}
`;

// 최종 합성 셰이더 (필요시 사용)
// const compositeFragmentShader = `...`;

/**
 * Shadow Renderer
 * Progressive Monte Carlo soft shadow 렌더링
 */
export class ShadowRenderer {
  private renderer: THREE.WebGLRenderer;
  private demAtlas: DEMAtlas;

  // Ping-pong render targets
  private pingTarget: THREE.WebGLRenderTarget;
  private pongTarget: THREE.WebGLRenderTarget;
  private currentTarget: 0 | 1 = 0;

  // 렌더링용 씬/카메라
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private shadowMaterial: THREE.ShaderMaterial;
  private quad: THREE.Mesh;

  // 상태
  private frameCount: number = 0;
  private maxFrames: number = 128;
  private isRendering: boolean = false;

  // Atlas 정보
  private atlasWidth: number = 0;
  private atlasHeight: number = 0;
  private pixelScale: number = 1.0;

  constructor(renderer: THREE.WebGLRenderer, atlasSize: number = 4096) {
    this.renderer = renderer;
    this.demAtlas = new DEMAtlas(atlasSize);

    // Render targets 생성 (Float 타입으로 누적)
    const targetOptions: THREE.RenderTargetOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.FloatType,
    };

    this.pingTarget = new THREE.WebGLRenderTarget(atlasSize, atlasSize, targetOptions);
    this.pongTarget = new THREE.WebGLRenderTarget(atlasSize, atlasSize, targetOptions);

    // 렌더링 씬 설정
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.shadowMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uDEMAtlas: { value: null },
        uAccumTex: { value: null },
        uSunDirection: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
        uAtlasSize: { value: new THREE.Vector2(atlasSize, atlasSize) },
        uPixelScale: { value: 1.0 },
        uFrameWeight: { value: 1.0 / 128.0 },
      },
      vertexShader: shadowVertexShader,
      fragmentShader: shadowFragmentShader,
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.shadowMaterial);
    this.scene.add(this.quad);
  }

  /**
   * Atlas 빌드 및 렌더링 시작
   */
  async startRendering(tiles: TileInfo[], sunDirection: THREE.Vector3): Promise<void> {
    await this.demAtlas.buildAtlas(tiles);

    const atlas = this.demAtlas.getAtlasTexture();
    if (!atlas) return;

    this.atlasWidth = atlas.image.width;
    this.atlasHeight = atlas.image.height;

    // Render target 크기 조정
    this.pingTarget.setSize(this.atlasWidth, this.atlasHeight);
    this.pongTarget.setSize(this.atlasWidth, this.atlasHeight);

    // 초기화: ping을 0으로 클리어
    this.renderer.setRenderTarget(this.pingTarget);
    this.renderer.clear();
    this.renderer.setRenderTarget(null);

    // Uniforms 설정
    this.shadowMaterial.uniforms.uDEMAtlas.value = atlas;
    this.shadowMaterial.uniforms.uAtlasSize.value.set(this.atlasWidth, this.atlasHeight);
    this.shadowMaterial.uniforms.uSunDirection.value.copy(sunDirection);

    // 픽셀 스케일 계산 (대략적인 값, 줌 레벨에 따라 조정 필요)
    this.pixelScale = 30.0;  // 미터/픽셀 (조정 필요)
    this.shadowMaterial.uniforms.uPixelScale.value = this.pixelScale;

    this.frameCount = 0;
    this.currentTarget = 0;
    this.isRendering = true;

    console.log(`ShadowRenderer started: ${this.atlasWidth}x${this.atlasHeight}`);
  }

  /**
   * 한 프레임 렌더링 (progressive)
   * @returns true if still rendering, false if complete
   */
  renderFrame(sunDirection: THREE.Vector3): boolean {
    if (!this.isRendering || this.frameCount >= this.maxFrames) {
      this.isRendering = false;
      return false;
    }

    // 태양 방향에 약간의 랜덤 추가 (soft shadow)
    const jitteredSun = sunDirection.clone();
    const jitterAmount = 0.02;
    jitteredSun.x += (Math.random() - 0.5) * jitterAmount;
    jitteredSun.z += (Math.random() - 0.5) * jitterAmount;
    jitteredSun.normalize();

    this.shadowMaterial.uniforms.uSunDirection.value.copy(jitteredSun);
    this.shadowMaterial.uniforms.uFrameWeight.value = 1.0 / this.maxFrames;

    // Ping-pong
    const srcTarget = this.currentTarget === 0 ? this.pingTarget : this.pongTarget;
    const dstTarget = this.currentTarget === 0 ? this.pongTarget : this.pingTarget;

    this.shadowMaterial.uniforms.uAccumTex.value = srcTarget.texture;

    this.renderer.setRenderTarget(dstTarget);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);

    this.currentTarget = this.currentTarget === 0 ? 1 : 0;
    this.frameCount++;

    return this.frameCount < this.maxFrames;
  }

  /**
   * 현재 결과 텍스처 반환
   */
  getResultTexture(): THREE.Texture {
    return this.currentTarget === 0 ? this.pingTarget.texture : this.pongTarget.texture;
  }

  /**
   * 현재 프레임 수 반환
   */
  getFrameCount(): number {
    return this.frameCount;
  }

  /**
   * 렌더링 중인지 확인
   */
  isActive(): boolean {
    return this.isRendering;
  }

  /**
   * 렌더링 중단
   */
  stop(): void {
    this.isRendering = false;
  }

  /**
   * 최대 프레임 수 설정
   */
  setMaxFrames(frames: number): void {
    this.maxFrames = frames;
  }

  /**
   * 리소스 해제
   */
  dispose(): void {
    this.pingTarget.dispose();
    this.pongTarget.dispose();
    this.shadowMaterial.dispose();
    this.quad.geometry.dispose();
    this.demAtlas.dispose();
  }
}
