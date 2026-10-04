/** Hash/geometry and sampled voxel checks on private evaluation packages. */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { openChunkedReader } from '../src/lib/import/chunked/reader';
import { readCaseMetadata, layerReader } from '../src/lib/case/archive';
import { readProjectArchive } from '../src/lib/project/exportProject';
import { geometryHash } from '../src/lib/case/binding';
import { sha256 } from '../src/lib/import/chunked/codec';
import type { Vec3 } from '../src/types';
const root=process.argv[2], selected=process.argv[3]?.split(',');
if (!root) throw new Error('Supply the private evaluation root');
for (const name of (await readdir(join(root,'cases'))).filter(n=>n.endsWith('.cbct.zip') && (!selected || selected.some(m=>n.endsWith(`-${m}.cbct.zip`))))) {
  const path=join(root,'cases',name);
  const reader=await openChunkedReader({blob:new Blob([await readFile(path)])});
  const metadata=await readCaseMetadata(reader); assert(metadata,'Analysis required');
  const project=await readProjectArchive(new File([await readFile(path.replace('.cbct.zip','.cbcter.zip'))],'result.cbcter.zip'));
  assert.equal(project.manifest.binding?.sha256,reader.manifest.volume.sha256);
  assert.equal(project.manifest.binding?.geometrySha256,await geometryHash(project.manifest.binding!.geometry));
  assert(metadata.state.toothInstances?.every(t=>t.review==='unreviewed'));
  for (const layer of metadata.manifest.layers) {
    const bytes=[...project.labelmaps,...(project.predictions??[])].find(p=>p.id===layer.id)!.data;
    const dense=new Uint16Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/2);
    const dims=reader.manifest.volume.dimensions;
    const lreader=layerReader(reader,layer);
    const starts: Vec3[] = [[0,0,0],dims.map(n=>Math.floor(n/2)) as Vec3,dims.map(n=>n-1) as Vec3];
    const instance=metadata.state.toothInstances?.find(t=>t.groupId===layer.id);
    if (instance) starts.push(instance.centroid.map(Math.round) as Vec3);
    for (const start of starts) {
      const shape=start.map((n,a)=>Math.min(4,dims[a]-n)) as Vec3;
      const region=await lreader.region(start,shape);let i=0;
      for(let z=0;z<shape[2];z++)for(let y=0;y<shape[1];y++)for(let x=0;x<shape[0];x++) {
        assert.equal(region[i++],dense[((z+start[2])*dims[1]+y+start[1])*dims[0]+x+start[0]], `${name} ${layer.id} alignment`);
      }
    }
    // Root checksum was validated by metadata; region reads check raw chunk hashes.
    assert.equal(await sha256(new TextEncoder().encode(JSON.stringify(layer.chunks.map(c=>c.sha256)))),layer.sha256);
  }
  console.log(JSON.stringify({case:name,layers:metadata.manifest.layers.length,instances:metadata.state.toothInstances?.length??0,status:'verified'}));
}
