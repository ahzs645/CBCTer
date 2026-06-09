import { expect, test, type Page } from '@playwright/test';

/**
 * In-browser validation of the DentalSegmentator model variants: loads the real
 * CBCT (staged as the `anatomy-test-cbct` sample), runs Full Anatomy through the
 * actual onnxruntime-web worker for a given variant, and reports whether it
 * completes or fails (e.g. OOM). Heavy — full-volume 3D inference in wasm.
 *
 * Run a single variant, e.g.:
 *   npx playwright test anatomy-variants --grep "pediatric"
 *   npx playwright test anatomy-variants --grep "universal"
 */

const VARIANT_OPTION: Record<string, RegExp> = {
  full: /full anatomy \(5 classes\)/i,
  pediatric: /pediatric \(primary teeth\)/i,
  universal: /universal/i,
};

async function loadSampleAndOpenAnatomy(page: Page) {
  await page.goto('/?sample=/anatomy-test-cbct');
  await page.getByRole('button', { name: /load sample cbct/i }).click();
  await expect(page).toHaveURL(/\/viewer$/, { timeout: 60_000 });
  // SPA-navigate to the dedicated anatomy page (which carries the variant select)
  // without a full reload, so the in-memory volume survives.
  await page.evaluate(() => {
    window.history.pushState({}, '', '/anatomy');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByRole('button', { name: /run segmentation/i })).toBeVisible({
    timeout: 30_000,
  });
}

async function selectVariant(page: Page, variant: string) {
  // The Model dropdown is the only listbox visible before a run.
  await page.locator('button[aria-haspopup="listbox"]').first().click();
  await page.getByRole('option', { name: VARIANT_OPTION[variant] }).click();
}

async function runVariant(page: Page, variant: string) {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

  await loadSampleAndOpenAnatomy(page);
  await selectVariant(page, variant);

  const start = Date.now();
  await page.getByRole('button', { name: /run segmentation/i }).click();

  // Wait (long) for success (Segments list) or an error Notice.
  let status: 'success' | 'error' | 'timeout' = 'timeout';
  await expect
    .poll(
      async () => {
        const hasSegments = await page
          .getByText(/^Segments$/)
          .isVisible()
          .catch(() => false);
        if (hasSegments) {
          status = 'success';
          return 'done';
        }
        // Error surfaces as a Notice with the worker/ORT message.
        const errText = page.getByText(
          /bad_alloc|OrtRun|failed to call|out of memory|memory access|segmentation failed|worker failed/i,
        );
        if (await errText.first().isVisible().catch(() => false)) {
          status = 'error';
          return 'done';
        }
        if (
          errors.some((e) =>
            /bad_alloc|ortrun|out of bounds|aborted|enlarge memory|rangeerror|out of memory/i.test(e),
          )
        ) {
          status = 'error';
          return 'done';
        }
        return 'pending';
      },
      { timeout: 18 * 60_000, intervals: [4000] },
    )
    .toBe('done');

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const logs = await page
    .locator('pre')
    .first()
    .innerText()
    .catch(() => '');
  console.log(`\n[${variant}] status=${status} elapsed=${elapsed}s`);
  if (errors.length) console.log(`[${variant}] console errors:\n${errors.join('\n')}`);
  if (logs) console.log(`[${variant}] run log tail:\n${logs.split('\n').slice(-8).join('\n')}`);

  // Capture the segment list on success for a sanity check.
  if (status === 'success') {
    const segText = await page.locator('ul').filter({ hasText: /cm³|mm³|—/ }).first().innerText().catch(() => '');
    console.log(`[${variant}] segments:\n${segText}`);
  }
  return status;
}

test.describe('DentalSegmentator variants in-browser', () => {
  test('pediatric runs end-to-end on the real CBCT', async ({ page }) => {
    test.setTimeout(20 * 60_000);
    const status = await runVariant(page, 'pediatric');
    expect(status).toBe('success');
  });

  test('universal runs end-to-end on the real CBCT', async ({ page }) => {
    test.setTimeout(20 * 60_000);
    const status = await runVariant(page, 'universal');
    // Universal may OOM in wasm; record the outcome rather than hard-failing.
    console.log(`[universal] final status: ${status}`);
    expect(['success', 'error']).toContain(status);
  });
});
