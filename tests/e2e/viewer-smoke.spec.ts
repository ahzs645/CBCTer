import { expect, test } from '@playwright/test';
import { CBCTerPage } from './pageobjects/cbcter.page';

test('loads the bundled sample and renders nonblank MPR canvases', async ({
  page,
}) => {
  const app = new CBCTerPage(page);
  await app.open();
  await app.loadSample();

  const { nonBlackPixels } = await app.firstNonEmptyCanvas();
  expect(nonBlackPixels).toBeGreaterThan(100);
  await expect(page).toHaveScreenshot('viewer-sample.png', {
    animations: 'disabled',
    fullPage: true,
  });
});

test('shows VolView-inspired study controls and crop overlay', async ({ page }) => {
  const app = new CBCTerPage(page);
  await app.open();
  await app.loadSample();

  await app.openWorkflowTab('Study');
  await expect(page.getByText('DICOM engine')).toBeVisible();
  await expect(page.getByText('Layout')).toBeVisible();

  await page.getByLabel('Crop bounds').check();
  await expect(page.getByText(/Crop 0,0,0 to/)).toBeVisible();
  await expect(page).toHaveScreenshot('viewer-crop-controls.png', {
    animations: 'disabled',
    fullPage: true,
  });
});

test('enables tissue preset overlay and creates a tissue mask', async ({ page }) => {
  const app = new CBCTerPage(page);
  await app.open();
  await app.loadSample();

  await app.openWorkflowTab('Study');
  await page.getByRole('button', { name: /voxel view only/i }).click();
  await page.getByRole('option', { name: /tissue preset overlay/i }).click();
  await expect(page.getByText('Soft tissue / skin')).toBeVisible();
  await expect(page.getByText('Compact bone')).toBeVisible();

  await expect
    .poll(async () =>
      page.locator('canvas').evaluateAll((nodes) => {
    for (const node of nodes) {
      const canvas = node as HTMLCanvasElement;
      if (canvas.width <= 8 || canvas.height <= 8) continue;
      const context = canvas.getContext('2d');
      if (!context) continue;
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let overlayLike = 0;
      for (let offset = 0; offset < data.length; offset += 4) {
        if (data[offset + 3] > 0) {
          overlayLike += 1;
        }
      }
      if (overlayLike > 50) return overlayLike;
    }
    return 0;
      }),
    )
    .toBeGreaterThan(50);

  await page
    .locator('div')
    .filter({ hasText: /^Compact bone662 to 1988 HUMask$/ })
    .getByRole('button', { name: 'Mask' })
    .click();
  await app.openWorkflowTab('Masks');
  await expect(
    page.getByRole('button', { name: 'Compact bone labels' }),
  ).toBeVisible();
});
