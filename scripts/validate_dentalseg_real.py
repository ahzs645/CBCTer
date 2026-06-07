#!/usr/bin/env python3
"""End-to-end validation of the exported DentalSegmentator ONNX on a real CBCT.

Mirrors the TS browser pipeline (`dentalSegInference.ts`): load DICOM → resample
to model spacing → CTNormalize → reflect-pad → sliding-window ONNX → per-voxel
softmax average → argmax. Reports per-class voxel counts / volumes and saves
mid-plane overlay PNGs for visual sanity.

Usage:
    python scripts/validate_dentalseg_real.py \
        --dicom-dir /path/to/dicom --model public/models/dentalsegmentator.onnx \
        --output-dir outputs/dentalseg-validation
"""
import argparse
import glob
import math
import os

import numpy as np
import onnxruntime as ort
import pydicom
from scipy.ndimage import zoom

ANATOMY_LABELS = {0: "background", 1: "Upper Skull", 2: "Mandible",
                  3: "Upper Teeth", 4: "Lower Teeth", 5: "Mandibular canal"}
ANATOMY_COLORS = {1: (216, 195, 165), 2: (232, 168, 124), 3: (84, 182, 232),
                  4: (112, 216, 120), 5: (234, 93, 93)}


def _universal_labels():
    # Per-tooth FDI + mandible/maxilla/canal; matches dataset.json value order.
    names = {0: "background"}
    perm_upper = ["UR3M", "UR2M", "UR1M", "UR2PM", "UR1PM", "URC", "UR2I", "UR1I",
                  "UL1I", "UL2I", "ULC", "UL1PM", "UL2PM", "UL1M", "UL2M", "UL3M"]
    perm_lower = ["LL3M", "LL2M", "LL1M", "LL2PM", "LL1PM", "LLC", "LL2I", "LL1I",
                  "LR1I", "LR2I", "LRC", "LR1PM", "LR2PM", "LR1M", "LR2M", "LR3M"]
    primary = ["ur2m", "ur1m", "urc", "ur2i", "ur1i", "ul1i", "ul2i", "ulc",
               "ul1m", "ul2m", "ll2m", "ll1m", "llc", "ll2i", "ll1i", "lr1i",
               "lr2i", "lrc", "lr1m", "lr2m"]
    for i, n in enumerate(perm_upper + perm_lower + primary):
        names[i + 1] = n
    names[53] = "Mandible"
    names[54] = "Maxilla"
    names[55] = "Mandibular canal"
    return names


VARIANTS = {
    "full": dict(
        labels=ANATOMY_LABELS, colors=ANATOMY_COLORS,
        ctnorm=dict(lower=-208.0, upper=3070.0, mean=1178.261474609375, std=611.7098999023438),
        spacing=(0.43164101243019104, 0.31200000643730164, 0.43164101243019104),
        patch=(128, 160, 112)),
    "pediatric": dict(
        labels=ANATOMY_LABELS, colors=ANATOMY_COLORS,
        ctnorm=dict(lower=-50.0, upper=2562.0, mean=801.7435, std=493.4995),
        spacing=(0.4, 0.4, 0.4), patch=(128, 128, 128)),
    "universal": dict(
        labels=_universal_labels(), colors={},
        ctnorm=dict(lower=-47.0, upper=2530.0, mean=780.1467, std=487.8516),
        spacing=(0.4, 0.4, 0.4), patch=(160, 192, 192)),
}


def load_dicom(dicom_dir):
    files = glob.glob(os.path.join(dicom_dir, "*.dcm"))
    slices = [pydicom.dcmread(f) for f in files]
    slices.sort(key=lambda s: float(s.ImagePositionPatient[2])
                if hasattr(s, "ImagePositionPatient") else int(s.InstanceNumber))
    s0 = slices[0]
    slope = float(getattr(s0, "RescaleSlope", 1))
    intercept = float(getattr(s0, "RescaleIntercept", 0))
    vol = np.stack([s.pixel_array.astype(np.float32) * slope + intercept for s in slices])
    sy, sx = map(float, s0.PixelSpacing)
    zs = [float(s.ImagePositionPatient[2]) for s in slices]
    sz = abs(zs[1] - zs[0]) if len(zs) > 1 else float(getattr(s0, "SliceThickness", sy))
    return vol.astype(np.float32), (sz, sy, sx)  # (z,y,x), spacing (sz,sy,sx)


def reflect_pad(vol, target):
    pads = []
    for n, t in zip(vol.shape, target):
        total = max(0, t - n)
        pads.append((total // 2, total - total // 2))
    return np.pad(vol, pads, mode="reflect") if any(p != (0, 0) for p in pads) else vol, pads


def window_starts(size, window):
    if size <= window:
        return [0]
    interval = window  # overlap 0 (validation speed)
    count = math.ceil((size - window) / interval) + 1
    return [min(k * interval, size - window) for k in range(count)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dicom-dir", required=True)
    ap.add_argument("--model", default="public/models/dentalsegmentator.onnx")
    ap.add_argument("--variant", choices=sorted(VARIANTS), default="full",
                    help="Which model's spacing/patch/CTNorm/labels to use.")
    ap.add_argument("--output-dir", default="outputs/dentalseg-validation")
    args = ap.parse_args()
    os.makedirs(args.output_dir, exist_ok=True)

    cfg = VARIANTS[args.variant]
    LABELS, COLORS = cfg["labels"], cfg["colors"]
    CT_NORM, MODEL_SPACING, PATCH = cfg["ctnorm"], cfg["spacing"], cfg["patch"]
    print(f"variant: {args.variant}  ({len(LABELS) - 1} foreground classes)")

    vol, spacing = load_dicom(args.dicom_dir)
    print(f"loaded volume {vol.shape} spacing(z,y,x)={tuple(round(s,3) for s in spacing)} "
          f"HU range [{vol.min():.0f}, {vol.max():.0f}]")

    factors = [spacing[i] / MODEL_SPACING[i] for i in range(3)]
    res = zoom(vol, factors, order=1)
    print(f"resampled to {res.shape} at model spacing {tuple(round(s,3) for s in MODEL_SPACING)}")

    norm = np.clip(res, CT_NORM["lower"], CT_NORM["upper"])
    norm = (norm - CT_NORM["mean"]) / CT_NORM["std"]

    target = [max(PATCH[i], norm.shape[i]) for i in range(3)]
    padded, pads = reflect_pad(norm, target)
    pd, ph, pw = padded.shape

    sess = ort.InferenceSession(args.model, providers=["CPUExecutionProvider"])
    n_classes = len(LABELS)
    prob = np.zeros((n_classes, pd, ph, pw), dtype=np.float32)
    weight = np.zeros((pd, ph, pw), dtype=np.float32)

    starts = [window_starts(pd, PATCH[0]), window_starts(ph, PATCH[1]), window_starts(pw, PATCH[2])]
    total = len(starts[0]) * len(starts[1]) * len(starts[2])
    done = 0
    for z0 in starts[0]:
        for y0 in starts[1]:
            for x0 in starts[2]:
                patch = padded[z0:z0+PATCH[0], y0:y0+PATCH[1], x0:x0+PATCH[2]][None, None]
                logits = sess.run(None, {"input": patch.astype(np.float32)})[0][0]  # [C,d,h,w]
                e = np.exp(logits - logits.max(axis=0, keepdims=True))
                soft = e / e.sum(axis=0, keepdims=True)
                prob[:, z0:z0+PATCH[0], y0:y0+PATCH[1], x0:x0+PATCH[2]] += soft
                weight[z0:z0+PATCH[0], y0:y0+PATCH[1], x0:x0+PATCH[2]] += 1
                done += 1
                print(f"  patch {done}/{total}", flush=True)

    labels_padded = prob.argmax(axis=0).astype(np.uint8)
    z0, z1 = pads[0][0], pads[0][0] + res.shape[0]
    y0, y1 = pads[1][0], pads[1][0] + res.shape[1]
    x0, x1 = pads[2][0], pads[2][0] + res.shape[2]
    labelmap = labels_padded[z0:z1, y0:y1, x0:x1]

    voxel_mm3 = MODEL_SPACING[0] * MODEL_SPACING[1] * MODEL_SPACING[2]
    foreground = [v for v in LABELS if v != 0]
    print("\n=== per-class result ===")
    for v in [0, *foreground]:
        count = int((labelmap == v).sum())
        if count == 0 and v != 0:
            continue
        print(f"  {v} {LABELS[v]:18s}: {count:>10d} voxels  {count*voxel_mm3/1000:8.2f} cm3")

    present = [LABELS[v] for v in foreground if (labelmap == v).sum() > 0]
    print(f"\nstructures present: {len(present)}/{len(foreground)} -> {present}")

    # Mid-plane overlays for visual sanity.
    try:
        from PIL import Image
        gray = np.clip((res - res.min()) / (np.ptp(res) + 1e-6) * 255, 0, 255).astype(np.uint8)

        def overlay(sl_gray, sl_lab):
            rgb = np.stack([sl_gray] * 3, axis=-1).astype(np.uint8)
            for v, c in COLORS.items():
                m = sl_lab == v
                rgb[m] = (0.45 * np.array(c) + 0.55 * rgb[m]).astype(np.uint8)
            return rgb

        mid = [s // 2 for s in res.shape]
        for name, g, l in [
            ("axial", gray[mid[0]], labelmap[mid[0]]),
            ("coronal", gray[:, mid[1]], labelmap[:, mid[1]]),
            ("sagittal", gray[:, :, mid[2]], labelmap[:, :, mid[2]]),
        ]:
            Image.fromarray(overlay(g, l)).save(os.path.join(args.output_dir, f"overlay_{name}.png"))
        print(f"saved overlay PNGs to {args.output_dir}/")
    except Exception as e:  # noqa: BLE001
        print("overlay skipped:", e)


if __name__ == "__main__":
    main()
