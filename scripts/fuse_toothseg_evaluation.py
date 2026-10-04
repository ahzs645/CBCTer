#!/usr/bin/env python3
"""CPU evaluation adaptation of ToothSeg border-core and majority assignment.
Retain stable instance values; FDI is metadata. Preserve both raw predictions.
No recovery from semantic-only blobs, no automatic acceptance, no clinical GT.
"""
import argparse
import json
import time
from types import SimpleNamespace

import numpy as np
from acvl_utils.instance_segmentation.instance_as_semantic_seg import convert_semantic_to_instanceseg, postprocess_instance_segmentation
from benchmark_cbct_models import resample, save_result
from pathlib import Path


def run(root, scan):
    started=time.monotonic(); directory=root/'results'/scan
    semantic_info=json.loads((directory/'toothseg-semantic/result.json').read_text())
    border_info=json.loads((directory/'toothseg-border/result.json').read_text())
    border=np.load(directory/'toothseg-border-labels-modelgrid.npy')
    spacing=border_info['preprocessing']['spacingZYX']
    instances=convert_semantic_to_instanceseg(border.copy(),spacing,16,0)
    counts=np.bincount(instances.ravel())
    instances[np.isin(instances,np.flatnonzero(counts < 16/np.prod(spacing)))]=0
    instances=postprocess_instance_segmentation(instances)
    semantic=np.load(directory/'toothseg-semantic-labels-modelgrid.npy')
    semantic=resample(semantic,tuple(border.shape),0)
    final=np.zeros(border.shape,np.uint16); fdi={}; labels={}; decisions=[]
    for value in np.unique(instances):
        if not value: continue
        mask=instances==value; freq=np.bincount(semantic[mask].astype(np.int32),minlength=33)
        prediction=int(freq.argmax())  # upstream allow_background_label=True
        decisions.append({'instance':int(value),'semantic':prediction,'voxels':int(mask.sum())})
        if prediction==0: continue
        number=((prediction-1)//8+1)*10+1+(prediction-1)%8
        stable=len(fdi)+1; fdi[str(stable)]=number; labels[str(stable)]=f'Tooth {number} proposal'
        final[mask]=stable
    meta=json.loads((root/'inputs'/(scan+'.json')).read_text()); volume=np.load(root/'inputs'/(scan+'.npy'))
    native=resample(final,tuple(volume.shape),0)
    details={'engine':'PyTorch CPU + acvl_utils','weightsBytes':semantic_info['weightsBytes']+border_info['weightsBytes'],
        'parameterBytes':semantic_info['parameterBytes']+border_info['parameterBytes'],'weightsSha256':None,
        'modelVersion':'ToothSeg fold 5, CPU window adaptation','labelNames':labels,'instanceFDI':fdi,
        'sourceModels':{'semantic':semantic_info,'border':border_info},
        'secondsInference':semantic_info['seconds']+border_info['seconds'],
        'preprocessing':{'fusion':'upstream border-core conversion + majority including background', 'minCenterMm3':16,'minInstanceMm3':16,'isolatedBorderMm3':0,'semanticRecovery':'disabled','stableInstanceValues':True},
        'instanceDecisions':decisions,'rawBorderInstances':int(len(np.unique(instances))-1)}
    args=SimpleNamespace(root=root,scan=scan,model='toothseg')
    save_result(args,native,volume,meta,details,started)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--scan',required=True)
    run(**vars(p.parse_args()))
