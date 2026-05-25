#!/usr/bin/env python3
"""Validate that the browser pipeline (normalize -> reflect-pad to 144 ->
96^3 sliding window -> onnxruntime -> softmax -> threshold), reimplemented
here in numpy/onnxruntime exactly as in toothSeg.worker.ts, matches the
reference MONAI SlidingWindowInferer pipeline used by the Slicer module.
"""
import math

import numpy as np
import onnxruntime as ort
import torch
from monai.inferers import SlidingWindowInferer
from monai.networks.layers import Norm
from monai.networks.layers.factories import Act
from monai.networks.nets import UNet
from monai.transforms import Compose, EnsureChannelFirst, NormalizeIntensity, SpatialPad

WINDOW, MIN_PAD, OVERLAP = 96, 144, 0.25


def window_starts(size):
    if size <= WINDOW:
        return [0]
    interval = max(1, int(WINDOW * (1 - OVERLAP)))
    count = math.ceil((size - WINDOW) / interval) + 1
    return [min(k * interval, size - WINDOW) for k in range(count)]


def browser_pipeline(crop, sess):
    cd, ch, cw = crop.shape
    mean, std = crop.mean(), crop.std() or 1.0
    pd, ph, pw = max(MIN_PAD, cd), max(MIN_PAD, ch), max(MIN_PAD, cw)
    offz, offy, offx = (pd - cd) // 2, (ph - ch) // 2, (pw - cw) // 2
    norm = (crop - mean) / std
    padded = np.pad(
        norm,
        ((offz, pd - cd - offz), (offy, ph - ch - offy), (offx, pw - cw - offx)),
        mode="reflect",
    )
    prob_sum = np.zeros((pd, ph, pw), np.float32)
    weight = np.zeros((pd, ph, pw), np.float32)
    for z0 in window_starts(pd):
        for y0 in window_starts(ph):
            for x0 in window_starts(pw):
                win = padded[z0:z0 + WINDOW, y0:y0 + WINDOW, x0:x0 + WINDOW]
                logits = sess.run(
                    ["logits"],
                    {"input": win[None, None].astype(np.float32)},
                )[0][0]
                fg = 1.0 / (1.0 + np.exp(logits[0] - logits[1]))
                prob_sum[z0:z0 + WINDOW, y0:y0 + WINDOW, x0:x0 + WINDOW] += fg
                weight[z0:z0 + WINDOW, y0:y0 + WINDOW, x0:x0 + WINDOW] += 1
    prob = prob_sum / np.maximum(weight, 1)
    return prob[offz:offz + cd, offy:offy + ch, offx:offx + cw]


def reference_pipeline(crop, model):
    pre = Compose([
        EnsureChannelFirst(channel_dim="no_channel"),
        NormalizeIntensity(),
        SpatialPad(spatial_size=[144, 144, 144], mode="reflect"),
        EnsureChannelFirst(channel_dim="no_channel"),
    ])
    inp = pre(torch.tensor(crop, dtype=torch.float))
    inferer = SlidingWindowInferer(roi_size=[96, 96, 96])
    with torch.no_grad():
        out = inferer(inp, model)
    prob = torch.softmax(out, axis=1).numpy()[0, 1]
    cd, ch, cw = crop.shape
    offz, offy, offx = (144 - cd) // 2, (144 - ch) // 2, (144 - cw) // 2
    return prob[offz:offz + cd, offy:offy + ch, offx:offx + cw]


def main():
    model = UNet(spatial_dims=3, in_channels=1, out_channels=2,
                 channels=(16, 32, 64, 128), strides=(2, 2, 2, 2),
                 num_res_units=2, act=Act.RELU, norm=Norm.BATCH, dropout=0.2)
    model.load_state_dict(
        torch.load("models/model-toothcrops-CBCT-normalize_best.pth",
                   map_location="cpu", weights_only=False),
        strict=True,
    )
    model.eval()
    sess = ort.InferenceSession("public/models/tooth-unet-96.onnx",
                                providers=["CPUExecutionProvider"])

    vol = np.fromfile("public/sample-cbct/volume-int16.raw",
                      dtype="<i2").reshape(420, 640, 640).astype(np.float32)
    # ROI around the dental arch (z mid, anterior maxilla region).
    crop = vol[150:230, 300:380, 280:360]
    print("crop shape:", crop.shape)

    mine = browser_pipeline(crop, sess)
    ref = reference_pipeline(crop, model)

    a, b = mine > 0.5, ref > 0.5
    inter = np.logical_and(a, b).sum()
    dice = 2 * inter / (a.sum() + b.sum() + 1e-8)
    print(f"browser fg voxels: {int(a.sum())}  reference fg voxels: {int(b.sum())}")
    print(f"max abs prob diff: {np.abs(mine - ref).max():.4f}")
    print(f"Dice(browser, reference): {dice:.4f}")


if __name__ == "__main__":
    main()
