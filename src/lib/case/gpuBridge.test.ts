/** Optional cross-language validation; needs the CPU benchmark environment. */
import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { caseFixture } from './fixture';
import { buildChunkedPackage } from '../import/chunked/package';
import { openChunkedReader } from '../import/chunked/reader';
import { readCaseMetadata, readCaseWorkspace } from './archive';
import { readProjectArchive } from '../project/exportProject';
import { assertProjectBinding } from './binding';
import { buildScanPackageFiles } from '../import/scanPackage';
import { zipSync } from 'fflate';
const python=process.env.CBCTER_MODEL_PYTHON;
const run=promisify(execFile);
describe.skipIf(!python)('GPU archive bridge (CPU registration tests)',()=>{
  it('keeps separate instance IDs when suggested tooth numbers repeat and preserves the raw prediction',async()=>{
    const root=await mkdtemp(join(tmpdir(),'cbcter-instance-ids-'));
    try {
      const {volume,labels}=await caseFixture();
      const raw=labels.map(n=>n ? 3 : 0);
      const scan=join(root,'scan.cbct.zip'),prediction=join(root,'raw.nii.gz'),instances=join(root,'instances.nii.gz'),output=join(root,'result');
      const packed=await buildChunkedPackage(volume,{name:'Repeated tooth numbers',windowLevel:volume.meta.initialWindowLevel});
      await writeFile(scan,new Uint8Array(await packed.blob.arrayBuffer()));
      await writeFile(join(root,'raw.uint16'),new Uint8Array(raw.buffer));
      await writeFile(join(root,'instances.uint16'),new Uint8Array(labels.buffer));
      await writeFile(join(root,'fdi.json'),JSON.stringify({'11':11,'32':11}));
      const script=resolve('scripts/cbct_gpu_bridge.py');
      const code=`import sys,importlib.util,numpy as np,SimpleITK as sitk\nspec=importlib.util.spec_from_file_location('bridge',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\nmanifest,_=m.load_scan(sys.argv[2]);v=manifest['volume']\nfor src,dst in [(sys.argv[3],sys.argv[4]),(sys.argv[5],sys.argv[6])]:\n words=np.fromfile(src,dtype='<u2').reshape(v['dimensions'][::-1]);sitk.WriteImage(m.image_on_native(words,v),dst)`;
      await run(python!,['-c',code,script,scan,join(root,'raw.uint16'),prediction,join(root,'instances.uint16'),instances]);
      await run(python!,[script,'package','--scan',scan,'--prediction',prediction,'--output',output,'--model','Synthetic repeated FDI','--label-scheme','oralseg','--tooth-instances',instances,'--instance-fdi',join(root,'fdi.json')]);
      const project=await readProjectArchive(new File([await readFile(output+'.cbcter.zip')],'result.cbcter.zip'));
      expect(project.manifest.state.toothInstances!.map(t=>t.value).sort((a,b)=>a-b)).toEqual([11,32]);
      expect(project.manifest.state.toothInstances!.map(t=>t.fdi)).toEqual([11,11]);
      expect(project.predictions![0].data).toEqual(new Uint8Array(raw.buffer));
      expect(project.labelmaps![0].data).toEqual(new Uint8Array(labels.buffer));
      const reader=await openChunkedReader({blob:new Blob([await readFile(output+'.cbct.zip')])});
      const metadata=await readCaseMetadata(reader);const restored=await readCaseWorkspace(reader,metadata!);
      expect(restored.predictions![0].data).toEqual(new Uint8Array(raw.buffer));
      expect(restored.labelmaps![0].data).toEqual(new Uint8Array(labels.buffer));
    } finally {await rm(root,{recursive:true,force:true});}
  },30000);
  it('upgrades classic full scans losslessly without inventing patient geometry',async()=>{
    const root=await mkdtemp(join(tmpdir(),'cbcter-classic-upgrade-'));
    try {
      const {volume}=await caseFixture();
      volume.voxels[0]=-32768;
      volume.voxels[1]=-4321;
      volume.voxels[2]=32767;
      const packed=buildScanPackageFiles(volume,{name:'Classic test',windowLevel:volume.meta.initialWindowLevel,contents:'full'});
      const source=join(root,'classic.cbct.zip'),output=join(root,'chunked.cbct.zip');
      const sourceBytes=zipSync(packed.files);
      await writeFile(source,sourceBytes);
      await run(python!,[resolve('scripts/upgrade_classic_cbct.py'),source,output]);
      const reader=await openChunkedReader({blob:new Blob([await readFile(output)])});
      expect(await reader.materialize()).toEqual(volume.voxels);
      expect(reader.manifest.volume.spacing).toEqual(volume.meta.spacing);
      expect(reader.manifest.volume.coordinateSystem).toBe('unknown');
      expect(reader.manifest.volume.representation).toBe('processed');
      expect(reader.manifest.volume.origin).toEqual([0,0,0]);
      expect(new Uint8Array(await readFile(source))).toEqual(sourceBytes);
    } finally {await rm(root,{recursive:true,force:true});}
  },30000);
  it('round trips source identity, rotated physical geometry, proposal IDs and immutable labels through Python',async()=>{
    const root=await mkdtemp(join(tmpdir(),'cbcter-gpu-bridge-'));
    try {
      const {volume,workspace,labels}=await caseFixture();
      const angle=8e-7,c=Math.cos(angle),s=Math.sin(angle);
      volume.native!.metadata.direction=[[c,s,0],[-s,c,0],[0,0,1]];
      const scan=join(root,'source.cbct.zip'), raw=join(root,'labels.raw'), prediction=join(root,'prediction.nii.gz'), output=join(root,'result');
      const packed=await buildChunkedPackage(volume,{name:'Synthetic geometry test',windowLevel:volume.meta.initialWindowLevel});
      await writeFile(scan,new Uint8Array(await packed.blob.arrayBuffer()));await writeFile(raw,new Uint8Array(labels.buffer));
      const script=resolve('scripts/cbct_gpu_bridge.py');
      const code=`import sys,importlib.util,numpy as np,SimpleITK as sitk\nspec=importlib.util.spec_from_file_location('bridge',sys.argv[1]);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)\nm,_=mod.load_scan(sys.argv[2]);v=m['volume'];words=np.fromfile(sys.argv[3],dtype='<u2').reshape(v['dimensions'][::-1]);sitk.WriteImage(mod.image_on_native(words,v),sys.argv[4])`;
      await run(python!,['-c',code,script,scan,raw,prediction]);
      await run(python!,[script,'package','--scan',scan,'--prediction',prediction,'--output',output,'--model','Synthetic GPU bridge fixture','--label-scheme','fdi']);
      const project=await readProjectArchive(new File([await readFile(output+'.cbcter.zip')],'result.cbcter.zip'));
      await assertProjectBinding(project.manifest.binding,volume);
      expect(project.manifest.state.toothInstances!.map(t=>t.fdi).sort()).toEqual([11,32]);
      expect(project.manifest.state.toothInstances!.every(t=>t.review==='unreviewed')).toBe(true);
      expect(project.predictions![0].data).toEqual(workspace.predictions![0].data);
      const reader=await openChunkedReader({blob:new Blob([await readFile(output+'.cbct.zip')])});
      const metadata=await readCaseMetadata(reader);const restored=await readCaseWorkspace(reader,metadata!);
      expect(await reader.materialize()).toEqual(volume.native!.voxels);
      expect(restored.predictions![0].data).toEqual(workspace.predictions![0].data);
    } finally {await rm(root,{recursive:true,force:true});}
  },30000);
});
