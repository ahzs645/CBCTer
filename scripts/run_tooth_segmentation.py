#!/usr/bin/env python3
"""Run the Slicer CBCT tooth segmentation model against a local DICOM series."""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pydicom
import torch
from monai.inferers import SlidingWindowInferer
from monai.networks.layers import Norm
from monai.networks.layers.factories import Act
from monai.networks.nets import UNet
from monai.transforms import Compose, EnsureChannelFirst, NormalizeIntensity, SpatialPad
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from skimage.feature import peak_local_max
from skimage.measure import label, regionprops
from skimage.measure import marching_cubes
from skimage.segmentation import watershed


@dataclass(frozen=True)
class Roi:
    name: str
    bounds: tuple[int, int, int, int, int, int]


def collect_dicoms(dicom_dir: Path) -> list[Path]:
    files = [path for path in dicom_dir.rglob("*") if path.is_file()]
    dicoms: list[Path] = []
    for path in files:
        try:
            with path.open("rb") as handle:
                handle.seek(128)
                if handle.read(4) == b"DICM":
                    dicoms.append(path)
        except OSError:
            continue
    if not dicoms:
        raise RuntimeError(f"No DICOM files found under {dicom_dir}")
    return dicoms


def slice_position(ds: pydicom.Dataset) -> tuple[float, int]:
    image_position = getattr(ds, "ImagePositionPatient", None)
    if image_position is not None and len(image_position) >= 3:
        return float(image_position[2]), int(getattr(ds, "InstanceNumber", 0))
    return float(getattr(ds, "SliceLocation", 0.0)), int(getattr(ds, "InstanceNumber", 0))


def load_volume(dicom_dir: Path) -> tuple[np.ndarray, dict[str, object]]:
    records = []
    for path in collect_dicoms(dicom_dir):
        ds = pydicom.dcmread(path)
        records.append((slice_position(ds), path, ds))
    records.sort(key=lambda item: item[0])

    slices = []
    for _, _, ds in records:
        pixels = ds.pixel_array.astype(np.float32)
        slope = float(getattr(ds, "RescaleSlope", 1.0))
        intercept = float(getattr(ds, "RescaleIntercept", 0.0))
        slices.append((pixels * slope) + intercept)

    volume = np.stack(slices, axis=0).astype(np.float32)
    first = records[0][2]
    metadata = {
        "sliceCount": len(records),
        "shapeZYX": list(volume.shape),
        "modality": str(getattr(first, "Modality", "")),
        "manufacturer": str(getattr(first, "Manufacturer", "")),
        "model": str(getattr(first, "ManufacturerModelName", "")),
        "transferSyntax": str(first.file_meta.TransferSyntaxUID),
        "spacing": [
            *[float(x) for x in getattr(first, "PixelSpacing", [1, 1])],
            float(getattr(first, "SliceThickness", 1.0)),
        ],
        "seriesInstanceUID": str(getattr(first, "SeriesInstanceUID", "")),
    }
    return volume, metadata


def build_model(device: torch.device | str) -> UNet:
    return UNet(
        spatial_dims=3,
        in_channels=1,
        out_channels=2,
        channels=(16, 32, 64, 128),
        strides=(2, 2, 2, 2),
        num_res_units=2,
        act=Act.RELU,
        norm=Norm.BATCH,
        dropout=0.2,
    ).to(device)


def parse_roi(values: list[int], shape: tuple[int, int, int]) -> tuple[slice, slice, slice]:
    if len(values) != 6:
        raise ValueError("--roi must contain six integers: z0 y0 x0 z1 y1 x1")
    z0, y0, x0, z1, y1, x1 = values
    z0, y0, x0 = max(0, z0), max(0, y0), max(0, x0)
    z1, y1, x1 = min(shape[0], z1), min(shape[1], y1), min(shape[2], x1)
    if z1 <= z0 or y1 <= y0 or x1 <= x0:
        raise ValueError(f"Invalid ROI {values} for volume shape {shape}")
    return slice(z0, z1), slice(y0, y1), slice(x0, x1)


def crop_padding(mask: np.ndarray, original_shape: tuple[int, int, int]) -> np.ndarray:
    lower = [0, 0, 0]
    upper = [0, 0, 0]
    for i, dim in enumerate(original_shape):
        padding = 144 - dim
        if padding > 0:
            lower[i] = int(np.floor(padding / 2))
            upper[i] = -int(np.ceil(padding / 2))
        else:
            lower[i] = 0
            upper[i] = dim
    return mask[lower[0] : upper[0], lower[1] : upper[1], lower[2] : upper[2]]


def default_arch_rois(shape: tuple[int, int, int]) -> list[Roi]:
    """Bootstrap candidate tooth crops for the bundled sample CBCT.

    The Slicer model is an ROI model: it segments one tooth from a user-selected
    crop. These candidates are intentionally explicit and easy to revise from
    the UI later, instead of pretending the model is a full-mouth detector.
    """
    z0, z1 = 88, 224
    centers = [
        ("upper-left-molar-1", 205, 250, 80),
        ("upper-left-molar-2", 175, 330, 82),
        ("upper-left-premolar", 185, 175, 76),
        ("upper-incisor-left", 275, 108, 70),
        ("upper-incisor-right", 340, 108, 70),
        ("upper-right-premolar", 410, 142, 76),
        ("upper-right-molar-1", 465, 225, 82),
        ("upper-right-molar-2", 475, 310, 82),
        ("lower-right-molar", 500, 390, 84),
    ]
    rois = []
    for name, x_center, y_center, side in centers:
        half = side // 2
        x0 = x_center - half
        y0 = y_center - half
        rois.append(
            Roi(
                name,
                (
                    max(0, z0),
                    max(0, y0),
                    max(0, x0),
                    min(shape[0], z1),
                    min(shape[1], y0 + side),
                    min(shape[2], x0 + side),
                ),
            )
        )
    return rois


def dedupe_rois(rois: list[Roi], min_distance: float = 34.0) -> list[Roi]:
    kept: list[Roi] = []
    centers: list[tuple[float, float]] = []
    for roi in rois:
        z0, y0, x0, z1, y1, x1 = roi.bounds
        center = ((y0 + y1) / 2, (x0 + x1) / 2)
        if any(np.hypot(center[0] - y, center[1] - x) < min_distance for y, x in centers):
            continue
        kept.append(roi)
        centers.append(center)
    return kept


def make_roi_from_center(
    name: str,
    z_center: int,
    y_center: int,
    x_center: int,
    shape: tuple[int, int, int],
    z_size: int = 136,
    side: int = 82,
) -> Roi:
    z_half = z_size // 2
    half = side // 2
    z0 = max(0, z_center - z_half)
    z1 = min(shape[0], z0 + z_size)
    z0 = max(0, z1 - z_size)
    y0 = max(0, y_center - half)
    y1 = min(shape[1], y0 + side)
    y0 = max(0, y1 - side)
    x0 = max(0, x_center - half)
    x1 = min(shape[2], x0 + side)
    x0 = max(0, x1 - side)
    return Roi(name, (z0, y0, x0, z1, y1, x1))


def auto_detect_rois(volume: np.ndarray, max_rois: int = 18) -> list[Roi]:
    """Detect tooth-candidate crops from the volume without hard-coded centers.

    This is a heuristic detector for bootstrapping: it uses a high-density axial
    projection, watershed splitting, and dental-region geometry. The ROI model
    remains responsible for the final tooth mask inside each crop.
    """
    z_start = max(0, int(volume.shape[0] * 0.14))
    z_stop = min(volume.shape[0], int(volume.shape[0] * 0.64))
    slab = volume[z_start:z_stop]
    mip = slab.max(axis=0)
    candidates = []
    yy, xx = np.indices(mip.shape)
    dental_region = (
        (yy > 45)
        & (yy < int(volume.shape[1] * 0.72))
        & (xx > 80)
        & (xx < int(volume.shape[2] * 0.90))
    )
    for threshold in [1600, 2200, 2800, 3600, 5200]:
        threshold_mask = (mip > threshold) & dental_region
        threshold_mask = ndi.binary_opening(threshold_mask, iterations=1)
        for region in regionprops(label(threshold_mask), intensity_image=mip):
            min_y, min_x, max_y, max_x = region.bbox
            area = int(region.area)
            height = max_y - min_y
            width = max_x - min_x
            if area < 28 or area > 6_000 or height < 5 or width < 5 or height > 110 or width > 110:
                continue
            y_center, x_center = region.weighted_centroid
            if not (55 <= y_center <= 430 and 90 <= x_center <= 570):
                continue
            # Prefer compact, tooth-sized components; very bright metal can still
            # be useful because it often sits inside the tooth crop.
            compactness = area / max(height * width, 1)
            score = float(region.max_intensity) * np.sqrt(float(area)) * max(compactness, 0.15)
            candidates.append((score, int(round(y_center)), int(round(x_center)), area))

    candidates.sort(reverse=True)
    rois: list[Roi] = []
    for index, (_score, y_center, x_center, area) in enumerate(candidates[: max_rois * 2], start=1):
        z_profile = slab[:, max(0, y_center - 20) : y_center + 21, max(0, x_center - 20) : x_center + 21].max(axis=(1, 2))
        z_center = z_start + int(z_profile.argmax())
        side = 68 if area < 400 else 80 if area < 1_500 else 92
        rois.append(make_roi_from_center(f"auto-tooth-{index:02d}", z_center, y_center, x_center, volume.shape, side=side))

    return dedupe_rois(rois, min_distance=28.0)[:max_rois]


def hybrid_watershed_rois(
    volume: np.ndarray,
    spacing: list[float],
    max_rois: int = 32,
    threshold: int = 1350,
    min_distance: int = 16,
) -> list[Roi]:
    """Use hard-tissue watershed as a detector, then hand ROIs to the Slicer model.

    The Slicer extension expects one manually chosen crop per tooth. This function
    automates that first step: split dense dental anatomy into tooth-sized blobs,
    convert each accepted blob into an ROI, and let the learned model do the
    final binary segmentation inside each ROI.
    """
    shape = volume.shape
    yy, xx = np.indices(shape[1:])
    dental_region = (
        (yy > max(12, int(shape[1] * 0.07)))
        & (yy < int(shape[1] * 0.82))
        & (xx > max(12, int(shape[2] * 0.10)))
        & (xx < int(shape[2] * 0.92))
    )
    z_mask = np.zeros(shape[0], dtype=bool)
    z_mask[int(shape[0] * 0.10) : int(shape[0] * 0.74)] = True

    hard = (volume > threshold) & z_mask[:, None, None] & dental_region[None, :, :]
    hard = ndi.binary_opening(hard, iterations=1)
    hard = ndi.binary_closing(hard, iterations=1)
    hard = ndi.binary_fill_holes(hard)

    if not hard.any():
        return []

    sampling = (
        spacing[2] if len(spacing) > 2 else 1.0,
        spacing[0] if spacing else 1.0,
        spacing[1] if len(spacing) > 1 else 1.0,
    )
    distance = ndi.distance_transform_edt(hard, sampling=sampling)
    peaks = peak_local_max(
        distance,
        labels=hard,
        min_distance=min_distance,
        threshold_abs=1.0,
        exclude_border=False,
    )
    markers = np.zeros(shape, dtype=np.int32)
    for index, (z, y, x) in enumerate(peaks, start=1):
        markers[z, y, x] = index

    raw_labels = watershed(-distance, markers, mask=hard)
    candidates = []
    for region in regionprops(raw_labels):
        if region.area < 900 or region.area > 150_000:
            continue
        min_z, min_y, min_x, max_z, max_y, max_x = region.bbox
        extent = np.array([max_z - min_z, max_y - min_y, max_x - min_x])
        if extent.min() < 8 or extent[1] > 130 or extent[2] > 130:
            continue
        z, y, x = region.centroid
        if not (
            int(shape[0] * 0.10) <= z <= int(shape[0] * 0.76)
            and int(shape[1] * 0.07) <= y <= int(shape[1] * 0.82)
            and int(shape[2] * 0.10) <= x <= int(shape[2] * 0.92)
        ):
            continue
        score = float(region.area) * float(distance[raw_labels == region.label].max())
        side = int(np.clip(max(extent[1], extent[2]) + 30, 68, 104))
        z_size = int(np.clip(extent[0] + 44, 104, 144))
        candidates.append((score, int(round(z)), int(round(y)), int(round(x)), z_size, side))

    candidates.sort(reverse=True)
    rois = [
        make_roi_from_center(
            f"hybrid-tooth-{index:02d}",
            z,
            y,
            x,
            shape,
            z_size=z_size,
            side=side,
        )
        for index, (_score, z, y, x, z_size, side) in enumerate(candidates, start=1)
    ]
    return dedupe_rois(rois, min_distance=22.0)[:max_rois]


def parse_roi_values(values: list[str] | None, shape: tuple[int, int, int]) -> list[Roi]:
    if not values:
        return []
    if len(values) % 6 != 0:
        raise ValueError("--roi values must come in groups of six: z0 y0 x0 z1 y1 x1")
    rois = []
    for index in range(0, len(values), 6):
        bounds = tuple(int(value) for value in values[index : index + 6])
        parse_roi(list(bounds), shape)
        rois.append(Roi(f"roi-{index // 6 + 1}", bounds))
    return rois


def save_preview(volume: np.ndarray, labels: np.ndarray, output_dir: Path) -> None:
    mask = labels > 0
    z = int(mask.sum(axis=(1, 2)).argmax()) if mask.any() else volume.shape[0] // 2
    image = volume[z]
    lo, hi = np.percentile(image, [1, 99])
    base = np.clip((image - lo) / max(hi - lo, 1), 0, 1)
    rgb = np.stack([base, base, base], axis=-1)
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
    for label in sorted(int(value) for value in np.unique(labels) if value):
        overlay = labels[z] == label
        color = palette[(label - 1) % len(palette)]
        rgb[overlay] = 0.30 * rgb[overlay] + 0.70 * color
    Image.fromarray((rgb * 255).astype(np.uint8)).save(output_dir / "preview.png")


def save_instance_previews(
    volume: np.ndarray,
    labels: np.ndarray,
    instances: list[dict[str, object]],
    output_dir: Path,
) -> None:
    preview_dir = output_dir / "instances"
    preview_dir.mkdir(parents=True, exist_ok=True)
    for instance in instances:
        label = int(instance["label"])
        if label == 0:
            continue
        mask = labels == label
        if not mask.any():
            continue
        z = int(mask.sum(axis=(1, 2)).argmax())
        image = volume[z]
        lo, hi = np.percentile(image, [1, 99])
        base = np.clip((image - lo) / max(hi - lo, 1), 0, 1)
        rgb = np.stack([base, base, base], axis=-1)
        overlay = mask[z]
        rgb[overlay, 0] = 1.0
        rgb[overlay, 1] *= 0.25
        rgb[overlay, 2] *= 0.25
        safe_name = str(instance["name"]).replace("/", "-").replace(" ", "-")
        Image.fromarray((rgb * 255).astype(np.uint8)).save(
            preview_dir / f"{label:02d}-{safe_name}.png"
        )


def save_contact_sheet(output_dir: Path) -> None:
    paths = sorted((output_dir / "instances").glob("*.png"))
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
    sheet.save(output_dir / "contact-sheet.png")


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


def export_instance_stls(
    labels: np.ndarray,
    instances: list[dict[str, object]],
    output_dir: Path,
    spacing: list[float],
) -> None:
    stl_dir = output_dir / "stl"
    stl_dir.mkdir(parents=True, exist_ok=True)
    z_spacing = spacing[2] if len(spacing) > 2 else 1.0
    y_spacing = spacing[0] if spacing else 1.0
    x_spacing = spacing[1] if len(spacing) > 1 else y_spacing
    for instance in instances:
        label_value = int(instance["label"])
        if label_value == 0:
            continue
        bounds = np.argwhere(labels == label_value)
        if bounds.shape[0] < 8:
            continue
        z0, y0, x0 = bounds.min(axis=0)
        z1, y1, x1 = bounds.max(axis=0) + 1
        padded = np.pad(labels[z0:z1, y0:y1, x0:x1] == label_value, 1)
        vertices, faces, _normals, _values = marching_cubes(
            padded.astype(np.float32),
            level=0.5,
            spacing=(z_spacing, y_spacing, x_spacing),
        )
        vertices[:, 0] += (z0 - 1) * z_spacing
        vertices[:, 1] += (y0 - 1) * y_spacing
        vertices[:, 2] += (x0 - 1) * x_spacing
        # STL has no intrinsic axis semantics; write x,y,z in patient voxel spacing order.
        xyz_vertices = vertices[:, [2, 1, 0]]
        safe_name = str(instance["name"]).replace("/", "-").replace(" ", "-")
        stl_path = stl_dir / f"{label_value:02d}-{safe_name}.stl"
        write_ascii_stl(stl_path, xyz_vertices, faces)
        instance["stl"] = str(stl_path.relative_to(output_dir))


def run_inference(
    crop: np.ndarray,
    model: UNet,
    inferer: SlidingWindowInferer,
    pre_transforms: Compose,
    device: torch.device | str,
) -> np.ndarray:
    with torch.no_grad():
        tensor = torch.tensor(crop, dtype=torch.float32)
        processed = pre_transforms(tensor).to(device)
        output = inferer(processed, model)
        probabilities = torch.softmax(output, axis=1).detach().cpu().numpy()
        prediction = np.argmax(probabilities, axis=1).squeeze().astype(np.uint8)
    return crop_padding(prediction, crop.shape)


def keep_largest_component(mask: np.ndarray) -> np.ndarray:
    components, count = ndi.label(mask > 0)
    if count <= 1:
        return mask.astype(np.uint8)
    component_sizes = np.bincount(components.ravel())
    component_sizes[0] = 0
    largest = int(component_sizes.argmax())
    return (components == largest).astype(np.uint8)


def component_metrics(mask: np.ndarray) -> dict[str, object]:
    coords = np.argwhere(mask > 0)
    if coords.size == 0:
        return {
            "componentCount": 0,
            "centroidZYX": None,
            "bboxZYX": None,
            "extentZYX": None,
        }
    components, count = ndi.label(mask > 0)
    sizes = np.bincount(components.ravel())
    if sizes.size:
        sizes[0] = 0
    largest_component_voxels = int(sizes.max()) if sizes.size else int(coords.shape[0])
    min_corner = coords.min(axis=0)
    max_corner = coords.max(axis=0) + 1
    return {
        "componentCount": int(count),
        "largestComponentVoxels": largest_component_voxels,
        "centroidZYX": [round(float(value), 2) for value in coords.mean(axis=0)],
        "bboxZYX": [int(value) for value in [*min_corner, *max_corner]],
        "extentZYX": [int(value) for value in (max_corner - min_corner)],
    }


def prune_duplicate_instances(
    labels: np.ndarray,
    instances: list[dict[str, object]],
    min_centroid_distance: float,
) -> tuple[np.ndarray, list[dict[str, object]]]:
    accepted = [instance for instance in instances if instance["accepted"] and instance.get("centroidZYX")]
    accepted.sort(key=lambda item: int(item["assignedVoxels"]), reverse=True)
    kept: list[dict[str, object]] = []
    rejected_labels: set[int] = set()
    for instance in accepted:
        centroid = instance["centroidZYX"]
        yx = np.array([float(centroid[1]), float(centroid[2])])
        duplicate = False
        for kept_instance in kept:
            kept_centroid = kept_instance["centroidZYX"]
            kept_yx = np.array([float(kept_centroid[1]), float(kept_centroid[2])])
            if np.linalg.norm(yx - kept_yx) < min_centroid_distance:
                duplicate = True
                break
        if duplicate:
            instance["accepted"] = False
            instance["rejectionReason"] = "duplicate-centroid"
            rejected_labels.add(int(instance["label"]))
            instance["label"] = 0
            instance.pop("stl", None)
        else:
            kept.append(instance)

    if rejected_labels:
        for label_value in rejected_labels:
            labels[labels == label_value] = 0
        relabeled = np.zeros_like(labels)
        next_label = 1
        for instance in instances:
            label_value = int(instance["label"])
            if not instance["accepted"] or label_value == 0:
                continue
            relabeled[labels == label_value] = next_label
            instance["label"] = next_label
            next_label += 1
        labels = relabeled
    return labels, instances


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dicom-dir", required=True, type=Path)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--roi", nargs="+", metavar=("Z0"))
    parser.add_argument("--arch-rois", action="store_true", help="Run bundled sample arch candidate ROIs.")
    parser.add_argument("--auto-rois", action="store_true", help="Detect candidate tooth ROIs from the volume.")
    parser.add_argument("--hybrid-rois", action="store_true", help="Use watershed candidates refined by the ROI model.")
    parser.add_argument("--max-rois", type=int, default=18)
    parser.add_argument("--hybrid-threshold", type=int, default=1350)
    parser.add_argument("--hybrid-min-distance", type=int, default=16)
    parser.add_argument("--min-voxels", type=int, default=250)
    parser.add_argument("--max-voxels", type=int, default=150_000)
    parser.add_argument("--min-assigned-ratio", type=float, default=0.45)
    parser.add_argument("--min-instance-distance", type=float, default=24.0)
    parser.add_argument("--keep-all-components", action="store_true")
    parser.add_argument(
        "--slicer-exact",
        action="store_true",
        help="Match the Slicer extension path: segment every ROI as a single binary output without component pruning or candidate rejection.",
    )
    parser.add_argument("--export-stl", action="store_true")
    args = parser.parse_args()
    if args.slicer_exact:
        args.keep_all_components = True

    args.output_dir.mkdir(parents=True, exist_ok=True)
    volume, metadata = load_volume(args.dicom_dir)
    rois = parse_roi_values(args.roi, volume.shape)
    if args.arch_rois:
        rois.extend(default_arch_rois(volume.shape))
    if args.auto_rois:
        rois.extend(auto_detect_rois(volume, max_rois=args.max_rois))
    if args.hybrid_rois:
        rois.extend(
            hybrid_watershed_rois(
                volume,
                metadata["spacing"],
                max_rois=args.max_rois,
                threshold=args.hybrid_threshold,
                min_distance=args.hybrid_min_distance,
            )
        )
    rois = dedupe_rois(rois, min_distance=18.0)
    if not rois:
        raise SystemExit("Provide --roi z0 y0 x0 z1 y1 x1, --arch-rois, --auto-rois, or --hybrid-rois.")

    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    model = build_model(device)
    state_dict = torch.load(args.model, map_location=device)
    model.load_state_dict(state_dict, strict=True)
    model.eval()

    pre_transforms = Compose(
        [
            EnsureChannelFirst(channel_dim="no_channel"),
            NormalizeIntensity(),
            SpatialPad(spatial_size=[144, 144, 144], mode="reflect"),
            EnsureChannelFirst(channel_dim="no_channel"),
        ]
    )
    inferer = SlidingWindowInferer(roi_size=[96, 96, 96])

    labels = np.zeros(volume.shape, dtype=np.uint16)
    instances = []
    next_label = 1
    for roi in rois:
        roi_slices = parse_roi(list(roi.bounds), volume.shape)
        crop = volume[roi_slices].astype(np.float32)
        crop_mask = run_inference(crop, model, inferer, pre_transforms, device)
        raw_positive_voxels = int(crop_mask.sum())
        if not args.keep_all_components:
            crop_mask = keep_largest_component(crop_mask)
        positive_voxels = int(crop_mask.sum())
        target = labels[roi_slices]
        new_voxels = (crop_mask > 0) & (target == 0)
        assigned_voxels = int(new_voxels.sum())
        assigned_ratio = assigned_voxels / positive_voxels if positive_voxels else 0.0
        if args.slicer_exact:
            accepted = positive_voxels > 0 and assigned_voxels > 0
        else:
            accepted = (
                args.min_voxels <= positive_voxels <= args.max_voxels
                and assigned_voxels >= args.min_voxels
                and assigned_ratio >= args.min_assigned_ratio
            )
        if accepted:
            target[new_voxels] = next_label
            label = next_label
            next_label += 1
        else:
            label = 0
        full_instance_mask = np.zeros(volume.shape, dtype=np.uint8)
        if accepted:
            full_instance_mask[roi_slices][new_voxels] = 1
            metrics = component_metrics(full_instance_mask)
        else:
            metrics = component_metrics(crop_mask)
        instances.append(
            {
                "name": roi.name,
                "label": label,
                "roiZYX": list(roi.bounds),
                "positiveVoxels": positive_voxels,
                "rawPositiveVoxels": raw_positive_voxels,
                "assignedVoxels": assigned_voxels,
                "assignedRatio": round(assigned_ratio, 4),
                "accepted": accepted,
                **metrics,
            }
        )
        print(f"{roi.name}: {positive_voxels} voxels {'accepted' if accepted else 'rejected'}")

    if not args.slicer_exact:
        labels, instances = prune_duplicate_instances(labels, instances, args.min_instance_distance)
    binary_mask = (labels > 0).astype(np.uint8)
    np.save(args.output_dir / "mask.npy", binary_mask)
    np.save(args.output_dir / "labels.npy", labels)
    np.savez_compressed(args.output_dir / "labels.npz", labels=labels)
    save_preview(volume, labels, args.output_dir)
    save_instance_previews(volume, labels, instances, args.output_dir)
    save_contact_sheet(args.output_dir)
    if args.export_stl:
        export_instance_stls(labels, instances, args.output_dir, metadata["spacing"])

    summary = {
        "source": "hybrid-watershed-roi-model" if args.hybrid_rois else "sample-auto-segmentation",
        "summary": "summary.json",
        "preview": "preview.png",
        "contactSheet": "contact-sheet.png",
        "labels": "labels.npz",
        "dicom": metadata,
        "instances": instances,
        "items": [instance for instance in instances if instance["accepted"]],
        "maskShapeZYX": list(labels.shape),
        "positiveVoxels": int(binary_mask.sum()),
        "acceptedInstances": int(sum(1 for instance in instances if instance["accepted"])),
        "candidateCount": len(rois),
        "autoRois": bool(args.auto_rois),
        "hybridRois": bool(args.hybrid_rois),
        "archRois": bool(args.arch_rois),
        "hybridThreshold": args.hybrid_threshold,
        "hybridMinDistance": args.hybrid_min_distance,
        "minVoxels": args.min_voxels,
        "maxVoxels": args.max_voxels,
        "minAssignedRatio": args.min_assigned_ratio,
        "minInstanceDistance": args.min_instance_distance,
        "slicerExact": bool(args.slicer_exact),
        "exportStl": bool(args.export_stl),
        "device": str(device),
        "model": str(args.model),
    }
    (args.output_dir / "summary.json").write_text(json.dumps(summary, indent=2))
    (args.output_dir / "manifest.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
