#!/usr/bin/env python3
"""Headless OralSeg case runner for an already provisioned Colab GPU runtime.

Upload this script, cbct_gpu_bridge.py, split_oralseg_instances.py and
run_oralseg_gpu.py to /content, then
run with /content/cbct-gpu-env/bin/python. Setup: setup_cbct_colab_gpu.py.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import SimpleITK as sitk
from scipy import ndimage

from cbct_gpu_bridge import package, prepare
from run_oralseg_gpu import run
from split_oralseg_instances import split

CHECKPOINT_SHA256 = "1b4b5806a0d2019d1b58b274cbb64c9b9f7f6510ddeff0413974acca58863ed2"


def evaluate(prediction):
    image = sitk.ReadImage(str(prediction))
    labels = sitk.GetArrayFromImage(image)
    voxel_mm3 = float(np.prod(image.GetSpacing()))
    teeth = []
    for label in range(3, 35):
        mask = labels == label
        count = int(mask.sum())
        if not count:
            continue
        components, _ = ndimage.label(mask, structure=np.ones((3, 3, 3)))
        sizes = np.bincount(components.ravel())[1:]
        teeth.append({"label": label, "suggestedFdi": ((label-3)//8+1)*10+1+(label-3)%8,
                      "voxels": count, "volumeMm3": count * voxel_mm3,
                      "largestComponentFraction": float(sizes.max() / count),
                      "componentsAtLeast16Mm3": int((sizes * voxel_mm3 >= 16).sum()),
                      "review": "unreviewed"})
    return {"dimensions": list(image.GetSize()), "spacing": list(image.GetSpacing()),
            "toothLabels": len(teeth),
            "toothLabelsAtLeast16Mm3": sum(t["volumeMm3"] >= 16 for t in teeth),
            "teeth": teeth, "clinicalAccuracy": None}


def main(scan, output_dir, source, checkpoint):
    checksum = hashlib.sha256()
    with open(checkpoint, "rb") as file:
        for block in iter(lambda: file.read(8 * 1024 * 1024), b""):
            checksum.update(block)
    if checksum.hexdigest() != CHECKPOINT_SHA256:
        raise ValueError("OralSeg checkpoint does not match the verified artifact")
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    image = prepare(scan, output)
    prediction = output / "oralseg-native.nii.gz"
    run(source, checkpoint, str(image), str(prediction))
    qc = evaluate(prediction)
    (output / "quality-summary.json").write_text(json.dumps(qc, indent=2))
    print(json.dumps(qc), flush=True)
    instances = output / "tooth-instances.nii.gz"
    split(prediction, instances)
    archives = package(scan, prediction, output / "oralseg-result", "OralSeg",
                       weights_hash=CHECKPOINT_SHA256, label_scheme="oralseg",
                       provenance=str(prediction) + ".json", tooth_instances=instances,
                       instance_fdi=str(instances) + ".fdi.json",
                       preprocessing={"instanceAssembly": "26-connected components per class; minimum 16 mm3; duplicate FDI retained"})
    print(json.dumps({"archives": archives}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scan", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--source", default="/content/OralSeg")
    parser.add_argument("--checkpoint", default="/content/model_workstation39.pt")
    main(**vars(parser.parse_args()))
