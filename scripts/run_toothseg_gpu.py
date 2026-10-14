#!/usr/bin/env python3
"""GPU ToothSeg comparison using released CNNs and nnU-Net Gaussian fusion.

Inference exports at each released model spacing to bound host RAM, then maps
integer labels physically to the source grid. This is an explicit export
adaptation, not an exact reproduction of native-grid probability interpolation.
Instance IDs remain independent of suggested FDI numbers. No semantic recovery.
"""
import argparse
import gc
import hashlib
import json
import os
import time
from pathlib import Path

import numpy as np
import SimpleITK as sitk
import torch

os.environ['nnUNet_compile'] = 'F'
os.environ['MPLBACKEND'] = 'Agg'
from nnunetv2.inference.predict_from_raw_data import nnUNetPredictor
from acvl_utils.instance_segmentation.instance_as_semantic_seg import (
    convert_semantic_to_instanceseg, postprocess_instance_segmentation,
)


def file_hash(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as file:
        for block in iter(lambda: file.read(8*1024*1024), b''):
            digest.update(block)
    return digest.hexdigest()


def predict(native, model_dir, spacing, output):
    predictor = nnUNetPredictor(tile_step_size=.5, use_gaussian=True,
                               use_mirroring=False, perform_everything_on_device=True,
                               device=torch.device('cuda'), verbose=True, allow_tqdm=True)
    predictor.initialize_from_trained_model_folder(str(model_dir), (5,), 'checkpoint_best.pth')
    size = [max(1, round(n*s/spacing)) for n,s in zip(native.GetSize(), native.GetSpacing())]
    model_image = sitk.Resample(native, size, sitk.Transform(), sitk.sitkLinear,
                               native.GetOrigin(), [spacing]*3, native.GetDirection(),
                               -1024, sitk.sitkFloat32)
    data = sitk.GetArrayFromImage(model_image)[None]
    labels = predictor.predict_single_npy_array(data, {'spacing': [spacing]*3})
    result = sitk.GetImageFromArray(labels.astype(np.uint16))
    result.CopyInformation(model_image)
    sitk.WriteImage(result, str(output))
    details = {'modelFolder': model_dir.name,
               'weightsSha256': file_hash(model_dir/'fold_5/checkpoint_best.pth'),
               'configuration': predictor.configuration_manager.configuration,
               'inputGridXYZ': size}
    del predictor, data
    gc.collect()
    torch.cuda.empty_cache()
    return result, details


def run(image, weights, output):
    if not torch.cuda.is_available():
        raise RuntimeError('ToothSeg comparison requires a CUDA GPU')
    torch.set_num_threads(4)
    started = time.monotonic()
    native = sitk.ReadImage(image)
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    folders = [p.parent for p in Path(weights).rglob('plans.json')]
    semantic_dir = next(p for p in folders if 'Dataset121' in str(p))
    border_dir = next(p for p in folders if 'Dataset123' in str(p))
    semantic, semantic_details = predict(native, semantic_dir, .3, output/'semantic-modelgrid.nii.gz')
    border, border_details = predict(native, border_dir, .2, output/'border-modelgrid.nii.gz')
    border_array = sitk.GetArrayFromImage(border)
    instances = convert_semantic_to_instanceseg(border_array, [.2]*3, 16, 0)
    counts = np.bincount(instances.ravel())
    instances[np.isin(instances, np.flatnonzero(counts*.2**3 < 16))] = 0
    instances = postprocess_instance_segmentation(instances)
    instance_image = sitk.GetImageFromArray(instances.astype(np.uint16))
    instance_image.CopyInformation(border)
    instance_image = sitk.Resample(instance_image, native, sitk.Transform(), sitk.sitkNearestNeighbor, 0, sitk.sitkUInt16)
    semantic = sitk.Resample(semantic, native, sitk.Transform(), sitk.sitkNearestNeighbor, 0, sitk.sitkUInt16)
    sitk.WriteImage(instance_image, str(output/'instances-original.nii.gz'))
    sitk.WriteImage(semantic, str(output/'semantic-native.nii.gz'))
    raw = sitk.GetArrayFromImage(instance_image)
    semantics = sitk.GetArrayFromImage(semantic)
    review = np.zeros(raw.shape, np.uint16)
    numbering, decisions = {}, []
    for instance in np.unique(raw):
        if instance == 0:
            continue
        mask = raw == instance
        votes = np.bincount(semantics[mask].astype(np.int32), minlength=33)
        label = int(votes.argmax())
        fdi = ((label-1)//8+1)*10+1+(label-1)%8 if label else None
        decisions.append({'instance': int(instance), 'suggestedFdi': fdi,
                          'volumeMm3': int(mask.sum())*float(np.prod(native.GetSpacing())),
                          'semanticMajorityFraction': float(votes.max()/mask.sum()),
                          'keptForReview': True})
        review[mask] = instance
        numbering[str(int(instance))] = fdi
    review_image = sitk.GetImageFromArray(review)
    review_image.CopyInformation(native)
    sitk.WriteImage(review_image, str(output/'tooth-instances.nii.gz'))
    (output/'instance-fdi.json').write_text(json.dumps(numbering, indent=2))
    hashes = [semantic_details['weightsSha256'], border_details['weightsSha256']]
    provenance = {'model': 'ToothSeg', 'sourceCommit': 'b29d1017fa124f89645fa56f98649e3f3f43bdb0',
                  'weightsSha256': hashlib.sha256(json.dumps(hashes).encode()).hexdigest(),
                  'semantic': semantic_details, 'border': border_details,
                  'seconds': time.monotonic()-started, 'gpu': torch.cuda.get_device_name(),
                  'fusion': 'nnU-Net Gaussian averaging; step .5; fold 5; no mirroring',
                  'export': 'argmax at released model spacing; physical nearest to source grid',
                  'instanceAssembly': 'upstream border/core, 16 mm3 centres/instances; majority including background; retain background-majority instances without FDI; no semantic recovery',
                  'clinicalAccuracy': None, 'review': 'unreviewed'}
    (output/'provenance.json').write_text(json.dumps(provenance, indent=2))
    summary = {'instances': decisions, 'toothInstances': len(numbering),
               'numberedInstances': sum(n is not None for n in numbering.values()), 'provenance': provenance}
    (output/'quality-summary.json').write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', required=True)
    parser.add_argument('--weights', required=True)
    parser.add_argument('--output', required=True)
    run(**vars(parser.parse_args()))
