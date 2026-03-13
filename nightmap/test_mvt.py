#!/usr/bin/env python3
"""
MVT 좌표 테스트 스크립트
서울 주변 타일을 파싱해서 좌표 변환이 올바른지 확인
"""

import requests
import math

# mapbox-vector-tile 라이브러리
try:
    import mapbox_vector_tile
except ImportError:
    print("Installing mapbox-vector-tile...")
    import subprocess
    subprocess.check_call(['pip', 'install', 'mapbox-vector-tile'])
    import mapbox_vector_tile


def tile2lon(x: float, z: int) -> float:
    return (x / (2 ** z)) * 360 - 180


def tile2lat(y: float, z: int) -> float:
    n = math.pi - (2 * math.pi * y) / (2 ** z)
    return (180 / math.pi) * math.atan(0.5 * (math.exp(n) - math.exp(-n)))


def lon2tile(lon: float, z: int) -> float:
    return (lon + 180) / 360 * (2 ** z)


def lat2tile(lat: float, z: int) -> float:
    lat_rad = lat * math.pi / 180
    return (1 - math.log(math.tan(lat_rad) + 1 / math.cos(lat_rad)) / math.pi) / 2 * (2 ** z)


# 서울 좌표: 37.5665° N, 126.9780° E
SEOUL_LAT = 37.5665
SEOUL_LON = 126.9780

# 줌 레벨 6에서 서울이 포함된 타일 찾기
z = 6
seoul_tile_x = int(lon2tile(SEOUL_LON, z))
seoul_tile_y = int(lat2tile(SEOUL_LAT, z))
print(f"Seoul is in tile z={z}, x={seoul_tile_x}, y={seoul_tile_y}")

# 타일 경계 확인
tile_north = tile2lat(seoul_tile_y, z)
tile_south = tile2lat(seoul_tile_y + 1, z)
tile_west = tile2lon(seoul_tile_x, z)
tile_east = tile2lon(seoul_tile_x + 1, z)
print(f"Tile bounds: N={tile_north:.4f}, S={tile_south:.4f}, W={tile_west:.4f}, E={tile_east:.4f}")

# MVT 다운로드
url = f"https://vector.openstreetmap.org/shortbread_v1/{z}/{seoul_tile_x}/{seoul_tile_y}.mvt"
print(f"\nFetching: {url}")
response = requests.get(url)
if response.status_code != 200:
    print(f"Failed to fetch tile: {response.status_code}")
    exit(1)

# 파싱
tile_data = mapbox_vector_tile.decode(response.content)

print("\nAvailable layers:", list(tile_data.keys()))

# place_labels 레이어 확인
if 'place_labels' in tile_data:
    layer = tile_data['place_labels']
    extent = layer.get('extent', 4096)
    print(f"\nplace_labels: {len(layer['features'])} features, extent={extent}")

    for feature in layer['features']:
        props = feature['properties']
        geom = feature['geometry']

        name = props.get('name', '')
        name_en = props.get('name_en', '')
        kind = props.get('kind', '')

        if geom['type'] == 'Point':
            coords = geom['coordinates']
            mvt_x, mvt_y = coords[0], coords[1]

            # 원래 TypeScript 코드 방식 (y + geom.y/extent)
            lon_current = tile2lon(seoul_tile_x + mvt_x / extent, z)
            lat_original = tile2lat(seoul_tile_y + mvt_y / extent, z)

            # MVT Y 좌표 반전 (extent - mvt_y)
            lat_flipped = tile2lat(seoul_tile_y + (extent - mvt_y) / extent, z)

            # 중간값 시도 - 타일 중심 기준
            lat_centered = tile2lat(seoul_tile_y + 0.5, z)  # 타일 중심

            print(f"\n  {name} ({name_en}) - {kind}")
            print(f"    MVT coords: x={mvt_x}, y={mvt_y} (extent={extent})")
            print(f"    Original (y + geom.y/extent):     lat={lat_original:.4f}")
            print(f"    Flipped (y + (ext-geom.y)/ext):   lat={lat_flipped:.4f}")
            print(f"    Tile center:                      lat={lat_centered:.4f}")

# boundary_labels 레이어도 확인
if 'boundary_labels' in tile_data:
    layer = tile_data['boundary_labels']
    extent = layer.get('extent', 4096)
    print(f"\nboundary_labels: {len(layer['features'])} features, extent={extent}")

    for feature in layer['features'][:5]:  # 처음 5개만
        props = feature['properties']
        geom = feature['geometry']

        name = props.get('name', '')
        name_en = props.get('name_en', '')
        admin_level = props.get('admin_level', '')

        if geom['type'] == 'Point':
            coords = geom['coordinates']
            mvt_x, mvt_y = coords[0], coords[1]

            lon_current = tile2lon(seoul_tile_x + mvt_x / extent, z)
            lat_current = tile2lat(seoul_tile_y + mvt_y / extent, z)
            lat_flipped = tile2lat(seoul_tile_y + (extent - mvt_y) / extent, z)

            print(f"\n  {name} ({name_en}) - admin_level={admin_level}")
            print(f"    MVT coords: x={mvt_x}, y={mvt_y}")
            print(f"    Current method: lon={lon_current:.4f}, lat={lat_current:.4f}")
            print(f"    Y-flipped:      lon={lon_current:.4f}, lat={lat_flipped:.4f}")
