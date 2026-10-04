import { test, expect, type Page } from '@playwright/test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { caseFixture } from '../../src/lib/case/fixture';
import { buildChunkedPackage } from '../../src/lib/import/chunked/package';
import { openChunkedReader } from '../../src/lib/import/chunked/reader';
import {
  readCaseMetadata,
  readCaseWorkspace,
} from '../../src/lib/case/archive';
import { sha256 } from '../../src/lib/import/chunked/codec';
import { readFile } from 'node:fs/promises';
let root: string, fixturePath: string, rawHash: string, predictionHash: string;
test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'cbcter-case-'));
  fixturePath = join(root, 'synthetic.cbct.zip');
  const { volume, workspace } = await caseFixture();
  rawHash = await sha256(volume.native!.voxels);
  predictionHash = await sha256(workspace.predictions![0].data);
  const packed = await buildChunkedPackage(volume, {
    name: 'Synthetic dental case',
    windowLevel: volume.meta.initialWindowLevel,
    analysis: workspace,
  });
  await writeFile(fixturePath, new Uint8Array(await packed.blob.arrayBuffer()));
});
test.afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});
async function openCase(page: Page) {
  await page.goto('/');
  await page.getByTestId('zip-input').setInputFiles(fixturePath);
  await expect(page.getByTestId('progressive-viewer')).toBeVisible();
  await expect(page.getByTestId('streaming-status')).toHaveText(
    'Full-resolution slices',
  );
}
async function exportCase(page: Page, path: string, mobile: boolean) {
  if (mobile) {
    await page.getByRole('button', { name: 'More', exact: true }).click();
  }
  await page.getByRole('button', { name: /Export slim package/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Export slim package' });
  await dialog.getByLabel('Scan + analysis', { exact: true }).check();
  const download = page.waitForEvent('download');
  await dialog
    .getByRole('button', { name: 'Export .cbct.zip', exact: true })
    .click();
  await (await download).saveAs(path);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
}
for (const mobile of [false, true]) {
  test.describe(mobile ? 'touch case' : 'desktop case', () => {
    test.use({
      hasTouch: mobile,
      isMobile: mobile,
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1280, height: 900 },
    });
    test(`${mobile ? 'mobile' : 'desktop'}: select, review, correct, split, merge, save arch and reopen a complete case`, async ({
      page,
    }, info) => {
      test.setTimeout(60000);
      page.setDefaultTimeout(15000);
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await openCase(page);
      await page.getByLabel('Contrast preset').selectOption('teeth');
      await expect(page.getByTestId('streaming-status')).toHaveText(
        'Full-resolution slices',
      );
      await page
        .getByLabel('Selected tooth instance')
        .selectOption('stable-tooth-11');
      await page.getByLabel('Structure visibility').selectOption('selected');
      await page
        .getByRole('button', { name: 'Review and export case' })
        .click();
      await expect(page.getByTestId('progressive-viewer')).toHaveCount(0);
      await page
        .getByRole('button', { name: 'Review teeth', exact: true })
        .click();
      const panel = page.getByRole('region', { name: 'Tooth review' });
      await panel
        .getByLabel('Selected tooth instance')
        .selectOption('stable-tooth-11');
      await panel.getByLabel('FDI number').selectOption('12');
      await panel.getByRole('button', { name: 'Accept outline' }).click();
      await expect(panel.getByLabel('Selected tooth instance')).toContainText(
        'FDI 12 · accepted',
      );
      await panel.getByLabel('Structure visibility').selectOption('selected');
      await panel.getByLabel('Show surrounding bone').check();
      await panel
        .getByRole('button', { name: 'Erase outline', exact: true })
        .click();
      await expect(panel).toHaveCount(0);
      const canvas = page.locator('canvas[data-slice-canvas="axial"]');
      const box = await canvas.boundingBox();
      if (!box) throw new Error('Missing axial canvas');
      if (mobile)
        await page.touchscreen.tap(
          box.x + box.width * (24 / 69),
          box.y + box.height * (18 / 37),
        );
      else
        await page.mouse.click(
          box.x + box.width * (24 / 69),
          box.y + box.height * (18 / 37),
        );
      await page.keyboard.press('Escape');
      await page
        .getByRole('button', { name: 'Review teeth', exact: true })
        .click();
      await expect(panel.getByLabel('Selected tooth instance')).toContainText(
        'corrected',
      );
      await panel.getByRole('button', { name: 'Split at crosshair' }).click();
      await expect(
        panel.getByLabel('Selected tooth instance').locator('option'),
      ).toHaveCount(4);
      await panel.getByRole('button', { name: 'Undo correction' }).click();
      await expect(
        panel.getByLabel('Selected tooth instance').locator('option'),
      ).toHaveCount(3);
      await panel.getByRole('button', { name: 'Redo correction' }).click();
      await expect(
        panel.getByLabel('Selected tooth instance').locator('option'),
      ).toHaveCount(4);
      const target = await panel
        .getByLabel('Merge tooth')
        .locator('option')
        .evaluateAll(
          (options) =>
            (options as HTMLOptionElement[]).find((o) =>
              o.textContent?.startsWith('Unassigned'),
            )?.value,
        );
      if (!target) throw new Error('Missing split tooth');
      await panel.getByLabel('Merge tooth').selectOption(target);
      await panel.getByRole('button', { name: 'Merge outlines' }).click();
      await expect(
        panel.getByLabel('Selected tooth instance').locator('option'),
      ).toHaveCount(3);
      await panel.getByRole('button', { name: 'Accept outline' }).click();
      await panel.getByRole('button', { name: 'Close tooth review' }).click();
      if (mobile) {
        await page.getByRole('button', { name: 'More', exact: true }).click();
      }
      await page
        .getByRole('button', { name: 'Panoramic', exact: true })
        .click();
      await expect(page.getByTestId('tooth-cross-section')).toBeVisible();
      const archBox = await page
        .getByTestId('dental-arch-editor')
        .boundingBox();
      expect(archBox!.height).toBeGreaterThan(250);
      await page
        .getByRole('slider', { name: 'Section width (mm)', exact: true })
        .fill('25');
      await page
        .getByRole('slider', { name: 'Section angle (degrees)', exact: true })
        .fill('30');
      await page.getByRole('button', { name: 'Viewer', exact: true }).click();
      await page
        .getByRole('button', { name: 'Review teeth', exact: true })
        .click();
      await expect(panel.getByLabel('FDI number')).toHaveValue('12');
      await panel.getByRole('button', { name: 'Close tooth review' }).click();
      const exported = info.outputPath('complete-case.cbct.zip');
      await exportCase(page, exported, mobile);
      const reader = await openChunkedReader({
          blob: new Blob([await readFile(exported)]),
        }),
        metadata = await readCaseMetadata(reader),
        workspace = await readCaseWorkspace(reader, metadata!);
      expect(await sha256(await reader.materialize())).toBe(rawHash);
      expect(await sha256(workspace.predictions![0].data)).toBe(predictionHash);
      expect(workspace.state.toothInstances).toHaveLength(2);
      expect(
        workspace.state.toothInstances!.find((t) => t.id === 'stable-tooth-11')!
          .fdi,
      ).toBe(12);
      expect(workspace.state.toothInstances![0].review).toBe('accepted');
      expect(workspace.state.dentalArch!.crossSection).toEqual({
        widthMm: 25,
        angleDeg: 30,
      });
      expect(workspace.state.caseNotes).toBe('Synthetic test findings');
      expect(workspace.state.analysisRevisions!.map((r) => r.action)).toContain(
        'merge teeth',
      );
      expect(await sha256(workspace.labelmaps![0].data)).not.toBe(
        predictionHash,
      );
      await page.goto('/');
      await page.getByTestId('zip-input').setInputFiles(exported);
      await expect(page.getByLabel('Selected tooth instance')).toContainText(
        'FDI 12 · accepted',
      );
      await page
        .getByRole('button', { name: 'Review and export case' })
        .click();
      if (mobile) {
        await page.getByRole('button', { name: 'More', exact: true }).click();
      }
      await page
        .getByRole('button', { name: 'Panoramic', exact: true })
        .click();
      await expect(
        page.getByRole('slider', { name: 'Section width (mm)', exact: true }),
      ).toHaveValue('25');
      await expect(
        page.getByRole('slider', {
          name: 'Section angle (degrees)',
          exact: true,
        }),
      ).toHaveValue('30');
      expect(errors).toEqual([]);
      await page.screenshot({ path: info.outputPath('restored-arch.png') });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
    test(`${mobile ? 'mobile' : 'desktop'}: runs separation, regenerates a tooth surface, saves all local layers and reports missing weights`, async ({
      page,
    }, info) => {
      test.setTimeout(60000);
      page.setDefaultTimeout(15000);
      await openCase(page);
      await page
        .getByRole('button', { name: 'Review and export case' })
        .click();
      await page
        .getByRole('button', { name: 'Review teeth', exact: true })
        .click();
      const panel = page.getByRole('region', { name: 'Tooth review' });
      await panel
        .getByText('Separate individual teeth', { exact: true })
        .click();
      await panel
        .getByLabel('Separation source')
        .selectOption('fixture-anatomy');
      await panel
        .getByRole('button', { name: 'Propose separate teeth' })
        .click();
      await expect(
        panel.getByRole('button', { name: 'Propose separate teeth' }),
      ).toBeEnabled();
      await expect
        .poll(() =>
          panel.getByLabel('Selected tooth instance').locator('option').count(),
        )
        .toBeGreaterThan(3);
      await panel
        .getByRole('button', { name: 'Regenerate tooth 3D surface' })
        .click();
      await expect(
        panel.getByRole('button', { name: 'Regenerate tooth 3D surface' }),
      ).toBeEnabled();
      await panel.getByRole('button',{name:'Draw a new tooth outline'}).click();
      const manualCanvas=page.locator('canvas[data-slice-canvas="axial"]'),manualBox=await manualCanvas.boundingBox();if(!manualBox)throw new Error('No manual edit canvas');
      if(mobile)await page.touchscreen.tap(manualBox.x+manualBox.width*10/69,manualBox.y+manualBox.height*10/37);else await page.mouse.click(manualBox.x+manualBox.width*10/69,manualBox.y+manualBox.height*10/37);
      await page.keyboard.press('Escape');await page.getByRole('button',{name:'Review teeth',exact:true}).click();await panel.getByLabel('FDI number').selectOption('13');
      await panel.getByRole('button', { name: 'Close tooth review' }).click();
      await page
        .getByRole('button', { name: 'Save case locally', exact: true })
        .click();
      await expect(
        page.getByText('Case saved on this device.', { exact: true }),
      ).toBeVisible();
      const saved = await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('cbcter-local');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const record = await new Promise<{
          labelmaps: { id: string; data: Uint8Array }[];
          predictions: { data: Uint8Array }[];
          state: { toothInstances: { id: string }[]; surfaces: unknown[] };
          binding: { sha256: string };
        }>((resolve, reject) => {
          const request = db
            .transaction('projects')
            .objectStore('projects')
            .get('latest');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        db.close();
        return {
          labelmapIds: record.labelmaps.map((v) => v.id),
          predictionCount: record.predictions.length,
          toothCount: record.state.toothInstances.length,
          surfaceCount: record.state.surfaces.length,
          scanHash: record.binding.sha256,
        };
      });
      expect(saved.labelmapIds).toHaveLength(4);
      expect(saved.predictionCount).toBe(2);
      expect(saved.toothCount).toBeGreaterThan(2);
      expect(saved.surfaceCount).toBe(1);
      expect(saved.scanHash).toBe(rawHash);
      if (mobile) {
        await page.getByRole('button', { name: 'More', exact: true }).click();
        await page
          .getByRole('button', { name: 'Study tools', exact: true })
          .click();
      }
      await page.getByRole('button', { name: 'Export', exact: true }).click();
      await page
        .getByRole('button', { name: 'Restore local', exact: true })
        .click();
      if (mobile) {
        await page.getByRole('button', { name: 'Hide', exact: true }).click();
      }
      await page
        .getByRole('button', { name: 'Review teeth', exact: true })
        .click();
      await expect
        .poll(() =>
          panel.getByLabel('Selected tooth instance').locator('option').count(),
        )
        .toBe(saved.toothCount + 1);
      await panel
        .getByText('Propose outlines with a model', { exact: true })
        .click();
      await panel.getByRole('button', { name: 'Run anatomy model' }).click();
      await expect(panel.getByRole('alert')).toContainText(
        'Model weights are unavailable',
      );
      await panel.getByRole('button', { name: 'Close tooth review' }).click();
      const path = info.outputPath('separated-case.cbct.zip');
      await exportCase(page, path, mobile);
      const reader = await openChunkedReader({
          blob: new Blob([await readFile(path)]),
        }),
        metadata = await readCaseMetadata(reader),
        workspace = await readCaseWorkspace(reader, metadata!);
      expect(workspace.state.toothInstances!.some(t=>t.fdi===13&&t.source==='manual')).toBe(true);
      expect(workspace.surfaces).toHaveLength(1);
      expect(workspace.predictions).toHaveLength(2);
      expect(await sha256(workspace.predictions![0].data)).toBe(predictionHash);
    });
  });
}
