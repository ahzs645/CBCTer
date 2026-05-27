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
