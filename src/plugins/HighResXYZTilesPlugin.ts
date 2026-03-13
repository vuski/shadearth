/**
 * HighResXYZTilesPlugin
 *
 * XYZTilesPlugin을 상속하여 고해상도 메시 생성
 * 기본 30×15 세그먼트 대신 32/64/128/256 세그먼트 선택 가능
 *
 * 핵심: parseToMesh를 완전히 오버라이드하여 EllipsoidProjectionTilesPlugin의
 * 로직을 고해상도 segment 수로 직접 구현
 */

import { XYZTilesPlugin } from "3d-tiles-renderer/plugins";
import {
  PlaneGeometry,
  MathUtils,
  Vector3,
  Vector2,
  Sphere,
  BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  Texture,
} from "three";

// 메시 해상도 옵션
export type MeshResolution = "low" | "medium" | "high" | "ultra";

export const MESH_RESOLUTION_MAP: Record<MeshResolution, number> = {
  low: 32, // 32×32 = 1,024 꼭짓점
  medium: 64, // 64×64 = 4,096 꼭짓점
  high: 128, // 128×128 = 16,384 꼭짓점
  ultra: 256, // 256×256 = 65,536 꼭짓점
};

// tile 객체에서 Symbol 키로 저장된 좌표를 추출하는 헬퍼
function getTileCoords(tile: Record<symbol, unknown>): {
  x: number;
  y: number;
  level: number;
} {
  const symbols = Object.getOwnPropertySymbols(tile);
  let x = 0,
    y = 0,
    level = 0;

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

interface TileInfo {
  boundingVolume: {
    region: [number, number, number, number, number, number];
  };
  engineData: {
    boundingVolume: {
      getSphere: (sphere: Sphere) => void;
    };
  };
}

interface PluginTiles {
  ellipsoid: {
    getCartographicToPosition: (
      lat: number,
      lon: number,
      height: number,
      target: Vector3
    ) => Vector3;
    getCartographicToNormal: (
      lat: number,
      lon: number,
      target: Vector3
    ) => Vector3;
  };
}

interface PluginProjection {
  isMercator: boolean;
  convertNormalizedToLongitude: (normalized: number) => number;
  convertNormalizedToLatitude: (normalized: number) => number;
  convertLongitudeToNormalized: (lon: number) => number;
  convertLatitudeToNormalized: (lat: number) => number;
}

interface PluginTiling {
  getTileBounds: (
    x: number,
    y: number,
    level: number,
    normalized1: boolean,
    normalized2: boolean
  ) => [number, number, number, number];
  getTileContentUVBounds: (
    x: number,
    y: number,
    level: number
  ) => [number, number, number, number];
}

interface ImageSource {
  processBufferToTexture: (buffer: ArrayBuffer) => Promise<Texture>;
  setData: (x: number, y: number, level: number, texture: Texture) => void;
}

export class HighResXYZTilesPlugin extends XYZTilesPlugin {
  private meshResolution: MeshResolution = "medium";

  // 부모 클래스 속성 타입 선언
  declare tiles: PluginTiles;
  declare projection: PluginProjection;
  declare tiling: PluginTiling;
  declare imageSource: ImageSource;
  declare shape: string;
  declare endCaps: boolean;

  constructor(options: {
    url: string;
    levels: number;
    meshResolution?: MeshResolution;
  }) {
    super({ ...options, shape: "ellipsoid" });
    if (options.meshResolution) {
      this.meshResolution = options.meshResolution;
    }
  }

  setMeshResolution(resolution: MeshResolution): void {
    this.meshResolution = resolution;
  }

  getMeshResolution(): MeshResolution {
    return this.meshResolution;
  }

  /**
   * parseToMesh 완전 오버라이드
   * EllipsoidProjectionTilesPlugin의 로직을 고해상도로 직접 구현
   */
  async parseToMesh(
    buffer: ArrayBuffer,
    tile: TileInfo,
    _extension: string,
    _uri: string,
    abortSignal: AbortSignal
  ): Promise<Mesh | null> {
    if (abortSignal.aborted) {
      return null;
    }

    const { imageSource, projection, tiling } = this;
    const ellipsoid = this.tiles.ellipsoid;

    // Symbol 키로 저장된 타일 좌표 추출
    const { x, y, level } = getTileCoords(tile as unknown as Record<symbol, unknown>);

    // 텍스처 생성
    const texture = await imageSource.processBufferToTexture(buffer);

    if (abortSignal.aborted) {
      texture.dispose();
      // @ts-expect-error - image may have close method
      if (texture.image?.close) texture.image.close();
      return null;
    }

    imageSource.setData(x, y, level, texture);

    // 고해상도 geometry 생성
    const segments = MESH_RESOLUTION_MAP[this.meshResolution];
    const geometry = new PlaneGeometry(1, 1, segments, segments);

    // 타일 경계
    const [minU, minV, maxU, maxV] = tiling.getTileBounds(x, y, level, true, true);
    const uvRange = tiling.getTileContentUVBounds(x, y, level);

    // geometry attributes
    const positionAttr = geometry.attributes.position as BufferAttribute;
    const normalAttr = geometry.attributes.normal as BufferAttribute;
    const uvAttr = geometry.attributes.uv as BufferAttribute;
    const vertCount = positionAttr.count;

    // bounding sphere
    const sphere = new Sphere();
    tile.engineData.boundingVolume.getSphere(sphere);

    const _pos = new Vector3();
    const _norm = new Vector3();
    const _uv = new Vector2();

    for (let i = 0; i < vertCount; i++) {
      _uv.fromBufferAttribute(uvAttr, i);

      // UV → 위도/경도 변환
      const lon = projection.convertNormalizedToLongitude(
        MathUtils.mapLinear(_uv.x, 0, 1, minU, maxU)
      );
      let lat = projection.convertNormalizedToLatitude(
        MathUtils.mapLinear(_uv.y, 0, 1, minV, maxV)
      );

      // Mercator 극점 처리 (endCaps)
      if (projection.isMercator && this.endCaps) {
        if (maxV === 1 && _uv.y === 1) lat = Math.PI / 2;
        if (minV === 0 && _uv.y === 0) lat = -Math.PI / 2;
      }

      // ECEF 좌표 및 법선 계산 (sphere.center 기준으로 상대 좌표)
      ellipsoid.getCartographicToPosition(lat, lon, 0, _pos).sub(sphere.center);
      ellipsoid.getCartographicToNormal(lat, lon, _norm);

      // UV 재매핑: 원본 EllipsoidProjectionTilesPlugin과 동일
      const u = MathUtils.mapLinear(
        projection.convertLongitudeToNormalized(lon),
        minU,
        maxU,
        uvRange[0],
        uvRange[2]
      );
      const v = MathUtils.mapLinear(
        projection.convertLatitudeToNormalized(lat),
        minV,
        maxV,
        uvRange[1],
        uvRange[3]
      );

      // geometry 업데이트
      uvAttr.setXY(i, u, v);
      positionAttr.setXYZ(i, _pos.x, _pos.y, _pos.z);
      normalAttr.setXYZ(i, _norm.x, _norm.y, _norm.z);
    }

    positionAttr.needsUpdate = true;
    normalAttr.needsUpdate = true;
    uvAttr.needsUpdate = true;

    // 메시 생성 및 위치 설정
    const mesh = new Mesh(
      geometry,
      new MeshBasicMaterial({ map: texture, transparent: true })
    );
    mesh.position.copy(sphere.center);

    return mesh;
  }
}
