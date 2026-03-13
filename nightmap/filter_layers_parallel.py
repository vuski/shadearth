#!/usr/bin/env python3
"""
PMTiles 레이어 필터링 스크립트 (병렬 처리)

z0-10.pmtiles에서 places + physical_point 레이어만 추출
줌 레벨별로 병렬 처리 후 합침

사용법:
    python filter_layers_parallel.py [workers]
    python filter_layers_parallel.py 8
"""

import gzip
import sys
import os
import json
import tempfile
import shutil
import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
from multiprocessing import cpu_count

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
TEMP_DIR = "temp_tiles"


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


def filter_mvt_layers(tile_data: bytes, layers_to_keep: list) -> bytes:
    """MVT 타일에서 특정 레이어만 유지"""
    is_gzipped = tile_data[:2] == b'\x1f\x8b'
    if is_gzipped:
        tile_data = gzip.decompress(tile_data)

    result_layers = []
    pos = 0

    while pos < len(tile_data):
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
                layer_name = extract_layer_name(field_data)
                if layer_name in layers_to_keep:
                    result_layers.append(tile_data[pos:field_end])

            pos = field_end
        else:
            break

    if not result_layers:
        return None

    result = b''.join(result_layers)
    return gzip.compress(result)


def process_tile_chunk(args):
    """타일 청크 처리 (워커 함수)"""
    z, x_start, x_end, input_path, temp_dir, layers_to_keep = args

    output_file = os.path.join(temp_dir, f"z{z}_x{x_start}-{x_end}.bin")
    tiles = []

    with open(input_path, 'rb') as f:
        source = MmapSource(f)
        reader = Reader(source)

        max_y = 2 ** z

        for x in range(x_start, x_end):
            for y in range(max_y):
                tile_data = reader.get(z, x, y)

                if tile_data:
                    filtered = filter_mvt_layers(tile_data, layers_to_keep)

                    if filtered:
                        tileid = zxy_to_tileid(z, x, y)
                        tiles.append((tileid, filtered))

    # 임시 파일에 저장 (tileid, length, data 형식)
    with open(output_file, 'wb') as f:
        for tileid, data in tiles:
            f.write(tileid.to_bytes(8, 'little'))
            f.write(len(data).to_bytes(4, 'little'))
            f.write(data)

    return z, x_start, x_end, len(tiles), output_file


def main():
    parser = argparse.ArgumentParser(description='Filter PMTiles layers in parallel')
    parser.add_argument('workers', nargs='?', type=int, default=cpu_count(),
                        help=f'Number of worker processes (default: {cpu_count()})')
    args = parser.parse_args()

    num_workers = args.workers

    print(f"Input: {INPUT_PATH}")
    print(f"Output: {OUTPUT_PATH}")
    print(f"Layers to keep: {LAYERS_TO_KEEP}")
    print(f"Workers: {num_workers}")
    print()

    if not os.path.exists(INPUT_PATH):
        print(f"Error: Input file not found: {INPUT_PATH}")
        sys.exit(1)

    input_size = os.path.getsize(INPUT_PATH)
    print(f"Input size: {input_size / 1024 / 1024:.1f} MB")

    # 메타데이터 읽기
    with open(INPUT_PATH, 'rb') as f:
        source = MmapSource(f)
        reader = Reader(source)
        header = reader.header()
        metadata = reader.metadata() or {}
        min_zoom = header.get('min_zoom', 0)
        max_zoom = header.get('max_zoom', 10)

    print(f"Zoom range: {min_zoom} - {max_zoom}")
    print()

    # 임시 디렉토리 생성
    if os.path.exists(TEMP_DIR):
        shutil.rmtree(TEMP_DIR)
    os.makedirs(TEMP_DIR)

    # 태스크 생성 - X축을 num_workers 청크로 분할
    tasks = []
    for z in range(min_zoom, max_zoom + 1):
        max_x = 2 ** z
        # 청크 크기 계산 (최소 1)
        chunk_size = max(1, max_x // num_workers)

        for x_start in range(0, max_x, chunk_size):
            x_end = min(x_start + chunk_size, max_x)
            tasks.append((z, x_start, x_end, INPUT_PATH, TEMP_DIR, LAYERS_TO_KEEP))

    print(f"Total tasks: {len(tasks)}")
    print()

    total_tiles = 0
    temp_files = []
    completed = 0

    print("Processing tiles in parallel...")
    with ProcessPoolExecutor(max_workers=num_workers) as executor:
        futures = {executor.submit(process_tile_chunk, task): task for task in tasks}

        for future in as_completed(futures):
            z, x_start, x_end, tiles_count, temp_file = future.result()
            total_tiles += tiles_count
            temp_files.append(temp_file)
            completed += 1
            print(f"  [{completed}/{len(tasks)}] z={z} x={x_start}-{x_end}: {tiles_count} tiles")

    print()
    print(f"Merging {total_tiles} tiles...")

    # 결과 합치기
    with open(OUTPUT_PATH, 'wb') as f_out:
        writer = Writer(f_out)

        for temp_file in temp_files:
            with open(temp_file, 'rb') as f:
                while True:
                    tileid_bytes = f.read(8)
                    if not tileid_bytes:
                        break

                    tileid = int.from_bytes(tileid_bytes, 'little')
                    length = int.from_bytes(f.read(4), 'little')
                    data = f.read(length)

                    writer.write_tile(tileid, data)

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

    # 임시 파일 정리
    shutil.rmtree(TEMP_DIR)

    output_size = os.path.getsize(OUTPUT_PATH)
    print()
    print(f"Done!")
    print(f"  Total tiles: {total_tiles}")
    print(f"  Output size: {output_size / 1024 / 1024:.1f} MB")
    print(f"  Reduction: {(1 - output_size / input_size) * 100:.1f}%")


if __name__ == '__main__':
    main()
