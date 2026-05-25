#!/usr/bin/env python3
"""Render and audit separated tooth label shapes."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from PIL import Image, ImageDraw
from scipy import ndimage
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
from skimage.measure import marching_cubes


def normalize_projection(projection: np.ndarray) -> Image.Image:
    if projection.max() <= 0:
        array = np.zeros(projection.shape, dtype=np.uint8)
    else:
        array = (projection / projection.max() * 255).astype(np.uint8)
    return Image.fromarray(array, mode="L").convert("RGB")


def pad_to_square(image: Image.Image, size: int = 180) -> Image.Image:
    image.thumbnail((size, size), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (size, size), "#05070a")
    x = (size - image.width) // 2
    y = (size - image.height) // 2
    canvas.paste(image, (x, y))
    return canvas


def crop_label(mask: np.ndarray) -> np.ndarray:
    coords = np.argwhere(mask)
    if coords.size == 0:
        return mask
    low = coords.min(axis=0)
    high = coords.max(axis=0) + 1
    return mask[low[0] : high[0], low[1] : high[1], low[2] : high[2]]


def render_label(mask: np.ndarray, item: dict[str, object], output: Path) -> None:
    crop = crop_label(mask)
    views = [
        ("sagittal", crop.sum(axis=2)),
        ("coronal", crop.sum(axis=1)),
        ("axial", crop.sum(axis=0)),
    ]
    tile_w = 180
    tile_h = 212
    canvas = Image.new("RGB", (tile_w * 3, tile_h), "#05070a")
    draw = ImageDraw.Draw(canvas)
    for index, (name, projection) in enumerate(views):
        image = pad_to_square(normalize_projection(projection), tile_w)
        x = index * tile_w
        canvas.paste(image, (x, 24))
        draw.text((x + 8, 6), name, fill="#cbd5e1")
    title = f"label {item['label']} {item['name']} {item.get('qualityStatus', '')}"
    draw.text((8, tile_h - 18), title, fill="#e2e8f0")
    canvas.save(output)


def render_surface(mask: np.ndarray, item: dict[str, object], output: Path) -> None:
    crop = crop_label(mask).astype(np.uint8)
    if min(crop.shape) < 2:
        return
    padded = np.pad(crop, 1)
    vertices, faces, _normals, _values = marching_cubes(padded, level=0.5)
    max_faces = 4500
    if len(faces) > max_faces:
        step = int(np.ceil(len(faces) / max_faces))
        faces = faces[::step]

    fig = plt.figure(figsize=(3.2, 3.2), dpi=140)
    ax = fig.add_subplot(111, projection="3d")
    mesh = Poly3DCollection(vertices[faces], alpha=0.92)
    mesh.set_facecolor("#d8ecff")
    mesh.set_edgecolor("#223040")
    mesh.set_linewidth(0.04)
    ax.add_collection3d(mesh)

    mins = vertices.min(axis=0)
    maxs = vertices.max(axis=0)
    center = (mins + maxs) / 2
    radius = max(maxs - mins) / 2
    for setter, value in [
        (ax.set_xlim, (center[0] - radius, center[0] + radius)),
        (ax.set_ylim, (center[1] - radius, center[1] + radius)),
        (ax.set_zlim, (center[2] - radius, center[2] + radius)),
    ]:
        setter(value)

    ax.view_init(elev=22, azim=-48)
    ax.set_axis_off()
    ax.set_facecolor("#05070a")
    fig.patch.set_facecolor("#05070a")
    title = f"L{item['label']} {item.get('qualityStatus', '')}"
    ax.text2D(0.03, 0.95, title, transform=ax.transAxes, color="#e2e8f0", fontsize=8)
    fig.tight_layout(pad=0)
    fig.savefig(output, facecolor=fig.get_facecolor(), bbox_inches="tight", pad_inches=0.02)
    plt.close(fig)


def save_contact_sheet(rows: list[dict[str, object]], output: Path) -> None:
    images = []
    for row in rows:
        preview = row.get("preview")
        if not preview:
            continue
        image_path = Path(str(preview))
        if image_path.exists():
            images.append((row, Image.open(image_path).convert("RGB")))
    if not images:
        return

    columns = 2
    tile_w, tile_h = images[0][1].size
    rows_count = int(np.ceil(len(images) / columns))
    canvas = Image.new("RGB", (columns * tile_w, rows_count * tile_h), "#05070a")
    draw = ImageDraw.Draw(canvas)
    for index, (row, image) in enumerate(images):
        x = (index % columns) * tile_w
        y = (index // columns) * tile_h
        canvas.paste(image, (x, y))
        if row["status"] != "ok":
            draw.rectangle((x + 2, y + 2, x + tile_w - 3, y + tile_h - 3), outline="#f7bf58", width=3)
    canvas.save(output)


def save_surface_contact_sheet(rows: list[dict[str, object]], output: Path) -> None:
    images = []
    for row in rows:
        preview = row.get("surfacePreview")
        if not preview:
            continue
        image_path = Path(str(preview))
        if image_path.exists():
            images.append((row, Image.open(image_path).convert("RGB")))
    if not images:
        return

    columns = 4
    tile = 260
    rows_count = int(np.ceil(len(images) / columns))
    canvas = Image.new("RGB", (columns * tile, rows_count * tile), "#05070a")
    draw = ImageDraw.Draw(canvas)
    for index, (row, image) in enumerate(images):
        image.thumbnail((tile, tile), Image.Resampling.LANCZOS)
        x = (index % columns) * tile
        y = (index // columns) * tile
        canvas.paste(image, (x + (tile - image.width) // 2, y + (tile - image.height) // 2))
        if row["status"] != "ok" or row.get("qualityStatus") == "review":
            draw.rectangle((x + 2, y + 2, x + tile - 3, y + tile - 3), outline="#f7bf58", width=3)
    canvas.save(output)


def reasons_for_shape(
    mask: np.ndarray,
    item: dict[str, object],
    max_components: int,
    min_extent: int,
    min_voxels: int,
) -> list[str]:
    reasons: list[str] = []
    voxels = int(mask.sum())
    extent = [int(value) for value in item.get("extentZYX", [0, 0, 0])]
    components, component_count = ndimage.label(mask)
    sizes = np.bincount(components.ravel())
    if sizes.size:
        sizes[0] = 0
    largest = int(sizes.max()) if sizes.size else 0

    if voxels < min_voxels:
        reasons.append("low-volume")
    if min(extent) < min_extent:
        reasons.append("flat-or-clipped")
    if component_count > max_components and largest / max(voxels, 1) < 0.985:
        reasons.append("fragmented")
    if max(extent) / max(min(extent), 1) > 7:
        reasons.append("extreme-aspect")
    return reasons


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=Path("public/sample-segmentation-curated/manifest.json"))
    parser.add_argument("--output-dir", type=Path, default=Path("outputs/tooth-shape-audit"))
    parser.add_argument("--max-components", type=int, default=80)
    parser.add_argument("--min-extent", type=int, default=12)
    parser.add_argument("--min-voxels", type=int, default=4_000)
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text())
    root = args.manifest.parent
    labels = np.load(root / manifest["labels"])["labels"]
    args.output_dir.mkdir(parents=True, exist_ok=True)

    rows = []
    for item in manifest["items"]:
        label = int(item["label"])
        mask = labels == label
        measured_voxels = int(mask.sum())
        if measured_voxels <= 0:
            rows.append({"label": label, "name": item["name"], "status": "failed", "reasons": ["empty"]})
            continue
        preview = args.output_dir / f"{label:02d}-{item['name']}-shape.png"
        surface_preview = args.output_dir / f"{label:02d}-{item['name']}-surface.png"
        render_label(mask, item, preview)
        render_surface(mask, item, surface_preview)
        reasons = reasons_for_shape(mask, item, args.max_components, args.min_extent, args.min_voxels)
        rows.append(
            {
                "label": label,
                "name": item["name"],
                "status": "review" if reasons else "ok",
                "reasons": reasons,
                "voxels": measured_voxels,
                "extentZYX": item.get("extentZYX"),
                "componentCount": item.get("componentCount"),
                "qualityStatus": item.get("qualityStatus"),
                "preview": str(preview),
                "surfacePreview": str(surface_preview),
            }
        )

    (args.output_dir / "shape-audit.json").write_text(json.dumps({"items": rows}, indent=2))
    save_contact_sheet(rows, args.output_dir / "shape-contact-sheet.png")
    save_surface_contact_sheet(rows, args.output_dir / "surface-contact-sheet.png")
    print(
        json.dumps(
            {
                "status": "ok",
                "items": len(rows),
                "shapeOk": sum(1 for row in rows if row["status"] == "ok"),
                "shapeReview": sum(1 for row in rows if row["status"] != "ok"),
                "output": str(args.output_dir),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
