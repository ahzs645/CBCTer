#!/usr/bin/env python3
import argparse
import json
from pathlib import Path

import numpy as np
import pydicom


def read_position(ds):
    position = getattr(ds, "ImagePositionPatient", None)
    if position and len(position) >= 3:
        return float(position[2])
    return float(getattr(ds, "InstanceNumber", 0))


def main():
    parser = argparse.ArgumentParser(
        description="Decode a DICOM slice folder into a browser-loadable raw Int16 volume."
    )
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    files = sorted(path for path in args.source.iterdir() if path.is_file())
    slices = []

    for path in files:
        try:
            ds = pydicom.dcmread(path)
        except Exception:
            continue

        if not hasattr(ds, "PixelData"):
            continue

        slices.append((read_position(ds), path, ds))

    if not slices:
        raise SystemExit(f"No DICOM slices found in {args.source}")

    slices.sort(key=lambda item: item[0])
    if args.limit:
        slices = slices[: args.limit]

    first = slices[0][2]
    rows = int(first.Rows)
    columns = int(first.Columns)
    slope = float(getattr(first, "RescaleSlope", 1))
    intercept = float(getattr(first, "RescaleIntercept", 0))
    spacing = [float(value) for value in getattr(first, "PixelSpacing", [1, 1])]
    slice_thickness = float(getattr(first, "SliceThickness", 1))
    volume = np.empty((len(slices), rows, columns), dtype=np.int16)

    for index, (_position, path, ds) in enumerate(slices, start=1):
        pixels = ds.pixel_array.astype(np.float32)
        hu = np.rint(pixels * slope + intercept)
        volume[index - 1] = np.clip(hu, -32768, 32767).astype(np.int16)
        if index % 25 == 0 or index == len(slices):
            print(f"decoded {index}/{len(slices)} {path.name}")

    args.target.mkdir(parents=True, exist_ok=True)
    raw_path = args.target / "volume-int16.raw"
    volume.tofile(raw_path)

    manifest = {
        "name": getattr(first, "SeriesDescription", None)
        or getattr(first, "StudyDescription", None)
        or "Sample CBCT",
        "source": str(args.source),
        "file": raw_path.name,
        "dtype": "int16",
        "byteOrder": "little-endian",
        "dimensions": {
            "width": columns,
            "height": rows,
            "depth": len(slices),
        },
        "spacing": {
            "x": spacing[1] if len(spacing) > 1 else spacing[0],
            "y": spacing[0],
            "z": slice_thickness,
        },
        "modality": getattr(first, "Modality", None),
        "manufacturer": getattr(first, "Manufacturer", None),
        "studyInstanceUid": getattr(first, "StudyInstanceUID", None),
        "seriesInstanceUid": getattr(first, "SeriesInstanceUID", None),
        "transferSyntaxUid": str(first.file_meta.TransferSyntaxUID),
        "fileCount": len(slices),
        "totalBytes": sum(path.stat().st_size for _position, path, _ds in slices),
        "scalarRange": [int(volume.min()), int(volume.max())],
        "window": {
            "center": 450,
            "width": 3000,
        },
    }

    with (args.target / "manifest.json").open("w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2)
        handle.write("\n")

    print(f"wrote {raw_path} ({raw_path.stat().st_size / 1024 / 1024:.1f} MB)")


if __name__ == "__main__":
    main()
