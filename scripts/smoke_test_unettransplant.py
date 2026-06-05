#!/usr/bin/env python3
"""CPU smoke test for UNetTransplant ToothFairy task-vector weights."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import torch


def load_numeric_state_into_named_model(model: torch.nn.Module, numeric_state: dict) -> None:
    named = model.state_dict()
    if len(named) != len(numeric_state):
        raise RuntimeError(f"state length mismatch: model={len(named)} checkpoint={len(numeric_state)}")
    remapped = {}
    for model_key, numeric_key in zip(named.keys(), sorted(numeric_state, key=lambda k: int(k)), strict=True):
        remapped[model_key] = numeric_state[numeric_key]
    model.load_state_dict(remapped, strict=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path("external/UNetTransplant"),
    )
    parser.add_argument(
        "--task-vector",
        type=Path,
        default=Path("external/UNetTransplant-weights/ToothFairy/TaskVector_Teeth_ToothFairy2.pth"),
    )
    parser.add_argument("--output", type=Path, default=Path("outputs/unettransplant-smoke.json"))
    parser.add_argument("--patch-size", type=int, default=32)
    args = parser.parse_args()

    sys.path.insert(0, str(args.repo_root.resolve()))
    from models.unet3d.unet3d import ResidualUNet3D  # noqa: PLC0415

    checkpoint = torch.load(args.task_vector, map_location="cpu", weights_only=False)
    pretrain = checkpoint["pretrain_state_dict"]
    delta = checkpoint["delta_state_dict"]
    merged = {key: pretrain[key] + delta[key] for key in pretrain}

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

    patch = torch.zeros((1, 1, args.patch_size, args.patch_size, args.patch_size), dtype=torch.float32)
    with torch.no_grad():
        features = backbone(patch)
        logits = head(features)
        probs = torch.sigmoid(logits)

    result = {
        "status": "ok",
        "taskVector": str(args.task_vector),
        "task": [repr(task) for task in checkpoint.get("task", [])],
        "patchShape": list(patch.shape),
        "featureShape": list(features.shape),
        "logitShape": list(logits.shape),
        "probabilityRange": [float(probs.min()), float(probs.max())],
        "checkpointBytes": args.task_vector.stat().st_size,
        "note": "CPU smoke test only; output is binary ToothFairy teeth task, not FDI instances.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
