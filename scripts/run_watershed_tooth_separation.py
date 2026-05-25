#!/usr/bin/env python3
"""Bootstrap tooth instance separation with hard-tissue watershed."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from skimage.feature import peak_local_max
from skimage.measure import marching_cubes, regionprops
from skimage.segmentation import watershed


def load_volume(raw_path: Path, shape: tuple[int, int, int]) -> np.ndarray:
    return np.fromfile(raw_path, dtype="<i2").reshape(shape)


def write_ascii_stl(path: Path, vertices: np.ndarray, faces: np.ndarray) -> None:
    with path.open("w", encoding="utf-8") as handle:
        handle.write(f"solid {path.stem}\n")
        for face in faces:
            tri = vertices[face]
            normal = np.cross(tri[1] - tri[0], tri[2] - tri[0])
            norm = np.linalg.norm(normal)
            if norm:
                normal = normal / norm
            handle.write(f"  facet normal {normal[0]:.6g} {normal[1]:.6g} {normal[2]:.6g}\n")
            handle.write("    outer loop\n")
            for vertex in tri:
                handle.write(f"      vertex {vertex[0]:.6g} {vertex[1]:.6g} {vertex[2]:.6g}\n")
            handle.write("    endloop\n")
            handle.write("  endfacet\n")
        handle.write(f"endsolid {path.stem}\n")


def normalize_slice(image: np.ndarray) -> np.ndarray:
    lo, hi = np.percentile(image, [1, 99])
    return np.clip((image - lo) / max(hi - lo, 1), 0, 1)


def overlay_preview(volume: np.ndarray, labels: np.ndarray, output: Path) -> None:
    z = int((labels > 0).sum(axis=(1, 2)).argmax())
    rgb = np.repeat(normalize_slice(volume[z])[..., None], 3, axis=2)
    palette = np.array(
        [
            [0.95, 0.12, 0.16],
            [0.10, 0.68, 0.92],
            [0.20, 0.86, 0.35],
            [0.98, 0.76, 0.18],
            [0.68, 0.38, 0.95],
            [0.96, 0.38, 0.74],
            [0.10, 0.78, 0.72],
            [1.00, 0.48, 0.18],
            [0.58, 0.84, 0.20],
        ]
    )
    for label_value in sorted(int(value) for value in np.unique(labels) if value):
        mask = labels[z] == label_value
        rgb[mask] = 0.28 * rgb[mask] + 0.72 * palette[(label_value - 1) % len(palette)]
    Image.fromarray((rgb * 255).astype(np.uint8)).save(output)


def save_instance_preview(volume: np.ndarray, labels: np.ndarray, label_value: int, output: Path) -> None:
    mask = labels == label_value
    z = int(mask.sum(axis=(1, 2)).argmax())
    rgb = np.repeat(normalize_slice(volume[z])[..., None], 3, axis=2)
    rgb[mask[z], 0] = 1
    rgb[mask[z], 1] *= 0.25
    rgb[mask[z], 2] *= 0.25
    Image.fromarray((rgb * 255).astype(np.uint8)).save(output)


def export_stl(labels: np.ndarray, label_value: int, spacing: tuple[float, float, float], output: Path) -> None:
    coords = np.argwhere(labels == label_value)
    z0, y0, x0 = coords.min(axis=0)
    z1, y1, x1 = coords.max(axis=0) + 1
    padded = np.pad(labels[z0:z1, y0:y1, x0:x1] == label_value, 1)
    vertices, faces, _normals, _values = marching_cubes(
        padded.astype(np.float32),
        level=0.5,
        spacing=(spacing[2], spacing[0], spacing[1]),
    )
    vertices[:, 0] += (z0 - 1) * spacing[2]
    vertices[:, 1] += (y0 - 1) * spacing[0]
    vertices[:, 2] += (x0 - 1) * spacing[1]
    write_ascii_stl(output, vertices[:, [2, 1, 0]], faces)


def make_contact_sheet(instance_paths: list[Path], output: Path) -> None:
    tiles = []
    for path in instance_paths:
        image = Image.open(path).resize((180, 180))
        tile = Image.new("RGB", (180, 210), (16, 19, 22))
        tile.paste(image, (0, 0))
        ImageDraw.Draw(tile).text((6, 188), path.stem[:24], fill=(230, 230, 230))
        tiles.append(tile)
    columns = 5
    rows = max(1, (len(tiles) + columns - 1) // columns)
    sheet = Image.new("RGB", (columns * 180, rows * 210), (16, 19, 22))
    for index, tile in enumerate(tiles):
        sheet.paste(tile, ((index % columns) * 180, (index // columns) * 210))
    sheet.save(output)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=Path("public/sample-cbct/manifest.json"))
    parser.add_argument("--raw", type=Path, default=Path("public/sample-cbct/volume-int16.raw"))
    parser.add_argument("--output-dir", type=Path, default=Path("outputs/sample-watershed-segmentation"))
    parser.add_argument("--threshold", type=int, default=1350)
    parser.add_argument("--min-distance", type=int, default=17)
    parser.add_argument("--min-voxels", type=int, default=1500)
    parser.add_argument("--max-voxels", type=int, default=180000)
    args = parser.parse_args()

    manifest = json.load(args.manifest.open())
    shape = (
        int(manifest["dimensions"]["depth"]),
        int(manifest["dimensions"]["height"]),
        int(manifest["dimensions"]["width"]),
    )
    spacing = (
        float(manifest["spacing"]["y"]),
        float(manifest["spacing"]["x"]),
        float(manifest["spacing"]["z"]),
    )
    volume = load_volume(args.raw, shape)

    yy, xx = np.indices(shape[1:])
    dental_xy = (yy > 45) & (yy < 440) & (xx > 80) & (xx < 575)
    z_mask = np.zeros(shape[0], dtype=bool)
    z_mask[45:300] = True
    hard = (volume > args.threshold) & z_mask[:, None, None] & dental_xy[None, :, :]
    hard = ndi.binary_opening(hard, iterations=1)
    hard = ndi.binary_closing(hard, iterations=1)
    hard = ndi.binary_fill_holes(hard)

    distance = ndi.distance_transform_edt(hard, sampling=(spacing[2], spacing[0], spacing[1]))
    peaks = peak_local_max(
        distance,
        labels=hard,
        min_distance=args.min_distance,
        threshold_abs=1.1,
        exclude_border=False,
    )
    markers = np.zeros(shape, dtype=np.int32)
    for index, (z, y, x) in enumerate(peaks, start=1):
        markers[z, y, x] = index
    raw_labels = watershed(-distance, markers, mask=hard)

    output = args.output_dir
    if output.exists():
        import shutil

        shutil.rmtree(output)
    (output / "instances").mkdir(parents=True)
    (output / "stl").mkdir()

    labels = np.zeros(shape, dtype=np.uint16)
    items = []
    next_label = 1
    for region in sorted(regionprops(raw_labels), key=lambda item: item.area, reverse=True):
        if region.area < args.min_voxels or region.area > args.max_voxels:
            continue
        z, y, x = region.centroid
        if not (45 <= z <= 300 and 45 <= y <= 440 and 80 <= x <= 575):
            continue
        labels[raw_labels == region.label] = next_label
        preview = output / "instances" / f"{next_label:02d}-watershed-tooth.png"
        stl = output / "stl" / f"{next_label:02d}-watershed-tooth.stl"
        save_instance_preview(volume, labels, next_label, preview)
        export_stl(labels, next_label, spacing, stl)
        min_z, min_y, min_x, max_z, max_y, max_x = region.bbox
        items.append(
            {
                "label": next_label,
                "name": f"watershed-tooth-{next_label:02d}",
                "preview": f"instances/{preview.name}",
                "stl": f"stl/{stl.name}",
                "assignedVoxels": int(region.area),
                "centroidZYX": [round(float(z), 2), round(float(y), 2), round(float(x), 2)],
                "bboxZYX": [int(min_z), int(min_y), int(min_x), int(max_z), int(max_y), int(max_x)],
                "extentZYX": [int(max_z - min_z), int(max_y - min_y), int(max_x - min_x)],
            }
        )
        next_label += 1
        if next_label > 33:
            break

    np.savez_compressed(output / "labels.npz", labels=labels)
    overlay_preview(volume, labels, output / "preview.png")
    make_contact_sheet(sorted((output / "instances").glob("*.png")), output / "contact-sheet.png")
    summary = {
        "source": "watershed-hard-tissue",
        "preview": "preview.png",
        "contactSheet": "contact-sheet.png",
        "labels": "labels.npz",
        "acceptedInstances": len(items),
        "candidateCount": int(len(peaks)),
        "positiveVoxels": int((labels > 0).sum()),
        "threshold": args.threshold,
        "minDistance": args.min_distance,
        "spacing": [spacing[0], spacing[1], spacing[2]],
        "items": items,
    }
    (output / "manifest.json").write_text(json.dumps(summary, indent=2))
    (output / "summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
