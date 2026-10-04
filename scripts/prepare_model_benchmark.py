#!/usr/bin/env python3
"""Prepare hash-verified native vendor ZIPs for benchmark_cbct_models.py."""
import argparse
import json
from pathlib import Path
import numpy as np
import SimpleITK as sitk
from cbct_gpu_bridge import load_scan, display_words, image_on_native


def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--scans',type=Path,required=True);parser.add_argument('--root',type=Path,required=True);parser.add_argument('--calibration-precision',choices=['float32','float64'],default='float32')
    args=parser.parse_args(); out=args.root/'inputs';out.mkdir(parents=True,exist_ok=True)
    for name in ['onevolume','sidexis']:
        manifest,raw=load_scan(args.scans/(name+'.cbct.zip')); meta=manifest['volume'];data=display_words(raw,meta)
        if args.calibration_precision == 'float32':
            values=raw.astype(np.float32)
            if 'highBit' in meta:
                values=((raw.astype(np.uint16) >> (meta['highBit']-meta['bitsStored']+1)) & (2**meta['bitsStored']-1)).astype(np.float32)
                if meta['dtype']=='int16': values[values >= 2**(meta['bitsStored']-1)] -= 2**meta['bitsStored']
            cal=meta['calibration']; values=values/cal['divisor']*cal['slope']+cal['intercept']
            data=np.clip(np.floor(values.astype(np.float64)+.5),-32767,32767).astype('<i2')
        if meta['paddingValue'] is not None: data[raw==meta['paddingValue']]=-1024
        np.save(out/(name+'.npy'),data)
        metadata={'name':name,'native':meta,'scanManifest':manifest,'analysisPaddingValue':-1024,'calibrationPrecision':args.calibration_precision,
            'intensityUnits':'DICOM calibrated HU' if manifest['source']['format']=='dicom' else 'vendor-calibrated; HU equivalence unverified',
            'orientationStatus':'DICOM LPS' if meta['coordinateSystem']=='LPS' else 'vendor axes; anatomical orientation unverified'}
        (out/(name+'.json')).write_text(json.dumps(metadata,indent=2))
        sitk.WriteImage(image_on_native(data,meta),str(out/(name+'_0000.nii.gz')))
        print(name,meta['sha256'],data.shape,flush=True)


if __name__=='__main__': main()
