# 서로 다른 줌 레벨 타일 조합하기 (UV Scale/Offset 방식)

## 문제 상황

이 프로젝트에서는 여러 종류의 타일 데이터를 사용하며, 각각 최대 줌 레벨이 다르다:

| 데이터 종류 | 최대 줌 레벨 | 해상도 |
|------------|-------------|--------|
| 위성 이미지 (ESRI) | ~17-19 | 256px |
| DEM (Mapterhorn) | 12 | 512px |
| Hillshade | 11 | 256px |
| Night Map | 8 | 256px |

사용자가 z=14로 확대하면 위성 이미지는 z=14 타일을 사용하지만, DEM은 z=12까지만 있으므로 z=12 타일을 사용해야 한다.

## 해결 방법: UV Scale/Offset

z=14 타일 1개는 z=12 타일의 1/4 x 1/4 = 1/16 영역에 해당한다.

```
z=12 타일 (전체)
┌───┬───┬───┬───┐
│   │   │   │   │
├───┼───┼───┼───┤
│   │ ● │   │   │  ← z=14 타일은 이 작은 영역
├───┼───┼───┼───┤
│   │   │   │   │
├───┼───┼───┼───┤
│   │   │   │   │
└───┴───┴───┴───┘
```

### UV 변환 공식

```typescript
function getTileInfo(z: number, x: number, y: number, maxZoom: number) {
  const clampedZ = Math.min(z, maxZoom);
  const zoomDiff = z - clampedZ;
  const scale = Math.pow(2, zoomDiff);  // z=14, maxZoom=12 → scale=4

  // 상위 타일 좌표
  const clampedX = Math.floor(x / scale);
  const clampedY = Math.floor(y / scale);

  // UV 스케일: 타일 텍스처에서 샘플링할 영역 크기
  const uvScale = [1.0 / scale, 1.0 / scale];  // [0.25, 0.25]

  // UV 오프셋: 타일 텍스처에서 샘플링할 시작 위치
  const uvOffsetX = (x % scale) / scale;
  // Y축 반전: 타일 좌표는 위→아래, UV는 아래→위
  const uvOffsetY = (scale - 1 - (y % scale)) / scale;
  const uvOffset = [uvOffsetX, uvOffsetY];

  return { clampedZ, clampedX, clampedY, uvScale, uvOffset };
}
```

### 예시: z=14, x=13578, y=6128

```
maxZoom = 12, scale = 4

clampedX = floor(13578 / 4) = 3394
clampedY = floor(6128 / 4) = 1532

uvScale = [0.25, 0.25]
uvOffsetX = (13578 % 4) / 4 = 2 / 4 = 0.5
uvOffsetY = (4 - 1 - (6128 % 4)) / 4 = (4 - 1 - 0) / 4 = 0.75
uvOffset = [0.5, 0.75]
```

## 셰이더에서 사용

### UV 변환 함수

```glsl
uniform vec2 uDemUvScale;   // [0.25, 0.25]
uniform vec2 uDemUvOffset;  // [0.5, 0.75]

vec2 transformDemUv(vec2 uv) {
  return uv * uDemUvScale + uDemUvOffset;
}
```

### Ray Marching에서 주의점

**문제**: Ray marching 중 매 스텝마다 `transformDemUv()`를 호출하면 UV가 중복 변환된다.

**해결**: 시작점에서 한 번만 변환하고, ray 방향도 스케일만 적용한다.

```glsl
float traceShadowRay(vec2 startUV, float startElevation, vec3 localSunDir) {
  // 시작점: 타일 UV → DEM UV로 한 번만 변환
  vec2 pos = transformDemUv(startUV);

  // ray 방향: 스케일만 적용 (오프셋 없음)
  vec2 demRayDir = rayDir * uDemUvScale;

  for (int i = 0; i < 1024; i++) {
    pos += demRayDir * stepSize;

    // DEM UV 범위 체크 (0~1)
    if (pos.x < 0.0 || pos.x > 1.0 || pos.y < 0.0 || pos.y > 1.0) {
      return 1.0;  // 타일 경계 밖 → 그림자 없음
    }

    // DEM UV로 직접 샘플링 (추가 변환 없음)
    float terrain = sampleElevationDirect(pos);
    if (terrain > height) return 0.0;
  }
  return 1.0;
}

// UV 변환 없이 직접 샘플링
float sampleElevationDirect(vec2 demUv) {
  return decodeTerrarium(texture2D(demMap, clamp(demUv, 0.0, 1.0)));
}
```

## 관련 파일

- `src/constants.ts`: `getDemTileInfo()`, `getHillshadeTileInfo()` - UV 계산
- `src/main.ts`: uniform에 uvScale/uvOffset 설정
- `src/rendering/TileShadowRenderer.ts`: soft shadow 누적 렌더러, `createDemUniforms()`
- `src/rendering/shaders/hillshade-shadow.frag.glsl`: `transformDemUv()`, `traceShadowRay()`
- `src/rendering/shaders/shadow-accumulate.frag.glsl`: soft shadow ray marching
- `src/rendering/shaders/ao-accumulate.frag.glsl`: AO ray marching

## Y축 반전 이유

XYZ 타일 시스템과 텍스처 UV 좌표계가 Y축 방향이 반대:

```
XYZ 타일: Y 증가 = 남쪽 (위 → 아래)
텍스처 UV: Y 증가 = 위쪽 (아래 → 위)
Three.js flipY=true: 이미지 상하 반전하여 로드
```

따라서 uvOffsetY 계산 시 `(scale - 1 - (y % scale))` 로 반전한다.
