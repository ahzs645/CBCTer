import { expect, type Locator, type Page } from '@playwright/test';

export class CBCTerPage {
  constructor(readonly page: Page) {}

  async open() {
    await this.page.goto('/?sample=/e2e-sample-cbct');
  }

  async loadSample() {
    await this.page.getByRole('button', { name: /load sample cbct/i }).click();
    await expect(this.page).toHaveURL(/\/viewer$/, { timeout: 30_000 });
    await expect(this.page.getByText(/main navigation volume/i)).toBeVisible({
      timeout: 30_000,
    });
  }

  async firstNonEmptyCanvas(): Promise<{
    canvas: Locator;
    nonBlackPixels: number;
  }> {
    await expect(this.page.locator('canvas').first()).toBeVisible();
    const canvases = this.page.locator('canvas');
    const count = await canvases.count();
    for (let index = 0; index < count; index += 1) {
      const canvas = canvases.nth(index);
      const box = await canvas.boundingBox();
      if (!box || box.width <= 50 || box.height <= 50) continue;
      const nonBlackPixels = await canvas.evaluate((node) => {
        const canvasNode = node as HTMLCanvasElement;
        const context = canvasNode.getContext('2d');
        if (!context) return 0;
        const { data } = context.getImageData(
          0,
          0,
          canvasNode.width,
          canvasNode.height,
        );
        let pixels = 0;
        for (let offset = 0; offset < data.length; offset += 4) {
          if (
            data[offset] > 8 ||
            data[offset + 1] > 8 ||
            data[offset + 2] > 8
          ) {
            pixels += 1;
          }
        }
        return pixels;
      });
      if (nonBlackPixels > 100) return { canvas, nonBlackPixels };
    }
    throw new Error('Expected at least one nonblank 2D canvas');
  }

  async openWorkflowTab(name: string) {
    await this.page.getByRole('button', { name }).click();
  }
}
