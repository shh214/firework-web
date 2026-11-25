"""Build the three-stage viewer's atlas and optional full-size cutouts."""

import argparse
import hashlib
import json
import math
import sqlite3
import sys
import tempfile
import zlib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
if not (ROOT / "research").is_dir():
    ROOT = ROOT.parent
OUTPUT = ROOT / "us-fireworks-scroll-three"
SELECTIONS = ROOT / "research" / "us_top10_color_full_2026-11-22"
ADJACENT_PIXELS = np.ones((3, 3), dtype=bool)
sys.path.insert(0, str(SELECTIONS))
from export_selected_pixels import to_srgb


def display_alpha(rgb, labels):
    luminous = (labels >= 1) & (labels <= 8)
    pixels = np.asarray(rgb)
    red, green, blue = pixels.transpose(2, 0, 1)
    peak = np.maximum(np.maximum(red, green), blue)
    second = np.maximum(np.minimum(red, green), np.minimum(np.maximum(red, green), blue))
    highlight = (peak >= 232) & (second >= 150)
    clipped = (peak >= 248) & (second >= 185)

    # Color-study masks can omit the interior of a bright bloom. Restore a
    # continuous highlight when it has a hot center and meets marked sparks.
    components, count = ndimage.label(highlight, structure=ADJACENT_PIXELS)
    radius = max(2, round(max(rgb.size) / 180))
    nearby = ndimage.maximum_filter(luminous, size=2 * radius + 1)
    contact = np.bincount(components[highlight & nearby], minlength=count + 1)
    hot_pixels = np.bincount(components[clipped], minlength=count + 1)
    restore = (contact >= 6) & (hot_pixels >= 4)
    return Image.fromarray(luminous | restore[components]).convert("L")


def detail_alpha(rgb, baseline):
    pixels = np.asarray(rgb, dtype=np.float32)
    value = pixels.max(axis=2)
    chroma = value - pixels.min(axis=2)
    scale = max(rgb.size) / 1000
    window = max(5, 2 * round(7 * scale) + 1)
    background = ndimage.grey_opening(value, size=(window, window))
    ridge = value - background
    known = np.asarray(baseline) > 0
    distance = ndimage.distance_transform_edt(~known)

    # Find faint colored details that stand out from the nearby sky.
    candidates = (
        (value >= 16) & (chroma >= 9) & (chroma >= value * .13)
        & (ridge >= 5) & (ridge >= background * .13)
        & (distance <= max(12, 40 * scale))
    )
    components, count = ndimage.label(candidates | known, structure=ADJACENT_PIXELS)
    anchored = np.bincount(components[known], minlength=count + 1) > 0
    connected = candidates & anchored[components]

    # Keep nearby groups of sparks, including trails interrupted by gaps.
    fragments, count = ndimage.label(candidates & ~connected, structure=ADJACENT_PIXELS)
    touches = np.bincount(fragments[candidates & (distance <= max(3, 8 * scale))], minlength=count + 1)
    contrast = np.bincount(fragments[candidates & (ridge >= 12)], minlength=count + 1)
    nearby = (touches >= 4) & (contrast >= 4)
    include = connected | (candidates & (fragments != 0) & nearby[fragments])
    opacity = np.clip((ridge - 3) / 10, 0, 1)
    return np.maximum(np.asarray(baseline), np.rint(255 * opacity * include).astype(np.uint8))


def cutout_thumbnail(record, photo, cell, png_directory):
    name, digest, width, height, compressed = record
    raw = (SELECTIONS / name).read_bytes()
    if hashlib.sha256(raw).hexdigest() != digest:
        raise ValueError(f"Source JPEG changed for {photo['id']}")
    rgb, profile = to_srgb(raw)
    if rgb.size != (width, height) or rgb.size != (photo["w"], photo["h"]):
        raise ValueError(f"Source dimensions changed for {photo['id']}")

    labels = np.frombuffer(zlib.decompress(compressed), dtype=np.uint8).reshape(height, width)
    alpha = detail_alpha(rgb, display_alpha(rgb, labels))
    if alpha.min() != 0 or alpha.max() == 0:
        raise ValueError(f"Expected both fireworks and transparent background for {photo['id']}")
    rgb.putalpha(Image.fromarray(alpha))
    if png_directory is not None:
        # Discard original background RGB where it would be entirely invisible.
        pixels = np.array(rgb)
        pixels[alpha == 0] = 0
        Image.fromarray(pixels).save(
            png_directory / f"{photo['id']}.png", compress_level=3, icc_profile=profile.tobytes()
        )
    scale = cell / max(width, height)
    size = tuple(max(1, math.floor(length * scale + 0.5)) for length in rgb.size)
    return rgb.resize(size, Image.Resampling.BOX)


def build(export_pngs):
    manifest = (ROOT / "us-fireworks-cloud" / "cloud-data.js").read_text(encoding="utf-8")
    cloud = json.loads(manifest.split("=", 1)[1].strip().removesuffix(";"))
    photos = cloud["photos"]
    cell = cloud["atlas"]["cell"]
    columns = cloud["atlas"]["cols"]
    sheet = Image.new("RGBA", (columns * cell, math.ceil(len(photos) / columns) * cell))
    database = (SELECTIONS / "pixel_selections.sqlite3").as_uri() + "?mode=ro"
    target = OUTPUT / "cutouts"
    if export_pngs and target.exists():
        raise FileExistsError(f"Move the previous export before creating another: {target}")
    with tempfile.TemporaryDirectory(dir=OUTPUT) as staging_name:
        staging = Path(staging_name)
        png_directory = staging / target.name if export_pngs else None
        if png_directory is not None:
            png_directory.mkdir()
        with sqlite3.connect(database, uri=True) as db, ThreadPoolExecutor(max_workers=4) as workers:
            for start in range(0, len(photos), 32):
                futures = []
                for photo in photos[start:start + 32]:
                    record = db.execute(
                        "SELECT source, sha256, width, height, labels FROM selections WHERE photo_id = ?",
                        (photo["id"],),
                    ).fetchone()
                    if record is None:
                        raise ValueError(f"No saved pixel selection for {photo['id']}")
                    futures.append(workers.submit(cutout_thumbnail, record, photo, cell, png_directory))
                for i, future in enumerate(futures, start):
                    tile = future.result()
                    left = (i % columns) * cell + (cell - tile.width) // 2
                    top = (i // columns) * cell + (cell - tile.height) // 2
                    sheet.paste(tile, (left, top))
                done = min(start + len(futures), len(photos))
                if done % 256 == 0 or done == len(photos):
                    print(f"Processed {done}/{len(photos)} photos", flush=True)
        atlas = staging / "fireworks-atlas.webp"
        sheet.save(atlas, "WEBP", lossless=True, method=4)
        if png_directory is not None:
            png_directory.rename(target)
        atlas.replace(OUTPUT / atlas.name)
    print(f"Built transparent thumbnails for {len(photos)} photos")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--full-size", action="store_true", help="Also export full-size PNGs into cutouts/")
    build(parser.parse_args().full_size)
