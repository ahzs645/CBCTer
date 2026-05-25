#!/usr/bin/env python3
"""Export the MONAI tooth-segmentation UNet to ONNX for fully client-side
inference with onnxruntime-web.

Architecture mirrors SlicerCBCTToothSegmentation exactly:
    UNet(spatial_dims=3, in_channels=1, out_channels=2,
         channels=(16,32,64,128), strides=(2,2,2,2),
         num_res_units=2, act=RELU, norm=BATCH, dropout=0.2)

The model is fully convolutional, but we export a fixed 96x96x96 input to
match the reference SlidingWindowInferer(roi_size=[96,96,96]); the browser
tiles the padded ROI into 96^3 windows and runs this graph per window.
"""
import argparse
from pathlib import Path

import numpy as np
import torch
from monai.networks.layers import Norm
from monai.networks.layers.factories import Act
from monai.networks.nets import UNet

ROI = 96


def build_model() -> torch.nn.Module:
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
    )


def load_weights(model: torch.nn.Module, weights_path: Path) -> None:
    loaded = torch.load(weights_path, map_location="cpu", weights_only=False)
    if isinstance(loaded, dict) and "state_dict" in loaded:
        loaded = loaded["state_dict"]
    if isinstance(loaded, torch.nn.Module):
        loaded = loaded.state_dict()

    expected = set(model.state_dict().keys())

    def remap(transform) -> dict:
        return {transform(k): v for k, v in loaded.items()}

    # MONAI's UNet nests layers under a `model.` Sequential. Checkpoints may
    # store keys with or without that prefix (and sometimes a `module.` wrap).
    candidates = {
        "as-is": remap(lambda k: k),
        "strip module.": remap(
            lambda k: k[len("module."):] if k.startswith("module.") else k
        ),
        "add model.": remap(
            lambda k: k if k.startswith("model.") else f"model.{k}"
        ),
    }

    best_name, best = max(
        candidates.items(),
        key=lambda item: len(expected & set(item[1].keys())),
    )
    overlap = len(expected & set(best.keys()))
    print(f"Key mapping '{best_name}' matches {overlap}/{len(expected)} keys.")

    result = model.load_state_dict(best, strict=False)
    if result.missing_keys or result.unexpected_keys:
        print("missing:", len(result.missing_keys))
        print("unexpected:", len(result.unexpected_keys))
        raise SystemExit("Weights did not fully load; aborting export.")
    print("Loaded weights (all keys matched).")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--weights",
        type=Path,
        default=Path("models/model-toothcrops-CBCT-normalize_best.pth"),
    )
    parser.add_argument(
        "--output", type=Path, default=Path("public/models/tooth-unet-96.onnx")
    )
    args = parser.parse_args()

    model = build_model()
    load_weights(model, args.weights)
    model.eval()

    dummy = torch.randn(1, 1, ROI, ROI, ROI, dtype=torch.float32)
    args.output.parent.mkdir(parents=True, exist_ok=True)

    torch.onnx.export(
        model,
        dummy,
        str(args.output),
        input_names=["input"],
        output_names=["logits"],
        opset_version=17,
        dynamo=False,
    )
    print(f"Exported ONNX to {args.output} "
          f"({args.output.stat().st_size / 1024 / 1024:.2f} MB)")

    # Parity check: torch vs onnxruntime on the same input.
    import onnxruntime as ort

    with torch.no_grad():
        torch_out = model(dummy).numpy()

    session = ort.InferenceSession(
        str(args.output), providers=["CPUExecutionProvider"]
    )
    ort_out = session.run(["logits"], {"input": dummy.numpy()})[0]

    max_abs = float(np.max(np.abs(torch_out - ort_out)))
    print(f"Parity max abs diff (torch vs onnxruntime): {max_abs:.3e}")
    if max_abs > 1e-3:
        raise SystemExit("Parity check FAILED (diff too large).")
    print("Parity check passed.")


if __name__ == "__main__":
    main()
