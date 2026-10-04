#!/usr/bin/env python3
"""Experimental upstream OralSeg adapter. Requires CUDA + Mamba.
Uses published validation preprocessing (.6 mm, RAS, [0,2500]->[0,1],
64-cube windows). Strict checkpoint load; writes a physically registered NIfTI.
GPU execution has not been validated in this CPU-only evaluation environment.
"""
import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

import numpy as np
import SimpleITK as sitk
import torch
from monai.inferers import sliding_window_inference


def run(source, checkpoint, image, output):
    if not torch.cuda.is_available(): raise RuntimeError('Select a GPU runtime in Colab before running OralSeg.')
    sys.path.insert(0,str(Path(source)/'OralSeg'))
    from modified.monai.networks.nets.OralSeg import OralSeg
    started=time.monotonic()
    model=OralSeg(img_size=(64,64,64),in_channels=1,out_channels=36,feature_size=48,drop_rate=0,attn_drop_rate=0,dropout_path_rate=0,use_checkpoint=False)
    payload=torch.load(checkpoint,map_location='cpu',weights_only=False)
    weights=payload.get('state_dict',payload)
    weights={k.removeprefix('module.').removeprefix('backbone.'):v for k,v in weights.items()}
    model.load_state_dict(weights,strict=True); del payload,weights
    model.eval().cuda()
    native=sitk.ReadImage(image)
    oriented=sitk.DICOMOrient(native,'RAS')
    spacing=(.6,.6,.6); size=[max(1,round(n*s/.6)) for n,s in zip(oriented.GetSize(),oriented.GetSpacing())]
    resampled=sitk.Resample(oriented,size,sitk.Transform(),sitk.sitkLinear,oriented.GetOrigin(),spacing,oriented.GetDirection(),-1024,sitk.sitkFloat32)
    array=sitk.GetArrayFromImage(resampled).transpose(2,1,0)
    tensor=torch.from_numpy(np.ascontiguousarray(np.clip(array,0,2500)/2500))[None,None]
    with torch.inference_mode():
        logits=sliding_window_inference(tensor,roi_size=(64,64,64),sw_batch_size=1,predictor=model,overlap=.5,sw_device='cuda',device='cpu')
    labels=logits.argmax(1)[0].numpy().transpose(2,1,0).astype(np.uint16)
    prediction=sitk.GetImageFromArray(labels); prediction.CopyInformation(resampled)
    native_labels=sitk.Resample(prediction,native,sitk.Transform(),sitk.sitkNearestNeighbor,0,sitk.sitkUInt16)
    sitk.WriteImage(native_labels,output)
    with open(checkpoint,'rb') as file: checkpoint_sha=hashlib.file_digest(file,'sha256').hexdigest()
    details={'model':'OralSeg','sourceCommit':'dd0eb05a97ed88e48da6f824fea2989bd4041c1c','weightsSha256':checkpoint_sha,'weightsBytes':Path(checkpoint).stat().st_size,'seconds':time.monotonic()-started,'gpu':torch.cuda.get_device_name(),
        'preprocessing':{'spacing':list(spacing),'orientation':'RAS','intensityRange':[0,2500],'roi':[64,64,64],'overlap':.5,'swBatchSize':1,'fusion':'MONAI constant average'},'clinicalAccuracy':None,'review':'unreviewed'}
    Path(output+'.json').write_text(json.dumps(details,indent=2));print(json.dumps(details))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--checkpoint',required=True);p.add_argument('--image',required=True);p.add_argument('--output',required=True)
    run(**vars(p.parse_args()))
