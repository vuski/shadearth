# 3DTilesRendererJS Globe 구현 가이드

이 문서는 `3d-tiles-renderer` 라이브러리를 사용하여 Three.js 기반 3D 지구본을 구현하는 방법을 정리합니다.
Mapzen DEM + OSM Vector 타일 기반 실사 렌더링 프로젝트에서 활용할 수 있습니다.

---

## 1. 핵심 의존성

```bash
npm install three 3d-tiles-renderer
npm install -D @types/three
```

**3d-tiles-renderer 버전**: 0.4.x 이상 (XYZTilesPlugin 지원)

---

## 2. 상수 정의

지구 반지름과 카메라 설정을 중앙 관리합니다.

```typescript
// constants.ts
export const EARTH_RADIUS = 6_371_000; // 지구 반지름 (미터)

export const CAMERA = {
  FOV: 45,
  NEAR: 1000, // 1km - 너무 작으면 z-fighting, 너무 크면 near clipping
  FAR_MULTIPLIER: 50,
  INITIAL_DISTANCE_MULTIPLIER: 4.83, // 초기 카메라 거리
  MAX_DISTANCE_MULTIPLIER: 30, // 최대 줌 아웃
} as const;

export const COMPUTED = {
  get CAMERA_FAR() { return EARTH_RADIUS * CAMERA.FAR_MULTIPLIER; },
  get CAMERA_INITIAL_DISTANCE() { return EARTH_RADIUS * CAMERA.INITIAL_DISTANCE_MULTIPLIER; },
  get CAMERA_MAX_DISTANCE() { return EARTH_RADIUS * CAMERA.MAX_DISTANCE_MULTIPLIER; },
} as const;
```

---

## 3. XYZTilesPlugin으로 지구본 생성

Cesium Ion 없이 XYZ 타일만으로 지구본을 만듭니다.

```typescript
import { TilesRenderer } from "3d-tiles-renderer";
import { XYZTilesPlugin } from "3d-tiles-renderer/plugins";

const tilesRenderer = new TilesRenderer();

// XYZ 타일로 ellipsoid(타원체) 지구본 생성
tilesRenderer.registerPlugin(
  new XYZTilesPlugin({
    shape: "ellipsoid",           // 구형 지구본
    url: "https://your-server/{z}/{x}/{y}.png",
    levels: 12,                   // 줌 레벨 0~11 (256px 타일 기준)
  })
);

// LOD 품질 (낮을수록 고해상도, 기본 6)
tilesRenderer.errorTarget = 3;

// ECEF(Z-up) → Three.js Y-up 변환
tilesRenderer.group.rotation.x = -Math.PI / 2;

scene.add(tilesRenderer.group);
```

### 타일 로드 시 커스텀 셰이더 적용

```typescript
tilesRenderer.addEventListener("load-model", (event: any) => {
  const { scene } = event;
  scene.traverse((child: THREE.Object3D) => {
    if (child instanceof THREE.Mesh) {
      // 원본 텍스처 백업
      const originalTexture = (child.material as any).map;

      // 커스텀 셰이더 머티리얼로 교체
      child.material = new THREE.ShaderMaterial({
        uniforms: {
          tileMap: { value: originalTexture },
          // 추가 유니폼...
        },
        vertexShader: myVertexShader,
        fragmentShader: myFragmentShader,
      });
    }
  });
});
```

---

## 4. GlobeControls 설정

`3d-tiles-renderer`의 `GlobeControls`로 지구본 조작을 구현합니다.

```typescript
import { GlobeControls, Ellipsoid } from "3d-tiles-renderer";

const SPHERE_ELLIPSOID = new Ellipsoid(EARTH_RADIUS, EARTH_RADIUS, EARTH_RADIUS);

// GlobeControls 생성
const controls = new GlobeControls(scene, camera, canvas);
controls.maxDistance = EARTH_RADIUS * 30;

// Ellipsoid 설정 (ECEF 좌표계 그룹 연결)
const ellipsoidGroup = new THREE.Group();
ellipsoidGroup.rotation.x = -Math.PI / 2; // Y-up → Z-up (ECEF)
scene.add(ellipsoidGroup);

ellipsoidGroup.updateMatrixWorld(true);
controls.setEllipsoid(SPHERE_ELLIPSOID, ellipsoidGroup);

// 조작 파라미터
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.rotationSpeed = 1.5;

// ★ 중요: Near Clipping 마진 축소
// 기본값 0.25는 지표면 가까이 가면 앞면이 잘림 (지구 반대편 보임)
controls.nearMargin = 0.01;
```

### 애니메이션 루프에서 업데이트

```typescript
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  tilesRenderer.update();
  renderer.render(scene, camera);
}
```

---

## 5. 좌표계 변환 (핵심!)

### ECEF ↔ Y-up 변환

XYZTilesPlugin의 ellipsoid는 ECEF(Z-up)로 생성 후 X축 -90도 회전되어 Y-up이 됩니다.

```
ECEF (Z-up)    →    Y-up (Three.js)
X              →    X
Y              →    -Z
Z (위)         →    Y (위)
```

### 셰이더에서 월드 좌표 → 경위도

```glsl
vec2 worldPosToLonLat(vec3 pos) {
  // Y-up → ECEF 역변환
  // ECEF_X = pos.x
  // ECEF_Y = -pos.z
  // ECEF_Z = pos.y

  // 경도: atan2(ECEF_Y, ECEF_X)
  float lon = atan(-pos.z, pos.x) * 180.0 / 3.141592653589793;

  // 위도: asin(ECEF_Z / radius)
  float lat = asin(pos.y / length(pos)) * 180.0 / 3.141592653589793;

  return vec2(lon, lat);
}
```

### JavaScript에서 경위도 → 방향 벡터

```typescript
function lonLatToDirection(lon: number, lat: number): THREE.Vector3 {
  const phi = THREE.MathUtils.degToRad(90 - lat);
  const theta = THREE.MathUtils.degToRad(lon + 90);

  return new THREE.Vector3(
    Math.sin(phi) * Math.sin(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.cos(theta)
  );
}
```

---

## 6. 수학적 Raycast (메시 없이 클릭 좌표 계산)

타일 로딩 전에도 클릭/호버가 작동하도록 수학적 구체 교차를 계산합니다.

```typescript
raycastToGlobe(): { lon: number; lat: number } | null {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

  const origin = raycaster.ray.origin;
  const direction = raycaster.ray.direction;

  // 구체-레이 교차: |origin + t*direction|² = R²
  const a = direction.dot(direction);
  const b = 2 * origin.dot(direction);
  const c = origin.dot(origin) - EARTH_RADIUS * EARTH_RADIUS;
  const discriminant = b * b - 4 * a * c;

  if (discriminant < 0) return null; // 교차 없음

  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  if (t < 0) return null; // 카메라 뒤

  const point = origin.clone().add(direction.clone().multiplyScalar(t));

  // Y-up → 경위도
  const r = point.length();
  const lat = 90 - THREE.MathUtils.radToDeg(Math.acos(point.y / r));
  const lon = THREE.MathUtils.radToDeg(Math.atan2(-point.z, point.x));

  return { lon, lat };
}
```

---

## 7. 줌 레벨 오프셋 (고해상도 타일 요청)

XYZ 타일 오버레이에서 더 높은 해상도 타일을 요청하려면:

```typescript
import { XYZTilesOverlay } from "3d-tiles-renderer/plugins";

class XYZTilesOverlayWithOffset extends XYZTilesOverlay {
  levelOffset: number;

  constructor(options: any = {}) {
    const { levelOffset = 0, ...rest } = options;
    super(rest);
    this.levelOffset = levelOffset;
  }

  calculateLevel(range: number[], tile: any): number {
    const baseLevel = (XYZTilesOverlay.prototype as any).calculateLevel.call(
      this, range, tile
    );
    const maxLevel = (this as any).tiling?.maxLevel ?? 9;
    return Math.min(baseLevel + this.levelOffset, maxLevel);
  }
}

// 사용
const overlay = new XYZTilesOverlayWithOffset({
  url: "https://server/{z}/{x}/{y}.png",
  levels: 12,
  dimension: 256,
  levelOffset: 2, // 줌 레벨 +2 오프셋
});
```

---

## 8. 기본 버텍스/프래그먼트 셰이더 템플릿

### 버텍스 셰이더

```glsl
varying vec2 vUv;
varying vec3 vWorldPosition;
varying vec3 vNormal;

void main() {
  vUv = uv;

  // 월드 위치 (경위도 변환용)
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPos.xyz;

  vNormal = normalize(normalMatrix * normal);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
```

### 프래그먼트 셰이더

```glsl
precision highp float;

uniform sampler2D tileMap;  // XYZ 타일 텍스처

varying vec2 vUv;
varying vec3 vWorldPosition;
varying vec3 vNormal;

// 월드 좌표 → 경위도
vec2 worldPosToLonLat(vec3 pos) {
  float lon = atan(-pos.z, pos.x) * 180.0 / 3.141592653589793;
  float lat = asin(pos.y / length(pos)) * 180.0 / 3.141592653589793;
  return vec2(lon, lat);
}

void main() {
  // 타일 텍스처 샘플링
  vec4 tileColor = texture2D(tileMap, vUv);

  // 경위도 계산 (추가 텍스처 매핑용)
  vec2 lonLat = worldPosToLonLat(vWorldPosition);

  // 림 라이팅 (구체 가장자리 강조)
  float rimLight = 1.0 - max(0.0, dot(vNormal, vec3(0.0, 0.0, 1.0)));
  rimLight = pow(rimLight, 3.0) * 0.15;

  vec3 finalColor = tileColor.rgb + vec3(rimLight);

  gl_FragColor = vec4(finalColor, 1.0);
}
```

---

## 9. 주요 시행착오 & 해결책

| 문제 | 원인 | 해결 |
|------|------|------|
| 지표면 가까이 가면 앞면 잘림 | `nearMargin` 기본값 0.25 | `controls.nearMargin = 0.01` |
| 셰이더 태양/경도 90도 틀어짐 | Y-up ↔ ECEF 변환 오류 | `atan(-pos.z, pos.x)` 사용 |
| 타일 로드 전 클릭 안됨 | 메시 기반 raycast | 수학적 구체 교차 계산 |
| HTTPS 사이트에서 타일 안됨 | mixed-content | 타일 서버도 HTTPS (역방향 프록시) |
| 줌인 시 타일 해상도 부족 | levels 설정 부족 | `levels: 12` (줌 0~11) |

---

## 10. 파일 구조 예시

```
src/
├── globe/
│   ├── constants.ts         # 지구 반지름, 카메라 설정
│   ├── GlobeRenderer.ts     # 메인 렌더러 클래스
│   ├── ControlsManager.ts   # GlobeControls 래퍼
│   └── shaders/
│       ├── globe.vert.glsl
│       └── globe.frag.glsl
└── types/
    └── const.ts             # 타일 서버 URL 등 환경 상수
```

---

## 11. 다음 단계 (Mapzen DEM + OSM)

1. **DEM 타일 로드**: Mapzen Terrarium PNG → 고도 디코딩
2. **OSM Vector 타일**: PBF → GeoJSON → 셰이더 렌더링
3. **지형 셰이딩**: DEM 노멀 계산 → 힐셰이드
4. **건물/도로**: OSM 벡터 데이터 → 3D 지오메트리 또는 텍스처

---

## 참고 자료

- [3DTilesRendererJS GitHub](https://github.com/NASA-AMMOS/3DTilesRendererJS)
- [XYZTilesPlugin 예제](https://github.com/NASA-AMMOS/3DTilesRendererJS/tree/master/example)
- [Three.js 문서](https://threejs.org/docs/)
