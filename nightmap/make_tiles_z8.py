"""Generate zoom level 8 tiles only from the 65536x65536 image."""

import os
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

INPUT = "nightmap_3857_z8.tif"
OUTPUT_DIR = "tiles"
TILE_SIZE = 256
FORMAT = "webp"
QUALITY = 85

def main():
    print(f"Loading {INPUT}...")
    img = Image.open(INPUT)
    print(f"Image size: {img.size}")

    z = 8
    num_tiles = 2 ** z  # 256
    print(f"Zoom {z}: generating {num_tiles}x{num_tiles} = {num_tiles*num_tiles} tiles...")

    for x in range(num_tiles):
        tile_dir = os.path.join(OUTPUT_DIR, str(z), str(x))
        os.makedirs(tile_dir, exist_ok=True)
        for y in range(num_tiles):
            left = x * TILE_SIZE
            upper = y * TILE_SIZE
            tile = img.crop((left, upper, left + TILE_SIZE, upper + TILE_SIZE))
            tile_path = os.path.join(tile_dir, f"{y}.{FORMAT}")
            tile.save(tile_path, FORMAT, quality=QUALITY)
        if x % 32 == 0:
            print(f"  {x}/{num_tiles}...")

    print(f"Zoom {z}: done!")

if __name__ == "__main__":
    main()
