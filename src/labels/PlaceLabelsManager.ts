import * as THREE from "three";
import {
  CSS2DRenderer,
  CSS2DObject,
} from "three/addons/renderers/CSS2DRenderer.js";
import Pbf from "pbf";
import { VectorTile } from "@mapbox/vector-tile";
import { PMTiles } from "pmtiles";

// 로컬 PMTiles 파일 (places + physical_point 레이어)
const PMTILES_URL = "https://tiles.vw-lab.uk/labels.pmtiles";

// PMTiles 인스턴스 (싱글톤)
let pmtilesInstance: PMTiles | null = null;

function getPMTiles(): PMTiles {
  if (!pmtilesInstance) {
    pmtilesInstance = new PMTiles(PMTILES_URL);
  }
  return pmtilesInstance;
}

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
const PLACE_LABELS_MAX_ZOOM = 10;

// 브라우저 언어 가져오기
function getBrowserLang(): string {
  return navigator.language.split("-")[0]; // "ko-KR" → "ko"
}

const BROWSER_LANG = getBrowserLang();

/**
 * Protomaps에서 다국어 이름 가져오기
 * name:{lang} 필드 사용 (예: name:ko, name:en, name:ja)
 */
function getLocalizedName(props: Record<string, unknown>): string | undefined {
  // 1. 사용자 언어로 된 이름 우선
  const langKey = `name:${BROWSER_LANG}`;
  if (props[langKey]) return props[langKey] as string;

  // 2. 영어 fallback
  if (props["name:en"]) return props["name:en"] as string;

  // 3. 기본 이름 (현지어)
  return props["name"] as string | undefined;
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
 * Protomaps pmap:kind 값에 따른 표시 여부
 * places 레이어: country, region, locality
 * physical_point 레이어: sea, ocean, lake, peak 등
 */
function getVisibleKinds(zoom: number): Set<string> {
  if (zoom < 2) return new Set();
  if (zoom < 3) return new Set(["country"]);
  if (zoom < 4) return new Set(["country"]);
  if (zoom < 5) return new Set(["country", "region"]);
  if (zoom < 6) return new Set(["country", "region"]);
  if (zoom < 7)
    return new Set(["country", "region", "locality", "sea", "ocean", "lake"]);
  return new Set(["country", "region", "locality", "sea", "ocean", "lake"]);
}

/**
 * pmap:kind → CSS 클래스 매핑
 */
function kindToClass(kind: string, isCapital: boolean): string {
  if (kind === "country") return "country";
  if (kind === "region") return "state";
  if (kind === "locality") {
    return isCapital ? "capital" : "city";
  }
  if (kind === "sea" || kind === "ocean" || kind === "lake") return "water";
  return "city";
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
function mvtToLat(
  tileY: number,
  geomY: number,
  extent: number,
  z: number,
): number {
  const numTiles = Math.pow(2, z);
  const tileSize = EARTH_CIRCUMFERENCE / numTiles; // 타일당 미터

  // 타일 상단(북쪽)의 Web Mercator Y 좌표 (미터, 원점은 적도)
  const tileTopMeters = EARTH_CIRCUMFERENCE / 2 - tileY * tileSize;
  // 타일 내 위치 (미터) - Y는 위에서 아래로 증가
  const offsetMeters = (geomY / extent) * tileSize;
  // 최종 Web Mercator Y 좌표
  const mercatorY = tileTopMeters - offsetMeters;

  // Web Mercator Y → WGS84 위도
  return (
    (180 / Math.PI) *
    (2 *
      Math.atan(Math.exp(mercatorY / (EARTH_CIRCUMFERENCE / (2 * Math.PI)))) -
      Math.PI / 2)
  );
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
 * PMTiles에서 지명을 읽어 3D 지구본 위에 표시
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
      .place-label.city { font-size: 11px; font-weight: 500; }
      .place-label.water { font-size: 10px; font-weight: 400; color: #8ecae6; font-style: italic; }
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
    _cameraZoom: number,
    visibleTileCoords: Array<{ z: number; x: number; y: number }>,
  ): void {
    // 로드된 타일 중 최대 줌 레벨 찾기 (최대 8로 제한)
    let maxZ = 0;
    for (const coord of visibleTileCoords) {
      if (coord.z > maxZ) maxZ = coord.z;
    }
    const placeZoom = Math.min(maxZ, PLACE_LABELS_MAX_ZOOM);

    // 최대 줌 타일만 사용
    const placeTiles = new Set<string>();
    for (const coord of visibleTileCoords) {
      if (coord.z === maxZ) {
        // 최대 줌 타일을 placeZoom으로 변환
        if (maxZ === placeZoom) {
          placeTiles.add(`${placeZoom}/${coord.x}/${coord.y}`);
        } else if (maxZ > placeZoom) {
          const scale = Math.pow(2, maxZ - placeZoom);
          const px = Math.floor(coord.x / scale);
          const py = Math.floor(coord.y / scale);
          placeTiles.add(`${placeZoom}/${px}/${py}`);
        }
      }
    }

    // 새로운 타일만 로드
    for (const tileKey of placeTiles) {
      if (!this.loadedTiles.has(tileKey)) {
        const [z, x, y] = tileKey.split("/").map(Number);
        this.loadTilePlaces(z, x, y);
      }
    }

    // 오래된 타일 정리: 현재 placeZoom과 다른 줌 또는 뷰포트 밖
    const tilesToRemove: string[] = [];
    for (const tileKey of this.loadedTiles) {
      const [z] = tileKey.split("/").map(Number);
      // 다른 줌 레벨이거나 현재 뷰포트에 없는 타일 제거
      if (z !== placeZoom || !placeTiles.has(tileKey)) {
        tilesToRemove.push(tileKey);
      }
    }
    for (const tileKey of tilesToRemove) {
      const [z, x, y] = tileKey.split("/").map(Number);
      this.removeTileLabels(z, x, y, true); // 모든 라벨 제거
    }
  }

  /**
   * 타일의 place labels 로드 (PMTiles에서)
   */
  private async loadTilePlaces(z: number, x: number, y: number): Promise<void> {
    const tileKey = `${z}/${x}/${y}`;
    if (this.loadedTiles.has(tileKey)) return;
    this.loadedTiles.add(tileKey);

    try {
      const pmtiles = getPMTiles();
      const tileData = await pmtiles.getZxy(z, x, y);

      if (!tileData || !tileData.data) return;

      // gzip 압축 해제 (필요한 경우)
      let data = new Uint8Array(tileData.data);
      if (data[0] === 0x1f && data[1] === 0x8b) {
        // gzip 헤더 감지
        const ds = new DecompressionStream("gzip");
        const blob = new Blob([data]);
        const decompressed = await new Response(
          blob.stream().pipeThrough(ds),
        ).arrayBuffer();
        data = new Uint8Array(decompressed);
      }

      const tile = new VectorTile(new Pbf(data));

      const visibleKinds = getVisibleKinds(z);
      const minPop = getMinPopulation(z);

      // places 레이어 파싱 (국가, 지역, 도시)
      const placesLayer = tile.layers["places"];
      if (placesLayer) {
        for (let i = 0; i < placesLayer.length; i++) {
          const feature = placesLayer.feature(i);
          const props = feature.properties as Record<string, unknown>;

          // pmap:kind 필드 사용
          const kind = (props["pmap:kind"] || props["kind"]) as string;
          if (!kind || !visibleKinds.has(kind)) continue;

          // 다국어 이름 가져오기
          const name = getLocalizedName(props);
          if (!name) continue;

          const population = (props["population"] as number) || 0;
          const populationRank = (props["pmap:population_rank"] as number) || 0;
          const isCapital = props["capital"] === "yes";

          // 인구 기반 필터링 (수도와 국가/지역은 항상 표시)
          if (kind === "locality" && !isCapital) {
            if (population < minPop && populationRank < 10) continue;
          }

          // MVT 좌표 → lon/lat
          const geom = feature.loadGeometry()[0][0];
          const extent = feature.extent || 4096;
          const lon = tile2lon(x + geom.x / extent, z);
          const lat = mvtToLat(y, geom.y, extent, z);

          // 국가/지역은 이름 기반으로 중복 제거
          const globalKey =
            kind === "locality"
              ? `${lon.toFixed(2)}:${lat.toFixed(2)}`
              : `${kind}:${name}`;

          const existing = this.globalPlaces.get(globalKey);
          if (existing) {
            if (existing.population >= population) continue;
            this.removeGlobalLabel(globalKey);
          }
          this.globalPlaces.set(globalKey, { name, population });

          const labelKey = `${tileKey}:${globalKey}`;
          if (this.labels.has(labelKey)) continue;

          this.createLabel({
            name,
            kind: kindToClass(kind, isCapital),
            population,
            lon,
            lat,
            tileKey,
            labelKey,
            persistent: kind === "country" || kind === "region",
          });
        }
      }

      // physical_point 레이어 파싱 (바다, 호수 등)
      const physicalLayer = tile.layers["physical_point"];
      if (physicalLayer) {
        for (let i = 0; i < physicalLayer.length; i++) {
          const feature = physicalLayer.feature(i);
          const props = feature.properties as Record<string, unknown>;

          const kind = (props["pmap:kind"] || props["kind"]) as string;
          if (!kind || !visibleKinds.has(kind)) continue;

          const name = getLocalizedName(props);
          if (!name) continue;

          // MVT 좌표 → lon/lat
          const geom = feature.loadGeometry()[0][0];
          const extent = feature.extent || 4096;
          const lon = tile2lon(x + geom.x / extent, z);
          const lat = mvtToLat(y, geom.y, extent, z);

          // 바다/호수는 이름 기반 중복 제거
          const globalKey = `${kind}:${name}`;
          if (this.globalPlaces.has(globalKey)) continue;
          this.globalPlaces.set(globalKey, { name, population: 0 });

          const labelKey = `${tileKey}:${globalKey}`;
          if (this.labels.has(labelKey)) continue;

          this.createLabel({
            name,
            kind: kindToClass(kind, false),
            population: 0,
            lon,
            lat,
            tileKey,
            labelKey,
            persistent: kind === "sea" || kind === "ocean",
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
    persistent: boolean;
  }): void {
    const { name, kind, population, lon, lat, tileKey, labelKey, persistent } =
      params;

    const div = document.createElement("div");
    div.className = `place-label ${kind}`;
    div.textContent = name;

    const label = new CSS2DObject(div);
    const position = lonLatToWorld(lon, lat);
    label.position.copy(position);

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
   * 현재 줌보다 높은 줌 레벨의 타일들을 즉시 정리
   */
  updateZoom(zoom: number): void {
    this.currentZoom = zoom;

    // 현재 줌 기준 타일 레벨 계산
    const targetPlaceZoom = Math.min(Math.floor(zoom) + 2, PLACE_LABELS_MAX_ZOOM);

    // 라벨들의 실제 tileKey 기준으로 정리 (loadedTiles가 아닌 labels에서 직접)
    const tilesToRemove = new Set<string>();
    for (const [, data] of this.labels) {
      const [z] = data.tileKey.split("/").map(Number);
      if (z > targetPlaceZoom) {
        tilesToRemove.add(data.tileKey);
      }
    }

    for (const tileKey of tilesToRemove) {
      const [z, x, y] = tileKey.split("/").map(Number);
      this.removeTileLabels(z, x, y, true);
    }
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
    // 타일 줌에 맞춰 가시성 결정 (currentZoom 대신 8 이상으로 설정)
    const effectiveZoom = Math.max(this.currentZoom, 8);
    const visibleKinds = getVisibleKinds(effectiveZoom);

    // kind → CSS class 매핑 (역변환)
    const kindClassMap: Record<string, string[]> = {
      country: ["country"],
      region: ["state"],
      locality: ["capital", "city"],
      sea: ["water"],
      ocean: ["water"],
      lake: ["water"],
    };

    // 각 레이블의 가시성 체크
    for (const data of this.labels.values()) {
      const elem = data.object.element;

      // CSS 클래스에서 원래 kind 찾기
      let isVisible = false;
      for (const [kind, classes] of Object.entries(kindClassMap)) {
        if (classes.includes(data.kind) && visibleKinds.has(kind)) {
          isVisible = true;
          break;
        }
      }

      if (!isVisible) {
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
