import { it, expect, vi } from 'vitest';
import { caseFixture } from '../case/fixture';
const store = vi.hoisted(() => ({ record: undefined as unknown }));
vi.mock('../../local-dexie/db', () => ({
  db: {
    projects: {
      get: async () => structuredClone(store.record),
      put: async (record: unknown) => {
        store.record = structuredClone(record);
      },
    },
  },
}));
import { saveLatestProject, loadLatestProject } from './localProjectStore';
it('local saving restores labelmaps, immutable predictions and scan binding along with the case state', async () => {
  const { workspace } = await caseFixture();
  await saveLatestProject(workspace);
  const restored = await loadLatestProject();
  expect(restored!.labelmaps).toEqual(workspace.labelmaps);
  expect(restored!.predictions).toEqual(workspace.predictions);
  expect(restored!.masks).toEqual(workspace.masks);
  expect(restored!.manifest.binding).toEqual(workspace.binding);
  expect(restored!.manifest.state.toothInstances).toEqual(
    workspace.state.toothInstances,
  );
  expect(
    restored!.manifest.dataSources.filter((s) => s.role === 'labelmap'),
  ).toHaveLength(2);
});
