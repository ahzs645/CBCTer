#!/usr/bin/env python3
"""Evaluate model outputs on authorized native CBCT inputs, outside the repo.

Inputs: <root>/inputs/<scan>.npy and .json, with calibrated x-fastest ZYX words
and native scan identity. No human ground truth is assumed. Outputs are private
label arrays, source geometry, runtime/provenance and qualitative overlays.
CPU defaults are bounded; candidate labels are never accepted automatically.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import os
import resource
import sys
import time
from pathlib import Path

import numpy as np
from scipy import ndimage


def sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as file:
        while block := file.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def resample(data: np.ndarray, shape: tuple[int, ...], order: int) -> np.ndarray:
    """Same voxel-centre mapping/clamped edges as CBCTer's resampleVolume."""
    ratio = np.array(data.shape) / np.array(shape)
    return ndimage.affine_transform(
        data, np.diag(ratio), offset=(ratio - 1) / 2, output_shape=shape,
        order=order, mode='nearest', prefilter=False,
    )


def starts(size: int, patch: int, overlap: float = .5) -> list[int]:
    stride = max(1, int(patch * (1 - overlap)))
    return [min(i * stride, max(0, size - patch))
            for i in range(math.ceil(max(0, size - patch) / stride) + 1)]


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def resolve_configuration(plans: dict, name: str, seen=()) -> dict:
    if name in seen:
        raise ValueError('Cyclic model configuration inheritance')
    config = plans['configurations'][name]
    return {**(resolve_configuration(plans, config['inherits_from'], (*seen, name))
               if 'inherits_from' in config else {}), **config}


def output_stats(labels: np.ndarray, spacing, names: dict, min_mm3=8) -> dict:
    counts = np.bincount(labels.ravel().astype(np.int32))
    voxel_mm3 = float(np.prod(spacing))
    result = {}
    for value, count in enumerate(counts):
        if value == 0 or count == 0:
            continue
        foreground = labels == value
        _, components = ndimage.label(foreground)
        coords = np.nonzero(foreground)
        result[str(value)] = {
            'name': names.get(str(value), names.get(value, f'Label {value}')),
            'voxels': int(count), 'mm3': float(count * voxel_mm3),
            'components': int(components),
            'boundsZYX': [[int(c.min()) for c in coords], [int(c.max()) for c in coords]],
            'centroidXYZ': [float(c.mean()) for c in coords[::-1]],
            'belowReviewSize': bool(count * voxel_mm3 < min_mm3),
        }
    return result


def save_result(args, labels, volume, meta, details, t0):
    out = args.root / 'results' / args.scan / args.model
    out.mkdir(parents=True, exist_ok=True)
    if tuple(labels.shape) != tuple(volume.shape):
        raise ValueError('Prediction does not match the native scan grid')
    labels = labels.astype('<u2')
    np.save(out / 'labels-native.npy', labels)
    result = {
        'scan': args.scan, 'model': args.model, 'status': 'completed',
        'scanSha256': meta['native']['sha256'],
        'nativeGeometry': {k: meta['native'][k] for k in
                           ['dimensions', 'spacing', 'origin', 'direction', 'coordinateSystem']},
        'inputAssumptions': {'intensity': meta['intensityUnits'],
                             'orientation': meta['orientationStatus'],
                             'paddingReplacement': meta['analysisPaddingValue'], 'calibrationPrecision': meta.get('calibrationPrecision', 'float32')},
        'seconds': round(time.monotonic() - t0, 3),
        'processPeakRssBytes': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024,
        'labelSha256': sha(out / 'labels-native.npy'),
        'review': 'unreviewed', 'clinicalAccuracy': None,
        **details,
    }
    result['labels'] = output_stats(labels, meta['native']['spacing'], details.get('labelNames', {}))
    (out / 'result.json').write_text(json.dumps(result, indent=2, default=lambda value: value.item()))
    # Anonymized axes only. These images stay beside the private results.
    from PIL import Image
    gray = np.clip((volume.astype(np.float32) + 1000) / 4000 * 255, 0, 255).astype(np.uint8)
    foreground = np.nonzero(labels)
    mid = [int(np.median(c)) if c.size else n // 2 for c, n in zip(foreground, labels.shape)]
    for axis, name in enumerate(['axial', 'coronal', 'sagittal']):
        sl_gray, sl_label = np.take(gray, mid[axis], axis=axis), np.take(labels, mid[axis], axis=axis)
        rgb = np.repeat(sl_gray[..., None], 3, axis=2)
        for value in np.unique(sl_label):
            if value == 0:
                continue
            color = np.array([70 + value * 73 % 180, 70 + value * 113 % 180, 70 + value * 151 % 180])
            mask = sl_label == value
            rgb[mask] = (.55 * rgb[mask] + .45 * color).astype(np.uint8)
        Image.fromarray(rgb).save(out / (name + '.png'))
    print(json.dumps({'scan': args.scan, 'model': args.model, 'seconds': result['seconds'],
                      'foregroundLabels': len(result['labels']), 'peakRssBytes': result['processPeakRssBytes']}), flush=True)


def nnunet(args, volume, meta):
    import torch
    from export_dentalseg_onnx import build_network
    torch.set_num_threads(args.threads)
    plans = json.loads((args.weights / 'plans.json').read_text())
    dataset = json.loads((args.weights / 'dataset.json').read_text())
    cfg = resolve_configuration(plans, args.configuration)
    channels = len(dataset['channel_names'])
    names = {str(v): k for k, v in dataset['labels'].items()}
    if args.model == 'airway':
        # The released UAW dataset.json reuses the generic name "Skin".
        names['1'] = 'Upper airway'
    network = build_network({**plans, 'configurations': {**plans['configurations'], '3d_fullres': cfg}}, dataset)
    checkpoint = next(args.weights.rglob(args.checkpoint))
    weights = torch.load(checkpoint, map_location='cpu', weights_only=False)
    network.load_state_dict(weights.get('network_weights', weights), strict=True)
    del weights
    network.eval()
    forward = plans.get('transpose_forward', [0, 1, 2])
    data = volume.transpose(forward)
    spacing = np.array(meta['native']['spacing'][::-1])[forward]
    model_spacing = np.array(cfg['spacing'])
    shape = tuple(np.maximum(1, np.floor(np.array(data.shape) * spacing / model_spacing + .5)).astype(int))
    data = resample(data.astype(np.float32), shape, 1)
    intensity = plans['foreground_intensity_properties_per_channel']['0']
    lower, upper = intensity['percentile_00_5'], intensity['percentile_99_5']
    data = (np.clip(data, lower, upper) - intensity['mean']) / intensity['std']
    patch = tuple(args.patch or cfg['patch_size'])
    pads = [(max(0, p - n) // 2, max(0, p - n) - max(0, p - n) // 2) for n, p in zip(shape, patch)]
    padded = np.pad(data, pads, mode='reflect')
    best_prob = np.zeros(padded.shape, np.float32)
    best_label = np.zeros(padded.shape, np.uint16)
    windows = [starts(n, p, args.overlap) for n, p in zip(padded.shape, patch)]
    total = math.prod(map(len, windows))
    done = 0
    for z in windows[0]:
        for y in windows[1]:
            for x in windows[2]:
                region = tuple(slice(s, s + n) for s, n in zip([z, y, x], patch))
                with torch.inference_mode():
                    tensor = torch.from_numpy(padded[region].copy())[None, None]
                    logits = network(tensor)[0]
                    prob, label = torch.softmax(logits, dim=0).max(dim=0)
                prob, label = prob.numpy(), label.numpy()
                replace = prob > best_prob[region]
                best_prob[region][replace] = prob[replace]
                best_label[region][replace] = label[replace]
                del logits, tensor
                done += 1
                print(f'{args.scan}/{args.model}: patch {done}/{total}', flush=True)
    crop = tuple(slice(p[0], p[0] + n) for n, p in zip(shape, pads))
    np.save(args.root / 'results' / args.scan / (args.model + '-labels-modelgrid.npy'), best_label[crop])
    native_labels = resample(best_label[crop], tuple(volume.transpose(forward).shape), 0)
    native_labels = native_labels.transpose(plans.get('transpose_backward', [0, 1, 2]))
    return native_labels, {
        'engine': 'PyTorch CPU', 'weightsBytes': checkpoint.stat().st_size,
        'weightsSha256': sha(checkpoint), 'parameterBytes': sum(p.numel() * p.element_size() for p in network.parameters()),
        'modelVersion': plans.get('plans_name'), 'labelNames': names,
        'preprocessing': {'spacingZYX': model_spacing.tolist(), 'transposeForward': forward,
                          'normalization': intensity, 'patchZYX': patch, 'overlap': args.overlap,
                          'fusion': 'maximum foreground/background softmax confidence, matching browser pipeline',
                          'resampling': 'voxel-centre trilinear; nearest native labels', 'cleanup': 'none; retain original predictions'},
        'patches': total, 'modelShapeZYX': shape,
    }


def yolo(args, volume, meta):
    mod = load_module(Path(__file__).with_name('compare_tooth_yolo_onnx_colab.py'), 'cbcter_yolo_benchmark')
    import onnxruntime as ort
    original = ort.InferenceSession
    options = ort.SessionOptions()
    options.intra_op_num_threads = args.threads
    options.inter_op_num_threads = 1
    mod.ort.InferenceSession = lambda path, **kwargs: original(path, sess_options=options, **kwargs)
    shape = tuple(np.maximum(1, np.floor(np.array(volume.shape) * np.array(meta['native']['spacing'][::-1]) / .3 + .5)).astype(int))
    data = resample(volume.astype(np.float32), shape, 1)
    run = mod.run_model(args.weights, data, .25, .45, .5, 0)
    np.save(args.root / 'results' / args.scan / 'yolo-mask-modelgrid.npy', run['mask'])
    labels, kept, _ = mod.watershed_instances(run['mask'], 2, 1500, marker_labels=run['seedLabels'])
    candidate_sizes = np.bincount(labels.ravel())
    shipping_count = int(sum(candidate_sizes[value] >= 8000 for value in kept))
    # Instance IDs are proposal labels, not FDI numbers.
    labels[~np.isin(labels, kept)] = 0
    labels = resample(labels.astype(np.uint16), tuple(volume.shape), 0)
    return labels, {'engine': 'ONNX Runtime CPU', 'weightsBytes': args.weights.stat().st_size,
                    'weightsSha256': sha(args.weights), 'instanceCount': len(kept),
                    'processedSlices': run['processedSlices'], 'labelNames': {},
                    'preprocessing': {'spacingXYZ': [.3, .3, .3], 'ctWindow': [-113.8, 4021],
                                      'confidenceThreshold': .25, 'nmsIoU': .45, 'maskThreshold': .5,
                                      'watershed': {'core': 2, 'minVoxels': 1500, 'seeds': 'tracked YOLO detections'}},
                    'modelShapeZYX': shape,
                    'thresholdComparison': {'1500ModelVoxels': len(kept), '8000ModelVoxels': shipping_count}}


def legacy(args, volume, meta):
    """Run both forms of the ROI U-Net on the same explicit scan regions."""
    import torch
    import onnxruntime as ort
    from monai.networks.nets import UNet
    from monai.networks.layers.factories import Act, Norm
    torch.set_num_threads(args.threads)
    helper = load_module(Path(__file__).with_name('validate_onnx_pipeline.py'), 'legacy_validation')
    options = ort.SessionOptions()
    options.intra_op_num_threads = args.threads
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(args.weights), sess_options=options, providers=['CPUExecutionProvider'])
    checkpoint = args.python_weights
    network = UNet(spatial_dims=3, in_channels=1, out_channels=2,
                   channels=(16,32,64,128), strides=(2,2,2,2), num_res_units=2,
                   act=Act.RELU, norm=Norm.BATCH, dropout=.2)
    network.load_state_dict(torch.load(checkpoint, map_location='cpu', weights_only=False), strict=True)
    network.eval()
    proposals = np.load(args.root / 'results' / args.scan / 'yolo' / 'labels-native.npy', mmap_mode='r')
    counts = np.bincount(proposals.ravel())
    values = sorted(range(1,len(counts)), key=lambda value: counts[value], reverse=True)[:3]
    centers = [np.array(ndimage.center_of_mass(proposals == v)) for v in values if counts[v]]
    if not centers:
        centers = [np.array(volume.shape) / 2]
    predictions = [np.zeros(volume.shape, np.uint16), np.zeros(volume.shape, np.uint16)]
    durations = [0., 0.]
    rois, agreement = [], []
    for center in centers:
        lo = np.maximum(0, np.minimum(np.array(volume.shape) - 80, np.floor(center - 40))).astype(int)
        hi = np.minimum(np.array(volume.shape),lo + 80)
        region = tuple(slice(int(a), int(b)) for a,b in zip(lo,hi))
        crop = volume[region].astype(np.float32)
        t = time.monotonic()
        onnx = helper.browser_pipeline(crop, session)
        durations[0] += time.monotonic() - t
        # Use identical normalized reflect-padded windows in both frameworks.
        norm = (crop - crop.mean()) / (crop.std() or 1)
        padded = np.pad(norm, [(32,32)]*3, mode='reflect')
        prob_sum, weight = np.zeros((144,)*3,np.float32), np.zeros((144,)*3,np.float32)
        t = time.monotonic()
        for z in helper.window_starts(144):
            for y in helper.window_starts(144):
                for x in helper.window_starts(144):
                    window = tuple(slice(s,s+96) for s in [z,y,x])
                    with torch.inference_mode():
                        logits = network(torch.from_numpy(padded[window].copy())[None,None])
                        probability = torch.softmax(logits,dim=1)[0,1].numpy()
                    prob_sum[window] += probability
                    weight[window] += 1
        python = (prob_sum/weight)[32:112,32:112,32:112]
        durations[1] += time.monotonic() - t
        a,b = onnx>.5, python>.5
        predictions[0][region][a] = 1
        predictions[1][region][b] = 1
        agreement.append({'maxProbabilityDifference':float(np.abs(onnx-python).max()),
                          'maskAgreement':float((a==b).mean()),
                          'foregroundDice':float(2*(a&b).sum()/max(1,a.sum()+b.sum()))})
        rois.append({'minZYX':lo.tolist(),'maxExclusiveZYX':hi.tolist()})
        print(f'{args.scan}/legacy: ROI {len(rois)}/{len(centers)}',flush=True)
    return predictions, {'labelNames':{'1':'Tooth foreground in tested ROIs'},
                        'mode':'3 representative 80-cubed native ROIs; outside these ROIs unassessed',
                        'rois':rois, 'frameworkAgreement':agreement,
                        'preprocessing':{'normalization':'ROI z-score','reflectPad':144,'patch':96,'overlap':.25,'threshold':.5}},durations


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--scan', choices=['onevolume', 'sidexis'], required=True)
    parser.add_argument('--model', required=True)
    parser.add_argument('--weights', type=Path, required=True)
    parser.add_argument('--configuration', default='3d_fullres')
    parser.add_argument('--checkpoint', default='checkpoint_final.pth')
    parser.add_argument('--patch', nargs=3, type=int)
    parser.add_argument('--overlap', type=float, default=.5)
    parser.add_argument('--threads', type=int, default=2)
    parser.add_argument('--python-weights', type=Path)
    args = parser.parse_args()
    out = args.root / 'results' / args.scan
    out.mkdir(parents=True, exist_ok=True)
    volume = np.load(args.root / 'inputs' / (args.scan + '.npy'))
    meta = json.loads((args.root / 'inputs' / (args.scan + '.json')).read_text())
    t0 = time.monotonic()
    if args.model == 'legacy':
        predictions, details, durations = legacy(args, volume, meta)
        for i, (model, weights, engine) in enumerate([
            ('roi-onnx',args.weights,'ONNX Runtime CPU'),('roi-python',args.python_weights,'PyTorch CPU')]):
            args.model = model
            save_result(args,predictions[i],volume,meta,
                        {**details,'engine':engine,'weightsBytes':weights.stat().st_size,
                         'weightsSha256':sha(weights),'inferenceSeconds':durations[i]},t0)
        return
    labels, details = yolo(args, volume, meta) if args.model == 'yolo' else nnunet(args, volume, meta)
    save_result(args, labels, volume, meta, details, t0)


if __name__ == '__main__':
    main()
