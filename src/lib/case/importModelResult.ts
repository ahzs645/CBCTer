import type { StudyState } from '../../domain/types';
import type { ProjectArchive } from '../project/exportProject';

/** Called only after asserting the project's scan/display binding. Never
 * replaces an existing proposal, dentist correction, chart, note or view. */
export function mergeModelResult(current: StudyState, archive: ProjectArchive, voxelCount: number): StudyState {
  const incoming = archive.manifest.state;
  const image = current.images.find(i => i.id === current.activeImageId);
  if (!image || !current.study) throw new Error('Open a scan before importing model results.');
  if (archive.masks.length || archive.surfaces.length || !archive.labelmaps.length ||
      !incoming.analysisModels?.length || !incoming.analysisLayers?.length) {
    throw new Error('Choose a model result project containing labelmaps and model provenance. Restore complete projects from Study.');
  }
  const existing = new Set([
    ...current.segmentGroups.map(g => g.id), ...(current.analysisModels ?? []).map(m => m.id),
    ...(current.analysisLayers ?? []).map(l => l.id), ...(current.toothInstances ?? []).map(t => t.id),
  ]);
  const ids = [...incoming.segmentGroups.map(g => g.id), ...(incoming.analysisModels ?? []).map(m => m.id),
    ...(incoming.analysisLayers ?? []).map(l => l.id), ...(incoming.toothInstances ?? []).map(t => t.id)];
  if (ids.some(id => existing.has(id))) throw new Error('This model result is already loaded. Existing review and corrections have been kept.');
  const groups = new Set(incoming.segmentGroups.map(g => g.id));
  const maps = new Set(archive.labelmaps.map(l => l.id));
  if (groups.size !== incoming.segmentGroups.length || maps.size !== archive.labelmaps.length ||
      maps.size !== groups.size || [...maps].some(id => !groups.has(id)) ||
      archive.labelmaps.some(l => l.data.byteLength !== voxelCount * 2) ||
      (archive.predictions ?? []).some(l => l.data.byteLength !== voxelCount * 2) ||
      incoming.toothInstances?.some(t => !groups.has(t.groupId))) {
    throw new Error('Model labelmaps do not match the loaded scan or their proposed regions.');
  }
  return {
    ...current,
    segmentGroups: [...current.segmentGroups, ...incoming.segmentGroups.map(g => ({
      ...g, studyId: current.study!.id, imageId: image.id,
    }))],
    activeSegmentGroupId: incoming.activeSegmentGroupId ?? incoming.segmentGroups[0]?.id,
    analysisModels: [...(current.analysisModels ?? []), ...incoming.analysisModels],
    analysisLayers: [...(current.analysisLayers ?? []), ...incoming.analysisLayers],
    toothInstances: [...(current.toothInstances ?? []), ...(incoming.toothInstances ?? []).map(t => ({...t, review: 'unreviewed' as const}))],
    selectedInstanceId: current.selectedInstanceId ?? incoming.toothInstances?.[0]?.id,
    analysisRevisions: [...(current.analysisRevisions ?? []), {
      id: crypto.randomUUID(), at: Date.now(), action: 'Import model proposals for dentist review',
      instanceIds: (incoming.toothInstances ?? []).map(t => t.id),
    }],
  };
}
