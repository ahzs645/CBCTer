import { expect, test } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { open, stat, readFile, writeFile } from 'node:fs/promises';
import { readZipIndex, readZipEntry } from '../../src/lib/import/zipIndex';
import { CBCTerPage } from './pageobjects/cbcter.page';

// Explicit opt-in keeps the authorized scans out of the repository and public build.
const nativeRoot = process.env.CBCTER_VALIDATION_OUT;
let server: Server, origin: string;
const traffic: Array<{
  name: string;
  start: number;
  end: number;
  bytes: number;
}> = [];
test.beforeAll(async () => {
  if (!nativeRoot) return;
  server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, ETag');
    res.setHeader('ETag', '"validation-v2"');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Headers', 'Range, If-Range');
      res.end();
      return;
    }
    const name = new URL(req.url!, 'http://localhost').pathname
      .split('/')
      .pop()!;
    try {
      const path = `${nativeRoot}/${name.replace('no-range-', '')}`;
      const info = await stat(path);
      if (name.startsWith('no-range-')) {
        res.statusCode = 200;
        res.setHeader('Content-Length', info.size);
        res.write(new Uint8Array(256));
        return;
      }
      const match = /^bytes=(\d+)-(\d+)$/.exec(String(req.headers.range));
      if (!match) {
        res.statusCode = 400;
        res.end('Range required');
        return;
      }
      const start = Number(match[1]),
        end = Number(match[2]);
      if (start > end || end >= info.size) {
        res.statusCode = 416;
        res.end();
        return;
      }
      const file = await open(path, 'r');
      const bytes = Buffer.alloc(end - start + 1);
      try {
        await file.read(bytes, 0, bytes.length, start);
      } finally {
        await file.close();
      }
      traffic.push({ name, start, end, bytes: bytes.length });
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`);
      res.setHeader('Content-Length', bytes.length);
      res.setHeader('Content-Type', 'application/zip');
      res.end(bytes);
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('No test server address');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('exports v2 in a worker, pages native slices, adjusts contrast and explicitly loads advanced tools', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const app = new CBCTerPage(page);
  await app.open();
  await app.loadSample();
  await page.getByRole('button', { name: /Export slim package/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Export slim package' });
  await dialog.getByLabel('Package format').selectOption('streamable');
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export .cbct.zip' }).click();
  const path = info.outputPath('streamable.cbct.zip');
  await (await download).saveAs(path);
  await page.goto('/');
  await page.getByTestId('zip-input').setInputFiles(path);
  await expect(page.getByTestId('progressive-viewer')).toBeVisible();
  await expect(page.getByTestId('streaming-status')).toHaveText(
    'Full-resolution slices',
  );
  const slider = page
    .getByRole('slider', { name: 'Slice', exact: true })
    .first();
  await slider.fill('13');
  await expect(slider).toHaveValue('13');
  await expect(page.getByTestId('streaming-status')).toHaveText(
    'Full-resolution slices',
  );
  const before = await page
    .getByTestId('progressive-viewer')
    .getAttribute('data-bytes-read');
  await page.getByRole('slider', { name: 'Window', exact: true }).fill('2500');
  await expect(page.getByTestId('streaming-status')).toHaveText(
    'Full-resolution slices',
  );
  expect(
    await page
      .getByTestId('progressive-viewer')
      .getAttribute('data-bytes-read'),
  ).toBe(before);
  await app.firstNonEmptyCanvas();
  await page.getByLabel('Measure', { exact: true }).selectOption('distance');
  const canvas = page.locator('canvas[data-slice-canvas="axial"]');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('No axial canvas');
  const side = Math.min(box.width, box.height),
    cx = box.x + box.width / 2,
    cy = box.y + box.height / 2;
  await page.mouse.click(cx - side * 0.2, cy);
  await page.mouse.click(cx + side * 0.2, cy);
  await expect(
    page.locator('svg text').filter({ hasText: '2.48 mm' }),
  ).toBeVisible();
  await page.getByLabel('Measure', { exact: true }).selectOption('off');
  await page
    .getByRole('button', { name: 'Load full volume for advanced tools' })
    .click();
  await expect(page.getByTestId('progressive-viewer')).toHaveCount(0);
  await expect(page.getByText('32 x 32 x 24 voxels')).toBeVisible();
  await expect(
    page.getByRole('slider', { name: 'Slice', exact: true }).first(),
  ).toHaveValue('13');
  await page.getByRole('button', { name: 'Measures', exact: true }).click();
  await expect(page.getByLabel('Rename measurement')).toHaveValue('Distance 1');
  expect(errors).toEqual([]);
});
for (const mobile of [false, true])
  test.describe(
    mobile ? 'mobile native streaming' : 'desktop native streaming',
    () => {
      test.use({
        viewport: mobile
          ? { width: 390, height: 844 }
          : { width: 1280, height: 900 },
        hasTouch: mobile,
        isMobile: mobile,
      });
      for (const name of ['onevolume', 'sidexis'])
        test(`${name}: range reads, native slice indices, bounded cache and full-volume verification`, async ({
          page,
        }, info) => {
          test.skip(
            !nativeRoot,
            'Set CBCTER_VALIDATION_OUT after running nativeExamples.test.ts.',
          );
          test.setTimeout(120000);
          const errors: string[] = [];
          page.on('pageerror', (e) => errors.push(e.message));
          const trafficStart = traffic.length;
          await page.goto('/');
          await page
            .locator('input[type=url]')
            .fill(`${origin}/${name}.cbct.zip`);
          const started = Date.now();
          await page.getByRole('button', { name: 'Open URL' }).click();
          const viewer = page.getByTestId('progressive-viewer');
          await expect(viewer).toBeVisible({ timeout: 60000 });
          const previewMs = Date.now() - started;
          await expect(page.getByTestId('streaming-status')).toHaveText(
            'Full-resolution slices',
            { timeout: 60000 },
          );
          const firstNativeMs = Date.now() - started;
          const firstHttpBytes = traffic
            .slice(trafficStart)
            .reduce((sum, r) => sum + r.bytes, 0);
          const firstBytes = Number(
            await viewer.getAttribute('data-bytes-read'),
          );
          const packageInfo = JSON.parse(
            await readFile(`${nativeRoot}/${name}.json`, 'utf8'),
          );
          expect(firstBytes).toBeLessThan(packageInfo.packageBytes * 0.7);
          const slider = page
            .getByRole('slider', { name: 'Slice', exact: true })
            .first();
          const middle = Number(await slider.inputValue());
          for (const index of [
            1,
            70,
            139,
            208,
            277,
            Number(await slider.getAttribute('max')) - 2,
            middle + 12,
          ])
            await slider.fill(String(index));
          await expect(page.getByTestId('streaming-status')).toHaveText(
            'Full-resolution slices',
            { timeout: 60000 },
          );
          await expect(slider).toHaveValue(String(middle + 12));
          const cacheBytes = Number(
              await viewer.getAttribute('data-cache-bytes'),
            ),
            cacheLimit = Number(await viewer.getAttribute('data-cache-limit'));
          expect(cacheBytes).toBeLessThanOrEqual(cacheLimit);
          expect(cacheLimit).toBe((mobile ? 32 : 64) * 1024 * 1024);
          const metrics = {
            name,
            mobile,
            previewMs,
            firstNativeMs,
            firstBytes,
            firstHttpBytes,
            packageBytes: packageInfo.packageBytes,
            cacheBytes,
            cacheLimit,
            afterScrubBytes: Number(
              await viewer.getAttribute('data-bytes-read'),
            ),
          };
          await info.attach('streaming-metrics', {
            body: JSON.stringify(metrics),
            contentType: 'application/json',
          });
          await writeFile(
            `${nativeRoot}/${name}-${mobile ? 'mobile' : 'desktop'}-browser.json`,
            JSON.stringify(metrics, null, 2),
          );
          await page.screenshot({ path: info.outputPath('streaming.png') });
          if (!mobile) {
            await page
              .getByRole('button', {
                name: 'Load full volume for advanced tools',
              })
              .click();
            await expect(viewer).toHaveCount(0, { timeout: 60000 });
            await expect(
              page.getByText(`${packageInfo.dimensions.join(' x ')} voxels`),
            ).toBeVisible({ timeout: 60000 });
          }
          if (!mobile) {
            await page
              .getByRole('button', { name: /Export slim package/ })
              .click();
            const dialog = page.getByRole('dialog', {
              name: 'Export slim package',
            });
            await dialog
              .getByLabel('Package format')
              .selectOption('streamable');
            const download = page.waitForEvent('download');
            await dialog
              .getByRole('button', { name: 'Export .cbct.zip' })
              .click();
            const path = info.outputPath(`${name}-native-export.cbct.zip`);
            await (await download).saveAs(path);
            const bytes = new Blob([await readFile(path)]);
            const index = await readZipIndex(bytes);
            const manifest = JSON.parse(
              new TextDecoder().decode(
                await readZipEntry(
                  bytes,
                  index.find((e) => e.name === 'cbct-scan.json')!,
                ),
              ),
            );
            expect(manifest.volume.sha256).toBe(packageInfo.sha256);
            expect(manifest.volume.dimensions).toEqual(packageInfo.dimensions);
            expect(manifest.volume.representation).toBe('native');
          }
          await page.goto('/');
          expect(errors).toEqual([]);
        });
    },
  );
test('a server without Range support shows a useful error without downloading the archive', async ({
  page,
}) => {
  test.skip(!nativeRoot, 'Native validation package required.');
  await page.goto('/');
  await page
    .locator('input[type=url]')
    .fill(`${origin}/no-range-onevolume.cbct.zip`);
  await page.getByRole('button', { name: 'Open URL' }).click();
  await expect(
    page.getByText(/Download the package and open the ZIP file instead/),
  ).toBeVisible();
});
