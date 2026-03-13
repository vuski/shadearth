// 지구 반지름 (미터)
export const EARTH_RADIUS = 6_370_000;

// 메시 해상도 타입
export type MeshResolution = "low" | "medium" | "high" | "ultra";

// 렌더링 설정 (UI 초기값 및 렌더러 초기값 통합)
export const RENDER_SETTINGS = {
  sunJitter: 5,
  aoShadowWeight: 1.0,
  aoDiffuseWeight: 0.7,
  brightness: 1.0,
  gamma: 1.0, //2.2,
  shadowContrast: 1.0,
  elevationScale: 1.0,
  aoRangeScale: 1.0,
  errorTarget: 2,
  useSatellite: true,
  greenDesatAmount: 0.4,
  wbStrength: 0.15,
  wbTemp: -26,
  wbTint: 16,
  groupBlendMode: 0,
  shadowBlendMode: 0,
  shadowPow: 2.0,
  meshResolution: "medium" as MeshResolution,
  useHillshade: true,
  showPlaceLabels: false,
  useAtmosphere: true,
};

// 카메라 설정
export const CAMERA = {
  FOV: 45,
  NEAR: 100,
  FAR_MULTIPLIER: 100, // 더 먼 거리까지 렌더링
  INITIAL_DISTANCE_MULTIPLIER: 3.5, // 지구가 화면에 잘 보이는 거리
  MAX_DISTANCE_MULTIPLIER: 20, // 줌 아웃 제한 (~127,000km)
} as const;

export const COMPUTED = {
  get CAMERA_FAR() {
    return EARTH_RADIUS * CAMERA.FAR_MULTIPLIER;
  },
  get CAMERA_INITIAL_DISTANCE() {
    return EARTH_RADIUS * CAMERA.INITIAL_DISTANCE_MULTIPLIER;
  },
  get CAMERA_MAX_DISTANCE() {
    return EARTH_RADIUS * CAMERA.MAX_DISTANCE_MULTIPLIER;
  },
} as const;

// 타일 서버
export const TILE_SERVER = {
  BASE_URL: "https://tiles.mapterhorn.com",
  DEM_PATH: "{z}/{x}/{y}.webp",
} as const;

export const OSM__VECTOR_TILE_SERVER = {
  BASE_URL: "https://vector.openstreetmap.org/shortbread_v1",
  OSM_PATH: "{z}/{x}/{y}.mvt",
} as const;

// DEM 최대 줌 레벨
export const DEM_MAX_ZOOM = 12;

// 기본 DEM URL 템플릿 (XYZTilesPlugin용)
export function getDemTileUrl(): string {
  return `${TILE_SERVER.BASE_URL}/${TILE_SERVER.DEM_PATH}`;
}

// DEM 타일 정보 (URL + UV 변환)
export interface DemTileInfo {
  url: string;
  uvScale: [number, number];
  uvOffset: [number, number];
}

// 줌 레벨에 따른 DEM URL 및 UV 정보 반환
// DEM은 최대 12레벨, 그 이상은 12레벨 타일의 해당 부분만 사용
export function getDemTileInfo(z: number, x: number, y: number): DemTileInfo {
  const clampedZ = Math.min(z, DEM_MAX_ZOOM);
  const zoomDiff = z - clampedZ;
  const scale = Math.pow(2, zoomDiff);
  const clampedX = Math.floor(x / scale);
  const clampedY = Math.floor(y / scale);

  // UV scale/offset: z > 12일 때 타일의 해당 부분만 사용
  const uvScale: [number, number] = [1.0 / scale, 1.0 / scale];
  const uvOffsetX = (x % scale) / scale;
  const uvOffsetY = (scale - 1 - (y % scale)) / scale;
  const uvOffset: [number, number] = [uvOffsetX, uvOffsetY];

  const url = `${TILE_SERVER.BASE_URL}/${TILE_SERVER.DEM_PATH}`
    .replace("{z}", String(clampedZ))
    .replace("{x}", String(clampedX))
    .replace("{y}", String(clampedY));

  return { url, uvScale, uvOffset };
}
