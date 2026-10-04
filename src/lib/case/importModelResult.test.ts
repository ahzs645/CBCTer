import { describe, expect, it } from 'vitest';
import { caseFixture } from './fixture';
import { mergeModelResult } from './importModelResult';
import { buildProjectArchive, readProjectArchive } from '../project/exportProject';

async function setup() {
  const { volume, workspace } = await caseFixture();
  const archive = await readProjectArchive(new File([await buildProjectArchive({...workspace, masks:[], surfaces:[]})], 'model.cbcter.zip'));
  const current = structuredClone(workspace.state);
  current.segmentGroups = []; current.analysisModels = []; current.analysisLayers = []; current.toothInstances = [];
  current.caseNotes = 'Dentist notes to keep';
  return { volume, archive, current };
}
describe('model result import', () => {
  it('adds unreviewed proposals while preserving notes, measurements, chart and view', async () => {
    const {volume, archive, current} = await setup();
    archive.manifest.state.toothInstances![0].review = 'accepted';
    const next = mergeModelResult(current, archive, volume.voxels.length);
    expect(next.caseNotes).toBe(current.caseNotes);
    expect(next.measurements).toEqual(current.measurements);
    expect(next.toothFindings).toEqual(current.toothFindings);
    expect(next.caseView).toEqual(current.caseView);
    expect(next.toothInstances!.every(t => t.review === 'unreviewed')).toBe(true);
    expect(next.segmentGroups.every(g => g.imageId === current.activeImageId)).toBe(true);
    expect(() => mergeModelResult(next, archive, volume.voxels.length)).toThrow('already loaded');
  });
  it('rejects wrong byte counts and leaves the current study untouched', async () => {
    const {volume, archive, current} = await setup();
    archive.labelmaps[0].data = new Uint8Array(2);
    expect(() => mergeModelResult(current, archive, volume.voxels.length)).toThrow('do not match');
    expect(current.segmentGroups).toHaveLength(0);
    expect(current.caseNotes).toBe('Dentist notes to keep');
  });
  it('rejects excessive ZIP allocations before inflating predictions', async () => {
    const { archive } = await setup();
    const blob = await buildProjectArchive({...archive, state: archive.manifest.state});
    await expect(readProjectArchive(new File([blob], 'model.zip'), 1024)).rejects.toThrow('too large');
  });
});
