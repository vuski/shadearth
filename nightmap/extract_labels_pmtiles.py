#!/usr/bin/env python3
"""
PMTiles 줌 범위 추출 스크립트

127GB 원본에서 z=0~10 범위만 추출하여 경량 PMTiles 생성
(레이어 필터링은 클라이언트에서 수행)

사용법:
    python extract_labels_pmtiles.py

출력:
    labels_z0-10.pmtiles
"""

import sys
import os

try:
    from pmtiles.reader import Reader, MmapSource
    from pmtiles.writer import Writer
    from pmtiles.tile import TileType, Compression
except ImportError:
    print("Installing pmtiles...")
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'pmtiles'])
    from pmtiles.reader import Reader, MmapSource
    from pmtiles.writer import Writer
    from pmtiles.tile import TileType, Compression


# 설정
INPUT_PATH = "//vwstor/docker/pmtiles/20240812.pmtiles"
OUTPUT_PATH = "//vwstor/docker/pmtiles/labels_z0-10.pmtiles"
MIN_ZOOM = 0
MAX_ZOOM = 10


def main():
    print(f"Input: {INPUT_PATH}")
    print(f"Output: {OUTPUT_PATH}")
    print(f"Zoom range: {MIN_ZOOM} - {MAX_ZOOM}")
    print()
    print("Note: All layers will be copied (layer filtering done client-side)")
    print()

    # 입력 파일 열기
    if not os.path.exists(INPUT_PATH):
        print(f"Error: Input file not found: {INPUT_PATH}")
        sys.exit(1)

    with open(INPUT_PATH, 'rb') as f_in:
        source = MmapSource(f_in)
        reader = Reader(source)

        # 메타데이터 읽기
        header = reader.header()
        metadata = reader.metadata() or {}

        print(f"Original tile type: {header.get('tile_type')}")
        print(f"Original zoom range: {header.get('min_zoom')} - {header.get('max_zoom')}")
        print()

        # 출력 파일 준비
        output_dir = os.path.dirname(OUTPUT_PATH)
        if output_dir and not os.path.exists(output_dir):
            os.makedirs(output_dir)

        # 타일 추출
        tiles_written = 0
        tiles_empty = 0

        with open(OUTPUT_PATH, 'wb') as f_out:
            writer = Writer(f_out)

            for z in range(MIN_ZOOM, MAX_ZOOM + 1):
                max_coord = 2 ** z
                tiles_at_zoom = 0

                print(f"Processing z={z} ({max_coord}x{max_coord} tiles)...", end='', flush=True)

                for x in range(max_coord):
                    for y in range(max_coord):
                        tile_data = reader.get(z, x, y)

                        if tile_data:
                            # 타일 데이터 그대로 복사 (디코딩/재인코딩 없음)
                            writer.write_tile(z, x, y, tile_data)
                            tiles_at_zoom += 1
                            tiles_written += 1
                        else:
                            tiles_empty += 1

                print(f" {tiles_at_zoom} tiles copied")

            # 메타데이터 업데이트
            new_metadata = {
                "name": "Protomaps Basemap (z0-10)",
                "description": "Extracted z0-10 from Protomaps Basemap for ShadEarth labels",
                "attribution": metadata.get("attribution", "OpenStreetMap contributors"),
                "vector_layers": metadata.get("vector_layers", [])
            }

            writer.finalize(
                header={
                    "tile_type": TileType.MVT,
                    "tile_compression": Compression.GZIP,
                    "min_zoom": MIN_ZOOM,
                    "max_zoom": MAX_ZOOM,
                    "min_lon": -180,
                    "min_lat": -85.051129,
                    "max_lon": 180,
                    "max_lat": 85.051129,
                    "center_lon": 0,
                    "center_lat": 0,
                    "center_zoom": 2,
                },
                metadata=new_metadata
            )

    # 결과 출력
    output_size = os.path.getsize(OUTPUT_PATH)
    print()
    print(f"Done!")
    print(f"  Tiles written: {tiles_written}")
    print(f"  Empty tiles: {tiles_empty}")
    print(f"  Output size: {output_size / 1024 / 1024:.1f} MB")


if __name__ == '__main__':
    main()
