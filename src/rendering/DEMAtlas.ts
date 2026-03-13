import * as THREE from "three";

/**
 * 타일 정보 인터페이스
 */
export interface TileInfo {
  z: number;
  x: number;
  y: number;
  texture: THREE.Texture;
  // 타일의 위경도 범위
  bounds: {
    west: number;
    east: number;
    north: number;
    south: number;
  };
}

/**
 * Atlas 내 타일 위치 정보
 */
interface AtlasTileEntry {
  tile: TileInfo;
  // Atlas 내 픽셀 위치
  atlasX: number;
  atlasY: number;
  // Atlas 내 UV 범위 (0~1)
  uvRect: { x: number; y: number; w: number; h: number };
}

/**
 * DEM Atlas
 * 여러 타일의 DEM 데이터를 하나의 대형 텍스처로 합성
 */
export class DEMAtlas {
  private atlasSize: number;
  private tileSize: number;
  private atlas: THREE.DataTexture | null = null;
  private entries: Map<string, AtlasTileEntry> = new Map();

  // Atlas 레이아웃 (타일 그리드)
  private gridWidth: number = 0;
  private gridHeight: number = 0;

  constructor(atlasSize: number = 4096, tileSize: number = 512) {
    this.atlasSize = atlasSize;
    this.tileSize = tileSize;
  }

  /**
   * 타일 키 생성
   */
  private getTileKey(z: number, x: number, y: number): string {
    return `${z}/${x}/${y}`;
  }

  /**
   * 위경도 → 타일 좌표 변환
   */
  static lonLatToTile(lon: number, lat: number, zoom: number): { x: number; y: number } {
    const n = Math.pow(2, zoom);
    const x = Math.floor(((lon + 180) / 360) * n);
    const latRad = (lat * Math.PI) / 180;
    const y = Math.floor(
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
    );
    return { x, y };
  }

  /**
   * 타일 좌표 → 위경도 범위 변환
   */
  static tileToBounds(
    z: number,
    x: number,
    y: number
  ): { west: number; east: number; north: number; south: number } {
    const n = Math.pow(2, z);

    const west = (x / n) * 360 - 180;
    const east = ((x + 1) / n) * 360 - 180;

    const northRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
    const southRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n)));

    const north = (northRad * 180) / Math.PI;
    const south = (southRad * 180) / Math.PI;

    return { west, east, north, south };
  }

  /**
   * 여러 타일로부터 Atlas 빌드
   */
  async buildAtlas(tiles: TileInfo[]): Promise<void> {
    if (tiles.length === 0) return;

    // 그리드 크기 계산
    const maxTilesPerRow = Math.floor(this.atlasSize / this.tileSize);
    this.gridWidth = Math.min(tiles.length, maxTilesPerRow);
    this.gridHeight = Math.ceil(tiles.length / maxTilesPerRow);

    const actualWidth = this.gridWidth * this.tileSize;
    const actualHeight = this.gridHeight * this.tileSize;

    // Float32 데이터 배열 생성 (고도 값 저장)
    const data = new Float32Array(actualWidth * actualHeight * 4);

    // 캔버스를 사용하여 텍스처 데이터 추출
    const canvas = document.createElement("canvas");
    canvas.width = this.tileSize;
    canvas.height = this.tileSize;
    const ctx = canvas.getContext("2d")!;

    this.entries.clear();

    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      const gridX = i % this.gridWidth;
      const gridY = Math.floor(i / this.gridWidth);

      const atlasX = gridX * this.tileSize;
      const atlasY = gridY * this.tileSize;

      // 타일 텍스처를 캔버스에 그리기
      const img = tile.texture.image as CanvasImageSource | undefined;
      if (img) {
        ctx.drawImage(img, 0, 0, this.tileSize, this.tileSize);
        const imageData = ctx.getImageData(0, 0, this.tileSize, this.tileSize);

        // Terrarium 디코딩하여 Float32 배열에 저장
        for (let py = 0; py < this.tileSize; py++) {
          for (let px = 0; px < this.tileSize; px++) {
            const srcIdx = (py * this.tileSize + px) * 4;
            const r = imageData.data[srcIdx];
            const g = imageData.data[srcIdx + 1];
            const b = imageData.data[srcIdx + 2];

            // Terrarium 디코딩: elevation = (R * 256 + G + B / 256) - 32768
            const elevation = (r * 256 + g + b / 256) - 32768;

            // Atlas 내 위치 계산
            const dstX = atlasX + px;
            const dstY = atlasY + py;
            const dstIdx = (dstY * actualWidth + dstX) * 4;

            data[dstIdx] = elevation;
            data[dstIdx + 1] = elevation;
            data[dstIdx + 2] = elevation;
            data[dstIdx + 3] = 1.0;
          }
        }
      }

      // Entry 저장
      const key = this.getTileKey(tile.z, tile.x, tile.y);
      this.entries.set(key, {
        tile,
        atlasX,
        atlasY,
        uvRect: {
          x: atlasX / actualWidth,
          y: atlasY / actualHeight,
          w: this.tileSize / actualWidth,
          h: this.tileSize / actualHeight,
        },
      });
    }

    // DataTexture 생성
    this.atlas = new THREE.DataTexture(
      data,
      actualWidth,
      actualHeight,
      THREE.RGBAFormat,
      THREE.FloatType
    );
    this.atlas.needsUpdate = true;
    this.atlas.minFilter = THREE.LinearFilter;
    this.atlas.magFilter = THREE.LinearFilter;
    this.atlas.wrapS = THREE.ClampToEdgeWrapping;
    this.atlas.wrapT = THREE.ClampToEdgeWrapping;

    console.log(`DEMAtlas built: ${tiles.length} tiles, ${actualWidth}x${actualHeight}`);
  }

  /**
   * Atlas 텍스처 반환
   */
  getAtlasTexture(): THREE.DataTexture | null {
    return this.atlas;
  }

  /**
   * 타일 UV rect 배열 반환 (셰이더용)
   */
  getTileRects(): Float32Array {
    const rects = new Float32Array(this.entries.size * 4);
    let i = 0;
    for (const entry of this.entries.values()) {
      rects[i * 4] = entry.uvRect.x;
      rects[i * 4 + 1] = entry.uvRect.y;
      rects[i * 4 + 2] = entry.uvRect.w;
      rects[i * 4 + 3] = entry.uvRect.h;
      i++;
    }
    return rects;
  }

  /**
   * 타일 수 반환
   */
  getTileCount(): number {
    return this.entries.size;
  }

  /**
   * 위경도로 Atlas UV 조회
   */
  lonLatToAtlasUV(lon: number, lat: number, zoom: number): { u: number; v: number } | null {
    const { x, y } = DEMAtlas.lonLatToTile(lon, lat, zoom);
    const key = this.getTileKey(zoom, x, y);
    const entry = this.entries.get(key);

    if (!entry) return null;

    // 타일 내 로컬 UV 계산
    const bounds = entry.tile.bounds;
    const localU = (lon - bounds.west) / (bounds.east - bounds.west);
    const localV = (bounds.north - lat) / (bounds.north - bounds.south);

    // Atlas UV로 변환
    const u = entry.uvRect.x + localU * entry.uvRect.w;
    const v = entry.uvRect.y + localV * entry.uvRect.h;

    return { u, v };
  }

  /**
   * 리소스 해제
   */
  dispose(): void {
    if (this.atlas) {
      this.atlas.dispose();
      this.atlas = null;
    }
    this.entries.clear();
  }
}
