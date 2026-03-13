#!/usr/bin/env python3
"""
PMTiles 레이어 필터링 스크립트

z0-10.pmtiles에서 places + physical_point 레이어만 추출

사용법:
    python filter_layers.py

입력: z0-10.pmtiles
출력: labels.pmtiles
"""

import gzip
import sys
import os
import struct

try:
    from pmtiles.reader import Reader, MmapSource
    from pmtiles.writer import Writer
    from pmtiles.tile import TileType, Compression, zxy_to_tileid
except ImportError:
    print("Installing pmtiles...")
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'pmtiles'])
    from pmtiles.reader import Reader, MmapSource
    from pmtiles.writer import Writer
    from pmtiles.tile import TileType, Compression, zxy_to_tileid


# 설정
INPUT_PATH = "z0-10.pmtiles"
OUTPUT_PATH = "labels.pmtiles"
LAYERS_TO_KEEP = ["places", "physical_point"]


def filter_mvt_layers(tile_data: bytes, layers_to_keep: list) -> bytes:
    """
    MVT 타일에서 특정 레이어만 유지 (저수준 protobuf 파싱)
    mapbox-vector-tile 없이 직접 처리
    """
    # gzip 압축 해제
    is_gzipped = tile_data[:2] == b'\x1f\x8b'
    if is_gzipped:
        tile_data = gzip.decompress(tile_data)

    # MVT는 protobuf 형식
    # 각 레이어는 tag 3 (length-delimited)
    # 레이어 내 name은 tag 1 (length-delimited)

    result_layers = []
    pos = 0

    while pos < len(tile_data):
        # varint로 태그/와이어타입 읽기
        tag_wire, new_pos = read_varint(tile_data, pos)
        if new_pos is None:
            break

        wire_type = tag_wire & 0x7
        field_num = tag_wire >> 3

        if wire_type == 2:  # length-delimited
            length, new_pos = read_varint(tile_data, new_pos)
            if new_pos is None:
                break

            field_data = tile_data[new_pos:new_pos + length]
            field_end = new_pos + length

            if field_num == 3:  # layer
                # 레이어 이름 추출 (tag 1)
                layer_name = extract_layer_name(field_data)

                if layer_name in layers_to_keep:
                    # 원본 바이트 그대로 보존
                    result_layers.append(tile_data[pos:field_end])

            pos = field_end
        else:
            # 다른 와이어 타입은 건너뜀
            break

    if not result_layers:
        return None

    # 결과 조합
    result = b''.join(result_layers)

    # gzip 재압축
    return gzip.compress(result)


def read_varint(data: bytes, pos: int):
    """protobuf varint 읽기"""
    result = 0
    shift = 0
    while pos < len(data):
        byte = data[pos]
        result |= (byte & 0x7F) << shift
        pos += 1
        if not (byte & 0x80):
            return result, pos
        shift += 7
    return None, None


def extract_layer_name(layer_data: bytes) -> str:
    """레이어 데이터에서 이름 추출 (tag 1)"""
    pos = 0
    while pos < len(layer_data):
        tag_wire, new_pos = read_varint(layer_data, pos)
        if new_pos is None:
            break

        wire_type = tag_wire & 0x7
        field_num = tag_wire >> 3

        if wire_type == 2:  # length-delimited
            length, new_pos = read_varint(layer_data, new_pos)
            if new_pos is None:
                break

            if field_num == 1:  # name
                return layer_data[new_pos:new_pos + length].decode('utf-8')

            pos = new_pos + length
        elif wire_type == 0:  # varint
            _, pos = read_varint(layer_data, new_pos)
        else:
            break

    return ""


def main():
    print(f"Input: {INPUT_PATH}")
    print(f"Output: {OUTPUT_PATH}")
    print(f"Layers to keep: {LAYERS_TO_KEEP}")
    print()

    if not os.path.exists(INPUT_PATH):
        print(f"Error: Input file not found: {INPUT_PATH}")
        sys.exit(1)

    input_size = os.path.getsize(INPUT_PATH)
    print(f"Input size: {input_size / 1024 / 1024:.1f} MB")
    print()

    with open(INPUT_PATH, 'rb') as f_in:
        source = MmapSource(f_in)
        reader = Reader(source)

        header = reader.header()
        metadata = reader.metadata() or {}

        min_zoom = header.get('min_zoom', 0)
        max_zoom = header.get('max_zoom', 10)

        print(f"Zoom range: {min_zoom} - {max_zoom}")
        print()

        tiles_written = 0
        tiles_filtered = 0

        with open(OUTPUT_PATH, 'wb') as f_out:
            writer = Writer(f_out)

            for z in range(min_zoom, max_zoom + 1):
                max_coord = 2 ** z
                tiles_at_zoom = 0

                print(f"Processing z={z} ({max_coord}x{max_coord})...", end='', flush=True)

                for x in range(max_coord):
                    for y in range(max_coord):
                        tile_data = reader.get(z, x, y)

                        if tile_data:
                            filtered = filter_mvt_layers(tile_data, LAYERS_TO_KEEP)

                            if filtered:
                                tileid = zxy_to_tileid(z, x, y)
                                writer.write_tile(tileid, filtered)
                                tiles_at_zoom += 1
                                tiles_written += 1
                            else:
                                tiles_filtered += 1

                print(f" {tiles_at_zoom} tiles")

            # 메타데이터 업데이트
            new_metadata = {
                "name": "ShadEarth Labels",
                "description": f"Layers: {', '.join(LAYERS_TO_KEEP)}",
                "attribution": metadata.get("attribution", "OpenStreetMap contributors"),
                "vector_layers": [
                    layer for layer in metadata.get("vector_layers", [])
                    if layer.get("id") in LAYERS_TO_KEEP
                ]
            }

            writer.finalize(
                header={
                    "tile_type": TileType.MVT,
                    "tile_compression": Compression.GZIP,
                    "min_zoom": min_zoom,
                    "max_zoom": max_zoom,
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

    output_size = os.path.getsize(OUTPUT_PATH)
    print()
    print(f"Done!")
    print(f"  Tiles written: {tiles_written}")
    print(f"  Tiles filtered out: {tiles_filtered}")
    print(f"  Output size: {output_size / 1024 / 1024:.1f} MB")
    print(f"  Reduction: {(1 - output_size / input_size) * 100:.1f}%")


if __name__ == '__main__':
    main()
