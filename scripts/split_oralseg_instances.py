#!/usr/bin/env python3
"""Split disconnected OralSeg tooth classes into reviewable IDs, preserving raw labels.

This does not resolve touching teeth or validate numbering. Small components are
excluded from review proposals but remain in the original prediction archive.
"""
import argparse
import json
from pathlib import Path
import numpy as np
import SimpleITK as sitk
from scipy import ndimage


def split(prediction, output, min_volume_mm3=16):
    image = sitk.ReadImage(str(prediction))
    raw = sitk.GetArrayFromImage(image)
    instances = np.zeros(raw.shape, dtype=np.uint16)
    numbering, decisions = {}, []
    voxel_mm3 = float(np.prod(image.GetSpacing()))
    for label in range(3, 35):
        components, _ = ndimage.label(raw == label, structure=np.ones((3, 3, 3)))
        counts = np.bincount(components.ravel())
        for component in np.flatnonzero(counts[1:] * voxel_mm3 >= min_volume_mm3) + 1:
            instance = len(numbering) + 1
            if instance > 65535:
                raise ValueError('Too many tooth components for uint16')
            instances[components == component] = instance
            fdi = ((label - 3) // 8 + 1) * 10 + 1 + (label - 3) % 8
            numbering[str(instance)] = fdi
            decisions.append({'instance': instance, 'originalClass': label, 'suggestedFdi': fdi,
                              'volumeMm3': int(counts[component]) * voxel_mm3, 'review': 'unreviewed'})
    result = sitk.GetImageFromArray(instances)
    result.CopyInformation(image)
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    sitk.WriteImage(result, str(output))
    Path(str(output) + '.fdi.json').write_text(json.dumps(numbering, indent=2))
    summary = {'method': '26-connected components per OralSeg tooth class',
               'minVolumeMm3': min_volume_mm3, 'instances': decisions,
               'warning': 'Touching teeth can remain merged. FDI is a suggestion, including duplicates. Original prediction is retained.'}
    Path(str(output) + '.json').write_text(json.dumps(summary, indent=2))
    return summary


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prediction', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--min-volume-mm3', type=float, default=16)
    args = vars(parser.parse_args())
    if not np.isfinite(args['min_volume_mm3']) or args['min_volume_mm3'] <= 0:
        parser.error('Minimum volume must be finite and positive')
    print(json.dumps(split(**args)))
