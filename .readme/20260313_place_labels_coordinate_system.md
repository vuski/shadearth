# Place Labels 좌표계 문제 해결

## 문제
OSM Shortbread 벡터 타일에서 가져온 지명 레이블이 실제 위치보다 약 15km 정도 북쪽으로 표시되는 문제.

## 원인
두 가지 좌표계 불일치:

### 1. MVT 좌표 변환 (Web Mercator)
MVT 타일 내 좌표는 Web Mercator 투영에서 **미터 단위로 선형 보간**됩니다. 단순히 `tile2lat(y + geom.y/extent, z)` 방식으로 변환하면 고위도에서 오차 발생.

**해결**: Web Mercator 미터 좌표를 경유하여 WGS84 위도로 변환
```typescript
function mvtToLat(tileY: number, geomY: number, extent: number, z: number): number {
  const numTiles = Math.pow(2, z);
  const tileSize = EARTH_CIRCUMFERENCE / numTiles;

  // 타일 상단(북쪽)의 Web Mercator Y 좌표
  const tileTopMeters = EARTH_CIRCUMFERENCE / 2 - tileY * tileSize;
  // 타일 내 위치 (Y는 위에서 아래로 증가)
  const offsetMeters = (geomY / extent) * tileSize;
  const mercatorY = tileTopMeters - offsetMeters;

  // Web Mercator Y → WGS84 위도
  return (180 / Math.PI) * (2 * Math.atan(Math.exp(mercatorY / (EARTH_CIRCUMFERENCE / (2 * Math.PI)))) - Math.PI / 2);
}
```

### 2. ECEF 좌표 변환 (WGS84 vs 구형)
`tilesRenderer`는 **WGS84 ellipsoid** (적도반경 6378137m, 극반경 6356752m)를 사용하지만, 레이블은 **완전 구** (반경 6370000m)를 가정하고 있었음.

**tilesRenderer ellipsoid 결과**: (-3040222, 4054614, 3859713)
**구형 가정 결과**: (-3032690, 4044362, 3875929)

이 차이가 약 15km 오차의 원인.

**해결**: WGS84 ellipsoid ECEF 공식 사용
```typescript
const WGS84_A = 6378137; // 적도 반경 (m)
const WGS84_B = 6356752.314245; // 극 반경 (m)
const WGS84_E2 = 1 - (WGS84_B * WGS84_B) / (WGS84_A * WGS84_A);

function lonLatToWorld(lon: number, lat: number): THREE.Vector3 {
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;

  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const sinLon = Math.sin(lonRad);
  const cosLon = Math.cos(lonRad);

  // WGS84 ECEF 변환
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);

  return new THREE.Vector3(
    N * cosLat * cosLon,
    N * cosLat * sinLon,
    N * (1 - WGS84_E2) * sinLat,
  );
}
```

## 검증
광명시 (126.863219°E, 37.478983°N) 테스트:
- 계산된 좌표: lon=126.8646, lat=37.4787
- 오차: 약 120m (lon), 34m (lat) - 허용 범위

## 핵심 교훈
- 3d-tiles-renderer의 지구본은 WGS84 ellipsoid를 사용
- 레이블 등 추가 요소를 배치할 때는 반드시 동일한 ellipsoid 사용
- MVT 좌표 변환 시 Web Mercator의 비선형성 고려 필요
