#!/usr/bin/env python3
"""Native v2 case ZIP <-> registered GPU NIfTI result <-> CBCTer archives.
No uploads or model downloads. Run in Colab or locally. Inference adapters are
separate: this module validates registration and preserves original predictions.
"""
import argparse
import copy
import hashlib
import json
import time
import uuid
import zipfile
from pathlib import Path

import jcs
import numpy as np
import SimpleITK as sitk
import zstandard as zstd

IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
COLORS = ['#38bdf8', '#a78bfa', '#f59e0b', '#34d399', '#fb7185']


def digest(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    # JS JSON.stringify writes integral floating-point numbers without '.0'.
    def clean(v):
        if isinstance(v, float) and v.is_integer(): return int(v)
        if isinstance(v, list): return [clean(x) for x in v]
        if isinstance(v, dict): return {k: clean(x) for k, x in v.items()}
        return v
    return json.dumps(clean(value), separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode()


def load_scan(path):
    with zipfile.ZipFile(path) as archive:
        manifest = json.loads(archive.read('cbct-scan.json'))
        v = manifest['volume']
        if (manifest.get('format'), manifest.get('version'), v.get('codec'), v.get('filter'),
            v.get('byteOrder'), v.get('layout')) != ('cbcter-scan', 2, 'zstd', 'x-delta-byte-shuffle', 'little-endian', 'x-fastest'):
            raise ValueError('Export a native version-2 Scan only package from CBCTer.')
        raw = np.zeros(v['dimensions'][::-1], dtype='<i2' if v['dtype'] == 'int16' else '<u2')
        expected = [(x,y,z) for z in range(0,v['dimensions'][2],64) for y in range(0,v['dimensions'][1],64) for x in range(0,v['dimensions'][0],64)]
        if len(expected) != len(v['chunks']): raise ValueError('Incomplete native chunk grid')
        for start, chunk in zip(expected, v['chunks']):
            if list(start) != chunk['start']: raise ValueError('Invalid chunk order')
            shape = [min(64, n-s) for n,s in zip(v['dimensions'], start)]
            if shape != chunk['shape']: raise ValueError('Invalid chunk coverage')
            encoded = archive.read(chunk['file'])
            count = int(np.prod(shape))
            if len(encoded) != chunk['bytes'] or zstd.frame_content_size(encoded) != count * 2: raise ValueError('Invalid chunk length')
            shuffled = np.frombuffer(zstd.ZstdDecompressor().decompress(encoded, max_output_size=count*2), np.uint8)
            delta = shuffled[:count].astype(np.uint16) | (shuffled[count:].astype(np.uint16) << 8)
            words = np.cumsum(delta.reshape(-1,shape[0]), axis=1, dtype=np.uint32).astype('<u2').reshape(shape[::-1])
            if digest(words.tobytes()) != chunk['sha256']: raise ValueError('Native chunk checksum failed')
            x,y,z = start; sx,sy,sz = shape
            raw[z:z+sz,y:y+sy,x:x+sx] = words.view(raw.dtype)
    if digest(raw.tobytes()) != v['sha256']: raise ValueError('Native scan checksum failed')
    return manifest, raw


def display_words(raw, v):
    values = raw.astype(np.float64)
    if 'highBit' in v:
        shift = v['highBit'] - v['bitsStored'] + 1
        values = (raw.astype(np.uint16) >> shift) & (2**v['bitsStored']-1)
        values = values.astype(np.float64)
        if v['dtype'] == 'int16': values[values >= 2**(v['bitsStored']-1)] -= 2**v['bitsStored']
    cal = v['calibration']
    values = np.clip(np.floor(values / cal['divisor'] * cal['slope'] + cal['intercept'] + .5), -32767, 32767).astype('<i2')
    if v['paddingValue'] is not None: values[raw == v['paddingValue']] = -32768
    return values


def image_on_native(words, v):
    image = sitk.GetImageFromArray(words)
    image.SetSpacing(v['spacing']); image.SetOrigin(v['origin'])
    image.SetDirection(np.asarray(v['direction']).T.flatten().tolist())
    return image


def prepare(scan, output):
    manifest, raw = load_scan(scan); v = manifest['volume']
    output = Path(output); output.mkdir(parents=True, exist_ok=True)
    calibrated = display_words(raw, v)
    calibrated[calibrated == -32768] = -1024  # inference only; binding keeps padding
    sitk.WriteImage(image_on_native(calibrated, v), str(output / 'scan.nii.gz'))
    (output / 'source.json').write_bytes(json_bytes({'scanSha256': v['sha256'], 'nativeGeometry': v,
        'warning': 'Vendor HU equivalence and anatomical orientation require verification.' if v['coordinateSystem'] != 'LPS' else 'DICOM LPS; verify model label orientation.'}))
    return output / 'scan.nii.gz'


def package(scan, prediction, output, model, weights_hash=None, label_scheme='none', preprocessing=None, provenance=None):
    if provenance:
        recorded=json.loads(Path(provenance).read_text())
        if recorded.get('weightsSha256') != weights_hash: raise ValueError('Model provenance weights fingerprint mismatch')
        preprocessing={**(preprocessing or {}),'modelRun':json_bytes(recorded).decode(),'registration':'NIfTI physical nearest to native grid'}
    manifest, raw = load_scan(scan); v = manifest['volume']
    reference = image_on_native(display_words(raw, v), v)
    prediction = sitk.ReadImage(str(prediction))
    if prediction.GetDimension() != 3 or prediction.GetNumberOfComponentsPerPixel() != 1: raise ValueError('Expected a scalar 3D label image')
    if not np.allclose(prediction.GetDirection(), reference.GetDirection(), atol=1e-5):
        raise ValueError('Prediction directions differ: invert model preprocessing before packaging.')
    source = sitk.GetArrayFromImage(prediction)
    if not np.isfinite(source).all() or (source < 0).any() or (source > 65535).any() or not np.equal(source, np.floor(source)).all():
        raise ValueError('Expected uint16-compatible integer labels')
    # Explicit physical registration: nearest neighbour onto the original grid.
    # A different origin/direction must never be repaired by array resizing.
    prediction = sitk.Resample(prediction, reference, sitk.Transform(), sitk.sitkNearestNeighbor, 0, sitk.sitkUInt16)
    words = sitk.GetArrayFromImage(prediction).astype('<u2')
    if not np.any(words): raise ValueError('Prediction has no foreground on the source scan')
    geometry = {k:v[k] for k in ['dimensions','spacing','origin','direction','coordinateSystem']}
    geo_hash = digest(jcs.canonicalize([geometry[k] for k in ['dimensions','spacing','origin','direction','coordinateSystem']]))
    binding = {'sha256':v['sha256'], 'geometrySha256':geo_hash, 'geometry':geometry,
        'displaySha256':digest(display_words(raw,v).tobytes()), 'displayDimensions':v['dimensions'], 'displaySpacing':v['spacing'], 'displayToNative':IDENTITY}
    now = int(time.time()*1000); prefix = str(uuid.uuid4()); model_id = prefix+'-model'; study_id=prefix+'-study'; image_id=prefix+'-image'
    state = {'study':{'id':study_id,'name':model+' proposed outlines','source':'local-files','fileCount':1,'totalBytes':raw.nbytes,'status':'indexed','createdAt':now,'updatedAt':now},
        'images':[{'id':image_id,'studyId':study_id,'name':'Native scan','source':'local-files','dimensions':v['dimensions'],'spacing':v['spacing'],'visible':True,'opacity':1}],
        'activeImageId':image_id,'segmentGroups':[],'toothInstances':[],'analysisLayers':[],
        'analysisModels':[{'id':model_id,'name':model,'version':'GPU adapter v1','weightsSha256':weights_hash,'preprocessing':preprocessing or {'registration':'NIfTI physical nearest to native grid'},'createdAt':now}],
        'caseNotes':'Unreviewed model output. Not a clinical accuracy validation.'}
    layer_arrays = []
    def fdi(value):
        if label_scheme == 'oralseg' and 3 <= value <= 34: return ((value-3)//8+1)*10+1+(value-3)%8
        if label_scheme == 'fdi' and value//10 in range(1,5) and value%10 in range(1,9): return value
        return None
    teeth = np.isin(words, [int(n) for n in np.unique(words) if fdi(int(n)) is not None])
    for role, array in [('teeth',np.where(teeth,words,0)),('anatomy',np.where(teeth,0,words))]:
        if not np.any(array): continue
        gid=prefix+'-'+role; segments=[]
        for value in np.unique(array):
            n=int(value)
            if n==0: continue
            coords=np.nonzero(array==n); count=len(coords[0]); number=fdi(n)
            name = f'Tooth {number}' if number else f'Region {n}'
            if label_scheme=='oralseg': name={1:'Maxilla',2:'Mandible',35:'Mandibular canal'}.get(n,name)
            segments.append({'id':gid+f'-{n}','value':n,'name':name,'color':COLORS[n%5],'opacity':.45,'visible':True,'locked':False,'voxelCount':count,'createdAt':now,'updatedAt':now})
            if role=='teeth': state['toothInstances'].append({'id':gid+f'-instance-{n}','groupId':gid,'value':n,'fdi':number,'review':'unreviewed','source':'model','voxelCount':count,
                'centroid':[float(c.mean()) for c in coords[::-1]],'bounds':{'min':[int(c.min()) for c in coords[::-1]],'max':[int(c.max()) for c in coords[::-1]]}})
        state['segmentGroups'].append({'id':gid,'studyId':study_id,'imageId':image_id,'name':model+' '+role,'visible':True,'opacity':.45,'segments':segments,'createdAt':now,'updatedAt':now})
        state['analysisLayers'].append({'id':gid,'role':role,'modelId':model_id,'predictionId':prefix+'-prediction'})
        layer_arrays.append((gid,role,array.astype('<u2')))
    state['activeSegmentGroupId']=state['segmentGroups'][0]['id']
    state['analysisLayers'].append({'id':prefix+'-prediction','role':'prediction','modelId':model_id})
    state['analysisRevisions']=[{'id':prefix+'-revision','at':now,'action':'Import unreviewed GPU prediction','modelId':model_id,'instanceIds':[t['id'] for t in state['toothInstances']]}]
    layer_arrays.append((prefix+'-prediction','prediction',words))
    output=Path(output); output.parent.mkdir(parents=True,exist_ok=True)
    entries=[]; pred_entries=[]
    with zipfile.ZipFile(str(output)+'.cbcter.zip','w',zipfile.ZIP_DEFLATED) as archive:
        for lid,role,array in layer_arrays:
            path=('predictions/' if role=='prediction' else 'labelmaps/')+lid+'.uint16.raw'
            entry={'id':lid,'path':path,'bytes':array.nbytes}
            (pred_entries if role=='prediction' else entries).append(entry)
            archive.writestr(path,array.tobytes())
        project={'version':2,'app':'CBCTer','binding':binding,'exportedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'state':state,'masks':[],'surfaces':[],'labelmaps':entries,'predictions':pred_entries,
            'dataSources':[dict(e,kind='embedded',role='labelmap' if e in entries else 'prediction') for e in entries+pred_entries]}
        archive.writestr('study.json',json_bytes(project))
    # A streamed complete case is usable even when dense editing exceeds phone RAM.
    layers=[]; study=json_bytes(state)
    with zipfile.ZipFile(str(output)+'.cbct.zip','w') as archive, zipfile.ZipFile(scan) as original:
        for item in original.infolist():
            if item.filename.startswith(('chunks/','preview.')): archive.writestr(item,original.read(item.filename))
        for index,(lid,role,array) in enumerate(layer_arrays):
            chunks=[]
            for z in range(0,array.shape[0],64):
                for y in range(0,array.shape[1],64):
                    for x in range(0,array.shape[2],64):
                        block=np.ascontiguousarray(array[z:z+64,y:y+64,x:x+64]); u=block.reshape(-1,block.shape[2]); delta=u.copy(); delta[:,1:]=(u[:,1:]-u[:,:-1]).astype(np.uint16)
                        delta=delta.ravel(); shuffled=np.concatenate([(delta&255).astype(np.uint8),(delta>>8).astype(np.uint8)])
                        encoded=zstd.ZstdCompressor(level=3).compress(shuffled.tobytes()); path=f'analysis/layer-{index}/{len(chunks)}.zst'
                        archive.writestr(path,encoded)
                        chunks.append({'start':[x,y,z],'shape':list(block.shape[::-1]),'file':path,'bytes':len(encoded),'sha256':digest(block.tobytes())})
            layer=dict(next(l for l in state['analysisLayers'] if l['id']==lid),byteOrder='little-endian',layout='x-fastest',hashKind='ordered-chunk-sha256',dtype='uint16',dimensions=v['dimensions'],chunks=chunks,sha256=digest(json_bytes([c['sha256'] for c in chunks])))
            layers.append(layer)
        extended=copy.deepcopy(manifest); extended['extensions']={'analysis':{'version':1,'manifest':'analysis/manifest.json'}}
        archive.writestr('cbct-scan.json',json_bytes(extended)); archive.writestr('study.json',study)
        archive.writestr('analysis/manifest.json',json_bytes({'format':'cbcter-analysis','version':1,'scanSha256':v['sha256'],'geometrySha256':geo_hash,'studyFile':'study.json','studySha256':digest(study),'sourceGrid':{'dimensions':v['dimensions'],'spacing':v['spacing'],'toNative':IDENTITY},'layers':layers,'surfaces':[]}))
    return [str(output)+'.cbcter.zip',str(output)+'.cbct.zip']


if __name__=='__main__':
    parser=argparse.ArgumentParser(); commands=parser.add_subparsers(dest='command',required=True)
    p=commands.add_parser('prepare'); p.add_argument('--scan',required=True); p.add_argument('--output',required=True)
    p=commands.add_parser('package'); p.add_argument('--scan',required=True); p.add_argument('--prediction',required=True); p.add_argument('--output',required=True); p.add_argument('--model',required=True); p.add_argument('--weights-hash'); p.add_argument('--provenance'); p.add_argument('--label-scheme',choices=['none','oralseg','fdi'],default='none')
    args=vars(parser.parse_args()); command=args.pop('command')
    print(prepare(**args) if command=='prepare' else package(**args))
