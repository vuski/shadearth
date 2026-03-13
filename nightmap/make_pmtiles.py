"""Convert XYZ tile directory to a single PMTiles archive."""

import os
import json
from pmtiles.tile import TileType, Compression, zxy_to_tileid
from pmtiles.writer import Writer

TILES_DIR = "tiles"
OUTPUT = "nightmap.pmtiles"
MIN_ZOOM = 0
MAX_ZOOM = 8
FORMAT = "webp"

def main():
    entries = []

    # Collect all tiles
    for z in range(MIN_ZOOM, MAX_ZOOM + 1):
        z_dir = os.path.join(TILES_DIR, str(z))
        if not os.path.isdir(z_dir):
            continue
        num_tiles = 2 ** z
        count = 0
        for x in range(num_tiles):
            x_dir = os.path.join(z_dir, str(x))
            if not os.path.isdir(x_dir):
                continue
            for y in range(num_tiles):
                tile_path = os.path.join(x_dir, f"{y}.{FORMAT}")
                if os.path.exists(tile_path):
                    with open(tile_path, "rb") as f:
                        data = f.read()
                    tile_id = zxy_to_tileid(z, x, y)
                    entries.append((tile_id, data))
                    count += 1
        print(f"Zoom {z}: {count} tiles collected")

    # Sort by tile_id (required by PMTiles spec)
    entries.sort(key=lambda e: e[0])
    print(f"Total: {len(entries)} tiles, writing {OUTPUT}...")

    with open(OUTPUT, "wb") as f:
        writer = Writer(f)
        for tile_id, data in entries:
            writer.write_tile(tile_id, data)

        writer.finalize(
            header={
                "tile_type": TileType.WEBP,
                "tile_compression": Compression.NONE,
                "min_zoom": MIN_ZOOM,
                "max_zoom": MAX_ZOOM,
                "min_lon_e7": -1800000000,
                "min_lat_e7": -850000000,
                "max_lon_e7": 1800000000,
                "max_lat_e7": 850000000,
            },
            metadata={
                "name": "NASA Night Map",
                "description": "NASA VIIRS Day/Night Band Earth at Night",
                "format": "webp",
                "type": "baselayer",
            },
        )

    size_mb = os.path.getsize(OUTPUT) / (1024 * 1024)
    print(f"Done! {OUTPUT} ({size_mb:.1f} MB)")

if __name__ == "__main__":
    main()
