#!/usr/bin/env python3
"""Export a DentalSegmentator-family nnU-Net (3d_fullres) to ONNX for onnxruntime-web.

Reconstructs the network from the model's ``plans.json``, loads
``fold_0/checkpoint_final.pth`` weights with ``strict=True`` (which validates the
architecture matches the weights), disables deep supervision, and exports a
single-output (logits) ONNX graph at the plans patch size.

Supports three model variants, auto-detected from the plans:
  - **base** DentalSegmentator (PlainConvUNet, classic plans format) —
    Dataset112, Zenodo DOI 10.5281/zenodo.10829674 (CC-BY-4.0).
  - **PediatricDentalSegmentator** (PlainConvUNet, newer plans format) —
    SADT release ``PEDIATRICDENTALSEG_MODEL``.
  - **UniversalLabDentalSegmentator** (ResidualEncoderUNet / nnUNetResEncUNetLPlans,
    55 classes = per-tooth FDI) — SADT release ``UNIVERSALLAB_MODEL``.

Pediatric/Universal weights are under the 3D Slicer Software License Agreement
(see THIRD_PARTY_NOTICES.md), not CC-BY. Download + unzip, then point
``--model-dir`` at the ``..._3d_fullres`` folder.

Requirements: ``pip install torch dynamic_network_architectures onnx``.

Usage (or use the npm scripts segment:export-dentalseg[-pediatric|-universal]):
    python scripts/export_dentalseg_onnx.py \
        --model-dir /path/to/Dataset.../nnUNetTrainer__..._3d_fullres \
        --output public/models/dentalsegmentator.onnx
"""
import argparse
import json
import os

import torch
from dynamic_network_architectures.architectures.unet import PlainConvUNet


def build_network(plans: dict, dataset: dict) -> torch.nn.Module:
    cfg = plans["configurations"]["3d_fullres"]
    num_classes = len(dataset["labels"])  # includes background
    input_channels = len(dataset["channel_names"])

    if "architecture" in cfg:
        # Newer nnU-Net plans format (e.g. AMASSS, Pediatric, Universal):
        # everything is explicit in architecture.arch_kwargs.
        ak = cfg["architecture"]["arch_kwargs"]
        class_name = cfg["architecture"].get("network_class_name", "")
        # The UniversalLab model is a ResidualEncoderUNet (nnUNetResEncUNetLPlans),
        # which takes n_blocks_per_stage instead of PlainConvUNet's n_conv_per_stage.
        is_resenc = "Residual" in class_name or "n_blocks_per_stage" in ak
        common = dict(
            input_channels=input_channels,
            n_stages=ak["n_stages"],
            features_per_stage=ak["features_per_stage"],
            conv_op=torch.nn.Conv3d,
            kernel_sizes=[tuple(k) for k in ak["kernel_sizes"]],
            strides=[tuple(s) for s in ak["strides"]],
            num_classes=num_classes,
            n_conv_per_stage_decoder=ak["n_conv_per_stage_decoder"],
            conv_bias=ak.get("conv_bias", True),
            norm_op=torch.nn.InstanceNorm3d,
            norm_op_kwargs=ak.get("norm_op_kwargs", {"eps": 1e-5, "affine": True}),
            dropout_op=None,
            nonlin=torch.nn.LeakyReLU,
            nonlin_kwargs=ak.get("nonlin_kwargs", {"inplace": True}),
            deep_supervision=False,
        )
        if is_resenc:
            # ResidualEncoderUNet moved modules across versions — try both paths.
            try:
                from dynamic_network_architectures.architectures.residual_unet import (
                    ResidualEncoderUNet,
                )
            except ImportError:  # pragma: no cover - version shim
                from dynamic_network_architectures.architectures.unet import (
                    ResidualEncoderUNet,
                )
            extra = {}
            # nnUNetResEncUNetLPlans uses the default BasicBlockD; pass through the
            # optional bottleneck/stem hints only when the plans specify them.
            for key in ("bottleneck_channels", "stem_channels"):
                if key in ak:
                    extra[key] = ak[key]
            return ResidualEncoderUNet(
                n_blocks_per_stage=ak["n_blocks_per_stage"],
                **common,
                **extra,
            )
        return PlainConvUNet(n_conv_per_stage=ak["n_conv_per_stage"], **common)

    # Older format (e.g. DentalSegmentator): derive from top-level keys.
    n_stages = len(cfg["conv_kernel_sizes"])
    base = cfg["UNet_base_num_features"]
    max_features = cfg["unet_max_num_features"]
    features_per_stage = [min(base * 2 ** i, max_features) for i in range(n_stages)]
    return PlainConvUNet(
        input_channels=input_channels,
        n_stages=n_stages,
        features_per_stage=features_per_stage,
        conv_op=torch.nn.Conv3d,
        kernel_sizes=[tuple(k) for k in cfg["conv_kernel_sizes"]],
        strides=[tuple(s) for s in cfg["pool_op_kernel_sizes"]],
        n_conv_per_stage=cfg["n_conv_per_stage_encoder"],
        num_classes=num_classes,
        n_conv_per_stage_decoder=cfg["n_conv_per_stage_decoder"],
        conv_bias=True,
        norm_op=torch.nn.InstanceNorm3d,
        norm_op_kwargs={"eps": 1e-5, "affine": True},
        dropout_op=None,
        nonlin=torch.nn.LeakyReLU,
        nonlin_kwargs={"inplace": True},
        deep_supervision=False,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--output", default="public/models/dentalsegmentator.onnx")
    parser.add_argument("--opset", type=int, default=17)
    args = parser.parse_args()

    plans = json.load(open(os.path.join(args.model_dir, "plans.json")))
    dataset = json.load(open(os.path.join(args.model_dir, "dataset.json")))
    cfg = plans["configurations"]["3d_fullres"]
    patch = cfg["patch_size"]

    network = build_network(plans, dataset)
    ckpt = torch.load(
        os.path.join(args.model_dir, "fold_0", "checkpoint_final.pth"),
        map_location="cpu",
        weights_only=False,
    )
    state = ckpt["network_weights"] if "network_weights" in ckpt else ckpt
    network.load_state_dict(state, strict=True)  # validates architecture
    network.eval()

    dummy = torch.zeros(1, len(dataset["channel_names"]), *patch, dtype=torch.float32)
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)

    # torch 2.x dynamo export writes weights to an external .data sidecar; export
    # to a temp path, then re-save as a single self-contained .onnx so it can be
    # staged for onnxruntime-web as one file.
    import glob
    import onnx

    tmp = args.output + ".tmp.onnx"
    with torch.no_grad():
        torch.onnx.export(
            network,
            dummy,
            tmp,
            input_names=["input"],
            output_names=["logits"],
            opset_version=args.opset,
            dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}},
        )
    model = onnx.load(tmp)  # pulls in any external .data
    onnx.checker.check_model(model)
    onnx.save_model(model, args.output, save_as_external_data=False)
    for leftover in glob.glob(tmp + "*"):
        os.remove(leftover)

    size_mb = os.path.getsize(args.output) / 1e6
    print(f"Exported {args.output} ({size_mb:.1f} MB), patch {patch}, "
          f"{len(dataset['labels'])} classes")


if __name__ == "__main__":
    main()
