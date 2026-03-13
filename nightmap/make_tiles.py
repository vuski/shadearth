"""
Generate XYZ tiles (256x256) from a 32768x32768 EPSG:3857 image.
Zoom level 7 = 128x128 tiles = 32768px.
Also generates lower zoom levels 0-6 by downscaling.
Output format: tiles/{z}/{x}/{y}.webp
"""

import os
import sys
from PIL import Image

# 32768x32768 = ~1 billion pixels, need to disable bomb check
Image.MAX_IMAGE_PIXELS = None

INPUT = "nightmap_3857.tif"
OUTPUT_DIR = "tiles"
TILE_SIZE = 256
MAX_ZOOM = 7
FORMAT = "webp"
QUALITY = 85

def main():
    print(f"Loading {INPUT}...")
    img = Image.open(INPUT)
    print(f"Image size: {img.size}")

    assert img.size == (32768, 32768), f"Expected 32768x32768, got {img.size}"

    # Generate tiles for each zoom level (7 down to 0)
    current = img
    for z in range(MAX_ZOOM, -1, -1):
        num_tiles = 2 ** z  # tiles per axis
        expected_size = num_tiles * TILE_SIZE

        if current.size[0] != expected_size:
            print(f"Zoom {z}: resizing to {expected_size}x{expected_size}...")
            current = img.resize((expected_size, expected_size), Image.LANCZOS)

        print(f"Zoom {z}: generating {num_tiles}x{num_tiles} = {num_tiles*num_tiles} tiles...")

        for x in range(num_tiles):
            tile_dir = os.path.join(OUTPUT_DIR, str(z), str(x))
            os.makedirs(tile_dir, exist_ok=True)
            for y in range(num_tiles):
                left = x * TILE_SIZE
                upper = y * TILE_SIZE
                tile = current.crop((left, upper, left + TILE_SIZE, upper + TILE_SIZE))
                tile_path = os.path.join(tile_dir, f"{y}.{FORMAT}")
                tile.save(tile_path, FORMAT, quality=QUALITY)

        print(f"Zoom {z}: done.")

    print("All tiles generated!")

if __name__ == "__main__":
    main()
