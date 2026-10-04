import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync } from 'fflate';
import { caseFixture } from './fixture';
import { buildChunkedPackage } from '../import/chunked/package';
import { openChunkedReader } from '../import/chunked/reader';
import { layerReader, readCaseMetadata, readCaseWorkspace } from './archive';
import { sha256 } from '../import/chunked/codec';
import {
  bindVolume,
  assertProjectBinding,
  nativeBlock,
  identityAffine,
} from './binding';
import { translateStl } from './mesh';
import {
  splitTooth,
  mergeTeeth,
  summarizeTeeth,
  isolatePreview,
} from './teeth';
import { prepareVolumeFor3D } from '../volume';
import {
  buildProjectArchive,
  readProjectArchive,
} from '../project/exportProject';
import { toothCrossSection } from '../panoramic/crossSection';
const opts = {
  name: 'Synthetic case',
  windowLevel: { window: 3000, level: 500 },
};
describe('complete dental case', () => {
  it('restores raw scan, binary masks, instance IDs, original predictions, metadata and physical geometry; older scan readers still work', async () => {
    const { volume, workspace } = await caseFixture(),
      packed = await buildChunkedPackage(volume, {
        ...opts,
        analysis: workspace,
      }),
      reader = await openChunkedReader({ blob: packed.blob }, 16 * 1024),
      metadata = await readCaseMetadata(reader);
    expect(await reader.materialize()).toEqual(volume.native!.voxels);
    expect(metadata!.state.caseNotes).toBe(workspace.state.caseNotes);
    const restored = await readCaseWorkspace(reader, metadata!);
    expect(restored.state.toothInstances).toEqual(
      workspace.state.toothInstances,
    );
    expect(restored.state.dentalArch).toEqual(workspace.state.dentalArch);
    expect(restored.state.caseView).toEqual(workspace.state.caseView);
    expect(restored.predictions).toEqual(workspace.predictions);
    expect(restored.labelmaps).toEqual(workspace.labelmaps);
    expect(restored.masks).toEqual(workspace.masks);
    const layer = layerReader(
      reader,
      metadata!.manifest.layers.find((l) => l.id === 'fixture-teeth')!,
    );
    await layer.region([20, 14, 8], [18, 9, 1]);
    expect(layer.stats().cacheBytes).toBe(reader.stats().cacheBytes);
    expect(reader.stats().cacheBytes).toBeLessThanOrEqual(16384);
  });
  it('rejects a different scan with identical dimensions and rejects an unbound legacy project', async () => {
    const { volume } = await caseFixture(),
      binding = await bindVolume(volume);
    await assertProjectBinding(binding, volume);
    const other = {
      ...volume,
      voxels: volume.voxels.slice(),
      native: { ...volume.native!, voxels: volume.native!.voxels.slice() },
    };
    other.native.voxels[10]++;
    await expect(assertProjectBinding(binding, other)).rejects.toThrow(
      'different scan',
    );
    await expect(assertProjectBinding(undefined, volume)).rejects.toThrow(
      'no scan fingerprint',
    );
  });
  it('maps cropped label voxels, measurements, bookmarks and mesh millimetres onto the native grid', async () => {
    const { volume, workspace } = await caseFixture();
    volume.meta = {
      ...volume.meta,
      dimensions: [68, 36, 26],
      sourceOffset: [1, 1, 1],
    };
    volume.voxels = new Int16Array(68 * 36 * 26);
    const mask = new Uint8Array(volume.voxels.length);
    mask[0] = 1;
    workspace.binding = await bindVolume(volume);
    workspace.masks = [{ id: 'cropped-mask', data: mask }];
    workspace.labelmaps = [];
    workspace.predictions = [];
    workspace.state.toothInstances = [];
    workspace.state.dentalArch = undefined;
    workspace.state.measurements = [
      {
        id: 'm',
        studyId: 's',
        name: 'distance',
        kind: 'distance',
        points: [
          [0, 0, 0],
          [1, 2, 3],
        ],
        value: 1,
        unit: 'mm',
        visible: true,
        createdAt: 0,
        updatedAt: 0,
      },
    ];
    workspace.state.toothFindings = [
      {
        fdi: 11,
        conditions: ['caries'],
        note: '',
        point: [0, 0, 0],
        updatedAt: 0,
      },
    ];
    const stl = new Uint8Array(134);
    new DataView(stl.buffer).setUint32(80, 1, true);
    workspace.surfaces = [{ id: 'mesh', data: stl }];
    const packed = await buildChunkedPackage(volume, {
        ...opts,
        analysis: workspace,
      }),
      reader = await openChunkedReader({ blob: packed.blob }),
      metadata = await readCaseMetadata(reader),
      restored = await readCaseWorkspace(reader, metadata!);
    expect(restored.masks[0].data[(1 * 38 + 1) * 70 + 1]).toBe(1);
    expect(restored.masks[0].data[0]).toBe(0);
    expect(restored.state.measurements[0].points).toEqual([
      [1, 1, 1],
      [2, 3, 4],
    ]);
    expect(restored.state.toothFindings[0].point).toEqual([1, 1, 1]);
    expect(restored.state.caseView?.cursor).toEqual([25, 19, 15]);
    expect(restored.state.caseView?.windowLevel).toEqual(workspace.state.caseView?.windowLevel);
    const view = new DataView(restored.surfaces[0].data.buffer);
    expect(view.getFloat32(96, true)).toBeCloseTo(0.2);
    expect(view.getFloat32(100, true)).toBeCloseTo(0.3);
    expect(view.getFloat32(104, true)).toBeCloseTo(0.4);
  });
  it.each(['layer', 'study', 'geometry', 'dictionary'])(
    'rejects corrupt or misaligned %s data',
    async (kind) => {
      const { volume, workspace } = await caseFixture(),
        packed = await buildChunkedPackage(volume, {
          ...opts,
          analysis: workspace,
        }),
        files = unzipSync(new Uint8Array(await packed.blob.arrayBuffer())),
        text = new TextEncoder();
      const m = JSON.parse(
        new TextDecoder().decode(files['analysis/manifest.json']),
      );
      if (kind === 'layer') files[m.layers[0].chunks[0].file][2] ^= 1;
      if (kind === 'study') files['study.json'][12] ^= 1;
      if (kind === 'geometry') m.geometrySha256 = '0'.repeat(64);
      if (kind === 'dictionary') {
        const state = JSON.parse(new TextDecoder().decode(files['study.json']));
        state.toothInstances[0].value = 0;
        files['study.json'] = text.encode(JSON.stringify(state));
        m.studySha256 = await sha256(files['study.json']);
      }
      files['analysis/manifest.json'] = text.encode(JSON.stringify(m));
      const reader = await openChunkedReader({
        blob: new Blob([zipSync(files)]),
      });
      await expect(
        (async () => {
          const metadata = await readCaseMetadata(reader);
          return readCaseWorkspace(reader, metadata!);
        })(),
      ).rejects.toThrow();
    },
  );
  it('splits and merges real voxels, keeps the surviving instance ID, and changing FDI does not change mask bytes', async () => {
    const { volume, labels, workspace } = await caseFixture(),
      original = await sha256(labels),
      old = workspace.state.toothInstances!;
    const split = splitTooth(labels, volume.meta.dimensions, 11, 0, 24),
      instances = summarizeTeeth(
        split.labels,
        volume.meta.dimensions,
        'fixture-teeth',
        old,
      );
    expect(instances).toHaveLength(3);
    expect(instances.find((t) => t.value === 11)!.id).toBe(old[0].id);
    expect(
      split.labels.filter((v) => v === 11).length +
        split.labels.filter((v) => v === split.newValue).length,
    ).toBe(old[0].voxelCount);
    const merged = mergeTeeth(split.labels, 11, split.newValue);
    expect(merged).toEqual(labels);
    old[0].fdi = 12;
    expect(await sha256(labels)).toBe(original);
    expect(() => splitTooth(labels, volume.meta.dimensions, 11, 0, 0)).toThrow(
      'split plane',
    );
  });
  it('isolates actual 3D texture voxels, includes bone when requested, and restores project prediction bytes', async () => {
    const { volume, labels, workspace } = await caseFixture(),
      preview = prepareVolumeFor3D(volume),
      selected = isolatePreview(
        preview,
        labels,
        volume.meta.dimensions,
        11,
        'selected',
      );
    const index = (10 * 38 + 18) * 70 + 33;
    expect(preview.voxels[index]).toBeGreaterThan(0);
    expect(selected.voxels[index]).toBe(0);
    expect(selected.voxels[(10 * 38 + 18) * 70 + 24]).toBeGreaterThan(0);
    const anatomy = new Uint16Array(workspace.labelmaps![1].data.buffer),
      withBone = isolatePreview(
        preview,
        labels,
        volume.meta.dimensions,
        11,
        'selected',
        anatomy,
      );
    expect(withBone.voxels[(4 * 38 + 18) * 70 + 24]).toBeGreaterThan(0);
    const additionalTeeth = new Uint16Array(labels.length);
    const extraIndex = (4 * 38 + 18) * 70 + 24;
    additionalTeeth[extraIndex] = 1;
    const hidden = isolatePreview(
      preview,
      labels,
      volume.meta.dimensions,
      0,
      'hide-teeth',
      undefined,
      undefined,
      [labels, additionalTeeth],
    );
    expect(hidden.voxels[index]).toBe(0);
    expect(hidden.voxels[extraIndex]).toBe(0);
    expect(preview.voxels[extraIndex]).toBeGreaterThan(0);
    const blob = await buildProjectArchive(workspace),
      restored = await readProjectArchive(new File([blob], 'case.cbcter.zip'));
    expect(restored.predictions).toEqual(workspace.predictions);
    expect(restored.manifest.binding).toEqual(workspace.binding);
  });
  it('samples a cross-section in physical space with correct anisotropic pixel geometry', async () => {
    const { volume, workspace } = await caseFixture();
    const section = toothCrossSection(
      volume,
      {
        controlPoints: [
          { x: 0, y: 18 },
          { x: 69, y: 18 },
        ],
      },
      [24, 18, 14],
      { widthMm: 6, angleDeg: 0, window: 3000, level: 500 },
    );
    expect(section.height).toBe(28);
    expect(section.mmPerPixelY).toBe(0.4);
    expect(section.mmPerPixelX * (section.width - 1)).toBe(6);
    expect(
      section.data[
        ((28 - 1 - 14) * section.width + Math.floor(section.width / 2)) * 4
      ],
    ).toBeGreaterThan(100);
    expect(workspace.state.dentalArch).toBeDefined();
  });
  it('fails unsupported registration and translates ASCII meshes', () => {
    const transform = [...identityAffine];
    transform[1] = 1;
    expect(() =>
      nativeBlock(
        new Uint8Array(1),
        [1, 1, 1],
        transform as typeof identityAffine,
        [0, 0, 0],
        [1, 1, 1],
      ),
    ).toThrow('registration');
    expect(
      new TextDecoder().decode(
        translateStl(
          new TextEncoder().encode('solid s\nvertex 1 2 3\nendsolid'),
          [0.1, 0.2, 0.3],
        ),
      ),
    ).toContain('vertex 1.1 2.2 3.3');
  });
});
