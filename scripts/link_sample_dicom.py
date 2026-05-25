#!/usr/bin/env python3
import json
from collections import Counter
from pathlib import Path

import pydicom

SOURCE = Path(
    "/Users/ahmadjalil/Library/CloudStorage/GoogleDrive-ahzs645@gmail.com/"
    "My Drive/Ahmad/Documents/Medical/CBCT/Aug 2025/DICOM/"
    "DICOMRM/20250826/13351841/20250826/132733"
)
TARGET = Path("public/sample-dicom")


def read_image_metadata(path: Path) -> pydicom.Dataset | None:
    if (
        not path.is_file()
        or path.name.startswith(".")
        or path.name.startswith("COMP")
        or path.name in {"DICOMDIR"}
    ):
        return None

    try:
        data_set = pydicom.dcmread(path, stop_before_pixels=True, force=True)
    except Exception:
        return None

    if not (
        getattr(data_set, "SOPInstanceUID", None)
        and getattr(data_set, "Rows", None)
        and getattr(data_set, "Columns", None)
        and getattr(data_set, "SeriesInstanceUID", None)
    ):
        return None

    return data_set


def link_name(path: Path) -> str:
    relative = path.relative_to(SOURCE)
    return "__".join(relative.parts)


def main():
    TARGET.mkdir(parents=True, exist_ok=True)
    for path in TARGET.iterdir():
        if path.is_symlink():
            path.unlink()

    candidates: list[tuple[Path, pydicom.Dataset]] = []
    for path in sorted(SOURCE.rglob("*")):
        data_set = read_image_metadata(path)
        if data_set is not None:
            candidates.append((path, data_set))

    series_counts = Counter(
        (str(data_set.SeriesInstanceUID), int(data_set.Rows), int(data_set.Columns))
        for _, data_set in candidates
    )
    if not series_counts:
        raise RuntimeError(f"No DICOM image series found under {SOURCE}")

    selected_series, _ = series_counts.most_common(1)[0]
    files = [
        path
        for path, data_set in candidates
        if (str(data_set.SeriesInstanceUID), int(data_set.Rows), int(data_set.Columns))
        == selected_series
    ]

    for path in files:
        link = TARGET / link_name(path)
        if link.exists() or link.is_symlink():
            link.unlink()
        link.symlink_to(path)

    with (TARGET / "manifest.json").open("w", encoding="utf-8") as handle:
        json.dump({"files": [link_name(path) for path in files]}, handle, indent=2)
        handle.write("\n")

    print(f"linked {len(files)} DICOM files into {TARGET}")


if __name__ == "__main__":
    main()
