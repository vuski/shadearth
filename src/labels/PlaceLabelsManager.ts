import * as THREE from "three";
import {
  CSS2DRenderer,
  CSS2DObject,
} from "three/addons/renderers/CSS2DRenderer.js";
import Pbf from "pbf";
import { VectorTile } from "@mapbox/vector-tile";

// OSM Shortbread 벡터 타일 서버
const OSM_VECTOR_TILE_URL =
  "https://vector.openstreetmap.org/shortbread_v1/{z}/{x}/{y}.mvt";

export interface PlaceLabel {
  name: string;
  kind: string;
  population: number;
  lon: number;
  lat: number;
}

interface LabelData {
  object: CSS2DObject;
  tileKey: string;
  kind: string;
  population: number;
  worldPosition: THREE.Vector3; // 가시성 체크용
  persistent: boolean; // 타일 언로드 시에도 유지 (국가/주)
}

// Place labels 전용 줌 레벨 (위성 타일과 독립)
const PLACE_LABELS_MAX_ZOOM = 8;

// Shortbread는 name, name_de, name_en만 제공
// name: 로컬 언어 (한국=한글, 중국=중문, 러시아=키릴 등)
// name_en: 영어
// 브라우저 언어의 로컬 이름이 있으면 사용, 없으면 영어
function getBrowserLang(): string {
  return navigator.language.split("-")[0]; // "ko-KR" → "ko"
}

const BROWSER_LANG = getBrowserLang();

// 문자열이 해당 언어인지 확인 (간단한 유니코드 범위 체크)
function isKorean(str: string): boolean {
  return /[\uAC00-\uD7AF]/.test(str); // 한글 음절
}

function isCJK(str: string): boolean {
  return /[\u4E00-\u9FFF\u3400-\u4DBF]/.test(str); // 한중일 한자
}

function isCyrillic(str: string): boolean {
  return /[\u0400-\u04FF]/.test(str); // 키릴 문자
}

function isArabic(str: string): boolean {
  return /[\u0600-\u06FF]/.test(str); // 아랍 문자
}

// 브라우저 언어에 맞는 이름인지 확인
function matchesBrowserLang(name: string): boolean {
  if (BROWSER_LANG === "ko") return isKorean(name);
  if (BROWSER_LANG === "zh") return isCJK(name);
  if (BROWSER_LANG === "ja") return isCJK(name) || /[\u3040-\u30FF]/.test(name);
  if (BROWSER_LANG === "ru") return isCyrillic(name);
  if (BROWSER_LANG === "ar") return isArabic(name);
  // 라틴 언어들은 name_en 사용
  return false;
}

/**
 * 줌 레벨별 최소 인구 요건
 * 낮은 줌에서는 큰 도시만, 높은 줌에서는 작은 마을도 표시
 */
function getMinPopulation(zoom: number): number {
  if (zoom <= 4) return 1000000; // 100만+
  if (zoom <= 5) return 500000; // 50만+
  if (zoom <= 6) return 100000; // 10만+
  if (zoom <= 7) return 50000; // 5만+
  if (zoom <= 8) return 10000; // 1만+
  return 0; // 전부
}

/**
 * 줌 레벨에 따라 표시할 place kind 목록 반환
 * boundary_labels: country, state
 * place_labels: capital, state_capital, city, town, village, hamlet, suburb
 */
function getVisibleKinds(zoom: number): Set<string> {
  if (zoom < 2) return new Set();
  if (zoom < 3) return new Set(["country"]);
  if (zoom < 4) return new Set(["country", "capital"]);
  if (zoom < 5) return new Set(["country", "capital", "state"]);
  if (zoom < 6)
    return new Set(["country", "capital", "state", "state_capital"]);
  if (zoom < 7)
    return new Set([
      "country",
      "capital",
      "state",
      "state_capital",
      "city",
      "water", // 호수, 저수지
    ]);
  if (zoom < 10)
    return new Set([
      "country",
      "capital",
      "state",
      "state_capital",
      "city",
      "town",
      "water",
      "river",
    ]);
  return new Set([
    "country",
    "capital",
    "state",
    "state_capital",
    "city",
    "town",
    "village",
    "hamlet",
    "suburb",
    "water",
    "river",
  ]);
}

/**
 * 타일 좌표 → 경도 변환
 */
function tile2lon(x: number, z: number): number {
  return (x / Math.pow(2, z)) * 360 - 180;
}

// Web Mercator 상수
const EARTH_CIRCUMFERENCE = 40075016.686; // 미터

/**
 * MVT 타일 내 좌표 → WGS84 위도 변환
 * geomY=0이 타일 상단(북쪽), geomY=extent가 타일 하단(남쪽)
 */
function mvtToLat(tileY: number, geomY: number, extent: number, z: number): number {
  const numTiles = Math.pow(2, z);
  const tileSize = EARTH_CIRCUMFERENCE / numTiles; // 타일당 미터

  // 타일 상단(북쪽)의 Web Mercator Y 좌표 (미터, 원점은 적도)
  const tileTopMeters = EARTH_CIRCUMFERENCE / 2 - tileY * tileSize;
  // 타일 내 위치 (미터) - Y는 위에서 아래로 증가
  const offsetMeters = (geomY / extent) * tileSize;
  // 최종 Web Mercator Y 좌표
  const mercatorY = tileTopMeters - offsetMeters;

  // Web Mercator Y → WGS84 위도
  return (180 / Math.PI) * (2 * Math.atan(Math.exp(mercatorY / (EARTH_CIRCUMFERENCE / (2 * Math.PI)))) - Math.PI / 2);
}

// WGS84 ellipsoid 상수 (tilesRenderer와 동일하게)
const WGS84_A = 6378137; // 적도 반경 (m)
const WGS84_B = 6356752.314245; // 극 반경 (m)
const WGS84_E2 = 1 - (WGS84_B * WGS84_B) / (WGS84_A * WGS84_A); // 이심률 제곱

/**
 * 경위도 → ECEF 좌표 변환 (Z-up, WGS84 ellipsoid)
 * tilesRenderer와 동일한 WGS84 ellipsoid 사용
 */
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

/**
 * Place Labels Manager
 * OSM Shortbread 벡터 타일에서 지명을 읽어 3D 지구본 위에 표시
 * 위성 타일과 독립적인 줌 레벨로 관리하여 레이블 수 제어
 */
export class PlaceLabelsManager {
  private css2dRenderer: CSS2DRenderer;
  private labelsGroup: THREE.Group;
  private labels: Map<string, LabelData> = new Map();
  private loadedTiles: Set<string> = new Set();
  private enabled: boolean = true;
  private currentZoom: number = 0;
  // 전역 중복 제거용 (좌표 기반)
  private globalPlaces: Map<string, { name: string; population: number }> =
    new Map();
  // 가시성 체크용
  private frustum = new THREE.Frustum();
  private projScreenMatrix = new THREE.Matrix4();

  constructor(container: HTMLElement) {
    // CSS2DRenderer 초기화
    this.css2dRenderer = new CSS2DRenderer();
    this.css2dRenderer.setSize(window.innerWidth, window.innerHeight);
    this.css2dRenderer.domElement.style.position = "absolute";
    this.css2dRenderer.domElement.style.top = "0";
    this.css2dRenderer.domElement.style.pointerEvents = "none";
    container.appendChild(this.css2dRenderer.domElement);

    // 레이블을 담을 그룹 (ECEF Z-up → Three.js Y-up 변환)
    this.labelsGroup = new THREE.Group();
    this.labelsGroup.rotation.x = -Math.PI / 2;
    this.labelsGroup.updateMatrixWorld(true);

    // 스타일 추가
    this.addStyles();
  }

  /**
   * CSS 스타일 추가
   */
  private addStyles(): void {
    const style = document.createElement("style");
    style.textContent = `
      .place-label {
        color: white;
        text-shadow: 1px 1px 2px black, -1px -1px 2px black, 1px -1px 2px black, -1px 1px 2px black;
        font-family: "Inter", "Roboto Condensed", "Arial Narrow", sans-serif;
        white-space: nowrap;
        pointer-events: none;
        user-select: none;
        font-stretch: condensed;
      }
      .place-label.country { font-size: 16px; font-weight: 600; color: #fff; letter-spacing: 1px; }
      .place-label.state { font-size: 13px; font-weight: 500; color: #eee; letter-spacing: 0.5px; }
      .place-label.capital { font-size: 13px; font-weight: 600; }
      .place-label.state_capital { font-size: 12px; font-weight: 600; }
      .place-label.city { font-size: 11px; font-weight: 500; }
      .place-label.town { font-size: 10px; }
      .place-label.village { font-size: 9px; }
      .place-label.hamlet { font-size: 8px; }
      .place-label.suburb { font-size: 8px; color: #ddd; }
      .place-label.water { font-size: 10px; font-weight: 400; color: #8ecae6; font-style: italic; }
      .place-label.river { font-size: 9px; font-weight: 400; color: #8ecae6; font-style: italic; }
    `;
    document.head.appendChild(style);
  }

  /**
   * 씬에 레이블 그룹 추가
   */
  getLabelsGroup(): THREE.Group {
    return this.labelsGroup;
  }

  /**
   * 윈도우 리사이즈 핸들러
   */
  setSize(width: number, height: number): void {
    this.css2dRenderer.setSize(width, height);
  }

  /**
   * 카메라 줌에 따라 place labels용 타일 로드
   * 위성 타일과 독립적으로 더 낮은 줌 레벨 사용
   */
  updateVisibleTiles(
    cameraZoom: number,
    visibleTileCoords: Array<{ z: number; x: number; y: number }>,
  ): void {
    // Place labels 전용 줌 레벨 계산 (최대 8)
    const placeZoom = Math.min(
      Math.floor(cameraZoom),
      PLACE_LABELS_MAX_ZOOM,
    );

    // 현재 뷰포트의 타일들을 place 줌 레벨로 변환
    const placeTiles = new Set<string>();
    for (const coord of visibleTileCoords) {
      // 높은 줌 레벨 타일 → 낮은 줌 레벨 타일로 변환
      const scale = Math.pow(2, coord.z - placeZoom);
      const px = Math.floor(coord.x / scale);
      const py = Math.floor(coord.y / scale);
      placeTiles.add(`${placeZoom}/${px}/${py}`);
    }

    // 새로운 타일만 로드
    for (const tileKey of placeTiles) {
      if (!this.loadedTiles.has(tileKey)) {
        const [z, x, y] = tileKey.split("/").map(Number);
        this.loadTilePlaces(z, x, y);
      }
    }

    // 오래된 타일 정리 (뷰포트 밖) - persistent 레이블은 유지
    for (const tileKey of this.loadedTiles) {
      if (!placeTiles.has(tileKey)) {
        const [z, x, y] = tileKey.split("/").map(Number);
        this.removeTileLabels(z, x, y, false); // persistent는 유지
      }
    }
  }

  /**
   * 타일의 place labels 로드 (내부 사용)
   */
  private async loadTilePlaces(z: number, x: number, y: number): Promise<void> {
    const tileKey = `${z}/${x}/${y}`;
    if (this.loadedTiles.has(tileKey)) return;
    this.loadedTiles.add(tileKey);

    try {
      const url = OSM_VECTOR_TILE_URL.replace("{z}", String(z))
        .replace("{x}", String(x))
        .replace("{y}", String(y));

      const response = await fetch(url);
      if (!response.ok) return;

      const data = await response.arrayBuffer();
      const tile = new VectorTile(new Pbf(data));

      const visibleKinds = getVisibleKinds(z);
      const minPop = getMinPopulation(z);

      // boundary_labels 레이어 파싱 (국가, 주/도 이름)
      // admin_level: 2 = country, 4 = state/province
      const boundaryLayer = tile.layers["boundary_labels"];
      if (boundaryLayer) {
        for (let i = 0; i < boundaryLayer.length; i++) {
          const feature = boundaryLayer.feature(i);
          const props = feature.properties;
          const adminLevel = props.admin_level as number;

          // admin_level → kind 변환
          let kind: string;
          if (adminLevel === 2) {
            kind = "country";
          } else if (adminLevel === 4) {
            kind = "state";
          } else {
            continue; // 다른 레벨은 무시
          }

          if (!visibleKinds.has(kind)) continue;

          // 브라우저 언어에 맞는 로컬 이름이 있으면 사용, 없으면 영어
          const localName = props.name as string;
          const englishName = props.name_en as string;
          let name: string | undefined;
          if (localName && matchesBrowserLang(localName)) {
            name = localName;
          } else {
            name = englishName || localName;
          }
          if (!name) continue;

          // MVT 좌표 → lon/lat
          const geom = feature.loadGeometry()[0][0];
          const extent = feature.extent || 4096;
          const lon = tile2lon(x + geom.x / extent, z);
          const lat = mvtToLat(y, geom.y, extent, z);

          // 국가/주는 이름 기반으로 중복 제거 (같은 국가가 여러 타일에 있음)
          const globalKey = `${kind}:${name}`;
          if (this.globalPlaces.has(globalKey)) continue;
          this.globalPlaces.set(globalKey, { name, population: 0 });

          const labelKey = `${tileKey}:${globalKey}`;
          if (this.labels.has(labelKey)) continue;

          this.createLabel({
            name,
            kind,
            population: 0,
            lon,
            lat,
            tileKey,
            labelKey,
            globalKey,
          });
        }
      }

      // place_labels 레이어 파싱 (도시, 마을 등)
      const placeLayer = tile.layers["place_labels"];
      if (placeLayer) {
        for (let i = 0; i < placeLayer.length; i++) {
          const feature = placeLayer.feature(i);
          const props = feature.properties;
          const kind = props.kind as string;

          // 줌 레벨에 따른 필터링
          if (!visibleKinds.has(kind)) continue;

          // 브라우저 언어에 맞는 로컬 이름이 있으면 사용, 없으면 영어
          const localName = props.name as string;
          const englishName = props.name_en as string;
          let name: string | undefined;
          if (localName && matchesBrowserLang(localName)) {
            name = localName;
          } else {
            name = englishName || localName;
          }
          if (!name) continue;

          const population = (props.population as number) || 0;

          // 인구 기반 필터링 (capital/state_capital은 항상 표시)
          if (kind !== "capital" && kind !== "state_capital") {
            if (population < minPop) continue;
          }

          // MVT 좌표 → lon/lat
          const geom = feature.loadGeometry()[0][0];
          const extent = feature.extent || 4096;
          const lon = tile2lon(x + geom.x / extent, z);
          const lat = mvtToLat(y, geom.y, extent, z);

          // 전역 중복 제거 (좌표 기반, 소수점 2자리)
          const globalKey = `${lon.toFixed(2)}:${lat.toFixed(2)}`;
          const existing = this.globalPlaces.get(globalKey);
          if (existing) {
            // 더 큰 인구의 도시가 있으면 스킵
            if (existing.population >= population) continue;
            // 기존 레이블 제거하고 새로 생성
            this.removeGlobalLabel(globalKey);
          }
          this.globalPlaces.set(globalKey, { name, population });

          const labelKey = `${tileKey}:${globalKey}`;
          if (this.labels.has(labelKey)) continue;

          this.createLabel({
            name,
            kind,
            population,
            lon,
            lat,
            tileKey,
            labelKey,
            globalKey,
          });
        }
      }

      // water_polygons_labels 레이어 파싱 (바다, 호수 등)
      const waterLayer = tile.layers["water_polygons_labels"];
      if (waterLayer) {
        for (let i = 0; i < waterLayer.length; i++) {
          const feature = waterLayer.feature(i);
          const props = feature.properties;
          const kind = props.kind as string;

          // 줌 레벨에 따른 필터링
          if (!visibleKinds.has(kind)) continue;

          // 브라우저 언어에 맞는 로컬 이름이 있으면 사용, 없으면 영어
          const localName = props.name as string;
          const englishName = props.name_en as string;
          let name: string | undefined;
          if (localName && matchesBrowserLang(localName)) {
            name = localName;
          } else {
            name = englishName || localName;
          }
          if (!name) continue;

          // MVT 좌표 → lon/lat
          const geom = feature.loadGeometry()[0][0];
          const extent = feature.extent || 4096;
          const lon = tile2lon(x + geom.x / extent, z);
          const lat = mvtToLat(y, geom.y, extent, z);

          // 바다 이름은 이름 기반 중복 제거 (국가와 동일하게)
          const globalKey = `${kind}:${name}`;
          if (this.globalPlaces.has(globalKey)) continue;
          this.globalPlaces.set(globalKey, { name, population: 0 });

          const labelKey = `${tileKey}:${globalKey}`;
          if (this.labels.has(labelKey)) continue;

          this.createLabel({
            name,
            kind,
            population: 0,
            lon,
            lat,
            tileKey,
            labelKey,
            globalKey,
          });
        }
      }
    } catch (error) {
      console.warn(`Failed to load place labels for tile ${tileKey}:`, error);
    }
  }

  /**
   * 전역 키로 레이블 제거
   */
  private removeGlobalLabel(globalKey: string): void {
    for (const [labelKey, data] of this.labels) {
      if (labelKey.endsWith(globalKey)) {
        this.labelsGroup.remove(data.object);
        data.object.element.remove();
        this.labels.delete(labelKey);
        break;
      }
    }
  }

  /**
   * 레이블 생성
   */
  private createLabel(params: {
    name: string;
    kind: string;
    population: number;
    lon: number;
    lat: number;
    tileKey: string;
    labelKey: string;
    globalKey: string;
  }): void {
    const { name, kind, population, lon, lat, tileKey, labelKey } = params;

    const div = document.createElement("div");
    div.className = `place-label ${kind}`;
    div.textContent = name;

    const label = new CSS2DObject(div);
    const position = lonLatToWorld(lon, lat);
    label.position.copy(position);

    // 국가/주는 persistent (줌 변경 시에도 유지)
    const persistent = kind === "country" || kind === "state";

    this.labelsGroup.add(label);
    this.labels.set(labelKey, {
      object: label,
      tileKey,
      kind,
      population,
      worldPosition: position,
      persistent,
    });

    // 비활성화 상태면 숨김
    if (!this.enabled) {
      label.visible = false;
      div.style.visibility = "hidden";
    }
  }

  /**
   * 타일 언로드 시 레이블 제거 (내부 사용)
   * @param removePersistent true면 persistent 레이블도 제거
   */
  private removeTileLabels(
    z: number,
    x: number,
    y: number,
    removePersistent: boolean = true,
  ): void {
    const tileKey = `${z}/${x}/${y}`;
    this.loadedTiles.delete(tileKey);

    const toRemove: string[] = [];
    for (const [labelKey, data] of this.labels) {
      if (data.tileKey === tileKey) {
        // persistent 레이블은 유지
        if (data.persistent && !removePersistent) continue;

        this.labelsGroup.remove(data.object);
        data.object.element.remove();
        toRemove.push(labelKey);
        // globalPlaces에서도 제거
        const parts = labelKey.split(":");
        const globalKey = parts.slice(-2).join(":");
        this.globalPlaces.delete(globalKey);
      }
    }
    for (const key of toRemove) {
      this.labels.delete(key);
    }
  }

  /**
   * 줌 레벨 변경 시 레이블 가시성 업데이트
   */
  updateZoom(zoom: number): void {
    this.currentZoom = zoom;
    // 실제 가시성 업데이트는 render()에서 처리
  }

  /**
   * 활성화/비활성화
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    // 비활성화 시 전체 숨김
    if (!enabled) {
      for (const data of this.labels.values()) {
        data.object.visible = false;
        data.object.element.style.visibility = "hidden";
      }
    }
    // 활성화 시 가시성은 render()에서 처리
  }

  /**
   * 렌더링 (가시성 체크 포함)
   */
  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (!this.enabled) return;

    // labelsGroup의 matrixWorld 업데이트
    this.labelsGroup.updateMatrixWorld(true);

    // Frustum 업데이트
    this.projScreenMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);

    const cameraPos = camera.position;
    const visibleKinds = getVisibleKinds(this.currentZoom);

    // 각 레이블의 가시성 체크
    for (const data of this.labels.values()) {
      const elem = data.object.element;

      if (!visibleKinds.has(data.kind)) {
        data.object.visible = false;
        elem.style.visibility = "hidden";
        continue;
      }

      // CSS2DObject의 실제 월드 좌표 가져오기
      const worldPos = new THREE.Vector3();
      data.object.getWorldPosition(worldPos);

      // 1. 반구 가시성: 카메라에서 레이블까지 벡터와 표면 법선 비교
      const toLabel = worldPos.clone().sub(cameraPos).normalize();
      const surfaceNormal = worldPos.clone().normalize();
      const dotProduct = toLabel.dot(surfaceNormal);

      // dotProduct > 0이면 레이블이 카메라 반대편 (지구 뒤)
      if (dotProduct > 0.1) {
        data.object.visible = false;
        elem.style.visibility = "hidden";
        continue;
      }

      // 2. Frustum 체크: 화면 영역 내인지
      if (!this.frustum.containsPoint(worldPos)) {
        data.object.visible = false;
        elem.style.visibility = "hidden";
        continue;
      }

      data.object.visible = true;
      elem.style.visibility = "visible";
    }

    this.css2dRenderer.render(scene, camera);
  }

  /**
   * 리소스 정리
   */
  dispose(): void {
    for (const data of this.labels.values()) {
      this.labelsGroup.remove(data.object);
      data.object.element.remove();
    }
    this.labels.clear();
    this.loadedTiles.clear();
    this.css2dRenderer.domElement.remove();
  }
}
