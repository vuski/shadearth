#!/usr/bin/env python3
"""
PMTiles 레이어 분석 스크립트
20240812.pmtiles의 레이어 구조를 OSM Shortbread와 비교
"""

import json
import sys

try:
    from pmtiles.reader import Reader, MmapSource
except ImportError:
    print("Installing pmtiles...")
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'pmtiles'])
    from pmtiles.reader import Reader, MmapSource

try:
    import mapbox_vector_tile
except ImportError:
    print("Installing mapbox-vector-tile...")
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'mapbox-vector-tile'])
    import mapbox_vector_tile


def analyze_pmtiles(filepath: str):
    """PMTiles 파일의 메타데이터와 레이어 구조 분석"""
    print(f"\n{'='*60}")
    print(f"Analyzing: {filepath}")
    print('='*60)

    with open(filepath, 'rb') as f:
        source = MmapSource(f)
        reader = Reader(source)

        # 메타데이터 읽기
        header = reader.header()
        print(f"\n[Header Info]")
        print(f"  Tile Type: {header.get('tile_type', 'unknown')}")
        print(f"  Min Zoom: {header.get('min_zoom', 'N/A')}")
        print(f"  Max Zoom: {header.get('max_zoom', 'N/A')}")
        print(f"  Center: {header.get('center_lon', 'N/A')}, {header.get('center_lat', 'N/A')}")

        # JSON 메타데이터
        metadata = reader.metadata()
        print(f"\n[Metadata]")

        if metadata:
            # vector_layers 확인
            if 'vector_layers' in metadata:
                print(f"\n  Vector Layers ({len(metadata['vector_layers'])} total):")
                for layer in metadata['vector_layers']:
                    layer_id = layer.get('id', 'unknown')
                    minzoom = layer.get('minzoom', '?')
                    maxzoom = layer.get('maxzoom', '?')
                    fields = layer.get('fields', {})
                    print(f"\n    - {layer_id}")
                    print(f"      Zoom: {minzoom} - {maxzoom}")
                    if fields:
                        print(f"      Fields: {list(fields.keys())[:10]}...")  # 처음 10개만

            # tilestats 확인 (있는 경우)
            if 'tilestats' in metadata:
                stats = metadata['tilestats']
                print(f"\n  Tile Stats:")
                print(f"    Layer Count: {stats.get('layerCount', 'N/A')}")
                if 'layers' in stats:
                    for layer in stats['layers']:
                        print(f"    - {layer.get('layer', 'unknown')}: {layer.get('count', '?')} features")

            # 기타 메타데이터
            for key in ['name', 'description', 'attribution', 'version']:
                if key in metadata:
                    print(f"\n  {key}: {metadata[key]}")

        # 샘플 타일 분석 (z=6 중심 타일)
        print(f"\n[Sample Tile Analysis - z=6]")
        try:
            # 서울 근처 타일 (z=6, x=54, y=25)
            tile_data = reader.get(6, 54, 25)
            if tile_data:
                decoded = mapbox_vector_tile.decode(tile_data)
                print(f"  Layers in tile (6/54/25): {list(decoded.keys())}")
                for layer_name, layer in decoded.items():
                    feature_count = len(layer.get('features', []))
                    print(f"    - {layer_name}: {feature_count} features")
            else:
                print("  No tile data at 6/54/25")
        except Exception as e:
            print(f"  Error reading sample tile: {e}")

        return metadata


def compare_with_shortbread():
    """OSM Shortbread에서 사용하는 레이어와 비교"""
    print(f"\n{'='*60}")
    print("OSM Shortbread (현재 ShadEarth에서 사용)")
    print('='*60)

    shortbread_layers = {
        'boundary_labels': {
            'description': '국가, 주/도 경계 라벨',
            'fields': ['name', 'name_en', 'admin_level'],
            'used_in_shadearth': True,
        },
        'place_labels': {
            'description': '도시, 마을 라벨',
            'fields': ['name', 'name_en', 'kind', 'population'],
            'used_in_shadearth': True,
        },
        'water_polygons_labels': {
            'description': '바다, 호수 라벨',
            'fields': ['name', 'name_en', 'kind'],
            'used_in_shadearth': True,
        },
        'streets': {'description': '도로', 'used_in_shadearth': False},
        'buildings': {'description': '건물', 'used_in_shadearth': False},
        'land': {'description': '토지 이용', 'used_in_shadearth': False},
        'water_polygons': {'description': '수역 폴리곤', 'used_in_shadearth': False},
        'water_lines': {'description': '하천', 'used_in_shadearth': False},
    }

    print("\n  ShadEarth에서 사용하는 레이어:")
    for name, info in shortbread_layers.items():
        if info.get('used_in_shadearth'):
            print(f"    - {name}: {info['description']}")
            if 'fields' in info:
                print(f"      Fields: {info['fields']}")

    print("\n  사용하지 않는 레이어 (다운로드 낭비):")
    for name, info in shortbread_layers.items():
        if not info.get('used_in_shadearth'):
            print(f"    - {name}: {info['description']}")

    return shortbread_layers


if __name__ == '__main__':
    # 1. OSM Shortbread 현황
    shortbread = compare_with_shortbread()

    # 2. 로컬 PMTiles 분석
    pmtiles_path = "//vwstor/docker/pmtiles/20240812.pmtiles"
    try:
        pmtiles_metadata = analyze_pmtiles(pmtiles_path)
    except FileNotFoundError:
        print(f"\nError: Cannot access {pmtiles_path}")
        print("Make sure the network drive is mounted.")
        sys.exit(1)
    except Exception as e:
        print(f"\nError analyzing PMTiles: {e}")
        sys.exit(1)

    # 3. 비교 및 결론
    print(f"\n{'='*60}")
    print("결론")
    print('='*60)

    if pmtiles_metadata and 'vector_layers' in pmtiles_metadata:
        pmtiles_layers = {l['id'] for l in pmtiles_metadata['vector_layers']}
        needed_layers = {'boundary_labels', 'place_labels', 'water_polygons_labels'}

        found = needed_layers & pmtiles_layers
        missing = needed_layers - pmtiles_layers

        print(f"\n  필요한 레이어 중 PMTiles에 있는 것: {found if found else 'None'}")
        print(f"  필요한 레이어 중 PMTiles에 없는 것: {missing if missing else 'None'}")

        if found == needed_layers:
            print("\n  => 레이어 추출 가능!")
            print("     tippecanoe로 해당 레이어만 추출하여 경량 PMTiles 생성 가능")
        elif found:
            print(f"\n  => 부분 추출 가능 ({len(found)}/{len(needed_layers)} 레이어)")
        else:
            print("\n  => 레이어 이름이 다름, 매핑 필요")
            print("     PMTiles 레이어 목록을 확인하여 대응되는 레이어 찾아야 함")
