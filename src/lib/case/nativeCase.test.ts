/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { openChunkedReader } from '../import/chunked/reader';
import { buildChunkedPackage } from '../import/chunked/package';
import { readCaseMetadata, readCaseWorkspace } from './archive';
import { bindVolume } from './binding';
import { displayVoxels } from '../volume/native';
import {
  createEmptyStudyState,
  createStudyImageLayer,
  createStudyMask,
} from '../../domain/studyState';
import { sha256 } from '../import/chunked/codec';
import type { LoadedVolume, Vec3 } from '../../types';
const root = process.env.CBCTER_VALIDATION_OUT;
describe.skipIf(!root)('authorized native case alignment', () => {
  it.each(['onevolume', 'sidexis'])(
    'saves and restores %s with an aligned sparse mask and unchanged native scan',
    async (name) => {
      const reader = await openChunkedReader({
          blob: new Blob([await readFile(`${root}/${name}.cbct.zip`)]),
        }),
        m = reader.manifest;
      const raw = await reader.materialize(),
        full = displayVoxels(raw, m.volume),
        dimensions: Vec3 =
          name === 'onevolume' ? [340, 340, 340] : m.volume.dimensions,
        offset: Vec3 = name === 'onevolume' ? [0, 0, 1] : [0, 0, 0];
      let voxels = full;
      if (name === 'onevolume') {
        voxels = new Int16Array(340 ** 3);
        for (let z = 0; z < 340; z++)
          for (let y = 0; y < 340; y++) {
            const from = ((z + 1) * 341 + y) * 341;
            voxels.set(full.subarray(from, from + 340), (z * 340 + y) * 340);
          }
      }
      const volume: LoadedVolume = {
        voxels,
        histogram: new Uint32Array(4096),
        native: { voxels: raw, metadata: m.volume },
        meta: {
          format: 'cbct-package',
          formatLabel: m.source.formatLabel,
          scanId: 'Authorized alignment validation',
          dimensions,
          spacing: m.volume.spacing,
          sourceOffset: offset,
          scalarRange: m.scalarRange,
          initialWindowLevel: m.display,
          sliceCount: dimensions[2],
          bytesPerVoxel: 2,
          headerFileName: '',
          slicePrefix: '',
          sliceFiles: [],
          nativeAxis: m.orientation.nativeAxis,
        },
      };
      const state = createEmptyStudyState({
          id: 'validation',
          name: 'Aligned sparse test mask',
          source: 'local-files',
          status: 'indexed',
          fileCount: 1,
          totalBytes: raw.byteLength,
          createdAt: 0,
          updatedAt: 0,
        }),
        image = createStudyImageLayer('validation', {
          name: 'Scan',
          source: 'local-files',
          dimensions,
          spacing: m.volume.spacing,
        }),
        mask = createStudyMask('validation', image.id, {
          name: 'Alignment test points',
          color: '#38bdf8',
        });
      state.images = [image];
      state.activeImageId = image.id;
      state.masks = [mask];
      const data = new Uint8Array(voxels.length);
      data[0] = 1;
      data[data.length - 1] = 1;
      const t = performance.now(),
        packed = await buildChunkedPackage(volume, {
          name: 'Authorized case validation',
          windowLevel: m.display,
          analysis: {
            state,
            binding: await bindVolume(volume),
            masks: [{ id: mask.id, data }],
            labelmaps: [],
            surfaces: [],
          },
        }),
        restoredReader = await openChunkedReader({ blob: packed.blob }),
        metadata = await readCaseMetadata(restoredReader),
        workspace = await readCaseWorkspace(restoredReader, metadata!);
      const native = m.volume.dimensions,
        index = (p: Vec3) => (p[2] * native[1] + p[1]) * native[0] + p[0];
      expect(workspace.masks[0].data[index(offset)]).toBe(1);
      expect(
        workspace.masks[0].data[
          index(dimensions.map((n, a) => n - 1 + offset[a]) as Vec3)
        ],
      ).toBe(1);
      expect(workspace.masks[0].data.reduce((a, b) => a + b, 0)).toBe(2);
      if (name === 'onevolume') expect(workspace.masks[0].data[0]).toBe(0);
      expect(await sha256(await restoredReader.materialize())).toBe(
        m.volume.sha256,
      );
      expect(metadata!.manifest.sourceGrid.toNative[11]).toBe(offset[2]);
      await writeFile(
        `${root}/${name}-case-validation.json`,
        JSON.stringify(
          {
            name,
            nativeDimensions: native,
            sourceDimensions: dimensions,
            cropOffset: offset,
            scanSha256: m.volume.sha256,
            alignedMaskVoxels: 2,
            packageBytes: packed.blob.size,
            roundTripMs: performance.now() - t,
          },
          null,
          2,
        ),
      );
    },
    180000,
  );
});
