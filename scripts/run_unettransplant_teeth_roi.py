#!/usr/bin/env python3
"""Run UNetTransplant ToothFairy teeth head on a downsampled CBCT volume."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import nibabel as nib
import numpy as np
import torch
from scipy import ndimage as ndi


def load_numeric_state_into_named_model(model: torch.nn.Module, numeric_state: dict) -> None:
    named = model.state_dict()
    if len(named) != len(numeric_state):
        raise RuntimeError(f"state length mismatch: model={len(named)} checkpoint={len(numeric_state)}")
    remapped = {}
    for model_key, numeric_key in zip(named.keys(), sorted(numeric_state, key=lambda k: int(k)), strict=True):
        remapped[model_key] = numeric_state[numeric_key]
    model.load_state_dict(remapped, strict=True)


def resize_linear(volume: np.ndarray, shape: tuple[int, int, int]) -> np.ndarray:
    factors = [target / source for target, source in zip(shape, volume.shape)]
    return ndi.zoom(volume, factors, order=1)[: shape[0], : shape[1], : shape[2]]


def build_model(repo_root: Path, task_vector: Path) -> tuple[torch.nn.Module, torch.nn.Module]:
    sys.path.insert(0, str(repo_root.resolve()))
    from models.unet3d.unet3d import ResidualUNet3D  # noqa: PLC0415

    checkpoint = torch.load(task_vector, map_location="cpu", weights_only=False)
    merged = {
        key: checkpoint["pretrain_state_dict"][key] + checkpoint["delta_state_dict"][key]
        for key in checkpoint["pretrain_state_dict"]
    }

    backbone = ResidualUNet3D(in_channels=1, f_maps=64, dropout_prob=0.0)
    load_numeric_state_into_named_model(backbone, merged)
    backbone.eval()

    head_state = checkpoint["heads_state_dict"]
    head_weight = next(value for key, value in head_state.items() if key.endswith(".weight"))
    head_bias = next(value for key, value in head_state.items() if key.endswith(".bias"))
    head = torch.nn.Conv3d(head_weight.shape[1], head_weight.shape[0], kernel_size=1)
    head.weight.data.copy_(head_weight)
    head.bias.data.copy_(head_bias)
    head.eval()
    return backbone, head


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, default=Path("outputs/unettransplant-cbct-aug2025"))
    parser.add_argument("--repo-root", type=Path, default=Path("external/UNetTransplant"))
    parser.add_argument(
        "--task-vector",
        type=Path,
        default=Path("external/UNetTransplant-weights/ToothFairy/TaskVector_Teeth_ToothFairy2.pth"),
    )
    parser.add_argument("--shape", type=int, nargs=3, default=(128, 128, 128))
    parser.add_argument("--clip", type=float, nargs=2, default=None)
    parser.add_argument("--threshold", type=float, default=0.5)
    args = parser.parse_args()

    image = nib.load(str(args.input))
    volume = np.asanyarray(image.dataobj).astype(np.float32)
    target_shape = tuple(int(v) for v in args.shape)
    small = resize_linear(volume, target_shape)
    if args.clip is None:
        lo, hi = np.percentile(small, [0.5, 99.5])
    else:
        lo, hi = args.clip
    clipped = np.clip(small, lo, hi)
    normalized = (clipped - float(np.mean(clipped))) / max(float(np.std(clipped)), 1e-6)

    backbone, head = build_model(args.repo_root, args.task_vector)
    tensor = torch.from_numpy(normalized[None, None]).float()
    with torch.no_grad():
        logits = head(backbone(tensor))
        probs = torch.sigmoid(logits)[0, 0].cpu().numpy()

    mask = probs >= args.threshold
    output = args.output_dir
    output.mkdir(parents=True, exist_ok=True)
    mask_img = nib.Nifti1Image(mask.astype(np.uint8), np.eye(4))
    prob_img = nib.Nifti1Image(probs.astype(np.float32), np.eye(4))
    mask_path = output / "unettransplant_teeth_mask_downsampled.nii.gz"
    prob_path = output / "unettransplant_teeth_probs_downsampled.nii.gz"
    nib.save(mask_img, str(mask_path))
    nib.save(prob_img, str(prob_path))

    summary = {
        "status": "ok",
        "input": str(args.input),
        "taskVector": str(args.task_vector),
        "inputShape": list(volume.shape),
        "targetShape": list(target_shape),
        "clip": [float(lo), float(hi)],
        "normalization": "percentile-clip-0.5-99.5-then-zscore" if args.clip is None else "fixed-clip-then-zscore",
        "threshold": args.threshold,
        "probabilityRange": [float(probs.min()), float(probs.max())],
        "probabilityMean": float(probs.mean()),
        "positiveVoxels": int(np.count_nonzero(mask)),
        "positiveFraction": float(np.mean(mask)),
        "outputMask": str(mask_path),
        "outputProbabilities": str(prob_path),
        "note": "Downsampled CPU smoke/inference; output is coarse binary tooth mask, not FDI instances.",
    }
    (output / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
