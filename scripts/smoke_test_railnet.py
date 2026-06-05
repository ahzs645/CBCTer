#!/usr/bin/env python3
"""CPU smoke test for the RAIL/RailNet Hugging Face checkpoint.

This does not run full-volume inference. The upstream demo hardcodes CUDA in
model construction and patch inference, so this script monkeypatches those CUDA
calls to no-ops and verifies that the downloaded weights can be loaded and a
single ROI-sized patch can run on CPU.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import h5py
import numpy as np
import torch


def patch_cuda_to_cpu() -> None:
    torch.nn.Module.cuda = lambda self, *args, **kwargs: self  # type: ignore[method-assign]
    torch.Tensor.cuda = lambda self, *args, **kwargs: self  # type: ignore[method-assign]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rail-root", type=Path, default=Path("external/RAIL-HF"))
    parser.add_argument(
        "--sample",
        type=Path,
        default=Path("external/RAIL-HF/example_input_file/CBCT_01.h5"),
    )
    parser.add_argument("--output", type=Path, default=Path("outputs/railnet-smoke.json"))
    args = parser.parse_args()

    patch_cuda_to_cpu()
    sys.path.insert(0, str(args.rail_root.resolve()))
    from railnet_model import RailNetSystem  # noqa: PLC0415

    model = RailNetSystem(n_channels=1, n_classes=2, normalization="batchnorm")
    weights = args.rail_root / "model weights"
    model.net_roi.load_state_dict(
        torch.load(weights / "roi_best_model.pth", map_location="cpu", weights_only=True)
    )
    model.model_array[0].load_state_dict(
        torch.load(weights / "rail_0_iter_7995_best.pth", map_location="cpu", weights_only=True)
    )
    model.net_roi.eval()
    model.model_array[0].eval()

    sample_summary = None
    if args.sample.exists():
        with h5py.File(args.sample, "r") as handle:
            sample_summary = {
                "keys": sorted(handle.keys()),
                "imageShape": list(handle["image"].shape) if "image" in handle else None,
                "labelShape": list(handle["label"].shape) if "label" in handle else None,
                "imageDtype": str(handle["image"].dtype) if "image" in handle else None,
                "labelDtype": str(handle["label"].dtype) if "label" in handle else None,
            }

    patch = torch.zeros((1, 1, 112, 112, 80), dtype=torch.float32)
    with torch.no_grad():
      roi_logits = model.net_roi(patch)
      rail_logits = model.model_array[0](patch)

    result = {
        "railRoot": str(args.rail_root),
        "sample": sample_summary,
        "roiOutputShape": list(roi_logits.shape),
        "railOutputShape": list(rail_logits.shape),
        "roiCheckpointBytes": (weights / "roi_best_model.pth").stat().st_size,
        "rail0CheckpointBytes": (weights / "rail_0_iter_7995_best.pth").stat().st_size,
        "status": "ok",
        "note": "CPU one-patch smoke test only; full-volume upstream inference remains CUDA-oriented and binary tooth-mask output.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
