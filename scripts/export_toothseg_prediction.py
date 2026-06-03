#!/usr/bin/env python3
"""Export a ToothSeg final prediction into CBCTer's tooth-library format."""

from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path

import numpy as np
import pydicom
import SimpleITK as sitk
from PIL import Image, ImageDraw
from skimage.measure import marching_cubes


TOOTHSEG_LABELS = {
    1: ("Upper Right Central Incisor", 11),
    2: ("Upper Right Lateral Incisor", 12),
    3: ("Upper Right Canine", 13),
    4: ("Upper Right First Premolar", 14),
    5: ("Upper Right Second Premolar", 15),
    6: ("Upper Right First Molar", 16),
    7: ("Upper Right Second Molar", 17),
    8: ("Upper Right Third Molar", 18),
    9: ("Upper Left Central Incisor", 21),
    10: ("Upper Left Lateral Incisor", 22),
    11: ("Upper Left Canine", 23),
    12: ("Upper Left First Premolar", 24),
    13: ("Upper Left Second Premolar", 25),
    14: ("Upper Left First Molar", 26),
    15: ("Upper Left Second Molar", 27),
    16: ("Upper Left Third Molar", 28),
    17: ("Lower Left Central Incisor", 31),
    18: ("Lower Left Lateral Incisor", 32),
    19: ("Lower Left Canine", 33),
    20: ("Lower Left First Premolar", 34),
    21: ("Lower Left Second Premolar", 35),
    22: ("Lower Left First Molar", 36),
    23: ("Lower Left Second Molar", 37),
    24: ("Lower Left Third Molar", 38),
    25: ("Lower Right Central Incisor", 41),
    26: ("Lower Right Lateral Incisor", 42),
    27: ("Lower Right Canine", 43),
    28: ("Lower Right First Premolar", 44),
    29: ("Lower Right Second Premolar", 45),
    30: ("Lower Right First Molar", 46),
    31: ("Lower Right Second Molar", 47),
    32: ("Lower Right Third Molar", 48),
}


def collect_dicoms(dicom_dir: Path) -> list[pydicom.Dataset]:
    records = []
    for path in dicom_dir.rglob("*"):
        if not path.is_file():
            continue
        try:
            ds = pydicom.dcmread(str(path))
        except Exception:
            continue
        pos = getattr(ds, "ImagePositionPatient", None)
        key = float(pos[2]) if pos is not None and len(pos) >= 3 else float(getattr(ds, "InstanceNumber", 0))
        records.append((key, ds))
    records.sort(key=lambda item: item[0])
    if not records:
        raise RuntimeError(f"No DICOM files found under {dicom_dir}")
    return [ds for _, ds in records]


def load_volume(dicom_dir: Path) -> tuple[np.ndarray, list[float], dict[str, object]]:
    slices = collect_dicoms(dicom_dir)
    planes = []
    for ds in slices:
        slope = float(getattr(ds, "RescaleSlope", 1.0))
        intercept = float(getattr(ds, "RescaleIntercept", 0.0))
        planes.append((ds.pixel_array.astype(np.float32) * slope + intercept).astype(np.int16))
    volume = np.stack(planes, axis=0)
    first = slices[0]
    sy, sx = [float(v) for v in getattr(first, "PixelSpacing", [1, 1])]
    if len(slices) > 1 and hasattr(slices[0], "ImagePositionPatient") and hasattr(slices[1], "ImagePositionPatient"):
        sz = abs(float(slices[1].ImagePositionPatient[2]) - float(slices[0].ImagePositionPatient[2]))
    else:
        sz = float(getattr(first, "SliceThickness", sy))
    meta = {
        "sliceCount": len(slices),
        "shapeZYX": list(volume.shape),
        "modality": str(getattr(first, "Modality", "")),
        "manufacturer": str(getattr(first, "Manufacturer", "")),
        "model": str(getattr(first, "ManufacturerModelName", "")),
        "transferSyntax": str(first.file_meta.TransferSyntaxUID),
        "spacing": [sx, sy, sz],
        "seriesInstanceUID": str(getattr(first, "SeriesInstanceUID", "")),
    }
    return volume, [sx, sy, sz], meta


def normalize_slice(image: np.ndarray) -> np.ndarray:
    lo, hi = np.percentile(image, [1, 99])
    return np.clip((image - lo) / max(float(hi - lo), 1.0), 0, 1)


def smooth_vertices(
    vertices: np.ndarray,
    faces: np.ndarray,
    iterations: int,
    pass_band: tuple[float, float] = (0.5, -0.53),
) -> np.ndarray:
    """Taubin-style smoothing keeps tooth meshes less blocky without heavy shrinkage."""
    if iterations <= 0 or len(vertices) == 0 or len(faces) == 0:
        return vertices

    face_edges = np.vstack(
        (
            faces[:, [0, 1]],
            faces[:, [1, 2]],
            faces[:, [2, 0]],
        )
    ).astype(np.int64, copy=False)
    directed_edges = np.vstack((face_edges, face_edges[:, ::-1]))
    directed_edges = np.unique(directed_edges, axis=0)
    source = directed_edges[:, 0]
    target = directed_edges[:, 1]
    neighbor_counts = np.bincount(source, minlength=len(vertices)).astype(np.float64)

    smoothed = vertices.astype(np.float64, copy=True)
    for _ in range(iterations):
        for factor in pass_band:
            neighbor_sums = np.zeros_like(smoothed)
            np.add.at(neighbor_sums, source, smoothed[target])
            movable = neighbor_counts > 0
            neighbor_mean = smoothed.copy()
            neighbor_mean[movable] = neighbor_sums[movable] / neighbor_counts[movable, None]
            smoothed = smoothed + factor * (neighbor_mean - smoothed)
    return smoothed.astype(vertices.dtype, copy=False)


def write_binary_stl(path: Path, vertices: np.ndarray, faces: np.ndarray) -> None:
    triangles = vertices[faces].astype("<f4", copy=False)
    normals = np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0])
    norms = np.linalg.norm(normals, axis=1)
    nonzero = norms > 0
    normals[nonzero] = normals[nonzero] / norms[nonzero, None]
    normals = normals.astype("<f4", copy=False)

    records = np.zeros(
        len(faces),
        dtype=np.dtype(
            [
                ("normal", "<f4", (3,)),
                ("vertices", "<f4", (3, 3)),
                ("attribute_byte_count", "<u2"),
            ]
        ),
    )
    records["normal"] = normals
    records["vertices"] = triangles
    header = f"CBCTer ToothSeg smoothed STL {path.stem}".encode("ascii", errors="ignore")[:80]
    with path.open("wb") as handle:
        handle.write(header.ljust(80, b"\0"))
        handle.write(struct.pack("<I", len(faces)))
        handle.write(records.tobytes())


def save_instance_preview(volume: np.ndarray, labels: np.ndarray, value: int, output: Path) -> None:
    mask = labels == value
    z = int(mask.sum(axis=(1, 2)).argmax())
    rgb = np.repeat(normalize_slice(volume[z])[..., None], 3, axis=2)
    rgb[mask[z], 0] = 1.0
    rgb[mask[z], 1] *= 0.25
    rgb[mask[z], 2] *= 0.25
    Image.fromarray((rgb * 255).astype(np.uint8)).save(output)


def export_stl(
    labels: np.ndarray,
    value: int,
    spacing_xyz: list[float],
    output: Path,
    smooth_iterations: int,
) -> None:
    coords = np.argwhere(labels == value)
    z0, y0, x0 = coords.min(axis=0)
    z1, y1, x1 = coords.max(axis=0) + 1
    padded = np.pad(labels[z0:z1, y0:y1, x0:x1] == value, 1)
    vertices, faces, _normals, _values = marching_cubes(
        padded.astype(np.float32),
        level=0.5,
        spacing=(spacing_xyz[2], spacing_xyz[1], spacing_xyz[0]),
    )
    vertices[:, 0] += (z0 - 1) * spacing_xyz[2]
    vertices[:, 1] += (y0 - 1) * spacing_xyz[1]
    vertices[:, 2] += (x0 - 1) * spacing_xyz[0]
    vertices = smooth_vertices(vertices, faces, smooth_iterations)
    write_binary_stl(output, vertices[:, [2, 1, 0]], faces)


def save_contact_sheet(paths: list[Path], output: Path) -> None:
    tiles = []
    for path in paths:
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
    parser.add_argument("--prediction", type=Path, required=True)
    parser.add_argument("--dicom-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--min-voxels", type=int, default=1000)
    parser.add_argument(
        "--smooth-iterations",
        type=int,
        default=8,
        help="Taubin smoothing iterations applied to exported tooth STL meshes.",
    )
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "instances").mkdir(exist_ok=True)
    (args.output_dir / "stl").mkdir(exist_ok=True)

    labels = sitk.GetArrayFromImage(sitk.ReadImage(str(args.prediction))).astype(np.uint16)
    volume, spacing, dicom_meta = load_volume(args.dicom_dir)
    if labels.shape != volume.shape:
        raise RuntimeError(f"Prediction shape {labels.shape} does not match DICOM volume {volume.shape}")

    np.savez_compressed(args.output_dir / "labels.npz", labels=labels)
    items = []
    preview_paths = []
    for value in sorted(int(v) for v in np.unique(labels) if v):
        voxels = int((labels == value).sum())
        if voxels < args.min_voxels:
            continue
        coords = np.argwhere(labels == value)
        z0, y0, x0 = coords.min(axis=0)
        z1, y1, x1 = coords.max(axis=0) + 1
        name, fdi = TOOTHSEG_LABELS.get(value, (f"ToothSeg class {value}", value))
        safe = name.lower().replace(" ", "-").replace("(", "").replace(")", "")
        preview = args.output_dir / "instances" / f"{value:02d}-fdi-{fdi}-{safe}.png"
        stl = args.output_dir / "stl" / f"{value:02d}-fdi-{fdi}-{safe}.stl"
        save_instance_preview(volume, labels, value, preview)
        export_stl(labels, value, spacing, stl, args.smooth_iterations)
        preview_paths.append(preview)
        items.append(
            {
                "label": value,
                "name": f"FDI {fdi} · {name}",
                "preview": str(preview.relative_to(args.output_dir)),
                "stl": str(stl.relative_to(args.output_dir)),
                "assignedVoxels": voxels,
                "centroidZYX": [round(float(v), 2) for v in coords.mean(axis=0)],
                "bboxZYX": [int(v) for v in [z0, y0, x0, z1, y1, x1]],
                "extentZYX": [int(v) for v in [z1 - z0, y1 - y0, x1 - x0]],
                "qualityStatus": "accepted",
                "qualityScore": 1,
                "fdi": fdi,
                "fdiName": name,
                "quadrant": fdi // 10,
            }
        )

    save_contact_sheet(preview_paths, args.output_dir / "contact-sheet.png")
    # Use the axial slice with the largest labeled area for the global preview.
    z = int((labels > 0).sum(axis=(1, 2)).argmax())
    rgb = np.repeat(normalize_slice(volume[z])[..., None], 3, axis=2)
    palette = np.array(
        [[0.95, 0.12, 0.16], [0.10, 0.68, 0.92], [0.20, 0.86, 0.35], [0.98, 0.76, 0.18], [0.68, 0.38, 0.95]]
    )
    for value in sorted(int(v) for v in np.unique(labels[z]) if v):
        mask = labels[z] == value
        rgb[mask] = 0.28 * rgb[mask] + 0.72 * palette[value % len(palette)]
    Image.fromarray((rgb * 255).astype(np.uint8)).save(args.output_dir / "preview.png")

    manifest = {
        "source": "toothseg-toothfairy2",
        "summary": "summary.json",
        "preview": "preview.png",
        "contactSheet": "contact-sheet.png",
        "labels": "labels.npz",
        "dicom": dicom_meta,
        "acceptedInstances": len(items),
        "candidateCount": len(items),
        "positiveVoxels": int((labels > 0).sum()),
        "qualityAccepted": len(items),
        "qualityReview": 0,
        "spacing": spacing,
        "meshSmoothing": {
            "method": "taubin-laplacian",
            "iterations": args.smooth_iterations,
            "lambda": 0.5,
            "mu": -0.53,
        },
        "items": items,
    }
    (args.output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    (args.output_dir / "summary.json").write_text(json.dumps(manifest, indent=2))
    print(json.dumps({"output": str(args.output_dir), "items": len(items)}, indent=2))


if __name__ == "__main__":
    main()
