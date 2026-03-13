# CLAUDE.md

**ShadEarth** - 구형 지구본에 실사 렌더링을 하는 프로젝트입니다.

## 필수 참고 문서

**컨텍스트 압축(compact) 이후 반드시 아래 문서를 읽으세요:**

- `.readme/20260308_the_plan.md` - 프로젝트 전체 계획 및 구현 가이드

## 참고 문서

- `.readme/20260308_기본 지시사항.md` - 초기 요구사항
- `.readme/20260308_3dtiles-globe-guide.md` - 3DTilesRendererJS 사용법
- `.readme/20260308_DEM_Raymarching_기법_조사.md` - Ray Marching 기법 조사
- `.readme/20260310_rendering_pipeline.md` - 렌더링 파이프라인 (Shadow/AO 누적)
- `.readme/20260311_high_res_mesh_and_tile_reload.md` - 고해상도 메시 플러그인
- `.readme/20260312_starfield_orientation_fix.md` - 별자리 좌표계
- `.readme/20260313_multi_zoom_tile_uv_mapping.md` - 다중 줌 레벨 UV 매핑
- `.readme/20260313_place_labels_coordinate_system.md` - 지명 라벨 좌표계

## 기술 스택

- Vite + TypeScript
- Three.js
- 3d-tiles-renderer (XYZTilesPlugin, GlobeControls)
- GLSL Shaders
- postprocessing (Lens Flare, Aerial Perspective)

## 주요 기능

- DEM 기반 지형 렌더링 (hillshade, soft shadow, AO)
- 대기 효과 (Bruneton atmospheric scattering)
- 별자리 배경 (sidereal time 기반 회전)
- 낮/밤 전환 (위성 이미지 + night map)
- 지명 라벨 (OSM Shortbread 벡터 타일)
- 렌즈 플레어

## 타일 서버

```typescript
// src/constants.ts 참조
const TILE_SERVER = {
  BASE_URL: "https://tiles.mapterhorn.com",
  DEM_PATH: "{z}/{x}/{y}.webp",
};
```

## Soft Shadow 구현 방침

**어떤 일이 있어도 프레임당 multi-sample 방식은 사용하지 않으며, 문제를 해결해서 wwwtyro 핑퐁(ping-pong) 방식으로 해결하려고 노력한다.**

## 좌표계 및 태양 방향 계산

### 태양 방향 (sunPosition.ts)
- **Y-up 좌표계** 사용 (Three.js 기본)
- X: 경도 0도 (본초 자오선)
- Y: 북극 방향
- Z: 경도 90도 동쪽 방향
- `hourAngle = ((hours - 12) * 15) * (Math.PI / 180)` - 부호 주의! 음수 붙이지 말 것
- `direction = (cosDecl * cosHA, sinDecl, cosDecl * sinHA)`

### 셰이더 내 로컬 좌표계 (hillshade-shadow.frag.glsl, shadow-accumulate.frag.glsl)
- `east = cross(vec3(0,1,0), surfaceNormal)` - 동쪽 방향
- `north = cross(surfaceNormal, east)` - 북쪽 방향
- `localSunDir = (dot(sun, east), dot(sun, north), dot(sun, surfaceNormal))`
- **Shadow ray 방향**: `sunDir2D = vec2(localSunDir.x, localSunDir.y)` - 부호 변환 없음!
- ray는 태양 방향으로 쏴서 장애물 확인

### TileShadowRenderer 좌표 변환 (shadow-accumulate용)
- tilesRenderer.group이 X축 -90도 회전되어 있음 (ECEF Z-up → Three.js Y-up)
- TypeScript에서 타일 좌표 계산 시 **같은 회전을 적용해야 함**
- ECEF → Y-up 변환:
  - `center = (cos(lat)*cos(lon), sin(lat), -cos(lat)*sin(lon))`
  - `east = (-sin(lon), 0, -cos(lon))`
  - `north = cross(center, east)`
- 셰이더에서는 TypeScript가 계산한 `uTileEast`, `uTileNorth`, `uTileCenter` 직접 사용

### 주의사항
- UI는 로컬 시간, 내부 계산은 `getUTCHours()` 등 UTC 사용
- Date 객체는 내부적으로 UTC timestamp 저장하므로 자동 변환됨
