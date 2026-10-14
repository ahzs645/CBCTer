#!/usr/bin/env python3
"""Propose splits of merged ToothSeg instances using substantial semantic regions.

All source-mask voxels are retained. Background-majority instances remain
unnumbered proposals. Original predictions must be packaged separately.
This heuristic needs review; it is not upstream ToothSeg self-correction.
"""
import argparse
import json
from pathlib import Path

import numpy as np
import SimpleITK as sitk
from scipy import ndimage


def refine(instances, semantic, output, min_fraction=.2, min_volume_mm3=80):
    source = sitk.ReadImage(str(instances))
    semantics = sitk.ReadImage(str(semantic))
    if (source.GetSize() != semantics.GetSize() or
        not np.allclose(source.GetSpacing(), semantics.GetSpacing(), atol=1e-6) or
        not np.allclose(source.GetOrigin(), semantics.GetOrigin(), atol=1e-5) or
        not np.allclose(source.GetDirection(), semantics.GetDirection(), atol=1e-5)):
        raise ValueError('Instance and semantic images must share a physical grid')
    raw = sitk.GetArrayFromImage(source)
    labels = sitk.GetArrayFromImage(semantics)
    if (source.GetNumberOfComponentsPerPixel() != 1 or semantics.GetNumberOfComponentsPerPixel() != 1 or
        not np.isfinite(raw).all() or not np.isfinite(labels).all() or
        (raw < 0).any() or (raw > 65535).any() or (labels < 0).any() or (labels > 32).any() or
        not np.equal(raw, np.floor(raw)).all() or not np.equal(labels, np.floor(labels)).all()):
        raise ValueError('Expected integer tooth instances and 0..32 semantic classes')
    result = raw.astype(np.uint16)
    numbering, decisions = {}, []
    voxel_mm3 = float(np.prod(source.GetSpacing()))
    next_id = int(raw.max()) + 1
    for value in np.unique(raw):
        instance = int(value)
        if not instance:
            continue
        coords = np.nonzero(raw == instance)
        bounds = tuple(slice(int(c.min()), int(c.max())+1) for c in coords)
        mask = raw[bounds] == instance
        local_semantic = labels[bounds]
        votes = np.bincount(local_semantic[mask].astype(np.int32), minlength=33)
        total = int(mask.sum())
        candidates = [n for n in range(1, 33) if votes[n]/total >= min_fraction and votes[n]*voxel_mm3 >= min_volume_mm3]
        candidates.sort(key=lambda n: (-votes[n], n))
        split = len(candidates) >= 2
        if not split:
            candidates = [int(votes.argmax())]
        proposed = np.zeros(mask.shape, np.uint16)
        for index, label in enumerate(candidates):
            target = instance if index == 0 else next_id
            if target > 65535:
                raise ValueError('Too many uint16 tooth instances')
            if index:
                next_id += 1
            fdi = ((label-1)//8+1)*10+1+(label-1)%8 if label else None
            numbering[str(target)] = fdi
            proposed[mask & (local_semantic == label) if split else mask] = target
            decisions.append({'instance': target, 'sourceInstance': instance, 'suggestedFdi': fdi,
                              'split': split, 'semanticSupportFraction': float(votes[label]/total),
                              'review': 'unreviewed'})
        if split:
            unresolved = mask & (proposed == 0)
            if unresolved.any():
                nearest = ndimage.distance_transform_edt(proposed == 0, sampling=source.GetSpacing()[::-1],
                                                        return_distances=False, return_indices=True)
                proposed[unresolved] = proposed[tuple(nearest[:, unresolved])]
        region = result[bounds]
        region[mask] = proposed[mask]
    if not np.array_equal(result != 0, raw != 0):
        raise ValueError('Refinement changed the source foreground union')
    image = sitk.GetImageFromArray(result)
    image.CopyInformation(source)
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    sitk.WriteImage(image, str(output))
    Path(str(output)+'.fdi.json').write_text(json.dumps(numbering, indent=2))
    summary = {'method': 'Substantial semantic regions inside border/core instances; nearest semantic seed for unresolved voxels',
               'minFraction': min_fraction, 'minSemanticVolumeMm3': min_volume_mm3,
               'foregroundUnionPreserved': True, 'instances': decisions,
               'warning': 'Unreviewed heuristic splits; numbering may be wrong. Background-majority regions retained without FDI.'}
    Path(str(output)+'.json').write_text(json.dumps(summary, indent=2))
    return summary


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--instances', required=True)
    parser.add_argument('--semantic', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--min-fraction', type=float, default=.2)
    parser.add_argument('--min-volume-mm3', type=float, default=80)
    args = vars(parser.parse_args())
    if not 0 < args['min_fraction'] <= .5 or not np.isfinite(args['min_volume_mm3']) or args['min_volume_mm3'] <= 0:
        parser.error('Require fraction in (0, .5] and finite positive volume')
    print(json.dumps(refine(**args)))
