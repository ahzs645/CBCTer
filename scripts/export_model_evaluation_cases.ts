/** Private model results -> native, streamable CBCTer cases and analysis projects.
 * Run with tsx: --root /private/evaluation --scans /private/native/packages.
 * Never place generated scans, masks or screenshots under public/ or git.
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { unzipSync, zipSync, type Zippable } from 'fflate';
import { openChunkedReader } from '../src/lib/import/chunked/reader';
import { buildCaseFiles, readCaseMetadata } from '../src/lib/case/archive';
import { bindVolume } from '../src/lib/case/binding';
import { displayVoxels } from '../src/lib/volume/native';
import { createEmptyStudyState, createStudyImageLayer, createStudySegmentGroup, createStudySegment } from '../src/domain/studyState';
import { buildProjectArchive } from '../src/lib/project/exportProject';
import { UNIVERSAL_FDI_BY_VALUE } from '../src/lib/segmentation/dentalSegVariants';
import type { LoadedVolume, Vec3 } from '../src/types';
import type { CaseWorkspace, ToothInstance } from '../src/lib/case/types';

const arg = (key: string) => {const index = process.argv.indexOf(key); return index < 0 ? undefined : process.argv[index + 1];};
const root = arg('--root'), scans = arg('--scans');
if (!root || !scans) throw new Error('Supply --root and --scans');
const output = join(root, 'cases');
await mkdir(output, { recursive: true });

function numpyWords(bytes: Buffer, dims: Vec3) {
  if (bytes.subarray(0, 6).toString('latin1') !== '\x93NUMPY') throw new Error('Not a NumPy array');
  const v2 = bytes[6] >= 2;
  const offset = v2 ? 12 : 10;
  const length = v2 ? bytes.readUInt32LE(8) : bytes.readUInt16LE(8);
  const header = bytes.subarray(offset, offset + length).toString();
  const shape = /'shape':\s*\(([^)]+)\)/.exec(header)?.[1].split(',').filter(s => s.trim()).map(Number);
  if (!/'descr':\s*'<u2'/.test(header) || !/'fortran_order':\s*False/.test(header) ||
      JSON.stringify(shape) !== JSON.stringify([...dims].reverse())) throw new Error('Prediction grid/layout mismatch');
  const data = Uint8Array.from(bytes.subarray(offset + length));
  if (data.byteLength !== dims.reduce((a,b)=>a*b,1) * 2) throw new Error('Prediction byte count mismatch');
  return data;
}

for (const scan of ['onevolume', 'sidexis']) {
  const original = await readFile(join(scans, scan + '.cbct.zip'));
  const reader = await openChunkedReader({ blob: new Blob([original]) });
  const manifest = reader.manifest, nativeWords = await reader.materialize();
  const native = { voxels: nativeWords, metadata: manifest.volume };
  const volume: LoadedVolume = {
    voxels: displayVoxels(nativeWords, native.metadata), native, histogram: new Uint32Array(4096),
    meta: { format: 'cbct-package', formatLabel: manifest.source.formatLabel, scanId: scan,
      dimensions: native.metadata.dimensions, spacing: native.metadata.spacing,
      scalarRange: manifest.scalarRange, initialWindowLevel: manifest.display,
      sliceCount: native.metadata.dimensions[2], bytesPerVoxel: 2, headerFileName: '',
      slicePrefix: '', sliceFiles: [], nativeAxis: manifest.orientation.nativeAxis },
  };
  const binding = await bindVolume(volume);
  for (const model of await readdir(join(root, 'results', scan))) {
    if (arg('--models') && !arg('--models')!.split(',').includes(model)) continue;
    if (model.includes('.') || model === 'toothseg-semantic' || model === 'toothseg-border') continue;
    const directory = join(root, 'results', scan, model);
    const result = JSON.parse(await readFile(join(directory, 'result.json'), 'utf8'));
    if (result.status !== 'completed' || result.scanSha256 !== binding.sha256) throw new Error('Result scan fingerprint mismatch');
    const bytes = numpyWords(await readFile(join(directory, 'labels-native.npy')), volume.meta.dimensions);
    const modelId = `${model}-${result.weightsSha256?.slice(0,16) ?? 'pipeline'}`;
    const groupId = `${scan}-${modelId}-labels`, predictionId = groupId + '-original';
    const now = Date.now();
    const state = createEmptyStudyState({ id: `${scan}-${modelId}-study`, name: `${scan}: ${model} evaluation`,
      source: 'local-files', fileCount: 1, totalBytes: nativeWords.byteLength, status: 'indexed', createdAt: now, updatedAt: now });
    const image = createStudyImageLayer(state.study!.id, { name: 'Native scan', source: 'local-files', dimensions: volume.meta.dimensions, spacing: volume.meta.spacing });
    state.images = [image]; state.activeImageId = image.id;
    state.caseNotes = 'Unreviewed model evaluation. No clinician ground truth. ' + result.inputAssumptions.intensity + '; ' + result.inputAssumptions.orientation + '. ' + (result.mode ?? 'Full scan inference');
    state.analysisModels = [{ id: modelId, name: model, version: result.modelVersion ?? null,
      weightsSha256: result.weightsSha256 ?? null, preprocessing: { settings: JSON.stringify(result.preprocessing),
      engine: result.engine, nativeScanSha256: binding.sha256, intensityAssumption: result.inputAssumptions.intensity }, createdAt: now }];
    const group = createStudySegmentGroup(state.study!.id, image.id, { name: `${model} proposed structures` });
    group.id = groupId;
    group.segments = Object.entries(result.labels).map(([value, info]) => createStudySegment({
      value: Number(value), name: (info as {name:string}).name || `Region ${value}`,
      color: ['#38bdf8','#a78bfa','#f59e0b','#34d399','#fb7185'][Number(value)%5],
    }));
    state.segmentGroups = [group]; state.activeSegmentGroupId = group.id;
    const teeth = ['yolo', 'universal', 'toothseg'].includes(model);
    const instances: ToothInstance[] = teeth ? Object.entries(result.labels)
      .filter(([value]) => model !== 'universal' || Number(value) <= 52)
      .map(([value, raw]) => {
        const info = raw as {voxels:number;centroidXYZ:Vec3;boundsZYX:[Vec3,Vec3]};
        const n = Number(value);
        return { id: `${groupId}-instance-${value}`, groupId, value: n,
          fdi: model === 'universal' ? UNIVERSAL_FDI_BY_VALUE[n] : model === 'toothseg' ? result.instanceFDI[value] : null,
          review: 'unreviewed', source: 'model', voxelCount: info.voxels,
          centroid: info.centroidXYZ, bounds: { min: [...info.boundsZYX[0]].reverse() as Vec3, max: [...info.boundsZYX[1]].reverse() as Vec3 } };
      }) : [];
    state.toothInstances = instances; state.selectedInstanceId = instances[0]?.id;
    state.analysisLayers = [{ id: groupId, role: teeth ? 'teeth' : 'anatomy', modelId, predictionId },
      { id: predictionId, role: 'prediction', modelId }];
    state.analysisRevisions = [{ id: groupId + '-revision', at: now, action: 'import unreviewed CPU model evaluation', modelId, instanceIds: instances.map(t=>t.id) }];
    const workspace: CaseWorkspace = { state, binding, masks: [], surfaces: [],
      labelmaps: [{ id: groupId, data: bytes }], predictions: [{ id: predictionId, data: bytes }] };
    if (model === 'toothseg') {
      // The final instance map is derived; keep both original model predictions
      // and each checkpoint fingerprint rather than attributing it to one file.
      workspace.predictions = [];
      state.analysisLayers = state.analysisLayers.filter(l => l.id !== predictionId);
      delete state.analysisLayers[0].predictionId;
      for (const branch of ['semantic', 'border']) {
        const source = result.sourceModels[branch];
        const id = `${modelId}-${branch}`, pid = `${groupId}-${branch}-original`;
        state.analysisModels.push({id, name:`ToothSeg ${branch}`, version:source.modelVersion,
          weightsSha256:source.weightsSha256, preprocessing:{settings:JSON.stringify(source.preprocessing)},createdAt:now});
        state.analysisLayers.push({id:pid,role:'prediction',modelId:id});
        workspace.predictions!.push({id:pid,data:numpyWords(await readFile(join(root,'results',scan,`toothseg-${branch}`,'labels-native.npy')),volume.meta.dimensions)});
      }
    }
    // Universal needs a separate anatomy layer so tooth isolation retains bone.
    if (model === 'universal') {
      const words = new Uint16Array(bytes.buffer), onlyTeeth = words.map(v=>v<=52?v:0), onlyAnatomy = words.map(v=>v>=53?v:0);
      workspace.labelmaps![0].data = new Uint8Array(onlyTeeth.buffer);
      group.segments = group.segments.filter(s=>s.value<=52);
      const bone = createStudySegmentGroup(state.study!.id, image.id, {name:'Universal anatomy', segments:Object.entries(result.labels).filter(([v])=>Number(v)>=53).map(([v,raw])=>createStudySegment({value:Number(v),name:(raw as {name:string}).name,color:'#c4b5fd'}))});
      state.segmentGroups.push(bone); state.analysisLayers.push({id:bone.id,role:'anatomy',modelId});
      workspace.labelmaps!.push({id:bone.id,data:new Uint8Array(onlyAnatomy.buffer)});
    }
    const caseFiles = await buildCaseFiles(volume, manifest, workspace);
    const files: Zippable = Object.fromEntries(Object.entries(unzipSync(original)).map(([path,data])=>[path,[data,{level:path.endsWith('.zst')?0:6}]]));
    const extended = {...manifest,extensions:{...manifest.extensions,analysis:{version:1,manifest:'analysis/manifest.json'}}};
    files['cbct-scan.json'] = new TextEncoder().encode(JSON.stringify(extended));
    Object.assign(files,caseFiles.files);
    const archive = zipSync(files,{level:6});
    const path = join(output, `${scan}-${model}.cbct.zip`);
    await writeFile(path,archive);
    const check = await openChunkedReader({blob:new Blob([archive])});
    const metadata = await readCaseMetadata(check);
    if (!metadata || metadata.manifest.scanSha256 !== binding.sha256) throw new Error('Generated case identity mismatch');
    const project = await buildProjectArchive(workspace);
    await writeFile(join(output,`${scan}-${model}.cbcter.zip`), new Uint8Array(await project.arrayBuffer()));
    console.log(JSON.stringify({scan,model,caseBytes:archive.byteLength,projectBytes:project.size,instances:instances.length,scanSha256:binding.sha256}));
  }
}
