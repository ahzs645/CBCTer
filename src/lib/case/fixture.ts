// Synthetic, non-patient fixture shared by archive and browser tests.
import { VolumeAxis, type LoadedVolume, type Vec3 } from '../../types';
import {
  createEmptyStudyState,
  createStudyImageLayer,
  createStudySegmentGroup,
  createStudySegment,
  createStudyMask,
} from '../../domain/studyState';
import { summarizeTeeth } from './teeth';
import { bindVolume } from './binding';
import type { CaseWorkspace } from './types';
export async function caseFixture() {
  const dimensions: Vec3 = [70, 38, 28],
    spacing: Vec3 = [0.2, 0.3, 0.4],
    voxels = new Int16Array(dimensions.reduce((a, b) => a * b, 1)).fill(-800),
    labels = new Uint16Array(voxels.length),
    anatomy = new Uint16Array(voxels.length);
  for (let z = 8; z <= 20; z++)
    for (let y = 14; y <= 22; y++)
      for (let x = 20; x <= 37; x++) {
        const i = (z * 38 + y) * 70 + x;
        labels[i] = x < 29 ? 11 : 32;
        voxels[i] = 1800;
        anatomy[i] = 3;
      }
  for (let z = 3; z <= 6; z++)
    for (let y = 10; y <= 26; y++)
      for (let x = 15; x <= 43; x++) {
        const i = (z * 38 + y) * 70 + x;
        voxels[i] = 900;
        anatomy[i] = 2;
      }
  const volume: LoadedVolume = {
    voxels,
    histogram: new Uint32Array(4096),
    meta: {
      format: 'dicom',
      formatLabel: 'Synthetic CT',
      scanId: 'Synthetic dental case',
      dimensions,
      spacing,
      scalarRange: [-800, 1800],
      initialWindowLevel: { window: 3000, level: 500 },
      sliceCount: 28,
      bytesPerVoxel: 2,
      headerFileName: '',
      slicePrefix: '',
      sliceFiles: [],
      nativeAxis: VolumeAxis.Axial,
    },
    native: {
      voxels: voxels.slice(),
      metadata: {
        dimensions,
        spacing,
        dtype: 'int16',
        bitsStored: 16,
        paddingValue: null,
        origin: [-20, -30, 10],
        direction: [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ],
        coordinateSystem: 'LPS',
        representation: 'native',
        calibration: { divisor: 1, slope: 1, intercept: 0 },
      },
    },
  };
  const study = {
      id: 'fixture-study',
      name: 'Synthetic dental case',
      source: 'sample' as const,
      fileCount: 1,
      totalBytes: voxels.byteLength,
      status: 'indexed' as const,
      createdAt: 0,
      updatedAt: 0,
    },
    state = createEmptyStudyState(study),
    image = createStudyImageLayer(study.id, {
      name: 'Fixture CT',
      source: 'sample',
      dimensions,
      spacing,
    });
  state.images = [image];
  state.activeImageId = image.id;
  const group = createStudySegmentGroup(study.id, image.id, {
    name: 'Individual teeth',
    segments: [
      createStudySegment({ value: 11, name: 'Tooth 11', color: '#38bdf8' }),
      createStudySegment({ value: 32, name: 'Tooth 32', color: '#a78bfa' }),
    ],
  });
  group.id = 'fixture-teeth';
  const bone = createStudySegmentGroup(study.id, image.id, {
    name: 'Fixture anatomy',
    segments: [
      createStudySegment({ value: 2, name: 'Mandible', color: '#10b981' }),
      createStudySegment({ value: 3, name: 'Upper teeth', color: '#f472b6' }),
    ],
  });
  bone.id = 'fixture-anatomy';
  state.segmentGroups = [group, bone];
  state.activeSegmentGroupId = group.id;
  state.toothInstances = summarizeTeeth(labels, dimensions, group.id).map(
    (t) => ({
      ...t,
      id: `stable-tooth-${t.value}`,
      fdi: t.value === 11 ? 11 : 21,
      source: 'model' as const,
    }),
  );
  state.selectedInstanceId = state.toothInstances[0].id;
  state.analysisLayers = [
    {
      id: group.id,
      role: 'teeth',
      modelId: 'fixture-model',
      predictionId: 'fixture-prediction',
    },
    { id: bone.id, role: 'anatomy' },
    { id: 'fixture-prediction', role: 'prediction', modelId: 'fixture-model' },
  ];
  state.analysisModels = [
    {
      id: 'fixture-model',
      name: 'Synthetic segmentation fixture (not inference)',
      version: 'fixture-v1',
      weightsSha256: null,
      preprocessing: { synthetic: 1 },
      createdAt: 0,
    },
  ];
  state.analysisRevisions = [
    {
      id: 'fixture-revision',
      at: 0,
      action: 'synthetic prediction',
      instanceIds: state.toothInstances.map((t) => t.id),
      modelId: 'fixture-model',
    },
  ];
  state.caseNotes = 'Synthetic test findings';
  state.caseView={cursor:[24,18,14],axis:VolumeAxis.Axial,zoom:1,windowLevel:{window:3000,level:500},invert:false};
  state.dentalArch = {
    curve: {
      controlPoints: [
        { x: 20, y: 18 },
        { x: 29, y: 15 },
        { x: 37, y: 18 },
      ],
    },
    options: {
      zMin: 3,
      zMax: 22,
      depthMm: 10,
      depthStepMm: 0.5,
      archStepMm: 0.3,
      projection: 'mean',
      window: 3000,
      level: 500,
    },
    crossSection: { widthMm: 20, angleDeg: 0 },
  };
  const mask = createStudyMask(study.id, image.id, {
    name: 'Fixture binary mask',
    color: '#f59e0b',
  });
  state.masks = [mask];
  const binary = Uint8Array.from(labels, (v) => (v === 11 ? 1 : 0));
  const workspace: CaseWorkspace = {
    state,
    binding: await bindVolume(volume),
    masks: [{ id: mask.id, data: binary }],
    labelmaps: [
      { id: group.id, data: new Uint8Array(labels.buffer) },
      { id: bone.id, data: new Uint8Array(anatomy.buffer) },
    ],
    predictions: [
      { id: 'fixture-prediction', data: new Uint8Array(labels.slice().buffer) },
    ],
    surfaces: [],
  };
  return { volume, workspace, labels };
}
