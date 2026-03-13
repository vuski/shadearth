import * as THREE from "three";
import { TilesRenderer, GlobeControls, Ellipsoid } from "3d-tiles-renderer";
import GUI from "lil-gui";
import { PMTiles } from "pmtiles";
import {
  EARTH_RADIUS,
  CAMERA,
  COMPUTED,
  RENDER_SETTINGS,
  getDemTileUrl,
  getDemTileInfo,
  MeshResolution,
} from "./constants";
import {
  HighResXYZTilesPlugin,
  MESH_RESOLUTION_MAP,
} from "./plugins/HighResXYZTilesPlugin";
import { SunPositionGui } from "./ui/SunPositionGui";
import { getGreenwichSiderealTime } from "./utils/sunPosition";
import { TileShadowRenderer } from "./rendering/TileShadowRenderer";
import { initCameraPresets } from "./ui/CameraPresets";
import { UI_POSITIONS, applyPosition } from "./ui/layout";
import { PlaceLabelsManager } from "./labels/PlaceLabelsManager";

// Atmosphere imports
import { loadAtmosphereTextures, SkyMaterial } from "./atmosphere";
import { AerialPerspectiveEffect } from "./atmosphere/AerialPerspectiveEffect";
import { LensFlareEffect } from "./effects/LensFlareEffect";
import { EffectComposer, EffectPass, RenderPass } from "postprocessing";
import html2canvas from "html2canvas";

// 위성 이미지 타일 URL (ESRI World Imagery)
const ESRI_SATELLITE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

// 위성 이미지 로더
const satelliteTextureLoader = new THREE.TextureLoader();
satelliteTextureLoader.crossOrigin = "anonymous";

async function loadSatelliteTile(
  z: number,
  x: number,
  y: number,
): Promise<THREE.Texture | null> {
  const url = ESRI_SATELLITE_URL.replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
  try {
    const texture = await satelliteTextureLoader.loadAsync(url);
    // colorSpace 설정 제거 - Three.js가 자동 linear 변환하면 어두워짐
    return texture;
  } catch (error) {
    console.warn(`Failed to load satellite tile ${z}/${x}/${y}:`, error);
    return null;
  }
}

// 야간 조명 타일 로더 (PMTiles, 최대 z=8)
const NIGHT_TILE_MAX_ZOOM = 8;
const NIGHT_PMTILES_URL = "https://tiles.vw-lab.uk/nightmap.pmtiles";
const nightPmtiles = new PMTiles(NIGHT_PMTILES_URL);

// Hillshade 타일 로더 (PMTiles, 최대 z=11)
const HILLSHADE_TILE_MAX_ZOOM = 11;
const HILLSHADE_PMTILES_URL =
  "https://tiles.vw-lab.uk/hillshade_z11_256.pmtiles";
const hillshadePmtiles = new PMTiles(HILLSHADE_PMTILES_URL);

interface NightTileResult {
  texture: THREE.Texture;
  uvScale: THREE.Vector2;
  uvOffset: THREE.Vector2;
}
async function loadNightTile(
  z: number,
  x: number,
  y: number,
): Promise<NightTileResult | null> {
  // 줌 레벨이 8보다 크면 8로 제한하고 UV 스케일/오프셋 계산
  const clampedZ = Math.min(z, NIGHT_TILE_MAX_ZOOM);
  const zoomDiff = z - clampedZ;
  const scale = Math.pow(2, zoomDiff);
  const clampedX = Math.floor(x / scale);
  const clampedY = Math.floor(y / scale);

  // UV 스케일: 타일이 z=8 타일의 일부분만 사용
  const uvScale = new THREE.Vector2(1.0 / scale, 1.0 / scale);
  // UV 오프셋: 해당 부분 타일의 시작 위치
  // Y축은 타일 좌표와 UV 좌표가 반대 (타일: 위→아래, UV: 아래→위)
  const uvOffsetX = (x % scale) / scale;
  const uvOffsetY = (scale - 1 - (y % scale)) / scale;
  const uvOffset = new THREE.Vector2(uvOffsetX, uvOffsetY);

  try {
    // PMTiles에서 타일 데이터 가져오기
    const tileData = await nightPmtiles.getZxy(clampedZ, clampedX, clampedY);
    if (!tileData || !tileData.data) {
      return null;
    }

    // Uint8Array를 Blob으로 변환 후 URL 생성
    const blob = new Blob([tileData.data], { type: "image/webp" });
    const blobUrl = URL.createObjectURL(blob);

    // TextureLoader로 로드
    const texture = await satelliteTextureLoader.loadAsync(blobUrl);

    // Blob URL 해제
    URL.revokeObjectURL(blobUrl);

    return { texture, uvScale, uvOffset };
  } catch (error) {
    console.warn(
      `Failed to load night tile ${clampedZ}/${clampedX}/${clampedY}:`,
      error,
    );
    return null;
  }
}

// Hillshade 타일 로더
interface HillshadeTileResult {
  texture: THREE.Texture;
  uvScale: [number, number];
  uvOffset: [number, number];
}

async function loadHillshadeTile(
  z: number,
  x: number,
  y: number,
): Promise<HillshadeTileResult | null> {
  // 줌 레벨이 11보다 크면 11로 제한하고 UV 스케일/오프셋 계산
  const clampedZ = Math.min(z, HILLSHADE_TILE_MAX_ZOOM);
  const zoomDiff = z - clampedZ;
  const scale = Math.pow(2, zoomDiff);
  const clampedX = Math.floor(x / scale);
  const clampedY = Math.floor(y / scale);

  // UV 스케일/오프셋 계산
  const uvScale: [number, number] = [1.0 / scale, 1.0 / scale];
  const uvOffsetX = (x % scale) / scale;
  const uvOffsetY = (scale - 1 - (y % scale)) / scale;
  const uvOffset: [number, number] = [uvOffsetX, uvOffsetY];

  try {
    // PMTiles에서 타일 데이터 가져오기
    const tileData = await hillshadePmtiles.getZxy(
      clampedZ,
      clampedX,
      clampedY,
    );
    if (!tileData || !tileData.data) {
      return null;
    }

    // Uint8Array를 Blob으로 변환 후 URL 생성
    const blob = new Blob([tileData.data], { type: "image/png" });
    const blobUrl = URL.createObjectURL(blob);

    // TextureLoader로 로드
    const texture = await satelliteTextureLoader.loadAsync(blobUrl);

    // Blob URL 해제
    URL.revokeObjectURL(blobUrl);

    return { texture, uvScale, uvOffset };
  } catch (error) {
    console.warn(`Failed to load hillshade tile ${z}/${x}/${y}:`, error);
    return null;
  }
}

// GLSL 셰이더 임포트 (vite-plugin-glsl)
import hillshadeVertexShader from "./rendering/shaders/hillshade.vert.glsl";
import hillshadeShadowShader from "./rendering/shaders/hillshade-shadow.frag.glsl";

// Three.js 기본 설정
const container = document.getElementById("app")!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// scene.background will be set after atmosphere loads, or fallback to dark color
scene.background = new THREE.Color(0x000011);

// Place Labels Manager
const placeLabelsManager = new PlaceLabelsManager(container);
scene.add(placeLabelsManager.getLabelsGroup());

// Atmosphere state (initialized later)
let skyMesh: THREE.Mesh | null = null;
let skyMaterial: SkyMaterial | null = null;
let aerialPerspectiveEffect: AerialPerspectiveEffect | null = null;
let lensFlareEffect: LensFlareEffect | null = null;
let effectComposer: EffectComposer | null = null;
const worldToECEFMatrix = new THREE.Matrix4().makeRotationX(Math.PI / 2); // Y-up to ECEF (Z-up)

const camera = new THREE.PerspectiveCamera(
  CAMERA.FOV,
  window.innerWidth / window.innerHeight,
  CAMERA.NEAR,
  COMPUTED.CAMERA_FAR,
);
// 초기 카메라 위치 및 회전
camera.position.set(-13334350.4, 9519493.6, -15126051.8);
camera.quaternion.set(0.0684, 0.9135, 0.208, -0.3429);

// 구형 Ellipsoid
const SPHERE_ELLIPSOID = new Ellipsoid(
  EARTH_RADIUS,
  EARTH_RADIUS,
  EARTH_RADIUS,
);

// 해수면 DEM fallback용 Blob (512x512, RGB=128,0,0 = elevation 0m)
let seaLevelBlob: Blob | null = null;
{
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#800000"; // RGB(128, 0, 0) = Terrarium elevation 0m
  ctx.fillRect(0, 0, 512, 512);
  canvas.toBlob((blob) => {
    seaLevelBlob = blob;
  }, "image/png");
}

// DEM Fallback 플러그인 - DEM 로드 실패 시 해수면(elevation=0) 반환
// 줌 레벨 13+ 에서는 고해상도 DEM 서버로 URL 변환
class DemFallbackPlugin {
  name = "DEM_FALLBACK_PLUGIN";
  priority = -100; // 최우선 순위 (낮을수록 먼저 처리)

  // URL에서 z/x/y 추출 후 줌 레벨 기반 URL로 변환
  private transformUrl(url: string): string {
    // planet 또는 dem5m1m_terrain 경로 매칭 (DEM 타일만)
    const match = url.match(
      /\/(planet|dem5m1m_terrain)\/(\d+)\/(\d+)\/(\d+)\.webp/,
    );
    if (match) {
      const z = parseInt(match[2], 10);
      const x = parseInt(match[3], 10);
      const y = parseInt(match[4], 10);
      return getDemTileInfo(z, x, y).url;
    }
    return url;
  }

  async fetchData(url: string, options: RequestInit): Promise<Response> {
    const actualUrl = this.transformUrl(url);
    try {
      const response = await fetch(actualUrl, options);
      // 204 No Content = 타일 없음 (바다 영역)
      if (response.status === 204 || !response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response;
    } catch {
      // DEM 로드 실패 → 해수면 fallback (404는 정상적인 상황 - 바다 영역)
      if (!seaLevelBlob) {
        // Blob 아직 준비 안됨 - 동기적으로 생성
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = 512;
        tempCanvas.height = 512;
        const ctx = tempCanvas.getContext("2d")!;
        ctx.fillStyle = "#800000";
        ctx.fillRect(0, 0, 512, 512);
        seaLevelBlob = await new Promise<Blob | null>((r) =>
          tempCanvas.toBlob(r, "image/png"),
        );
      }
      return new Response(seaLevelBlob, {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    }
  }
}

// TilesRenderer 생성
const demTileUrl = getDemTileUrl();
let highResPlugin: HighResXYZTilesPlugin;
let tilesRenderer = createTilesRenderer();

function createTilesRenderer(): TilesRenderer {
  const renderer = new TilesRenderer();

  // 타일 로딩 최적화 설정
  renderer.loadSiblings = false; // 형제 타일 로드 비활성화 (현재 뷰에 필요한 것만)
  renderer.displayActiveTiles = true; // 활성 타일만 표시
  renderer.maxDepth = 19; // 최대 깊이 제한

  // DEM Fallback 플러그인을 먼저 등록 (fetchData 처리 담당)
  renderer.registerPlugin(new DemFallbackPlugin());

  // 고해상도 메시 플러그인 (XYZTilesPlugin 대체)
  highResPlugin = new HighResXYZTilesPlugin({
    url: demTileUrl,
    levels: 19,
    meshResolution: RENDER_SETTINGS.meshResolution,
  });
  renderer.registerPlugin(highResPlugin);

  return renderer;
}

// errorTarget은 renderSettings에서 초기화 후 설정됨

// Hard shadow 모드로 전환
function switchToHardShadow(): void {
  if (!renderState.softShadowMode) return; // 이미 hard shadow 모드

  renderState.softShadowMode = false;
  renderState.shadowAccumulating = false;
  renderState.renderProgress = "";

  // 모든 타일을 hard shadow로 전환
  for (const tileData of loadedTiles.values()) {
    tileData.material.uniforms.uUseShadowMap.value = 0.0;
  }

  // shadow 버퍼 리셋
  shadowRenderer.reset();

  // Render 버튼 색상 변경 (나중에 GUI 생성 후 연결)
  updateRenderButtonStyle();

  renderState.needsRender = true;
}

// Render 버튼 스타일 업데이트 (GUI 생성 후 연결됨)
let renderButtonElement: HTMLElement | null = null;
function updateRenderButtonStyle(): void {
  if (!renderButtonElement) return;

  if (renderState.softShadowMode) {
    // soft shadow 모드: 기본 색상
    renderButtonElement.style.backgroundColor = "";
  } else {
    // hard shadow 모드: 강조색 (렌더 필요)
    renderButtonElement.style.backgroundColor = "#8b4513";
  }
}

// UI: 날짜/시각 컨트롤
const dateTimeControl = new SunPositionGui({
  onSceneChange: () => {
    switchToHardShadow();
  },
  onTimeChange: () => {
    renderState.needsRender = true;
  },
});

// 더미 텍스처
const dummyTexture = new THREE.DataTexture(
  new Uint8Array([0, 0, 0, 255]),
  1,
  1,
  THREE.RGBAFormat,
);
dummyTexture.needsUpdate = true;

// AO용 흰색 더미 텍스처 (AO 미계산 시 기본값 1.0)
const whiteDummyTexture = new THREE.DataTexture(
  new Uint8Array([255, 255, 255, 255]),
  1,
  1,
  THREE.RGBAFormat,
);
whiteDummyTexture.needsUpdate = true;

// 렌더링 상태
interface RenderState {
  isIdle: boolean;
  idleTimeout: number | null;
  shadowAccumulating: boolean;
  frameCount: number;
  debugMode: number;
  needsRender: boolean; // 렌더링 필요 플래그
  softShadowMode: boolean; // true: soft shadow 렌더링 완료/진행 중, false: hard shadow
  renderProgress: string; // 진행률 표시 (예: "32/128")
}

const renderState: RenderState = {
  isIdle: false,
  idleTimeout: null,
  shadowAccumulating: false,
  frameCount: 0,
  debugMode: 0,
  needsRender: true,
  softShadowMode: false,
  renderProgress: "",
};

// wwwtyro 방식 Shadow Renderer (ping-pong 누적)
const shadowRenderer = new TileShadowRenderer(renderer, 512);
shadowRenderer.setMaxFrames(128);
shadowRenderer.setElevationScale(1.0); // GUI 기본값

// 타일 데이터
interface TileData {
  z: number;
  x: number;
  y: number;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  texture: THREE.Texture;
  satelliteTexture: THREE.Texture | null;
  nightTexture: THREE.Texture | null;
  hillshadeTexture: THREE.Texture | null;
}

const loadedTiles: Map<string, TileData> = new Map();

// 타일 키 생성
function getTileKey(z: number, x: number, y: number): string {
  return `${z}/${x}/${y}`;
}

// 인접 타일 방향
const NEIGHBOR_DIRECTIONS = [
  { name: "N", dx: 0, dy: -1 },
  { name: "NE", dx: 1, dy: -1 },
  { name: "E", dx: 1, dy: 0 },
  { name: "SE", dx: 1, dy: 1 },
  { name: "S", dx: 0, dy: 1 },
  { name: "SW", dx: -1, dy: 1 },
  { name: "W", dx: -1, dy: 0 },
  { name: "NW", dx: -1, dy: -1 },
];

// 머티리얼 생성
function createMaterial(demTexture: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      demMap: { value: demTexture },
      demMapN: { value: dummyTexture },
      demMapNE: { value: dummyTexture },
      demMapE: { value: dummyTexture },
      demMapSE: { value: dummyTexture },
      demMapS: { value: dummyTexture },
      demMapSW: { value: dummyTexture },
      demMapW: { value: dummyTexture },
      demMapNW: { value: dummyTexture },
      uHasN: { value: 0.0 },
      uHasNE: { value: 0.0 },
      uHasE: { value: 0.0 },
      uHasSE: { value: 0.0 },
      uHasS: { value: 0.0 },
      uHasSW: { value: 0.0 },
      uHasW: { value: 0.0 },
      uHasNW: { value: 0.0 },
      uSunDirection: { value: dateTimeControl.getSunDirection().clone() },
      uTileSize: { value: new THREE.Vector2(512, 512) },
      uElevationScale: { value: renderSettings.elevationScale },
      uZoomLevel: { value: 10.0 },
      uMetersPerTexel: { value: 78.0 },
      uTileCenter: { value: new THREE.Vector3(1, 0, 0) },
      uTileEast: { value: new THREE.Vector3(0, 0, -1) },
      uTileNorth: { value: new THREE.Vector3(0, 1, 0) },
      uShadowMap: { value: dummyTexture },
      uAOMap: { value: whiteDummyTexture }, // AO 기본값 1.0 (흰색)
      uUseShadowMap: { value: 0.0 },
      uDebugMode: { value: 0.0 },
      uShadingMode: { value: 1.0 }, // 0.0 = slope, 1.0 = AO (기본: AO)
      uAoShadowWeight: { value: 0.5 }, // Shadow overlay 가중치 (0~1)
      uAoDiffuseWeight: { value: 0.5 }, // AO overlay 가중치 (0~1)
      uBrightness: { value: renderSettings.brightness }, // 전체 밝기
      uGamma: { value: renderSettings.gamma }, // 감마 보정
      uShadowContrast: { value: renderSettings.shadowContrast }, // shadow 강도 (비활성)
      uGroupBlendMode: { value: renderSettings.groupBlendMode },
      uShadowBlendMode: { value: renderSettings.shadowBlendMode },
      uShadowPow: { value: renderSettings.shadowPow },
      // 위성 이미지 관련
      uSatelliteMap: { value: dummyTexture },
      uNightMap: { value: dummyTexture },
      uNightUvScale: { value: new THREE.Vector2(1.0, 1.0) },
      uNightUvOffset: { value: new THREE.Vector2(0.0, 0.0) },
      uDemUvScale: { value: new THREE.Vector2(1.0, 1.0) },
      uDemUvOffset: { value: new THREE.Vector2(0.0, 0.0) },
      uUseSatellite: { value: renderSettings.useSatellite ? 1.0 : 0.0 },
      uGreenDesatAmount: { value: renderSettings.greenDesatAmount },
      uWbStrength: { value: renderSettings.wbStrength },
      uWbTemp: { value: renderSettings.wbTemp },
      uWbTint: { value: renderSettings.wbTint },
      // Hillshade 오버레이
      uHillshadeMap: { value: dummyTexture },
      uHillshadeUvScale: { value: new THREE.Vector2(1.0, 1.0) },
      uHillshadeUvOffset: { value: new THREE.Vector2(0.0, 0.0) },
      uUseHillshade: { value: renderSettings.useHillshade ? 1.0 : 0.0 },
      uUseAtmosphere: { value: renderSettings.useAtmosphere ? 1.0 : 0.0 },
    },
    vertexShader: hillshadeVertexShader,
    fragmentShader: hillshadeShadowShader,
  });
}

// WebMercator 기준 타일 중심의 지상 해상도 (meters / texel)
function calculateMetersPerTexel(
  z: number,
  y: number,
  tileSize: number = 512,
): number {
  const n = Math.pow(2, z);
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n)));
  const metersPerPixelAtEquator = (2 * Math.PI * EARTH_RADIUS) / (n * tileSize);
  return Math.max(0.01, metersPerPixelAtEquator * Math.cos(latRad));
}

function calculateTileFrame(
  z: number,
  x: number,
  y: number,
): { center: THREE.Vector3; east: THREE.Vector3; north: THREE.Vector3 } {
  const n = Math.pow(2, z);
  const lon = ((x + 0.5) / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n)));

  const lonRad = (lon * Math.PI) / 180;

  // ECEF(Z-up) -> Y-up (tilesRenderer.group.rotation.x = -PI/2)
  const center = new THREE.Vector3(
    Math.cos(latRad) * Math.cos(lonRad),
    Math.sin(latRad),
    -Math.cos(latRad) * Math.sin(lonRad),
  ).normalize();

  const east = new THREE.Vector3(
    -Math.sin(lonRad),
    0,
    -Math.cos(lonRad),
  ).normalize();

  const north = new THREE.Vector3().crossVectors(center, east).normalize();

  return { center, east, north };
}

// URL에서 타일 좌표 추출
function extractTileCoords(
  url: string,
): { z: number; x: number; y: number } | null {
  const match = url.match(/\/(\d+)\/(\d+)\/(\d+)\.webp/);
  if (match) {
    return {
      z: parseInt(match[1], 10),
      x: parseInt(match[2], 10),
      y: parseInt(match[3], 10),
    };
  }
  return null;
}

// 인접 타일 업데이트
function updateNeighborTextures(): void {
  for (const [, tileData] of loadedTiles) {
    const { z, x, y, material } = tileData;

    for (const { name, dx, dy } of NEIGHBOR_DIRECTIONS) {
      const neighborKey = getTileKey(z, x + dx, y + dy);
      const neighbor = loadedTiles.get(neighborKey);

      const texUniformName = `demMap${name}`;
      const hasUniformName = `uHas${name}`;

      if (neighbor) {
        material.uniforms[texUniformName].value = neighbor.texture;
        material.uniforms[hasUniformName].value = 1.0;
      } else {
        material.uniforms[texUniformName].value = dummyTexture;
        material.uniforms[hasUniformName].value = 0.0;
      }
    }
  }
}

// 타일 로드 시 머티리얼 생성
// 타일 로드 로깅 활성화 여부
let tileLoadLogging = false;

// 전역 디버그 함수
(window as unknown as { toggleTileLog: () => void }).toggleTileLog = () => {
  tileLoadLogging = !tileLoadLogging;
  console.log(`Tile logging: ${tileLoadLogging ? "ON" : "OFF"}`);
};
(window as unknown as { getCamPos: () => void }).getCamPos = () => {
  const pivot = controls.pivotPoint;
  const pivotLen = pivot.length();
  if (pivotLen > 0) {
    const lat = Math.asin(pivot.y / pivotLen) * (180 / Math.PI);
    const lon = Math.atan2(-pivot.z, pivot.x) * (180 / Math.PI);
    console.log(
      `Camera target: lat=${lat.toFixed(2)}°, lon=${lon.toFixed(2)}°`,
    );
  }
};

// 이벤트 핸들러 설정 함수 (tilesRenderer 재생성 시 재사용)
function setupTileEventHandlers(): void {
  tilesRenderer.addEventListener("load-model", (event: unknown) => {
    const { scene: tileScene, tile } = event as {
      scene: THREE.Object3D;
      tile: { content: { uri: string } };
    };
    const tileUrl = tile?.content?.uri || "";
    const coords = extractTileCoords(tileUrl);

    // 타일 좌표 로깅
    if (tileLoadLogging && coords) {
      // XYZ 타일 좌표를 경위도로 변환
      const n = Math.pow(2, coords.z);
      const lon = (coords.x / n) * 360 - 180;
      const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * coords.y) / n)));
      const lat = (latRad * 180) / Math.PI;

      // 카메라 타겟(pivotPoint)을 경위도로 변환
      const pivot = controls.pivotPoint;
      const pivotLen = pivot.length();
      if (pivotLen > 0) {
        const camLat = Math.asin(pivot.y / pivotLen) * (180 / Math.PI);
        const camLon = Math.atan2(-pivot.z, pivot.x) * (180 / Math.PI);
        console.log(
          `[TileLoad] z${coords.z}/${coords.x}/${coords.y} → tile:(${lat.toFixed(1)}°, ${lon.toFixed(1)}°) | cam:(${camLat.toFixed(1)}°, ${camLon.toFixed(1)}°)`,
        );
      } else {
        console.log(
          `[TileLoad] z${coords.z}/${coords.x}/${coords.y} → lat:${lat.toFixed(1)}° lon:${lon.toFixed(1)}°`,
        );
      }
    }

    // 디버그: UV 시각화 (R=U, G=V)
    const DEBUG_UV = false;

    tileScene.traverse((child: THREE.Object3D) => {
      if (child instanceof THREE.Mesh) {
        const originalTexture = (child.material as THREE.MeshBasicMaterial).map;
        if (originalTexture) {
          originalTexture.colorSpace = THREE.NoColorSpace;

          // 디버그 모드: UV 시각화
          if (DEBUG_UV) {
            child.material = new THREE.ShaderMaterial({
              vertexShader: `
                varying vec2 vUv;
                void main() {
                  vUv = uv;
                  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
              `,
              fragmentShader: `
                varying vec2 vUv;
                void main() {
                  gl_FragColor = vec4(vUv.x, vUv.y, 0.0, 1.0);
                }
              `,
              side: THREE.DoubleSide,
            });
            return;
          }

          const material = createMaterial(originalTexture);
          material.uniforms.uDebugMode.value = renderState.debugMode;
          material.uniforms.uShadingMode.value = 1.0; // AO 모드 고정
          material.uniforms.uAoShadowWeight.value =
            renderSettings.aoShadowWeight;
          material.uniforms.uAoDiffuseWeight.value =
            renderSettings.aoDiffuseWeight;
          material.uniforms.uGroupBlendMode.value =
            renderSettings.groupBlendMode;
          material.uniforms.uShadowBlendMode.value =
            renderSettings.shadowBlendMode;
          material.uniforms.uShadowPow.value = renderSettings.shadowPow;
          child.material = material;

          if (coords) {
            // 줌 레벨 uniform 설정
            material.uniforms.uZoomLevel.value = coords.z;
            material.uniforms.uMetersPerTexel.value = calculateMetersPerTexel(
              coords.z,
              coords.y,
              512,
            );
            const frame = calculateTileFrame(coords.z, coords.x, coords.y);
            material.uniforms.uTileCenter.value.copy(frame.center);
            material.uniforms.uTileEast.value.copy(frame.east);
            material.uniforms.uTileNorth.value.copy(frame.north);

            // DEM UV 변환 정보 설정 (z > 12일 때 상위 타일의 해당 부분만 사용)
            const demInfo = getDemTileInfo(coords.z, coords.x, coords.y);
            material.uniforms.uDemUvScale.value.set(
              demInfo.uvScale[0],
              demInfo.uvScale[1],
            );
            material.uniforms.uDemUvOffset.value.set(
              demInfo.uvOffset[0],
              demInfo.uvOffset[1],
            );

            const key = getTileKey(coords.z, coords.x, coords.y);
            const tileData: TileData = {
              z: coords.z,
              x: coords.x,
              y: coords.y,
              mesh: child,
              material,
              texture: originalTexture,
              satelliteTexture: null,
              nightTexture: null,
              hillshadeTexture: null,
            };
            loadedTiles.set(key, tileData);

            // 위성 이미지 비동기 로드
            if (renderSettings.useSatellite) {
              loadSatelliteTile(coords.z, coords.x, coords.y).then(
                (satTexture) => {
                  if (satTexture && loadedTiles.has(key)) {
                    tileData.satelliteTexture = satTexture;
                    material.uniforms.uSatelliteMap.value = satTexture;
                    renderState.needsRender = true;
                  }
                },
              );
              // 야간 타일도 로드
              loadNightTile(coords.z, coords.x, coords.y).then(
                (nightResult) => {
                  if (nightResult && loadedTiles.has(key)) {
                    tileData.nightTexture = nightResult.texture;
                    material.uniforms.uNightMap.value = nightResult.texture;
                    material.uniforms.uNightUvScale.value.copy(
                      nightResult.uvScale,
                    );
                    material.uniforms.uNightUvOffset.value.copy(
                      nightResult.uvOffset,
                    );
                    renderState.needsRender = true;
                  }
                },
              );
            }

            // Hillshade 타일 로드 (위성 이미지와 독립적으로)
            if (renderSettings.useHillshade) {
              loadHillshadeTile(coords.z, coords.x, coords.y).then(
                (hillshadeResult) => {
                  if (hillshadeResult && loadedTiles.has(key)) {
                    tileData.hillshadeTexture = hillshadeResult.texture;
                    material.uniforms.uHillshadeMap.value =
                      hillshadeResult.texture;
                    material.uniforms.uHillshadeUvScale.value.set(
                      hillshadeResult.uvScale[0],
                      hillshadeResult.uvScale[1],
                    );
                    material.uniforms.uHillshadeUvOffset.value.set(
                      hillshadeResult.uvOffset[0],
                      hillshadeResult.uvOffset[1],
                    );
                    renderState.needsRender = true;
                  }
                },
              );
            }

            // Place Labels는 별도 줌 레벨로 관리 (updatePlaceLabels에서 처리)
          }
        }
      }
    });

    updateNeighborTextures();

    // Place labels 업데이트
    updatePlaceLabels();

    // soft shadow 진행 중이면 새 타일도 누적 시작
    if (renderState.softShadowMode && !renderState.shadowAccumulating) {
      startShadowAccumulation();
    }

    renderState.needsRender = true;
  });

  // 타일 언로드 시 제거
  tilesRenderer.addEventListener("dispose-model", (event: unknown) => {
    const { tile } = event as { tile: { content: { uri: string } } };
    const coords = extractTileCoords(tile?.content?.uri || "");

    if (coords) {
      const key = getTileKey(coords.z, coords.x, coords.y);
      loadedTiles.delete(key);
      // Place labels는 updateVisibleTiles에서 자동 정리
    }

    updateNeighborTextures();
    // Place labels 업데이트 (뷰포트 밖 타일 정리)
    updatePlaceLabels();
    renderState.needsRender = true;
  });

  // 타일 로드 실패 이벤트 - DemFallbackPlugin에서 처리되므로 발생하지 않음
  tilesRenderer.addEventListener("load-error", () => {
    // fallback 덕분에 이 이벤트는 발생하지 않음
  });
}

// 초기 이벤트 핸들러 설정
setupTileEventHandlers();

// ECEF(Z-up) → Three.js Y-up 변환
tilesRenderer.group.rotation.x = -Math.PI / 2;
scene.add(tilesRenderer.group);

const ellipsoidGroup = new THREE.Group();
ellipsoidGroup.rotation.x = -Math.PI / 2;
scene.add(ellipsoidGroup);
ellipsoidGroup.updateMatrixWorld(true);

// Initialize atmosphere (async)
async function initAtmosphere(): Promise<void> {
  try {
    console.log("Loading atmosphere textures...");
    const baseUrl = import.meta.env.BASE_URL || "/";
    const textures = await loadAtmosphereTextures(`${baseUrl}atmosphere`);
    console.log("Atmosphere textures loaded");

    // Create sky material
    skyMaterial = new SkyMaterial({ textures });

    // Create full-screen quad for sky rendering
    const skyGeometry = new THREE.PlaneGeometry(2, 2);
    skyMesh = new THREE.Mesh(skyGeometry, skyMaterial);
    skyMesh.frustumCulled = false;
    skyMesh.renderOrder = -1000; // Render first (behind everything)
    scene.add(skyMesh);

    // Load starfield texture for sky shader
    const starfieldTexture = new THREE.TextureLoader().load(
      `${baseUrl}starmap_2020_4k.webp`,
    );
    starfieldTexture.colorSpace = THREE.SRGBColorSpace;
    skyMaterial.updateStarfield(starfieldTexture, 0);

    // Remove solid background color
    scene.background = null;

    // Create EffectComposer with postprocessing library
    // Linear 출력: 셰이더에서 직접 감마 보정하므로 sRGB 자동 변환 비활성화
    // 여기 임의로 수정하지 말 것!!
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    effectComposer = new EffectComposer(renderer, {
      frameBufferType: THREE.HalfFloatType,
    });

    const renderPass = new RenderPass(scene, camera);
    effectComposer.addPass(renderPass);

    // Create AerialPerspectiveEffect for atmospheric scattering on terrain
    aerialPerspectiveEffect = new AerialPerspectiveEffect(camera, { textures });

    // Create LensFlareEffect for sun flare
    lensFlareEffect = new LensFlareEffect({
      intensity: 3.5, // Stronger effect
    });
    lensFlareEffect.thresholdLevel = 3; // Lower threshold to catch sun
    lensFlareEffect.thresholdRange = 2;

    // Add effects pass
    const effectPass = new EffectPass(
      camera,
      aerialPerspectiveEffect,
      lensFlareEffect,
    );
    effectComposer.addPass(effectPass);

    console.log(
      "Atmosphere initialized with aerial perspective and lens flare",
    );
    renderState.needsRender = true;
  } catch (error) {
    console.error("Failed to load atmosphere:", error);
  }
}

// Start loading atmosphere
initAtmosphere();

// GlobeControls 설정
const controls = new GlobeControls(scene, camera, renderer.domElement);
controls.setEllipsoid(SPHERE_ELLIPSOID, ellipsoidGroup);
controls.maxDistance = COMPUTED.CAMERA_MAX_DISTANCE;
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.rotationSpeed = 1.5;
controls.nearMargin = 0.01;
// 초기 타겟 설정
controls.pivotPoint.set(-4203681.1, 631129.5, -4754776.9);

// Debug: expose to console
(window as unknown as Record<string, unknown>).controls = controls;
(window as unknown as Record<string, unknown>).camera = camera;
(window as unknown as Record<string, unknown>).renderer = renderer;
(window as unknown as Record<string, unknown>).scene = scene;
(window as unknown as Record<string, unknown>).renderState = renderState;

// 카메라 프리셋 초기화 (개발 모드에서만)
if (import.meta.env.DEV) {
  initCameraPresets(camera, controls, () => {
    renderState.needsRender = true;
  });
}

// 카메라 거리에서 대략적인 줌 레벨 계산
function getApproximateZoom(): number {
  const distance = camera.position.length() - EARTH_RADIUS;
  // 지구 전체가 보이는 거리 (~20,000km) = z0
  // z가 1 증가할 때마다 거리가 절반
  const fullEarthDistance = EARTH_RADIUS * 3;
  const zoom = Math.log2(fullEarthDistance / Math.max(distance, 1000));
  return Math.max(0, Math.min(18, zoom));
}

// Place labels 타일 업데이트 (별도 줌 레벨로 관리)
function updatePlaceLabels(): void {
  if (!renderSettings.showPlaceLabels) return;

  // 현재 로드된 타일 좌표 수집
  const visibleCoords: Array<{ z: number; x: number; y: number }> = [];
  for (const key of loadedTiles.keys()) {
    const [z, x, y] = key.split("/").map(Number);
    visibleCoords.push({ z, x, y });
  }

  if (visibleCoords.length > 0) {
    const zoom = getApproximateZoom();
    placeLabelsManager.updateVisibleTiles(zoom, visibleCoords);
  }
}

// 카메라 이동 시
function onControlsChange(): void {
  renderState.isIdle = false;
  renderState.needsRender = true;

  // hard shadow 모드로 전환
  switchToHardShadow();

  // 줌 레벨 변경에 따른 레이블 가시성 업데이트
  const zoom = getApproximateZoom();
  placeLabelsManager.updateZoom(zoom);

  // Place labels 타일 업데이트 (별도 줌 레벨로 관리)
  updatePlaceLabels();

  if (renderState.idleTimeout !== null) {
    clearTimeout(renderState.idleTimeout);
  }

  renderState.idleTimeout = window.setTimeout(() => {
    renderState.isIdle = true;
    // 자동 렌더링 하지 않음 - 사용자가 Render 버튼 눌러야 함
  }, 500);
}

// Shadow 누적 시작
function startShadowAccumulation(): void {
  renderState.softShadowMode = true;
  renderState.shadowAccumulating = true;
  updateRenderButtonStyle();

  // 현재 로드된 모든 타일에 대해 shadow 렌더러 초기화
  const sunDir = dateTimeControl.getSunDirection();
  shadowRenderer.setSunDirection(sunDir);

  // AO 렌더링 항상 활성화
  shadowRenderer.setAOEnabled(true);

  for (const [key, tileData] of loadedTiles) {
    // 인접 타일 텍스처 수집
    const neighborTextures = new Map<string, THREE.Texture>();
    for (const { name, dx, dy } of NEIGHBOR_DIRECTIONS) {
      const neighborKey = getTileKey(
        tileData.z,
        tileData.x + dx,
        tileData.y + dy,
      );
      const neighbor = loadedTiles.get(neighborKey);
      if (neighbor) {
        neighborTextures.set(name, neighbor.texture);
      }
    }

    shadowRenderer.initTile(
      key,
      tileData.z,
      tileData.x,
      tileData.y,
      tileData.texture,
      neighborTextures,
    );
  }
}

controls.addEventListener("change", onControlsChange);

tilesRenderer.setCamera(camera);
tilesRenderer.setResolutionFromRenderer(camera, renderer);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  placeLabelsManager.setSize(window.innerWidth, window.innerHeight);
  tilesRenderer.setResolutionFromRenderer(camera, renderer);

  // EffectComposer 리사이즈
  if (effectComposer) {
    effectComposer.setSize(window.innerWidth, window.innerHeight);
  }

  // 화면 갱신
  renderState.needsRender = true;
});

function clampCameraDistance(): void {
  const distance = camera.position.length();
  if (distance > COMPUTED.CAMERA_MAX_DISTANCE) {
    camera.position.setLength(COMPUTED.CAMERA_MAX_DISTANCE);
  }
}

function ensureCameraNearFar(): void {
  // 카메라와 지구 표면 사이의 거리 계산
  const distanceFromCenter = camera.position.length();
  const distanceFromSurface = Math.max(100, distanceFromCenter - EARTH_RADIUS);

  // near를 표면 거리의 0.1%로, 최소 10m
  const newNear = Math.max(10, distanceFromSurface * 0.001);

  let needsUpdate = false;
  if (Math.abs(camera.near - newNear) > 1) {
    camera.near = newNear;
    needsUpdate = true;
  }
  if (camera.far < COMPUTED.CAMERA_FAR) {
    camera.far = COMPUTED.CAMERA_FAR;
    needsUpdate = true;
  }
  if (needsUpdate) {
    camera.updateProjectionMatrix();
  }
}

function updateSunDirection(): void {
  dateTimeControl.update();
  const newSunDir = dateTimeControl.getSunDirection();

  for (const tileData of loadedTiles.values()) {
    tileData.material.uniforms.uSunDirection.value.copy(newSunDir);
  }
}

function updateShadowAccumulation(): void {
  // Soft shadow 모드가 아니면 hard shadow만 사용
  if (!renderState.softShadowMode) {
    for (const tileData of loadedTiles.values()) {
      tileData.material.uniforms.uUseShadowMap.value = 0.0;
      // AO도 기본 흰색 텍스처로 리셋 (ao=1.0 → 효과 없음)
      tileData.material.uniforms.uAOMap.value = whiteDummyTexture;
    }
    renderState.shadowAccumulating = false;
    return;
  }

  // 누적 중이면 렌더링 계속
  if (renderState.shadowAccumulating) {
    shadowRenderer.renderFrame();
  }

  // wwwtyro 방식: shadow map이 1프레임이라도 있으면 바로 적용
  // 0에서 시작해서 점진적으로 밝아지므로 블렌딩 불필요
  for (const [key, tileData] of loadedTiles) {
    const shadowTexture = shadowRenderer.getShadowTexture(key);
    const frameCount = shadowRenderer.getFrameCount(key);

    if (shadowTexture && frameCount >= 1) {
      tileData.material.uniforms.uShadowMap.value = shadowTexture;
      tileData.material.uniforms.uUseShadowMap.value = 1.0;
    } else {
      tileData.material.uniforms.uUseShadowMap.value = 0.0;
    }

    // AO 텍스처도 업데이트
    const aoTexture = shadowRenderer.getAOTexture(key);
    if (aoTexture) {
      tileData.material.uniforms.uAOMap.value = aoTexture;
    }
  }

  // 모든 타일이 256프레임 완료되면 누적 종료
  if (renderState.shadowAccumulating) {
    const avgFrames = shadowRenderer.getAverageFrameCount();
    if (avgFrames >= 128) {
      renderState.shadowAccumulating = false;
    }
  }

  renderState.frameCount++;
}

// lil-gui 폰트 스타일
const GUI_FONT = `font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; font-size: 11px;`;

// 하단 좌측 브랜딩 UI
const statusDiv = document.createElement("div");
statusDiv.style.cssText = `
  position: fixed;
  bottom: 10px;
  left: 10px;
  background: rgba(0, 0, 0, 0.7);
  color: #eee;
  padding: 8px 12px;
  border-radius: 4px;
  ${GUI_FONT}
  display: flex;
  align-items: center;
  gap: 8px;
`;

const brandText = document.createElement("span");
brandText.textContent = "VWL Inc.  |  2026  |";
statusDiv.appendChild(brandText);

const infoButton = document.createElement("button");
infoButton.textContent = "Info";
infoButton.style.cssText = `
  background: transparent;
  border: 1px solid #aaa;
  color: #eee;
  padding: 2px 8px;
  border-radius: 3px;
  cursor: pointer;
  ${GUI_FONT}
`;
infoButton.addEventListener("mouseenter", () => {
  infoButton.style.background = "rgba(255, 255, 255, 0.2)";
});
infoButton.addEventListener("mouseleave", () => {
  infoButton.style.background = "transparent";
});
infoButton.addEventListener("click", showInfoPopup);
statusDiv.appendChild(infoButton);

const helpButton = document.createElement("button");
helpButton.textContent = "Help";
helpButton.style.cssText = `
  background: transparent;
  border: 1px solid #aaa;
  color: #eee;
  padding: 2px 8px;
  border-radius: 3px;
  cursor: pointer;
  ${GUI_FONT}
`;
helpButton.addEventListener("mouseenter", () => {
  helpButton.style.background = "rgba(255, 255, 255, 0.2)";
});
helpButton.addEventListener("mouseleave", () => {
  helpButton.style.background = "transparent";
});
helpButton.addEventListener("click", showHelpPopup);
statusDiv.appendChild(helpButton);

document.body.appendChild(statusDiv);

// Info 팝업
let infoPopup: HTMLDivElement | null = null;

function showInfoPopup(): void {
  if (infoPopup) {
    closeInfoPopup();
    return;
  }

  infoPopup = document.createElement("div");
  infoPopup.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(20, 20, 30, 0.95);
    color: #eee;
    padding: 24px 32px;
    border-radius: 8px;
    ${GUI_FONT}
    z-index: 99999;
    min-width: 300px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  `;

  const linkStyle = "color: #6af; text-decoration: none;";
  infoPopup.innerHTML = `
    <h2 style="margin: 0 0 16px 0; font-size: 16px;">ShadEarth</h2>
    <p style="margin: 8px 0;"><strong>Version:</strong> 1.0.0</p>
    <p style="margin: 8px 0;"><strong>Developer:</strong> VWL Inc.</p>
    <p style="margin: 8px 0;"><strong>Year:</strong> 2026</p>
    <p style="margin: 8px 0;"><strong>Source Code:</strong> <a href="https://github.com/vuski/shadearth" target="_blank" style="${linkStyle}">GitHub</a></p>
    <p style="margin: 8px 0;"><strong>Blog:</strong> <a href="https://www.vw-lab.com" target="_blank" style="${linkStyle}">www.vw-lab.com</a></p>
    <hr style="border: none; border-top: 1px solid #444; margin: 16px 0;">
    <p style="margin: 8px 0; color: #aaa;">
      Keyboard Shortcuts:<br>
      A/F - Day -/+<br>
      S/D - Time -/+<br>
      U - Toggle UI<br>
      I - Info<br>
      H - Help<br>
      P - Screenshot (canvas)<br>
      Shift+P - Screenshot (with UI)<br>
      F2 - Debug View
    </p>
    <hr style="border: none; border-top: 1px solid #444; margin: 16px 0;">
    <p style="margin: 8px 0; font-size: 12px;"><strong>References</strong></p>
    <p style="margin: 4px 0; font-size: 11px; color: #aaa; display: grid; grid-template-columns: auto 1fr; gap: 2px 8px;">
      <span>Render Engine</span><a href="https://github.com/wwwtyro/map-tile-lighting-demo" target="_blank" style="${linkStyle}">map-tile-lighting-demo</a>
      <span>XYZ Tile</span><a href="https://github.com/NASA-AMMOS/3DTilesRendererJS" target="_blank" style="${linkStyle}">3DTilesRendererJS</a>
      <span>Atmosphere+Sky</span><a href="https://github.com/takram-design-engineering/three-geospatial" target="_blank" style="${linkStyle}">three-geospatial</a>
    </p>
    <p style="margin: 12px 0 4px 0; font-size: 12px;"><strong>Map Sources</strong></p>
    <p style="margin: 4px 0; font-size: 11px; color: #aaa;">
      Satellite: <a href="https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9" target="_blank" style="${linkStyle}">Esri World Imagery</a><br>
      DEM: <a href="https://mapterhorn.com/" target="_blank" style="${linkStyle}">Mapterhorn</a><br>
      Night: <a href="https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps/" target="_blank" style="${linkStyle}">NASA Earth Observatory</a><br>
      Hillshade: OSM + Mapterhorn (processed)
    </p>
    <button id="info-close-btn" style="
      margin-top: 16px;
      background: #444;
      border: none;
      color: #eee;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      width: 100%;
      font-family: inherit;
    ">Close</button>
  `;

  document.body.appendChild(infoPopup);

  const closeBtn = document.getElementById("info-close-btn");
  closeBtn?.addEventListener("click", closeInfoPopup);

  // ESC 키로 닫기
  document.addEventListener("keydown", handleInfoEsc);
}

function handleInfoEsc(e: KeyboardEvent): void {
  if (e.key === "Escape" && infoPopup) {
    closeInfoPopup();
  }
}

function closeInfoPopup(): void {
  if (infoPopup) {
    document.body.removeChild(infoPopup);
    infoPopup = null;
    document.removeEventListener("keydown", handleInfoEsc);
  }
}

// Help 팝업
let helpPopup: HTMLDivElement | null = null;

function showHelpPopup(): void {
  if (helpPopup) {
    closeHelpPopup();
    return;
  }

  helpPopup = document.createElement("div");
  helpPopup.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(20, 20, 30, 0.95);
    color: #eee;
    padding: 24px 32px;
    border-radius: 8px;
    ${GUI_FONT}
    z-index: 99999;
    min-width: 400px;
    max-width: 500px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  `;

  helpPopup.innerHTML = `
    <h2 style="margin: 0 0 16px 0; font-size: 16px;">How to Use</h2>
    <p style="margin: 8px 0; color: #ffa; font-size: 11px;">
      <strong>Note:</strong> Works on mobile but the UI covers most of the screen, and navigation will be very slow.
      Rendering is not optimized, so the 128-step soft shadow pass can take up to a minute depending on the scene.
    </p>
    <hr style="border: none; border-top: 1px solid #444; margin: 16px 0;">
    <ol style="margin: 8px 0; padding-left: 20px; line-height: 1.8;">
      <li>Navigate the globe by dragging and zooming</li>
      <li>Set the sun position using the time/date controls</li>
      <li>Click the <strong>Render</strong> button to calculate soft shadows</li>
      <li>For distant views, increase <strong>Elevation Scale</strong> to emphasize terrain relief<br>
        <span style="color: #aaa; font-size: 10px;">(exaggerated elevation is not realistic, but helps visualize topography from space where actual mountains would be imperceptible)</span></li>
      <li>If the scene looks too dark, adjust <strong>Brightness</strong> and other settings in Post Processing</li>
    </ol>
    <hr style="border: none; border-top: 1px solid #444; margin: 16px 0;">
    <p style="margin: 8px 0; color: #aaa;">
      <strong>Keyboard Shortcuts:</strong><br>
      <span style="display: inline-block; width: 80px;">A / F</span> Day -/+<br>
      <span style="display: inline-block; width: 80px;">S / D</span> Time -/+<br>
      <span style="display: inline-block; width: 80px;">U</span> Toggle UI<br>
      <span style="display: inline-block; width: 80px;">I</span> Info<br>
      <span style="display: inline-block; width: 80px;">H</span> Help<br>
      <span style="display: inline-block; width: 80px;">P</span> Screenshot (canvas)<br>
      <span style="display: inline-block; width: 80px;">Shift+P</span> Screenshot (with UI)<br>
      <span style="display: inline-block; width: 80px;">F2</span> Debug View
    </p>
    <button id="help-close-btn" style="
      margin-top: 16px;
      background: #444;
      border: none;
      color: #eee;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      width: 100%;
      font-family: inherit;
    ">Close</button>
  `;

  document.body.appendChild(helpPopup);

  const closeBtn = document.getElementById("help-close-btn");
  closeBtn?.addEventListener("click", closeHelpPopup);

  document.addEventListener("keydown", handleHelpEsc);
}

function handleHelpEsc(e: KeyboardEvent): void {
  if (e.key === "Escape" && helpPopup) {
    closeHelpPopup();
  }
}

function closeHelpPopup(): void {
  if (helpPopup) {
    document.body.removeChild(helpPopup);
    helpPopup = null;
    document.removeEventListener("keydown", handleHelpEsc);
  }
}

function updateStatus(): void {
  const avgFrames = shadowRenderer.getAverageFrameCount();
  if (renderState.shadowAccumulating) {
    renderDisplay.progress = `${avgFrames}/128`;
  } else if (renderState.softShadowMode && avgFrames > 0) {
    renderDisplay.progress = `Done (${avgFrames}/128)`;
  } else {
    renderDisplay.progress = "";
  }
}

// Debug View 설정 (F2 키와 GUI에서 공유)
const debugSettings = { debugView: 0 };

// 디버그 모드 순환: F2 (캡처 단계에서 처리하여 GUI 포커스와 무관하게 동작)
document.addEventListener(
  "keydown",
  (event) => {
    if (event.key !== "F2") return;
    event.preventDefault();
    renderState.debugMode = (renderState.debugMode + 1) % 8;
    debugSettings.debugView = renderState.debugMode; // GUI 동기화
    console.log("Debug mode:", renderState.debugMode);
    for (const tileData of loadedTiles.values()) {
      tileData.material.uniforms.uDebugMode.value = renderState.debugMode;
    }
    renderState.needsRender = true;
  },
  true,
); // true = 캡처 단계

// 렌더링 설정 GUI (constants.ts에서 초기값 가져옴)
const renderSettings = { ...RENDER_SETTINGS };

// errorTarget 초기값 적용
tilesRenderer.errorTarget = renderSettings.errorTarget;

const settingsGui = new GUI({ title: "Scene Settings", width: 280 });
applyPosition(settingsGui.domElement, UI_POSITIONS.settings);

// 타일 재로드 함수: tilesRenderer를 완전히 재생성
function reloadAllTiles() {
  console.log("타일 새로고침: tilesRenderer 재생성 중...");

  // 1. 기존 tilesRenderer 정리
  const oldGroup = tilesRenderer.group;
  scene.remove(oldGroup);
  tilesRenderer.dispose();

  // 2. loadedTiles 클리어
  loadedTiles.clear();

  // 3. 새 tilesRenderer 생성
  tilesRenderer = createTilesRenderer();
  tilesRenderer.errorTarget = renderSettings.errorTarget;

  // 4. 카메라 및 컨트롤 재설정
  tilesRenderer.setCamera(camera);
  tilesRenderer.setResolutionFromRenderer(camera, renderer);

  // 5. scene에 추가
  scene.add(tilesRenderer.group);
  tilesRenderer.group.rotation.x = -Math.PI / 2;

  // 6. 이벤트 핸들러 재연결
  setupTileEventHandlers();

  console.log("타일 새로고침 완료");
  renderState.needsRender = true;
}

// === Scene Settings ===
settingsGui
  .add(renderSettings, "errorTarget", 0.01, 6, 0.01)
  .name("Tile LOD Threshold")
  .onChange((value: number) => {
    tilesRenderer.errorTarget = value;
    switchToHardShadow();
  });

settingsGui
  .add(renderSettings, "meshResolution", {
    "Low (32×32)": "low",
    "Medium (64×64)": "medium",
    "High (128×128)": "high",
    "Ultra (256×256)": "ultra",
  })
  .name("Mesh Resolution")
  .onChange((value: MeshResolution) => {
    highResPlugin.setMeshResolution(value);
    console.log(
      `Mesh resolution: ${value} (${MESH_RESOLUTION_MAP[value]}×${MESH_RESOLUTION_MAP[value]})`,
    );
    switchToHardShadow();
  });

// Reload 버튼 (타일 수 포함)
const tileActions = { reload: reloadAllTiles };
const reloadController = settingsGui
  .add(tileActions, "reload")
  .name("Reload Tiles (0)");

// 타일 수 업데이트 함수
function updateTileCount(): void {
  reloadController.name(`Reload Tiles (${loadedTiles.size})`);
}

settingsGui
  .add(renderSettings, "elevationScale", 0.5, 30.0, 0.5)
  .name("Elevation Scale")
  .onChange((value: number) => {
    for (const tileData of loadedTiles.values()) {
      tileData.material.uniforms.uElevationScale.value = value;
    }
    // shadowRenderer에도 적용
    shadowRenderer.setElevationScale(value);
    // hard shadow 모드로 전환
    switchToHardShadow();
    // 화면 갱신
    renderState.needsRender = true;
  });

settingsGui
  .add(renderSettings, "aoRangeScale", 0.1, 2.0, 0.01)
  .name("AO Range")
  .onChange((value: number) => {
    shadowRenderer.setAoRangeScale(value);
    // hard shadow 모드로 전환
    switchToHardShadow();
  });

settingsGui
  .add(renderSettings, "sunJitter", 1, 100, 1)
  .name("Soft Shadow")
  .onChange((value: number) => {
    shadowRenderer.setSunRadiusMultiplier(value);
    shadowRenderer.reset();
    switchToHardShadow();
  });

// === Render GUI ===
const renderGui = new GUI({ title: "Render", width: 280 });
applyPosition(renderGui.domElement, UI_POSITIONS.render);

// 진행률 표시용 객체
const renderDisplay = {
  progress: "",
  render: () => {
    // soft shadow 렌더링 시작
    startShadowAccumulation();
  },
};

const renderButtonController = renderGui
  .add(renderDisplay, "render")
  .name("Render");

// 버튼 요소 참조 저장
renderButtonElement = renderButtonController.domElement.querySelector("button");

// 진행률 표시
renderGui.add(renderDisplay, "progress").name("").disable().listen();

// 초기 버튼 스타일 설정 (hard shadow 모드)
updateRenderButtonStyle();

// === Post Processing GUI ===
const postProcessGui = new GUI({ title: "Post Processing", width: 280 });
applyPosition(postProcessGui.domElement, UI_POSITIONS.postProcess);

// 모바일에서는 Post Processing 패널 기본 접기
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
if (isMobile) {
  postProcessGui.close();
}

// Debug View 드롭다운 (F2 키와 동일)
const debugViewOptions = {
  Off: 0,
  LocalSun: 1,
  LocalNormal: 2,
  SurfaceNormal: 3,
  Shadow: 4,
  "Soft-Hard Diff": 5,
  Elevation: 6,
  AO: 7,
};

postProcessGui
  .add(debugSettings, "debugView", debugViewOptions)
  .name("Debug View (F2)")
  .listen()
  .onChange((value: number) => {
    renderState.debugMode = value;
    for (const tileData of loadedTiles.values()) {
      tileData.material.uniforms.uDebugMode.value = value;
    }
    renderState.needsRender = true;
  });

// === Shading 폴더 ===
const shadingFolder = postProcessGui.addFolder("Shading");
shadingFolder.open();

shadingFolder
  .add(renderSettings, "aoShadowWeight", 0, 1, 0.01)
  .name("Shadow Weight")
  .onChange((value: number) => {
    for (const tileData of loadedTiles.values()) {
      tileData.material.uniforms.uAoShadowWeight.value = value;
    }
    renderState.needsRender = true;
  });

shadingFolder
  .add(renderSettings, "aoDiffuseWeight", 0, 1, 0.01)
  .name("AO Weight")
  .onChange((value: number) => {
    for (const tileData of loadedTiles.values()) {
      tileData.material.uniforms.uAoDiffuseWeight.value = value;
    }
    renderState.needsRender = true;
  });

shadingFolder
  .add(renderSettings, "groupBlendMode", {
    Multiply: 0,
    Overlay: 1,
    "Hard Light": 2,
  })
  .name("Shading Blend")
  .onChange((value: number) => {
    for (const tileData of loadedTiles.values()) {
      tileData.material.uniforms.uGroupBlendMode.value = value;
    }
    renderState.needsRender = true;
  });

shadingFolder
  .add(renderSettings, "shadowBlendMode", {
    "Hard Light": 0,
    Multiply: 1,
    Pow: 2,
  })
  .name("Shadow Blend")
  .onChange((value: number) => {
    for (const tileData of loadedTiles.values()) {
      tileData.material.uniforms.uShadowBlendMode.value = value;
    }
    // Pow 모드일 때만 shadowPow 활성화
    if (value === 2) {
      shadowPowController.enable();
    } else {
      shadowPowController.disable();
    }
    renderState.needsRender = true;
  });

const shadowPowController = shadingFolder
  .add(renderSettings, "shadowPow", 0.1, 4.0, 0.1)
  .name("Shadow Pow")
  .onChange((value: number) => {
    for (const tileData of loadedTiles.values()) {
      tileData.material.uniforms.uShadowPow.value = value;
    }
    renderState.needsRender = true;
  });

// 초기 상태: Pow 모드가 아니면 비활성화
if (renderSettings.shadowBlendMode !== 2) {
  shadowPowController.disable();
}

// === Tone 폴더 ===
const toneFolder = postProcessGui.addFolder("Tone");
toneFolder.open();

toneFolder
  .add(renderSettings, "brightness", 0.5, 4.0, 0.05)
  .name("Brightness")
  .onChange((value: number) => {
    for (const tileData of loadedTiles.values()) {
      tileData.material.uniforms.uBrightness.value = value;
    }
    renderState.needsRender = true;
  });

toneFolder
  .add(renderSettings, "gamma", 0.5, 3.0, 0.1)
  .name("Gamma")
  .onChange((value: number) => {
    for (const tileData of loadedTiles.values()) {
      tileData.material.uniforms.uGamma.value = value;
    }
    renderState.needsRender = true;
  });

// === Satellite 폴더 ===
const satelliteFolder = postProcessGui.addFolder("Satellite");
satelliteFolder.open();

satelliteFolder
  .add(renderSettings, "useSatellite")
  .name("Enable Satellite")
  .onChange((value: boolean) => {
    for (const tileData of loadedTiles.values()) {
      tileData.material.uniforms.uUseSatellite.value = value ? 1.0 : 0.0;
    }
    // 위성 이미지 활성화 시 아직 로드 안된 타일 로드
    if (value) {
      for (const [key, tileData] of loadedTiles) {
        if (!tileData.satelliteTexture) {
          loadSatelliteTile(tileData.z, tileData.x, tileData.y).then(
            (satTexture) => {
              if (satTexture && loadedTiles.has(key)) {
                tileData.satelliteTexture = satTexture;
                tileData.material.uniforms.uSatelliteMap.value = satTexture;
                renderState.needsRender = true;
              }
            },
          );
        }
      }
    }
    renderState.needsRender = true;
  });

satelliteFolder
  .add(renderSettings, "useHillshade")
  .name("Enable Hillshade")
  .onChange((value: boolean) => {
    for (const tileData of loadedTiles.values()) {
      tileData.material.uniforms.uUseHillshade.value = value ? 1.0 : 0.0;
    }
    // Hillshade 활성화 시 아직 로드 안된 타일 로드
    if (value) {
      for (const [key, tileData] of loadedTiles) {
        if (!tileData.hillshadeTexture) {
          loadHillshadeTile(tileData.z, tileData.x, tileData.y).then(
            (hillshadeResult) => {
              if (hillshadeResult && loadedTiles.has(key)) {
                tileData.hillshadeTexture = hillshadeResult.texture;
                tileData.material.uniforms.uHillshadeMap.value =
                  hillshadeResult.texture;
                tileData.material.uniforms.uHillshadeUvScale.value.set(
                  hillshadeResult.uvScale[0],
                  hillshadeResult.uvScale[1],
                );
                tileData.material.uniforms.uHillshadeUvOffset.value.set(
                  hillshadeResult.uvOffset[0],
                  hillshadeResult.uvOffset[1],
                );
                renderState.needsRender = true;
              }
            },
          );
        }
      }
    }
    renderState.needsRender = true;
  });

satelliteFolder
  .add(renderSettings, "showPlaceLabels")
  .name("Show Place Labels")
  .onChange((value: boolean) => {
    placeLabelsManager.setEnabled(value);
    renderState.needsRender = true;
  });

satelliteFolder
  .add(renderSettings, "greenDesatAmount", 0, 1, 0.05)
  .name("Green Desat")
  .onChange((value: number) => {
    for (const tileData of loadedTiles.values()) {
      tileData.material.uniforms.uGreenDesatAmount.value = value;
    }
    renderState.needsRender = true;
  });

satelliteFolder
  .add(renderSettings, "wbStrength", 0, 0.5, 0.01)
  .name("WB Strength")
  .onChange((value: number) => {
    for (const tileData of loadedTiles.values()) {
      tileData.material.uniforms.uWbStrength.value = value;
    }
    renderState.needsRender = true;
  });

satelliteFolder
  .add(renderSettings, "wbTemp", -50, 50, 1)
  .name("Temperature")
  .onChange((value: number) => {
    for (const tileData of loadedTiles.values()) {
      tileData.material.uniforms.uWbTemp.value = value;
    }
    renderState.needsRender = true;
  });

satelliteFolder
  .add(renderSettings, "wbTint", -50, 50, 1)
  .name("Tint")
  .onChange((value: number) => {
    for (const tileData of loadedTiles.values()) {
      tileData.material.uniforms.uWbTint.value = value;
    }
    renderState.needsRender = true;
  });

satelliteFolder
  .add(renderSettings, "useAtmosphere")
  .name("Atmosphere")
  .onChange((value: boolean) => {
    // Sky mesh visibility
    if (skyMesh) {
      skyMesh.visible = value;
    }
    // Aerial perspective effect (limb, inscatter)
    if (aerialPerspectiveEffect) {
      aerialPerspectiveEffect.setEnabled(value);
    }
    // Twilight tint in tile shaders
    for (const tileData of loadedTiles.values()) {
      tileData.material.uniforms.uUseAtmosphere.value = value ? 1.0 : 0.0;
    }
    renderState.needsRender = true;
  });

// Click debug: display point info with lil-gui
const debugData = {
  // Position
  "Lat (°)": 0,
  "Lon (°)": 0,
  "Elev (m)": 0,
  // Sun vector (ground projection)
  "Sun East": 0,
  "Sun North": 0,
  "Azimuth (°)": 0,
  "Altitude (°)": 0,
  "Day/Night": "---",
  // Shadow (based on actual elevation)
  "Shadow E-W (m)": 0,
  "Shadow N-S (m)": 0,
  "Shadow Len (m)": 0,
};

const debugGui = new GUI({ title: "DoubleClick Point Info" });
applyPosition(debugGui.domElement, UI_POSITIONS.debug);
debugGui.close();

const posFolder = debugGui.addFolder("Position");
posFolder.add(debugData, "Lat (°)").listen().disable();
posFolder.add(debugData, "Lon (°)").listen().disable();
posFolder.add(debugData, "Elev (m)").listen().disable();

const sunFolder = debugGui.addFolder("Sun Vector");
sunFolder.add(debugData, "Sun East").listen().disable();
sunFolder.add(debugData, "Sun North").listen().disable();
sunFolder.add(debugData, "Azimuth (°)").listen().disable();
sunFolder.add(debugData, "Altitude (°)").listen().disable();
sunFolder.add(debugData, "Day/Night").listen().disable();

const debugShadowFolder = debugGui.addFolder("Shadow");
debugShadowFolder.add(debugData, "Shadow E-W (m)").listen().disable();
debugShadowFolder.add(debugData, "Shadow N-S (m)").listen().disable();
debugShadowFolder.add(debugData, "Shadow Len (m)").listen().disable();

// 디버그용 화살표 헬퍼 및 마커
let sunArrow: THREE.ArrowHelper | null = null;
let shadowArrow: THREE.ArrowHelper | null = null;
let clickMarker: THREE.Mesh | null = null;
let lastDebugWorldPos: THREE.Vector3 | null = null;
let cachedElevation: number | null = null; // 고도 캐시 (위치 변경 시에만 갱신)

// Reset 버튼: 마커 및 화살표 제거, 수치 초기화
function clearDebugMarkers(): void {
  if (clickMarker) {
    scene.remove(clickMarker);
    clickMarker = null;
  }
  if (sunArrow) {
    scene.remove(sunArrow);
    sunArrow = null;
  }
  if (shadowArrow) {
    scene.remove(shadowArrow);
    shadowArrow = null;
  }
  lastDebugWorldPos = null;
  cachedElevation = null;
  // 수치 초기화
  debugData["Lat (°)"] = 0;
  debugData["Lon (°)"] = 0;
  debugData["Elev (m)"] = 0;
  debugData["Sun East"] = 0;
  debugData["Sun North"] = 0;
  debugData["Azimuth (°)"] = 0;
  debugData["Altitude (°)"] = 0;
  debugData["Day/Night"] = "---";
  debugData["Shadow E-W (m)"] = 0;
  debugData["Shadow N-S (m)"] = 0;
  debugData["Shadow Len (m)"] = 0;
  debugGui.close();
  renderState.needsRender = true;
}
debugGui.add({ reset: clearDebugMarkers }, "reset").name("Reset");

// GUI 조작 후 포커스 해제 (키보드 이벤트가 캔버스로 전달되도록)
[settingsGui, renderGui, postProcessGui, debugGui].forEach((gui) => {
  gui.domElement.addEventListener("click", () => {
    setTimeout(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    }, 0);
  });
});

// 클릭 마커 생성 (카메라 거리에 따라 크기 조절)
function createClickMarker(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(1, 8, 8); // 단위 구체
  const material = new THREE.MeshBasicMaterial({
    color: 0xff0000,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 999; // 항상 위에 렌더링
  return mesh;
}

// 화면 픽셀 기준 월드 스케일 계산
function getWorldPerPixel(worldPos: THREE.Vector3): number {
  const distance = camera.position.distanceTo(worldPos);
  const fovRad = (camera.fov * Math.PI) / 180;
  return (2 * distance * Math.tan(fovRad / 2)) / window.innerHeight;
}

function updateClickMarkerScale(): void {
  if (!clickMarker) return;
  // 화면에서 약 6px로 보이도록 마커까지의 거리 기반 스케일 계산
  const worldPerPixel = getWorldPerPixel(clickMarker.position);
  const targetPixels = 6;
  // SphereGeometry의 radius가 1이므로 scale = 원하는 반지름
  clickMarker.scale.setScalar(worldPerPixel * targetPixels);
}

function updateArrowScale(): void {
  if (!lastDebugWorldPos) return;
  const worldPerPixel = getWorldPerPixel(lastDebugWorldPos);
  const arrowLen = worldPerPixel * 80; // 화면에서 약 80px 길이

  if (sunArrow) {
    sunArrow.setLength(arrowLen, arrowLen * 0.2, arrowLen * 0.1);
  }
  if (shadowArrow) {
    shadowArrow.setLength(arrowLen, arrowLen * 0.15, arrowLen * 0.08);
  }
}

function calculatePointInfo(worldPos: THREE.Vector3): void {
  lastDebugWorldPos = worldPos.clone();
  const surfaceNormal = worldPos.clone().normalize();

  // 위도/경도 계산 (Y-up 좌표계)
  const lat = Math.asin(surfaceNormal.y) * (180 / Math.PI);
  const lon = Math.atan2(-surfaceNormal.z, surfaceNormal.x) * (180 / Math.PI);

  // 로컬 동/북 벡터 계산
  const lonRad = lon * (Math.PI / 180);
  const east = new THREE.Vector3(
    -Math.sin(lonRad),
    0,
    -Math.cos(lonRad),
  ).normalize();
  const north = new THREE.Vector3()
    .crossVectors(surfaceNormal, east)
    .normalize();

  // 태양 방향
  const sunDir = dateTimeControl.getSunDirection();

  // 로컬 태양 벡터 (동/북/상 성분)
  const localSunX = sunDir.dot(east); // 동쪽 성분
  const localSunY = sunDir.dot(north); // 북쪽 성분
  const localSunZ = sunDir.dot(surfaceNormal); // 상향 성분 (고도)

  // 지면 투영 (정사영)
  const sunHorizLen = Math.sqrt(localSunX * localSunX + localSunY * localSunY);
  const sunAzimuth = Math.atan2(localSunX, localSunY) * (180 / Math.PI); // 북쪽 기준 시계방향
  const sunAltitude = Math.atan2(localSunZ, sunHorizLen) * (180 / Math.PI);

  // 그림자 방향 (태양 반대 방향)
  const shadowDirX = -localSunX;
  const shadowDirY = -localSunY;

  // 클릭 지점의 고도 샘플링 - 캐시된 값 사용 (위치가 같으면 재사용)
  let elevation = cachedElevation ?? 0;

  // 새 위치이거나 캐시가 없으면 샘플링
  if (cachedElevation === null) {
    // 현재 디버그 모드 저장
    const prevDebugMode = renderState.debugMode;

    // 마커/화살표 숨기기
    if (clickMarker) clickMarker.visible = false;
    if (sunArrow) sunArrow.visible = false;
    if (shadowArrow) shadowArrow.visible = false;

    // Elevation 디버그 모드(6)로 설정
    for (const tileData of loadedTiles.values()) {
      tileData.material.uniforms.uDebugMode.value = 6;
    }

    // RenderTarget에 렌더링
    const rt = new THREE.WebGLRenderTarget(
      window.innerWidth,
      window.innerHeight,
    );
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);

    // 클릭 위치를 화면 좌표로 변환
    const screenPos = worldPos.clone().project(camera);
    const screenX = Math.round(((screenPos.x + 1) / 2) * window.innerWidth);
    const screenY = Math.round(((screenPos.y + 1) / 2) * window.innerHeight);

    // RenderTarget에서 픽셀 읽기
    const pixelBuffer = new Uint8Array(4);
    renderer.readRenderTargetPixels(rt, screenX, screenY, 1, 1, pixelBuffer);
    rt.dispose();

    // Elevation 디버그 모드에서는 0~9000m를 0~255로 매핑 (grayscale)
    const normalizedElev = pixelBuffer[0] / 255;
    elevation = normalizedElev * 9000;
    cachedElevation = elevation;

    // 디버그 모드 복원
    for (const tileData of loadedTiles.values()) {
      tileData.material.uniforms.uDebugMode.value = prevDebugMode;
    }
    renderState.debugMode = prevDebugMode;

    // 마커/화살표 다시 보이기
    if (clickMarker) clickMarker.visible = true;
    if (sunArrow) sunArrow.visible = true;
    if (shadowArrow) shadowArrow.visible = true;
  }

  // 그림자 길이 계산 (실제 고도 기준)
  let shadowLength = 0;
  let shadowLengthX = 0;
  let shadowLengthY = 0;

  if (localSunZ > 0.01 && sunHorizLen > 0.001 && elevation > 0) {
    shadowLength = elevation / (localSunZ / sunHorizLen);
    const shadowNormX = shadowDirX / sunHorizLen;
    const shadowNormY = shadowDirY / sunHorizLen;
    shadowLengthX = shadowLength * shadowNormX;
    shadowLengthY = shadowLength * shadowNormY;
  }

  // GUI 데이터 업데이트
  debugData["Lat (°)"] = parseFloat(lat.toFixed(4));
  debugData["Lon (°)"] = parseFloat(lon.toFixed(4));
  debugData["Elev (m)"] = parseFloat(elevation.toFixed(1));
  debugData["Sun East"] = parseFloat(localSunX.toFixed(4));
  debugData["Sun North"] = parseFloat(localSunY.toFixed(4));
  debugData["Azimuth (°)"] = parseFloat(sunAzimuth.toFixed(1));
  debugData["Altitude (°)"] = parseFloat(sunAltitude.toFixed(1));
  debugData["Day/Night"] = localSunZ > 0 ? "Day" : "Night";
  debugData["Shadow E-W (m)"] = parseFloat(shadowLengthX.toFixed(1));
  debugData["Shadow N-S (m)"] = parseFloat(shadowLengthY.toFixed(1));
  debugData["Shadow Len (m)"] = parseFloat(shadowLength.toFixed(1));

  // GUI 열기
  debugGui.open();

  // 클릭 마커 업데이트
  if (clickMarker) scene.remove(clickMarker);
  clickMarker = createClickMarker();
  clickMarker.position.copy(
    worldPos.clone().normalize().multiplyScalar(EARTH_RADIUS),
  );
  scene.add(clickMarker);

  // 3D 화살표 업데이트 (지면에 투영된 태양 방향)
  if (sunArrow) scene.remove(sunArrow);
  if (shadowArrow) scene.remove(shadowArrow);

  const arrowOrigin = worldPos.clone().multiplyScalar(1.001);
  const arrowScale = EARTH_RADIUS * 0.05;

  // 태양 방향 화살표 (노란색)
  const sunHorizDir = east
    .clone()
    .multiplyScalar(localSunX)
    .add(north.clone().multiplyScalar(localSunY))
    .normalize();
  if (sunHorizLen > 0.01) {
    sunArrow = new THREE.ArrowHelper(
      sunHorizDir,
      arrowOrigin,
      arrowScale,
      0xffff00,
      arrowScale * 0.2,
      arrowScale * 0.1,
    );
    scene.add(sunArrow);
  }

  // 그림자 방향 화살표 (검은색)
  const shadowHorizDir = sunHorizDir.clone().negate();
  if (sunHorizLen > 0.01 && localSunZ > 0.01) {
    const shadowArrowLen = Math.min(
      arrowScale * 2,
      arrowScale * (shadowLength / 5000),
    );
    shadowArrow = new THREE.ArrowHelper(
      shadowHorizDir,
      arrowOrigin,
      shadowArrowLen,
      0x333333,
      shadowArrowLen * 0.15,
      shadowArrowLen * 0.08,
    );
    scene.add(shadowArrow);
  }
}

// Raycaster로 클릭 위치 찾기
const raycaster = new THREE.Raycaster();
const clickMouse = new THREE.Vector2();

function handleDebugClick(event: MouseEvent): void {
  console.log("Debug click at:", event.clientX, event.clientY);

  clickMouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  clickMouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(clickMouse, camera);

  // 지구 표면과의 교차점 계산 (구와의 교차)
  const earthCenter = new THREE.Vector3(0, 0, 0);

  const rayOrigin = raycaster.ray.origin;
  const rayDir = raycaster.ray.direction;

  const oc = rayOrigin.clone().sub(earthCenter);
  const a = rayDir.dot(rayDir);
  const b = 2.0 * oc.dot(rayDir);
  const c = oc.dot(oc) - EARTH_RADIUS * EARTH_RADIUS;
  const discriminant = b * b - 4 * a * c;

  console.log("Discriminant:", discriminant);

  if (discriminant >= 0) {
    const t = (-b - Math.sqrt(discriminant)) / (2.0 * a);
    if (t > 0) {
      const hitPoint = rayOrigin.clone().add(rayDir.clone().multiplyScalar(t));
      cachedElevation = null; // 새 위치 클릭 시 고도 캐시 무효화
      calculatePointInfo(hitPoint);
      renderState.needsRender = true;
    }
  }
}

// 더블클릭으로 디버그 활성화
renderer.domElement.addEventListener("dblclick", handleDebugClick);

// ESC로 디버그 패널 닫기
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    debugGui.close();
    lastDebugWorldPos = null;
    if (clickMarker) {
      scene.remove(clickMarker);
      clickMarker = null;
    }
    if (sunArrow) {
      scene.remove(sunArrow);
      sunArrow = null;
    }
    if (shadowArrow) {
      scene.remove(shadowArrow);
      shadowArrow = null;
    }
  }

  // U 키로 모든 UI 토글
  if (event.key === "u" || event.key === "U") {
    const allUiElements = document.querySelectorAll(".lil-gui");
    const isHidden = statusDiv.style.display === "none";

    if (isHidden) {
      // UI 보이기
      statusDiv.style.display = "block";
      allUiElements.forEach((el) => {
        (el as HTMLElement).style.display = "";
      });
    } else {
      // UI 숨기기
      statusDiv.style.display = "none";
      allUiElements.forEach((el) => {
        (el as HTMLElement).style.display = "none";
      });
    }
  }

  // P 키로 스크린샷 저장 (canvas만), Shift+P로 전체 화면 캡처 (UI 포함)
  if (event.key === "p" && !event.shiftKey) {
    takeScreenshot();
  } else if (event.key === "P" && event.shiftKey) {
    takeFullScreenshot();
  }

  // I 키로 Info 토글
  if (event.key === "i" || event.key === "I") {
    showInfoPopup();
  }

  // H 키로 Help 토글
  if (event.key === "h" || event.key === "H") {
    showHelpPopup();
  }
});

// 스크린샷 저장 함수 (canvas만 + 워터마크)
function takeScreenshot(): void {
  // 현재 프레임 렌더링
  if (effectComposer) {
    effectComposer.render();
  } else {
    renderer.render(scene, camera);
  }

  // 워터마크 추가를 위한 임시 canvas 생성
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = renderer.domElement.width;
  tempCanvas.height = renderer.domElement.height;
  const ctx = tempCanvas.getContext("2d")!;

  // WebGL canvas 복사
  ctx.drawImage(renderer.domElement, 0, 0);

  // 워터마크 텍스트
  const text = "shadearth.vw-lab.com";
  ctx.font = "12px 'Helvetica Neue', Helvetica, Arial, sans-serif";
  ctx.textBaseline = "bottom";

  const x = 10;
  const y = tempCanvas.height - 10;

  // 검은색 outline
  ctx.strokeStyle = "black";
  ctx.lineWidth = 2;
  ctx.strokeText(text, x, y);

  // 흰색 텍스트
  ctx.fillStyle = "white";
  ctx.fillText(text, x, y);

  // 다운로드
  const dataUrl = tempCanvas.toDataURL("image/png");
  const link = document.createElement("a");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  link.download = `shadearth-${timestamp}.png`;
  link.href = dataUrl;
  link.click();
}

// 전체 화면 스크린샷 (UI 포함) - WebGL canvas와 UI를 합성
async function takeFullScreenshot(): Promise<void> {
  try {
    // 1. WebGL canvas 렌더링
    if (effectComposer) {
      effectComposer.render();
    } else {
      renderer.render(scene, camera);
    }

    // 2. 합성용 canvas 생성
    const finalCanvas = document.createElement("canvas");
    finalCanvas.width = window.innerWidth;
    finalCanvas.height = window.innerHeight;
    const ctx = finalCanvas.getContext("2d")!;

    // 3. WebGL canvas를 먼저 그리기
    ctx.drawImage(
      renderer.domElement,
      0,
      0,
      finalCanvas.width,
      finalCanvas.height,
    );

    // 4. UI를 html2canvas로 캡처 (WebGL canvas 제외)
    const uiCanvas = await html2canvas(document.body, {
      useCORS: true,
      allowTaint: true,
      backgroundColor: null,
      ignoreElements: (element) => element === renderer.domElement,
    });

    // 5. UI를 위에 합성
    ctx.drawImage(uiCanvas, 0, 0);

    // 6. 다운로드
    const dataUrl = finalCanvas.toDataURL("image/png");
    const link = document.createElement("a");
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    link.download = `shadearth-full-${timestamp}.png`;
    link.href = dataUrl;
    link.click();
  } catch (error) {
    console.error("Full screenshot failed:", error);
  }
}

// T 키로 타일 로딩 디버그 정보 출력, Shift+T로 실시간 로깅 토글
window.addEventListener("keydown", (event) => {
  if (event.key === "T" && event.shiftKey) {
    tileLoadLogging = !tileLoadLogging;
    console.log(`Tile load logging: ${tileLoadLogging ? "ON" : "OFF"}`);
    return;
  }
  if (event.key === "t" || event.key === "T") {
    const cameraDistance = camera.position.length();
    const cameraAltitude = cameraDistance - EARTH_RADIUS;

    // 로드된 타일의 줌 레벨 분포
    const zoomLevelCount = new Map<number, number>();
    for (const tileData of loadedTiles.values()) {
      const count = zoomLevelCount.get(tileData.z) || 0;
      zoomLevelCount.set(tileData.z, count + 1);
    }

    // tilesRenderer 내부 상태
    console.log("=== Tile Debug Info ===");
    console.log(`Camera distance: ${(cameraDistance / 1000).toFixed(1)} km`);
    console.log(`Camera altitude: ${(cameraAltitude / 1000).toFixed(1)} km`);
    console.log(`errorTarget: ${tilesRenderer.errorTarget}`);
    console.log(`Loaded tiles: ${loadedTiles.size}`);
    console.log("Zoom level distribution:");
    const sortedZooms = Array.from(zoomLevelCount.entries()).sort(
      (a, b) => a[0] - b[0],
    );
    for (const [z, count] of sortedZooms) {
      console.log(`  z${z}: ${count} tiles`);
    }
    // tilesRenderer 내부 상태 (any 캐스트로 접근)
    const tr = tilesRenderer as unknown as Record<string, unknown>;
    if (tr.visibleTiles) {
      console.log(`  visibleTiles: ${(tr.visibleTiles as Set<unknown>).size}`);
    }
    if (tr.activeTiles) {
      console.log(`  activeTiles: ${(tr.activeTiles as Set<unknown>).size}`);
    }
    if (tr.downloadQueue) {
      const queue = tr.downloadQueue as { length?: number; size?: number };
      console.log(
        `  downloadQueue: ${queue.length ?? queue.size ?? "unknown"}`,
      );
    }
    console.log("=======================");
  }
});

// 애니메이션 루프
function animate(): void {
  requestAnimationFrame(animate);

  controls.update();
  clampCameraDistance();
  ensureCameraNearFar();
  updateSunDirection();
  updateShadowAccumulation();
  tilesRenderer.update();

  // Update atmosphere/sky
  if (skyMaterial) {
    // Update camera matrices for sky shader
    const invProj = camera.projectionMatrixInverse;
    const invView = camera.matrixWorld;
    skyMaterial.updateCamera(invProj, invView, camera.position);
    skyMaterial.updateWorldToECEF(worldToECEFMatrix);

    // Update sun direction (convert from our Y-up to ECEF)
    // transformDirection applies rotation without translation
    const sunDir = dateTimeControl.getSunDirection();
    const sunECEF = sunDir.clone().transformDirection(worldToECEFMatrix);
    skyMaterial.updateSunDirection(sunECEF);

    // Update moon direction
    const moonDir = dateTimeControl.getMoonDirection();
    const moonECEF = moonDir.clone().transformDirection(worldToECEFMatrix);
    skyMaterial.updateMoonDirection(
      moonECEF,
      dateTimeControl.getMoonAngularRadius(),
    );

    // Update aerial perspective effect
    if (aerialPerspectiveEffect) {
      aerialPerspectiveEffect.updateSunDirection(sunECEF);
      aerialPerspectiveEffect.updateWorldToECEF(worldToECEFMatrix);
    }

    // Update starfield rotation based on sidereal time
    const gmst = getGreenwichSiderealTime(dateTimeControl.getDate());
    skyMaterial.updateStarfield(
      skyMaterial.uniforms.starfieldTexture.value,
      gmst,
    );
  }

  // 디버그 패널이 열려있고 위치가 있으면 실시간 업데이트
  if (lastDebugWorldPos && !debugGui._closed) {
    calculatePointInfo(lastDebugWorldPos);
  }

  // 클릭 마커 및 화살표 크기 업데이트
  updateClickMarkerScale();
  updateArrowScale();

  // 렌더링이 필요할 때만 렌더
  if (renderState.needsRender || renderState.shadowAccumulating) {
    if (effectComposer) {
      effectComposer.render();
    } else {
      renderer.render(scene, camera);
    }
    // Place Labels 렌더링 (WebGL 렌더 후)
    placeLabelsManager.render(scene, camera);
    renderState.needsRender = false;
  }

  updateStatus();
  updateTileCount();
}

animate();

console.log("ShadEarth - Interactive 3D Globe with Terrain Shadows");
