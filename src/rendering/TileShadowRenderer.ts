import * as THREE from "three";
import { RENDER_SETTINGS, getDemTileInfo } from "../constants";

// 셰이더 임포트 (vite-plugin-glsl)
import fullscreenVertexShader from "./shaders/fullscreen.vert.glsl";
import shadowAccumulateShader from "./shaders/shadow-accumulate.frag.glsl";
import aoAccumulateShader from "./shaders/ao-accumulate.frag.glsl";

/**
 * 타일별 Shadow + AO 누적 렌더러 (wwwtyro 방식)
 *
 * 각 타일에 대해:
 * 1. Shadow: jittered 태양 방향으로 shadow 계산 → ping-pong 누적
 * 2. AO: 랜덤 반구 방향으로 하늘 노출도 계산 → ping-pong 누적
 */

interface TileShadowData {
  // Shadow ping-pong
  shadowPingTarget: THREE.WebGLRenderTarget;
  shadowPongTarget: THREE.WebGLRenderTarget;
  shadowCurrentTarget: 0 | 1;
  shadowFrameCount: number;
  shadowMaterial: THREE.ShaderMaterial;
  // AO ping-pong
  aoPingTarget: THREE.WebGLRenderTarget;
  aoPongTarget: THREE.WebGLRenderTarget;
  aoCurrentTarget: 0 | 1;
  aoFrameCount: number;
  aoMaterial: THREE.ShaderMaterial;
}

export class TileShadowRenderer {
  private renderer: THREE.WebGLRenderer;
  private tileSize: number;

  // 렌더링용
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private quad: THREE.Mesh;

  // 타일별 데이터
  private tileData: Map<string, TileShadowData> = new Map();

  // 설정
  private maxFrames: number = 128;

  // wwwtyro 방식: 태양의 angular size 시뮬레이션
  private sunRadiusMultiplier: number = RENDER_SETTINGS.sunJitter;

  // 기본 태양 방향
  private baseSunDirection: THREE.Vector3 = new THREE.Vector3();

  // 더미 텍스처
  private dummyTexture: THREE.DataTexture;

  // AO 렌더링 활성화 여부
  private aoEnabled: boolean = false;

  // Z축 강조 배율
  private elevationScale: number = RENDER_SETTINGS.elevationScale;

  // AO 계산 범위 스케일
  private aoRangeScale: number = RENDER_SETTINGS.aoRangeScale;

  constructor(renderer: THREE.WebGLRenderer, tileSize: number = 512) {
    this.renderer = renderer;
    this.tileSize = tileSize;

    // 렌더링 씬 설정
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // 더미 텍스처 생성
    this.dummyTexture = new THREE.DataTexture(
      new Uint8Array([128, 0, 0, 255]),
      1,
      1,
      THREE.RGBAFormat,
    );
    this.dummyTexture.needsUpdate = true;

    // Fullscreen quad
    const geometry = new THREE.PlaneGeometry(2, 2);
    this.quad = new THREE.Mesh(geometry);
    this.scene.add(this.quad);
  }

  /**
   * AO 렌더링 활성화/비활성화
   */
  setAOEnabled(enabled: boolean): void {
    this.aoEnabled = enabled;
  }

  /**
   * 기본 태양 방향 설정
   */
  setSunDirection(direction: THREE.Vector3): void {
    this.baseSunDirection.copy(direction);
  }

  /**
   * 타일 좌표에서 월드 위치 계산
   */
  private calculateTileWorldPosition(
    z: number,
    x: number,
    y: number,
  ): { center: THREE.Vector3; east: THREE.Vector3; north: THREE.Vector3 } {
    const n = Math.pow(2, z);
    const lon = ((x + 0.5) / n) * 360 - 180;
    const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n)));
    const lat = (latRad * 180) / Math.PI;

    const lonRad = (lon * Math.PI) / 180;
    const latRadFinal = (lat * Math.PI) / 180;

    const center = new THREE.Vector3(
      Math.cos(latRadFinal) * Math.cos(lonRad),
      Math.sin(latRadFinal),
      -Math.cos(latRadFinal) * Math.sin(lonRad),
    );

    const east = new THREE.Vector3(
      -Math.sin(lonRad),
      0,
      -Math.cos(lonRad),
    ).normalize();

    const north = new THREE.Vector3().crossVectors(center, east).normalize();

    return { center, east, north };
  }

  /**
   * WebMercator 기준 타일 중심의 지상 해상도 (meters / texel)
   */
  private calculateMetersPerTexel(z: number, y: number): number {
    // DEM은 최대 z=12이므로, z > 12일 때는 z=12 기준으로 계산
    const demZ = Math.min(z, 12);
    const demN = Math.pow(2, demZ);
    // y도 DEM 줌 레벨 기준으로 변환
    const scale = Math.pow(2, z - demZ);
    const demY = Math.floor(y / scale);
    const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (demY + 0.5)) / demN)));
    const earthRadius = 6_371_000.0;
    const metersPerPixelAtEquator =
      (2 * Math.PI * earthRadius) / (demN * this.tileSize);
    return Math.max(0.01, metersPerPixelAtEquator * Math.cos(latRad));
  }

  /**
   * 공통 DEM uniform 객체 생성
   */
  private createDemUniforms(
    demTexture: THREE.Texture,
    z: number,
    x: number,
    y: number,
    center: THREE.Vector3,
    east: THREE.Vector3,
    north: THREE.Vector3,
    metersPerTexel: number,
  ): Record<string, { value: unknown }> {
    // DEM UV 변환 정보 (z > 12일 때 상위 타일의 해당 부분만 사용)
    const demInfo = getDemTileInfo(z, x, y);

    return {
      demMap: { value: demTexture },
      demMapN: { value: this.dummyTexture },
      demMapNE: { value: this.dummyTexture },
      demMapE: { value: this.dummyTexture },
      demMapSE: { value: this.dummyTexture },
      demMapS: { value: this.dummyTexture },
      demMapSW: { value: this.dummyTexture },
      demMapW: { value: this.dummyTexture },
      demMapNW: { value: this.dummyTexture },
      uHasN: { value: 0.0 },
      uHasNE: { value: 0.0 },
      uHasE: { value: 0.0 },
      uHasSE: { value: 0.0 },
      uHasS: { value: 0.0 },
      uHasSW: { value: 0.0 },
      uHasW: { value: 0.0 },
      uHasNW: { value: 0.0 },
      uTileCenter: { value: center.clone() },
      uTileEast: { value: east.clone() },
      uTileNorth: { value: north.clone() },
      uZoomLevel: { value: z },
      uMetersPerTexel: { value: metersPerTexel },
      uElevationScale: { value: this.elevationScale },
      uTileX: { value: x },
      uTileY: { value: y },
      uAoRangeScale: { value: this.aoRangeScale },
      uDemUvScale: { value: new THREE.Vector2(demInfo.uvScale[0], demInfo.uvScale[1]) },
      uDemUvOffset: { value: new THREE.Vector2(demInfo.uvOffset[0], demInfo.uvOffset[1]) },
    };
  }

  /**
   * 타일 초기화
   */
  initTile(
    tileKey: string,
    z: number,
    x: number,
    y: number,
    demTexture: THREE.Texture,
    neighborTextures: Map<string, THREE.Texture>,
  ): void {
    // 기존 데이터가 있으면 리셋
    if (this.tileData.has(tileKey)) {
      const data = this.tileData.get(tileKey)!;
      const { center, east, north } = this.calculateTileWorldPosition(z, x, y);
      const metersPerTexel = this.calculateMetersPerTexel(z, y);

      // DEM UV 변환 정보
      const demInfo = getDemTileInfo(z, x, y);

      // Shadow 리셋
      data.shadowFrameCount = 0;
      data.shadowCurrentTarget = 0;
      this.updateMaterialTextures(
        data.shadowMaterial,
        demTexture,
        neighborTextures,
      );
      data.shadowMaterial.uniforms.uTileCenter.value.copy(center);
      data.shadowMaterial.uniforms.uTileEast.value.copy(east);
      data.shadowMaterial.uniforms.uTileNorth.value.copy(north);
      data.shadowMaterial.uniforms.uZoomLevel.value = z;
      data.shadowMaterial.uniforms.uMetersPerTexel.value = metersPerTexel;
      data.shadowMaterial.uniforms.uTileX.value = x;
      data.shadowMaterial.uniforms.uTileY.value = y;
      data.shadowMaterial.uniforms.uDemUvScale.value.set(demInfo.uvScale[0], demInfo.uvScale[1]);
      data.shadowMaterial.uniforms.uDemUvOffset.value.set(demInfo.uvOffset[0], demInfo.uvOffset[1]);

      // AO 리셋
      data.aoFrameCount = 0;
      data.aoCurrentTarget = 0;
      this.updateMaterialTextures(
        data.aoMaterial,
        demTexture,
        neighborTextures,
      );
      data.aoMaterial.uniforms.uZoomLevel.value = z;
      data.aoMaterial.uniforms.uMetersPerTexel.value = metersPerTexel;
      data.aoMaterial.uniforms.uTileX.value = x;
      data.aoMaterial.uniforms.uTileY.value = y;
      data.aoMaterial.uniforms.uDemUvScale.value.set(demInfo.uvScale[0], demInfo.uvScale[1]);
      data.aoMaterial.uniforms.uDemUvOffset.value.set(demInfo.uvOffset[0], demInfo.uvOffset[1]);

      this.clearTargets(data);
      return;
    }

    // Ping-pong 타겟 생성
    const targetOptions: THREE.RenderTargetOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
    };

    // Shadow targets
    const shadowPingTarget = new THREE.WebGLRenderTarget(
      this.tileSize,
      this.tileSize,
      targetOptions,
    );
    const shadowPongTarget = new THREE.WebGLRenderTarget(
      this.tileSize,
      this.tileSize,
      targetOptions,
    );

    // AO targets
    const aoPingTarget = new THREE.WebGLRenderTarget(
      this.tileSize,
      this.tileSize,
      targetOptions,
    );
    const aoPongTarget = new THREE.WebGLRenderTarget(
      this.tileSize,
      this.tileSize,
      targetOptions,
    );

    // 타일 월드 위치 계산
    const { center, east, north } = this.calculateTileWorldPosition(z, x, y);
    const metersPerTexel = this.calculateMetersPerTexel(z, y);

    // Shadow 머티리얼
    const shadowMaterial = new THREE.ShaderMaterial({
      uniforms: {
        ...this.createDemUniforms(
          demTexture,
          z,
          x,
          y,
          center,
          east,
          north,
          metersPerTexel,
        ),
        uPrevShadow: { value: shadowPingTarget.texture },
        uWeight: { value: 1.0 / this.maxFrames },
        uSunDirection: { value: new THREE.Vector3() },
      },
      vertexShader: fullscreenVertexShader,
      fragmentShader: shadowAccumulateShader,
    });

    // AO 머티리얼
    const aoMaterial = new THREE.ShaderMaterial({
      uniforms: {
        ...this.createDemUniforms(
          demTexture,
          z,
          x,
          y,
          center,
          east,
          north,
          metersPerTexel,
        ),
        uPrevAO: { value: aoPingTarget.texture },
        uWeight: { value: 1.0 / this.maxFrames },
        uRandomDirection: { value: new THREE.Vector3() },
      },
      vertexShader: fullscreenVertexShader,
      fragmentShader: aoAccumulateShader,
    });

    this.updateMaterialTextures(shadowMaterial, demTexture, neighborTextures);
    this.updateMaterialTextures(aoMaterial, demTexture, neighborTextures);

    const data: TileShadowData = {
      shadowPingTarget,
      shadowPongTarget,
      shadowCurrentTarget: 0,
      shadowFrameCount: 0,
      shadowMaterial,
      aoPingTarget,
      aoPongTarget,
      aoCurrentTarget: 0,
      aoFrameCount: 0,
      aoMaterial,
    };

    this.tileData.set(tileKey, data);
    this.clearTargets(data);
  }

  /**
   * 머티리얼 텍스처 업데이트
   */
  private updateMaterialTextures(
    material: THREE.ShaderMaterial,
    demTexture: THREE.Texture,
    neighborTextures: Map<string, THREE.Texture>,
  ): void {
    material.uniforms.demMap.value = demTexture;

    const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    for (const dir of directions) {
      const tex = neighborTextures.get(dir);
      material.uniforms[`demMap${dir}`].value = tex || this.dummyTexture;
      material.uniforms[`uHas${dir}`].value = tex ? 1.0 : 0.0;
    }
  }

  /**
   * 타겟 클리어
   */
  private clearTargets(data: TileShadowData): void {
    const prevClearColor = this.renderer.getClearColor(new THREE.Color());
    const prevClearAlpha = this.renderer.getClearAlpha();

    // 검정(0.0)으로 초기화 - wwwtyro 방식은 0에서 누적 시작
    this.renderer.setClearColor(0x000000, 1);

    // Shadow targets
    this.renderer.setRenderTarget(data.shadowPingTarget);
    this.renderer.clear();
    this.renderer.setRenderTarget(data.shadowPongTarget);
    this.renderer.clear();

    // AO targets
    this.renderer.setRenderTarget(data.aoPingTarget);
    this.renderer.clear();
    this.renderer.setRenderTarget(data.aoPongTarget);
    this.renderer.clear();

    this.renderer.setRenderTarget(null);
    this.renderer.setClearColor(prevClearColor, prevClearAlpha);
  }

  /**
   * wwwtyro 방식의 jittered 태양 방향 생성
   */
  private generateJitteredSunDirection(): THREE.Vector3 {
    const sunDistance = 149600000;
    const sunRadius = 695508;

    const sunDir = this.baseSunDirection.clone().normalize();

    const arbitrary =
      Math.abs(sunDir.y) < 0.9
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(1, 0, 0);
    const tangent1 = new THREE.Vector3()
      .crossVectors(sunDir, arbitrary)
      .normalize();
    const tangent2 = new THREE.Vector3()
      .crossVectors(sunDir, tangent1)
      .normalize();

    const angle = Math.random() * Math.PI * 2;
    const radius =
      Math.sqrt(Math.random()) * sunRadius * this.sunRadiusMultiplier;

    const sunPos = sunDir.clone().multiplyScalar(sunDistance);
    sunPos.addScaledVector(tangent1, Math.cos(angle) * radius);
    sunPos.addScaledVector(tangent2, Math.sin(angle) * radius);

    return sunPos.normalize();
  }

  /**
   * 랜덤 반구 방향 생성 (AO용)
   * wwwtyro는 상반구 전체에서 균등하게 샘플링
   */
  private generateRandomHemisphereDirection(): THREE.Vector3 {
    // 구면 좌표계에서 균등 분포
    const u = Math.random();
    const v = Math.random();

    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1); // 전체 구

    // 상반구만 (z >= 0)
    const sinPhi = Math.sin(phi);
    const x = sinPhi * Math.cos(theta);
    const y = sinPhi * Math.sin(theta);
    const z = Math.abs(Math.cos(phi)); // 항상 양수 (상반구)

    return new THREE.Vector3(x, y, z);
  }

  /**
   * 한 프레임 렌더링 (모든 타일)
   */
  renderFrame(): boolean {
    let stillRendering = false;

    const jitteredSun = this.generateJitteredSunDirection();
    const randomDir = this.generateRandomHemisphereDirection();

    for (const [, data] of this.tileData) {
      // Shadow 렌더링
      if (data.shadowFrameCount < this.maxFrames) {
        stillRendering = true;
        data.shadowFrameCount++;

        const srcTarget =
          data.shadowCurrentTarget === 0
            ? data.shadowPingTarget
            : data.shadowPongTarget;
        const dstTarget =
          data.shadowCurrentTarget === 0
            ? data.shadowPongTarget
            : data.shadowPingTarget;

        data.shadowMaterial.uniforms.uPrevShadow.value = srcTarget.texture;
        data.shadowMaterial.uniforms.uWeight.value = 1.0 / this.maxFrames;
        data.shadowMaterial.uniforms.uSunDirection.value.copy(jitteredSun);

        this.quad.material = data.shadowMaterial;
        this.renderer.setRenderTarget(dstTarget);
        this.renderer.render(this.scene, this.camera);

        data.shadowCurrentTarget = data.shadowCurrentTarget === 0 ? 1 : 0;
      }

      // AO 렌더링 (활성화된 경우만)
      if (this.aoEnabled && data.aoFrameCount < this.maxFrames) {
        stillRendering = true;
        data.aoFrameCount++;

        // 첫 프레임에서만 로그 출력
        // if (data.aoFrameCount === 1) {
        //   const uniforms = data.aoMaterial.uniforms;
        //   console.log(`[AO] tileKey=${tileKey} z=${uniforms.uZoomLevel.value} metersPerTexel=${uniforms.uMetersPerTexel.value.toFixed(2)} elevationScale=${uniforms.uElevationScale.value} aoRangeScale=${uniforms.uAoRangeScale.value}`);
        // }

        const srcTarget =
          data.aoCurrentTarget === 0 ? data.aoPingTarget : data.aoPongTarget;
        const dstTarget =
          data.aoCurrentTarget === 0 ? data.aoPongTarget : data.aoPingTarget;

        data.aoMaterial.uniforms.uPrevAO.value = srcTarget.texture;
        data.aoMaterial.uniforms.uWeight.value = 1.0 / this.maxFrames;
        data.aoMaterial.uniforms.uRandomDirection.value.copy(randomDir);

        this.quad.material = data.aoMaterial;
        this.renderer.setRenderTarget(dstTarget);
        this.renderer.render(this.scene, this.camera);

        data.aoCurrentTarget = data.aoCurrentTarget === 0 ? 1 : 0;
      }
    }

    this.renderer.setRenderTarget(null);
    return stillRendering;
  }

  /**
   * 타일의 결과 shadow 텍스처
   */
  getShadowTexture(tileKey: string): THREE.Texture | null {
    const data = this.tileData.get(tileKey);
    if (!data) return null;

    return data.shadowCurrentTarget === 0
      ? data.shadowPingTarget.texture
      : data.shadowPongTarget.texture;
  }

  /**
   * 타일의 결과 AO 텍스처
   */
  getAOTexture(tileKey: string): THREE.Texture | null {
    const data = this.tileData.get(tileKey);
    if (!data) return null;

    return data.aoCurrentTarget === 0
      ? data.aoPingTarget.texture
      : data.aoPongTarget.texture;
  }

  /**
   * Shadow 프레임 수
   */
  getFrameCount(tileKey: string): number {
    return this.tileData.get(tileKey)?.shadowFrameCount ?? 0;
  }

  /**
   * AO 프레임 수
   */
  getAOFrameCount(tileKey: string): number {
    return this.tileData.get(tileKey)?.aoFrameCount ?? 0;
  }

  /**
   * 평균 프레임 수 (shadow 기준)
   */
  getAverageFrameCount(): number {
    if (this.tileData.size === 0) return 0;
    let total = 0;
    for (const data of this.tileData.values()) {
      total += data.shadowFrameCount;
    }
    return Math.floor(total / this.tileData.size);
  }

  /**
   * 최대 프레임 수 설정
   */
  setMaxFrames(frames: number): void {
    this.maxFrames = frames;
  }

  /**
   * 태양 반경 배수 설정
   */
  setSunRadiusMultiplier(multiplier: number): void {
    this.sunRadiusMultiplier = multiplier;
  }

  /**
   * Z축 강조 배율 설정
   */
  setElevationScale(scale: number): void {
    this.elevationScale = scale;
    // 기존 타일들의 uniform도 업데이트
    for (const data of this.tileData.values()) {
      data.shadowMaterial.uniforms.uElevationScale.value = scale;
      data.aoMaterial.uniforms.uElevationScale.value = scale;
    }
  }

  /**
   * AO 계산 범위 스케일 설정
   */
  setAoRangeScale(scale: number): void {
    this.aoRangeScale = scale;
    for (const data of this.tileData.values()) {
      data.aoMaterial.uniforms.uAoRangeScale.value = scale;
    }
  }

  /**
   * 타일 제거
   */
  removeTile(tileKey: string): void {
    const data = this.tileData.get(tileKey);
    if (data) {
      data.shadowPingTarget.dispose();
      data.shadowPongTarget.dispose();
      data.shadowMaterial.dispose();
      data.aoPingTarget.dispose();
      data.aoPongTarget.dispose();
      data.aoMaterial.dispose();
      this.tileData.delete(tileKey);
    }
  }

  /**
   * 모든 타일 리셋
   */
  reset(): void {
    for (const data of this.tileData.values()) {
      data.shadowFrameCount = 0;
      data.shadowCurrentTarget = 0;
      data.aoFrameCount = 0;
      data.aoCurrentTarget = 0;
      this.clearTargets(data);
    }
  }

  /**
   * 리소스 해제
   */
  dispose(): void {
    for (const data of this.tileData.values()) {
      data.shadowPingTarget.dispose();
      data.shadowPongTarget.dispose();
      data.shadowMaterial.dispose();
      data.aoPingTarget.dispose();
      data.aoPongTarget.dispose();
      data.aoMaterial.dispose();
    }
    this.tileData.clear();
    this.quad.geometry.dispose();
    this.dummyTexture.dispose();
  }
}
