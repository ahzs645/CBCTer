import { translateStl } from './mesh';
import { FDI_NUMBERS } from './teeth';
import type { Zippable } from 'fflate';
import type { LoadedVolume, Vec3 } from '../../types';
import { normalizeStudyState } from '../../domain/studyState';
import { encodeChunk, sha256 } from '../import/chunked/codec';
import {
  blockDescriptors,
  type ChunkedManifest,
} from '../import/chunked/manifest';
import type { ChunkedReader } from '../import/chunked/reader';
import {
  geometryHash,
  identityAffine,
  nativeBlock,
  transformPoint,
} from './binding';
import type {
  AnalysisManifest,
  CaseLayer,
  CaseMetadata,
  CaseWorkspace,
  ScanBinding,
} from './types';
const text = new TextEncoder(),
  hash = (s: unknown) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
function stateOnNative(workspace: CaseWorkspace, binding: ScanBinding) {
  const state = structuredClone(workspace.state),
    m = binding.displayToNative,
    point = (p: Vec3) => transformPoint(p, m);
  state.images = state.images.map((image) => ({
    ...image,
    dimensions: binding.geometry.dimensions,
    spacing: binding.geometry.spacing,
  }));
  state.measurements = state.measurements.map((v) => ({
    ...v,
    points: v.points.map(point),
  }));
  state.annotations = state.annotations.map((v) => ({
    ...v,
    point: point(v.point),
  }));
  state.toothFindings = state.toothFindings.map((v) => ({
    ...v,
    point: v.point ? point(v.point) : undefined,
  }));
  if(state.caseView)state.caseView.cursor=point(state.caseView.cursor);
  state.toothInstances = state.toothInstances?.map((v) => ({
    ...v,
    centroid: point(v.centroid),
    bounds: { min: point(v.bounds.min), max: point(v.bounds.max) },
  }));
  if (state.cropBounds)
    state.cropBounds = {
      ...state.cropBounds,
      min: point(state.cropBounds.min),
      max: point(state.cropBounds.max),
    };
  if (state.dentalArch) {
    state.dentalArch.curve.controlPoints =
      state.dentalArch.curve.controlPoints.map((p) => {
        const q = point([p.x, p.y, 0]);
        return { x: q[0], y: q[1] };
      });
    state.dentalArch.options.zMin = point([
      0,
      0,
      state.dentalArch.options.zMin,
    ])[2];
    state.dentalArch.options.zMax = point([
      0,
      0,
      state.dentalArch.options.zMax,
    ])[2];
  }
  return state;
}
export async function buildCaseFiles(
  volume: Pick<LoadedVolume, 'voxels' | 'meta' | 'native'>,
  native: ChunkedManifest,
  workspace: CaseWorkspace,
): Promise<{ files: Zippable; manifest: AnalysisManifest }> {
  const supplied = workspace.binding;
  const matrix = [...identityAffine] as ScanBinding['displayToNative'];
  for (let a = 0; a < 3; a++) {
    matrix[a * 4 + a] = volume.meta.spacing[a] / native.volume.spacing[a];
    matrix[a * 4 + 3] = volume.meta.sourceOffset?.[a] ?? 0;
  }
  const geometry = {
    dimensions: native.volume.dimensions,
    spacing: native.volume.spacing,
    origin: native.volume.origin,
    direction: native.volume.direction,
    coordinateSystem: native.volume.coordinateSystem,
  };
  const geoHash = await geometryHash(geometry);
  if (
    supplied &&
    (supplied.sha256 !== native.volume.sha256 ||
      supplied.geometrySha256 !== geoHash)
  )
    throw new Error('Analysis belongs to a different native scan.');
  const binding: ScanBinding = {
    sha256: native.volume.sha256,
    geometrySha256: geoHash,
    geometry,
    displaySha256: supplied?.displaySha256 ?? '',
    displayDimensions: volume.meta.dimensions,
    displaySpacing: volume.meta.spacing,
    displayToNative: matrix,
  };
  const files: Zippable = {},
    layers: CaseLayer[] = [];
  const summaries = new Map<
    string,
    Map<number, { count: number; sum: Vec3; min: Vec3; max: Vec3 }>
  >();
  const inputs = [
    ...workspace.masks.map((v) => ({
      ...v,
      role: 'mask' as const,
      words: v.data,
    })),
    ...(workspace.labelmaps ?? []).map((v) => ({
      ...v,
      role: 'labels' as const,
      words: new Uint16Array(
        v.data.buffer.slice(
          v.data.byteOffset,
          v.data.byteOffset + v.data.byteLength,
        ) as ArrayBuffer,
      ),
    })),
    ...(workspace.predictions ?? []).map((v) => ({
      ...v,
      role: 'prediction' as const,
      words: new Uint16Array(
        v.data.buffer.slice(
          v.data.byteOffset,
          v.data.byteOffset + v.data.byteLength,
        ) as ArrayBuffer,
      ),
    })),
  ];
  if (new Set(inputs.map((v) => v.id)).size !== inputs.length)
    throw new Error('Analysis layer IDs must be unique.');
  for (const [index, input] of inputs.entries()) {
    const info = workspace.state.analysisLayers?.find((v) => v.id === input.id);
    const layer: CaseLayer = {
      ...info,
      id: input.id,
      role: info?.role ?? input.role,
      byteOrder:'little-endian',layout:'x-fastest',
      hashKind: 'ordered-chunk-sha256',
      dtype: 'uint16',
      dimensions: native.volume.dimensions,
      sha256: '',
      chunks: [],
    };
    // Hash canonical output incrementally by slab to avoid a second full label
    // volume solely for integrity. Chunk hashes plus a hash of their ordered
    // descriptors form this layer's root; descriptors are schema validated.
    for (const descriptor of blockDescriptors(layer.dimensions)) {
      const words = nativeBlock(
        input.words,
        volume.meta.dimensions,
        matrix,
        descriptor.start,
        descriptor.shape,
      );
      if (layer.role === 'teeth') {
        let stats = summaries.get(layer.id);
        if (!stats) {
          stats = new Map();
          summaries.set(layer.id, stats);
        }
        for (let i = 0; i < words.length; i++) {
          const value = words[i];
          if (!value) continue;
          const p: Vec3 = [
            (i % descriptor.shape[0]) + descriptor.start[0],
            (Math.floor(i / descriptor.shape[0]) % descriptor.shape[1]) +
              descriptor.start[1],
            Math.floor(i / (descriptor.shape[0] * descriptor.shape[1])) +
              descriptor.start[2],
          ];
          let item = stats.get(value);
          if (!item) {
            item = { count: 0, sum: [0, 0, 0], min: [...p], max: [...p] };
            stats.set(value, item);
          }
          item.count++;
          for (let a = 0; a < 3; a++) {
            item.sum[a] += p[a];
            item.min[a] = Math.min(item.min[a], p[a]);
            item.max[a] = Math.max(item.max[a], p[a]);
          }
        }
      }
      const encoded = await encodeChunk(words, descriptor.shape[0]),
        file = `analysis/layer-${index}/${layer.chunks.length}.zst`;
      files[file] = [encoded, { level: 0 }];
      layer.chunks.push({
        ...descriptor,
        file,
        bytes: encoded.length,
        sha256: await sha256(words),
      });
    }
    layer.sha256 = await sha256(
      text.encode(JSON.stringify(layer.chunks.map((v) => v.sha256))),
    );
    layers.push(layer);
  }
  const state = stateOnNative(workspace, binding);
  state.toothInstances = state.toothInstances?.map((t) => {
    const item = summaries.get(t.groupId)?.get(t.value);
    if (!item)
      throw new Error('A tooth dictionary entry has no native voxels.');
    return {
      ...t,
      voxelCount: item.count,
      centroid: item.sum.map((n) => n / item.count) as Vec3,
      bounds: { min: item.min, max: item.max },
    };
  });
  const study = text.encode(JSON.stringify(state));
  files['study.json'] = [study, { level: 6 }];
  const surfaces: AnalysisManifest['surfaces'] = [];
  for (const [index, surface] of workspace.surfaces.entries()) {
    const file = `meshes/${index}.stl`,
      data = translateStl(
        surface.data,
        matrix
          .filter((_, i) => [3, 7, 11].includes(i))
          .map((n, a) => n * native.volume.spacing[a]) as Vec3,
      );
    files[file] = [data, { level: 6 }];
    surfaces.push({
      id: surface.id,
      file,
      bytes: data.length,
      sha256: await sha256(data),
    });
  }
  const manifest: AnalysisManifest = {
    format: 'cbcter-analysis',
    version: 1,
    scanSha256: native.volume.sha256,
    geometrySha256: geoHash,
    studyFile: 'study.json',
    studySha256: await sha256(study),
    sourceGrid: {
      dimensions: volume.meta.dimensions,
      spacing: volume.meta.spacing,
      toNative: matrix,
    },
    layers,
    surfaces,
  };
  files['analysis/manifest.json'] = [
    text.encode(JSON.stringify(manifest)),
    { level: 6 },
  ];
  return { files, manifest };
}
export async function readCaseMetadata(
  reader: ChunkedReader,
): Promise<CaseMetadata | undefined> {
  if (!reader.manifest.extensions?.analysis) return undefined;
  const m = JSON.parse(
    new TextDecoder().decode(await reader.fileBytes('analysis/manifest.json')),
  ) as AnalysisManifest;
  const v = reader.manifest.volume,
    geometry = {
      dimensions: v.dimensions,
      spacing: v.spacing,
      origin: v.origin,
      direction: v.direction,
      coordinateSystem: v.coordinateSystem,
    };
  if (
    m.format !== 'cbcter-analysis' ||
    m.version !== 1 ||
    m.scanSha256 !== v.sha256 ||
    m.geometrySha256 !== (await geometryHash(geometry)) ||
    m.studyFile !== 'study.json' ||
    !hash(m.studySha256) ||
    !Array.isArray(m.layers) ||
    m.layers.length > 64 ||
    !Array.isArray(m.surfaces) ||
    m.surfaces.length > 512
  )
    throw new Error(
      'Analysis does not match the scan or has an invalid manifest.',
    );
  const grid = m.sourceGrid;
  if (
    !grid ||
    !Array.isArray(grid.dimensions) ||
    grid.dimensions.length !== 3 ||
    !grid.dimensions.every(
      (n) => Number.isSafeInteger(n) && n > 0 && n <= 4096,
    ) ||
    !Array.isArray(grid.spacing) ||
    grid.spacing.length !== 3 ||
    !grid.spacing.every((n) => Number.isFinite(n) && n > 0) ||
    !Array.isArray(grid.toNative) ||
    grid.toNative.length !== 16 ||
    !grid.toNative.every(Number.isFinite) ||
    [1, 2, 4, 6, 8, 9, 12, 13, 14].some((i) => grid.toNative[i] !== 0) ||
    grid.toNative[15] !== 1 ||
    [0, 1, 2].some(
      (a) => grid.toNative[a * 4 + a] !== grid.spacing[a] / v.spacing[a],
    )
  )
    throw new Error('Invalid analysis source transform.');
  const ids = new Set<string>();
  for (const [index, layer] of m.layers.entries()) {
    const expected = blockDescriptors(v.dimensions);
    if (
      typeof layer.id !== 'string' ||
      ids.has(layer.id) ||
      !['mask', 'labels', 'anatomy', 'teeth', 'prediction'].includes(
        layer.role,
      ) ||
      layer.byteOrder!=='little-endian'||layer.layout!=='x-fastest'||
      layer.hashKind !== 'ordered-chunk-sha256' ||
      layer.dtype !== 'uint16' ||
      JSON.stringify(layer.dimensions) !== JSON.stringify(v.dimensions) ||
      !hash(layer.sha256) ||
      !Array.isArray(layer.chunks) ||
      layer.chunks.length !== expected.length
    )
      throw new Error('Invalid analysis layer.');
    ids.add(layer.id);
    layer.chunks.forEach((chunk, i) => {
      if (
        chunk.file !== `analysis/layer-${index}/${i}.zst` ||
        !hash(chunk.sha256) ||
        !Number.isInteger(chunk.bytes) ||
        chunk.bytes < 1 ||
        chunk.bytes > 1048576 ||
        JSON.stringify(chunk.start) !== JSON.stringify(expected[i].start) ||
        JSON.stringify(chunk.shape) !== JSON.stringify(expected[i].shape)
      )
        throw new Error('Invalid analysis block coverage.');
    });
    if (
      (await sha256(
        text.encode(JSON.stringify(layer.chunks.map((c) => c.sha256))),
      )) !== layer.sha256
    )
      throw new Error('Analysis layer root checksum mismatch.');
  }
  m.surfaces.forEach((s, i) => {
    if (
      typeof s.id !== 'string' ||
      s.file !== `meshes/${i}.stl` ||
      !Number.isSafeInteger(s.bytes) ||
      s.bytes < 0 ||
      s.bytes > 128 * 1024 * 1024 ||
      !hash(s.sha256)
    )
      throw new Error('Invalid case mesh.');
  });
  const study = await reader.fileBytes(m.studyFile);
  if ((await sha256(study)) !== m.studySha256)
    throw new Error('Study checksum mismatch.');
  const state = normalizeStudyState(
    JSON.parse(new TextDecoder().decode(study)),
  );
  const instanceIds = new Set<string>(),
    values = new Set<string>();
  for (const tooth of state.toothInstances ?? []) {
    const layer = m.layers.find(
      (v) => v.id === tooth.groupId && v.role === 'teeth',
    );
    const key = `${tooth.groupId}:${tooth.value}`;
    if (
      !layer ||
      typeof tooth.id !== 'string' ||
      instanceIds.has(tooth.id) ||
      values.has(key) ||
      !['unreviewed', 'accepted', 'rejected', 'corrected'].includes(
        tooth.review,
      ) ||
      (tooth.fdi !== null && !FDI_NUMBERS.includes(tooth.fdi)) ||
      !Number.isSafeInteger(tooth.voxelCount) ||
      tooth.voxelCount < 1 ||
      (tooth.confidence !== undefined &&
        (!Number.isFinite(tooth.confidence) ||
          tooth.confidence < 0 ||
          tooth.confidence > 1)) ||
      !tooth.bounds ||
      !Array.isArray(tooth.bounds.min) ||
      !Array.isArray(tooth.bounds.max) ||
      tooth.bounds.min.length !== 3 ||
      tooth.bounds.max.length !== 3 ||
      !tooth.bounds.min.every(
        (n, a) =>
          Number.isFinite(n) &&
          n >= 0 &&
          n <= tooth.bounds.max[a] &&
          tooth.bounds.max[a] < v.dimensions[a],
      ) ||
      !Number.isInteger(tooth.value) ||
      tooth.value < 1 ||
      tooth.value > 65535 ||
      !Array.isArray(tooth.centroid) ||
      tooth.centroid.length !== 3 ||
      !tooth.centroid.every(
        (n, a) => Number.isFinite(n) && n >= 0 && n < v.dimensions[a],
      )
    )
      throw new Error('Invalid tooth instance dictionary.');
    instanceIds.add(tooth.id);
    values.add(key);
  }
  if (
    state.analysisModels?.some(
      (model) =>
        typeof model.id !== 'string' ||
        typeof model.name !== 'string' ||
        (model.weightsSha256 !== null && !hash(model.weightsSha256)),
    )
  )
    throw new Error('Invalid model provenance.');
  if(state.caseView){const view=state.caseView;if(!Array.isArray(view.cursor)||view.cursor.length!==3||!view.cursor.every((n,a)=>Number.isFinite(n)&&n>=0&&n<v.dimensions[a])||!['axial','coronal','sagittal'].includes(view.axis)||!Number.isFinite(view.zoom)||view.zoom<=0||view.zoom>64||!Number.isFinite(view.windowLevel?.window)||view.windowLevel.window<=0||!Number.isFinite(view.windowLevel.level)||typeof view.invert!=='boolean')throw new Error('Invalid saved case view.');}
  if (state.dentalArch) {
    const arch = state.dentalArch;
    if (
      !Array.isArray(arch.curve?.controlPoints) ||
      arch.curve.controlPoints.length > 512 ||
      arch.curve.controlPoints.some(
        (p) =>
          !Number.isFinite(p.x) ||
          !Number.isFinite(p.y) ||
          p.x < 0 ||
          p.y < 0 ||
          p.x >= v.dimensions[0] ||
          p.y >= v.dimensions[1],
      ) ||
      !arch.options ||
      !Number.isFinite(arch.options.zMin) ||
      !Number.isFinite(arch.options.zMax) ||
      arch.options.zMin < 0 ||
      arch.options.zMax >= v.dimensions[2] ||
      !arch.crossSection ||
      !Number.isFinite(arch.crossSection.widthMm) ||
      arch.crossSection.widthMm < 1 ||
      arch.crossSection.widthMm > 100 ||
      !Number.isFinite(arch.crossSection.angleDeg)
    )
      throw new Error('Invalid saved dental arch.');
  }
  return { manifest: m, state };
}
export function layerReader(reader: ChunkedReader, layer: CaseLayer) {
  return reader.fork({
    ...reader.manifest,
    volume: {
      ...reader.manifest.volume,
      dtype: 'uint16',
      bitsStored: 16,
      highBit: 15,
      paddingValue: null,
      calibration: { divisor: 1, slope: 1, intercept: 0 },
      chunks: layer.chunks,
      sha256: '',
    },
  });
}
export async function readCaseWorkspace(
  reader: ChunkedReader,
  metadata: CaseMetadata,
): Promise<CaseWorkspace> {
  const workspace: CaseWorkspace = {
    state: metadata.state,
    masks: [],
    labelmaps: [],
    predictions: [],
    surfaces: [],
  };
  for (const layer of metadata.manifest.layers) {
    const labels = await layerReader(reader, layer).materialize(
      undefined,
      false,
    );
    if (layer.role === 'mask') {
      if (labels.some((v) => v > 1))
        throw new Error('Binary mask contains non-binary labels.');
      workspace.masks.push({ id: layer.id, data: Uint8Array.from(labels) });
    } else {
      const data = new Uint8Array(labels.buffer);
      if (layer.role === 'prediction')
        workspace.predictions!.push({ id: layer.id, data });
      else workspace.labelmaps!.push({ id: layer.id, data });
    }
  }
  for (const surface of metadata.manifest.surfaces) {
    const data = await reader.fileBytes(surface.file, surface.bytes);
    if ((await sha256(data)) !== surface.sha256)
      throw new Error('Mesh checksum mismatch.');
    workspace.surfaces.push({ id: surface.id, data });
  }
  return workspace;
}
