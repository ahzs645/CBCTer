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
