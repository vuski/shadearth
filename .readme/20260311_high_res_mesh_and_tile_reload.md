# 고해상도 메시 생성 및 타일 새로고침 기능

## Context

DEM 텍스처를 사용한 vertex displacement를 위해 기본 30×15 세그먼트 메시로는 부족함.
고해상도 메시 생성 플러그인과 타일 새로고침 기능을 구현함.

---

## 1. HighResXYZTilesPlugin

### 파일 위치
`src/plugins/HighResXYZTilesPlugin.ts`

### 목적
XYZTilesPlugin을 상속하여 고해상도 메시(32/64/128/256 세그먼트) 생성.
기본 30×15 세그먼트 대신 선택 가능한 해상도로 PlaneGeometry 생성 후 ellipsoid 표면으로 변환.

### 핵심 코드

```typescript
export type MeshResolution = "low" | "medium" | "high" | "ultra";

export const MESH_RESOLUTION_MAP: Record<MeshResolution, number> = {
  low: 32,      // 32×32 = 1,024 꼭짓점
  medium: 64,   // 64×64 = 4,096 꼭짓점
  high: 128,    // 128×128 = 16,384 꼭짓점
  ultra: 256,   // 256×256 = 65,536 꼭짓점
};
```

### parseToMesh 완전 오버라이드

Symbol 기반 타일 좌표 접근 문제로 `super.parseToMesh()` 호출 대신 완전히 새로 구현:

```typescript
// Symbol 키로 저장된 타일 좌표 추출
function getTileCoords(tile: Record<symbol, unknown>): { x, y, level } {
  const symbols = Object.getOwnPropertySymbols(tile);
  for (const sym of symbols) {
    const desc = sym.description;
    const val = tile[sym];
    if (typeof val === "number") {
      if (desc === "TILE_X") x = val;
      else if (desc === "TILE_Y") y = val;
      else if (desc === "TILE_LEVEL") level = val;
    }
  }
  return { x, y, level };
}
```

### 주의사항

- `Symbol.for("TILE_X")` 대신 `Object.getOwnPropertySymbols()` + description 매칭 사용
- `Symbol.for()`는 전역 레지스트리를 사용하므로 3d-tiles-renderer 내부의 Symbol과 다름
- parseToMesh에서 `super.parseToMesh()` 호출 시 geometry가 이미 변환되어 있어 UV 매핑 오류 발생

---

## 2. Vertex Shader Displacement

### 파일 위치
`src/rendering/shaders/hillshade.vert.glsl`

### Terrarium 디코딩

```glsl
// Terrarium 포맷: RGB (0~1) → 고도(m)
// height = (R * 255 * 256 + G * 255 + B * 255 / 256) - 32768
float decodeTerrarium(vec3 rgb) {
  return (rgb.r * 255.0 * 256.0 + rgb.g * 255.0 + rgb.b * 255.0 / 256.0) - 32768.0;
}
```

**주의**: RGB 값이 0~1 범위이므로 반드시 `* 255.0` 필요!

### Vertex Displacement

```glsl
void main() {
  vUv = uv;

  // DEM에서 고도 샘플링
  vec4 demSample = texture2D(demMap, uv);
  float elevation = decodeTerrarium(demSample.rgb);

  // normal 방향으로 displacement
  // normal은 ellipsoid 표면의 바깥 방향
  vec3 displacedPosition = position + normal * elevation * uElevationScale;

  // 월드 위치 계산
  vec4 worldPos = modelMatrix * vec4(displacedPosition, 1.0);
  vWorldPosition = worldPos.xyz;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(displacedPosition, 1.0);
}
```

---

## 3. 타일 새로고침 기능

### 문제
메시 해상도나 errorTarget을 변경해도 이미 로드된 타일은 그대로 유지됨.

### 해결 방법
`tilesRenderer`를 완전히 재생성.

### 구현

```typescript
// tilesRenderer를 let으로 선언
let tilesRenderer = createTilesRenderer();

function createTilesRenderer(): TilesRenderer {
  const renderer = new TilesRenderer();
  renderer.loadSiblings = false;
  renderer.displayActiveTiles = true;
  renderer.maxDepth = 17;

  renderer.registerPlugin(new DemFallbackPlugin());

  highResPlugin = new HighResXYZTilesPlugin({
    url: demTileUrl,
    levels: 17,
    meshResolution: RENDER_SETTINGS.meshResolution,
  });
  renderer.registerPlugin(highResPlugin);

  return renderer;
}

function reloadAllTiles() {
  // 1. 기존 tilesRenderer 정리
  scene.remove(tilesRenderer.group);
  tilesRenderer.dispose();
  loadedTiles.clear();

  // 2. 새 tilesRenderer 생성
  tilesRenderer = createTilesRenderer();
  tilesRenderer.errorTarget = renderSettings.errorTarget;

  // 3. 카메라 및 컨트롤 재설정
  tilesRenderer.setCamera(camera);
  tilesRenderer.setResolutionFromRenderer(camera, renderer);

  // 4. scene에 추가
  scene.add(tilesRenderer.group);
  tilesRenderer.group.rotation.x = -Math.PI / 2;

  // 5. 이벤트 핸들러 재연결
  setupTileEventHandlers();
}
```

### setupTileEventHandlers 분리

이벤트 핸들러를 함수로 분리하여 재사용:

```typescript
function setupTileEventHandlers(): void {
  tilesRenderer.addEventListener("load-model", (event) => {
    // 타일 로드 처리...
  });

  tilesRenderer.addEventListener("dispose-model", (event) => {
    // 타일 언로드 처리...
  });
}

// 초기 설정
setupTileEventHandlers();
```

---

## 4. GUI 컨트롤

### 메시 해상도

```typescript
settingsGui
  .add(renderSettings, "meshResolution", {
    "낮음 (32×32)": "low",
    "중간 (64×64)": "medium",
    "높음 (128×128)": "high",
    "최고 (256×256)": "ultra",
  })
  .name("메시 해상도")
  .onChange((value: MeshResolution) => {
    highResPlugin.setMeshResolution(value);
  });
```

### 타일 새로고침 버튼

```typescript
settingsGui
  .add({ reloadTiles: reloadAllTiles }, "reloadTiles")
  .name("타일 새로고침");
```

---

## 5. 발생했던 문제들

### Symbol 접근 문제
- **증상**: 모든 타일이 `0_0_0` 키로 저장됨
- **원인**: `Symbol.for("TILE_X")`가 3d-tiles-renderer 내부 Symbol과 다름
- **해결**: `Object.getOwnPropertySymbols()` + description 매칭

### UV 매핑 오류
- **증상**: 타일 텍스처가 뒤섞임
- **원인**: `super.parseToMesh()` 호출 후 geometry 교체 시 이미 변환된 UV에 또 변환 적용
- **해결**: parseToMesh를 완전히 오버라이드하여 직접 구현

### Vertex displacement 작동 안함
- **증상**: 지형이 평평함
- **원인**: Terrarium 디코딩에서 `* 255.0` 누락
- **해결**: `rgb.r * 255.0 * 256.0 + rgb.g * 255.0 + rgb.b * 255.0 / 256.0`

### elevationScale 적용 안됨
- **증상**: 새로 로드된 타일에 elevationScale이 1.0으로 고정
- **원인**: `createMaterial()`에서 `renderSettings.elevationScale` 대신 하드코딩된 값 사용
- **해결**: uniform 초기값을 `renderSettings.elevationScale`로 변경

### 변수 초기화 순서
- **증상**: `Cannot access 'highResPlugin' before initialization`
- **원인**: `let tilesRenderer = createTilesRenderer()` 이후에 `let highResPlugin` 선언
- **해결**: 선언 순서 변경

---

## 6. 현재 상태

### 작동하는 기능
- 고해상도 메시 생성 (32/64/128/256 세그먼트)
- Vertex displacement (DEM 기반 지형)
- Z축 강조 (elevationScale)
- 타일 새로고침

### 알려진 이슈
- 일부 타일이 elevationScale 변경에 반응하지 않음 (간헐적)
- 원인 조사 필요

---

## 7. 관련 파일

- `src/plugins/HighResXYZTilesPlugin.ts` - 고해상도 메시 플러그인
- `src/rendering/shaders/hillshade.vert.glsl` - Vertex displacement 셰이더
- `src/main.ts` - tilesRenderer 생성/재생성, GUI 컨트롤
- `src/constants.ts` - RENDER_SETTINGS.meshResolution 기본값
