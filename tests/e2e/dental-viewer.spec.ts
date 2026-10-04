import { expect, test } from '@playwright/test';
import { CBCTerPage } from './pageobjects/cbcter.page';

test('desktop: measure a distance, chart a tooth, and page slices', async ({
  page,
}) => {
  const app = new CBCTerPage(page);
  await app.open();
  await app.loadSample();

  const axial = page.locator('canvas[data-slice-canvas="axial"]');
  const box = await axial.boundingBox();
  if (!box) throw new Error('axial canvas not rendered');

  // Distance tool via keyboard shortcut, two clicks on the axial slice.
  await page.keyboard.press('d');
  await expect(page.getByRole('button', { name: 'Distance' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.5);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Measures' }).click();
  await expect(page.getByLabel('Rename measurement')).toHaveValue('Distance 1');
  await expect(page.getByText(/Axial · slice 13/)).toBeVisible();

  // Tooth chart: record a finding and bookmark the crosshair position.
  await page.getByRole('button', { name: 'Chart', exact: true }).click();
  await page.getByRole('button', { name: /^36 / }).click();
  await page.getByRole('button', { name: 'Caries' }).click();
  await page.getByRole('button', { name: 'Pin to crosshair' }).click();
  await expect(page.getByText('1 teeth charted')).toBeVisible();
  await expect(page.getByText('Position pinned')).toBeVisible();

  // Arrow keys page the active (axial) slice.
  await expect(page.getByText('Z 13/24', { exact: true }).first()).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByText('Z 14/24', { exact: true }).first()).toBeVisible();

  // Contrast preset by number key updates the status bar window/level.
  const before = await page.getByText(/^W \d+ \/ L -?\d+$/).innerText();
  await page.keyboard.press('3');
  await expect(page.getByText(/^W \d+ \/ L -?\d+$/)).not.toHaveText(before);
});

test('voxel geometry: distances are in millimetres and the probe reads voxel values', async ({
  page,
}) => {
  // The e2e sample is 32×32×24 voxels at 0.2 mm with a 1800-valued sphere
  // (radius 8 voxels) centred in a -800 background (scripts/build_e2e_sample.mjs).
  const app = new CBCTerPage(page);
  await app.open();
  await app.loadSample();

  const axial = page.locator('canvas[data-slice-canvas="axial"]');
  const box = await axial.boundingBox();
  if (!box) throw new Error('axial canvas not rendered');
  const at = (rx: number, ry: number) =>
    [box.x + rx * box.width, box.y + ry * box.height] as const;

  // Half the axial width: 0.5 × (32 − 1) voxels × 0.2 mm = 3.1 mm.
  await page.keyboard.press('d');
  await page.mouse.click(...at(0.25, 0.5));
  await page.mouse.click(...at(0.75, 0.5));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Measures' }).click();
  await expect(page.locator('li span.font-mono').first()).toHaveText('3.1 mm');

  // Hovering reads the stored voxel: sphere centre vs. background corner.
  await page.mouse.move(...at(0.5, 0.5));
  await expect(page.locator('footer')).toContainText('Value 1800');
  await page.mouse.move(...at(0.05, 0.05));
  await expect(page.locator('footer')).toContainText('Value -800');
  // Crosshair position is reported in mm (voxel index × spacing).
  await expect(page.locator('footer')).toContainText('Position 3.2, 3.2, 2.4 mm');
});

test('exports a slim .cbct.zip package and reopens it from the import screen', async ({
  page,
}, testInfo) => {
  const app = new CBCTerPage(page);
  await app.open();
  await app.loadSample();

  await page.getByRole('button', { name: /Export slim package/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Export slim package' });
  await expect(dialog.getByRole('textbox')).toHaveValue(/^CBCT_\d{8}$/);
  await dialog.getByRole('textbox').fill('CT_20260101120000');
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export .cbct.zip' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('CT_20260101120000.cbct.zip');
  const packagePath = testInfo.outputPath('package.cbct.zip');
  await download.saveAs(packagePath);
  await expect(dialog.getByText(/^Saved \(/)).toBeVisible();

  // Fresh page: open the package with "Open ZIP file".
  await page.goto('/');
  await page.getByTestId('zip-input').setInputFiles(packagePath);
  await expect(page).toHaveURL(/\/viewer$/, { timeout: 30_000 });
  await expect(page.getByText('CBCTer package · Sample CBCT · CT').first()).toBeVisible();
  await expect(page.getByText('32 x 32 x 24 voxels')).toBeVisible();

  const axial = page.locator('canvas[data-slice-canvas="axial"]');
  const box = await axial.boundingBox();
  if (!box) throw new Error('axial canvas not rendered');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('footer')).toContainText('Value 1800');
  await page.mouse.move(box.x + box.width * 0.05, box.y + box.height * 0.05);
  await expect(page.locator('footer')).toContainText('Value -800');

  // The default package carries both levels; the desktop opened full, and
  // the side panel can switch to the phone level and back.
  await expect(page.getByRole('button', { name: 'Full', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Phone', exact: true }).click();
  await expect(page.getByText('16 x 16 x 12 voxels')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/phone version/).first()).toBeVisible();
});

test.describe('phone layout', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('switches views and uses the bottom dock sheets', async ({ page }) => {
    const app = new CBCTerPage(page);
    await app.open();
    await page.getByRole('button', { name: /load sample cbct/i }).click();
    await expect(page).toHaveURL(/\/viewer$/, { timeout: 30_000 });

    await expect(page.getByRole('tab', { name: 'Axial' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.getByRole('tab', { name: 'Coronal' }).tap();
    await expect(page.locator('canvas[data-slice-canvas="coronal"]')).toBeVisible();

    await page.getByRole('button', { name: 'Contrast' }).tap();
    const contrastSheet = page.getByRole('dialog', { name: 'Contrast presets' });
    await expect(contrastSheet).toBeVisible();
    // The sheet slides over the bottom dock.
    const sheetBox = await contrastSheet.boundingBox();
    const dockBox = await page.getByRole('button', { name: 'More' }).boundingBox();
    expect(sheetBox && dockBox && sheetBox.y + sheetBox.height).toBeGreaterThanOrEqual(
      (dockBox?.y ?? 0) + (dockBox?.height ?? 0),
    );
    await page.getByRole('button', { name: 'Bone', exact: true }).tap();
    await expect(page.getByRole('button', { name: 'Bone', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Sheets cover the dock; close one before opening the next.
    await page.getByRole('button', { name: 'Close' }).first().tap();
    await page.getByRole('button', { name: 'Chart', exact: true }).tap();
    await expect(page.getByRole('dialog', { name: 'Tooth chart' })).toBeVisible();
    await page.getByRole('button', { name: /^46 / }).tap();
    await page.getByRole('button', { name: 'Root canal treated' }).tap();
    await expect(page.getByText('1 teeth charted')).toBeVisible();

    await page
      .getByRole('dialog', { name: 'Tooth chart' })
      .getByRole('button', { name: 'Close' })
      .tap();
    await page.getByRole('button', { name: 'Measure' }).tap();
    await page.getByRole('button', { name: 'Distance' }).tap();
    await expect(page.getByText(/Tap points on a slice/)).toBeVisible();
  });

  test('opens the phone level of a two-level package and can load full resolution', async ({
    page,
  }, testInfo) => {
    // Export on the phone layout too (More → Export slim package).
    const app = new CBCTerPage(page);
    await app.open();
    await page.getByRole('button', { name: /load sample cbct/i }).click();
    await expect(page).toHaveURL(/\/viewer$/, { timeout: 30_000 });
    await page.getByRole('button', { name: 'More' }).tap();
    await page.getByRole('button', { name: /Export slim package/ }).tap();
    const dialog = page.getByRole('dialog', { name: 'Export slim package' });
    await expect(dialog.getByLabel(/Full \+ phone version/)).toBeChecked();
    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Export .cbct.zip' }).tap();
    const packagePath = testInfo.outputPath('package.cbct.zip');
    await (await downloadPromise).saveAs(packagePath);

    await page.goto('/');
    await page.getByTestId('zip-input').setInputFiles(packagePath);
    await expect(page).toHaveURL(/\/viewer$/, { timeout: 30_000 });
    // Phones open the half-resolution level by default.
    await expect(page.getByText(/· phone version/)).toBeVisible();
    await expect(page.getByText('Z 7/12')).toBeVisible();

    await page.getByRole('button', { name: 'More' }).tap();
    await page.getByRole('button', { name: 'Load full resolution' }).tap();
    await expect(page.getByText('Z 13/24')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/· phone version/)).toHaveCount(0);
  });
});
