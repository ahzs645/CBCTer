#!/usr/bin/env python3
"""Losslessly repackage a full classic v1 scan for the native v2 GPU bridge.

Classic scans already contain processed int16 values. Missing physical geometry
stays explicitly unknown, matching CBCTer's classic-to-chunked browser export.
The input archive is never modified. Requires numpy and zstandard.
"""
import argparse
import hashlib
import json
import zipfile
from pathlib import Path

import numpy as np
import zstandard as zstd


def sha(data):
    return hashlib.sha256(data).hexdigest()


def upgrade(source, output):
    source, output = Path(source), Path(output)
    if source.resolve() == output.resolve():
        raise ValueError("Use a new output path; preserve the original scan.")
    with zipfile.ZipFile(source) as original:
        manifest = json.loads(original.read("cbct-scan.json"))
        v = manifest["volume"]
        if (manifest.get("format"), manifest.get("version"), manifest.get("resolution"),
            v.get("dtype"), v.get("byteOrder"), v.get("layout")) != (
                "cbcter-scan", 1, "full", "int16", "little-endian", "x-fastest"):
            raise ValueError("Expected a full-resolution classic int16 CBCTer scan.")
        dims = v["dimensions"]
        if len(dims) != 3 or any(type(n) is not int or n <= 0 for n in dims):
            raise ValueError("Invalid dimensions")
        count = int(np.prod(dims))
        data = original.read(v["file"])
        if len(data) != count * 2:
            raise ValueError("Classic voxel byte count does not match dimensions")
        if v.get("encoding", "raw") == "byte-shuffle":
            encoded = np.frombuffer(data, np.uint8)
            words = (encoded[:count].astype(np.uint16) |
                     (encoded[count:].astype(np.uint16) << 8)).astype("<u2").view("<i2")
        elif v.get("encoding", "raw") == "raw":
            words = np.frombuffer(data, "<i2")
        else:
            raise ValueError("Unsupported classic voxel encoding")
        array = words.reshape(dims[::-1])
        # Never infer an origin or patient coordinate system from a v1 package.
        native = {"dimensions": dims, "spacing": v["spacing"], "dtype": "int16",
                  "bitsStored": 16, "paddingValue": v.get("paddingValue"),
                  "origin": [0, 0, 0], "direction": [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
                  "coordinateSystem": "unknown", "representation": "processed",
                  "calibration": {"divisor": 1, "slope": 1, "intercept": 0},
                  "byteOrder": "little-endian", "layout": "x-fastest",
                  "blockSize": [64, 64, 64], "codec": "zstd",
                  "filter": "x-delta-byte-shuffle", "sha256": sha(words.tobytes()), "chunks": []}
        preview = np.ascontiguousarray(array[::2, ::2, ::2])
        result = {k: manifest[k] for k in ["format", "name", "createdAt", "source", "display", "orientation"]}
        result.update(version=2, generator="CBCTer classic upgrade", volume=native,
                      scalarRange=v["scalarRange"], preview={
                          "file": "preview.i16", "dimensions": list(preview.shape[::-1]),
                          "spacing": [s * 2 for s in v["spacing"]], "dtype": "int16",
                          "encoding": "raw", "sha256": sha(preview.tobytes()),
                          "sampling": "nearest", "step": 2})
        output.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(output, "w") as archive:
            for z in range(0, dims[2], 64):
                for y in range(0, dims[1], 64):
                    for x in range(0, dims[0], 64):
                        block = np.ascontiguousarray(array[z:z+64, y:y+64, x:x+64])
                        rows = block.view("<u2").reshape(-1, block.shape[2])
                        delta = rows.copy()
                        delta[:, 1:] = rows[:, 1:] - rows[:, :-1]
                        flat = delta.ravel()
                        shuffled = np.concatenate([(flat & 255).astype(np.uint8), (flat >> 8).astype(np.uint8)])
                        compressed = zstd.ZstdCompressor(level=3).compress(shuffled.tobytes())
                        filename = f"chunks/{len(native['chunks'])}.zst"
                        archive.writestr(filename, compressed)
                        native["chunks"].append({"start": [x, y, z], "shape": list(block.shape[::-1]),
                                                 "file": filename, "bytes": len(compressed),
                                                 "sha256": sha(block.tobytes())})
            archive.writestr("preview.i16", preview.tobytes(), compress_type=zipfile.ZIP_DEFLATED)
            if "preview.png" in original.namelist():
                archive.writestr("preview.png", original.read("preview.png"))
            archive.writestr("cbct-scan.json", json.dumps(result, separators=(",", ":")))
    return {"output": str(output), "dimensions": dims, "sha256": native["sha256"],
            "coordinateSystem": "unknown", "representation": "processed"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("output")
    print(json.dumps(upgrade(**vars(parser.parse_args()))))
