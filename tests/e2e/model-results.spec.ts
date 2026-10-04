/** Opt-in tests against authorized private predictions; no patient fixtures in git. */
import { test, expect } from '@playwright/test';
import { join } from 'node:path';
const root=process.env.CBCTER_MODEL_EVALUATION_ROOT;
test.skip(!root,'Set CBCTER_MODEL_EVALUATION_ROOT to private model results');
for (const mobile of [false,true]) {
  test.describe(mobile?'mobile model results':'desktop model results',()=>{
    test.use({hasTouch:mobile,isMobile:mobile,viewport:mobile?{width:390,height:844}:{width:1280,height:900}});
    test('views actual YOLO proposals, edits a full-grid case and preserves them during another model import',async({page})=>{
      test.setTimeout(180000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto('/');
      await page.getByTestId('zip-input').setInputFiles(join(root!,'cases','onevolume-yolo.cbct.zip'));
      await expect(page.getByTestId('streaming-status')).toHaveText('Full-resolution slices',{timeout:45000});
      await expect(page.getByLabel('Selected tooth instance').locator('option')).toHaveCount(8);
      await page.getByLabel('Structure visibility').selectOption('selected');
      await page.getByRole('button',{name:'Review and export case'}).click();
      await expect(page.getByTestId('progressive-viewer')).toHaveCount(0,{timeout:60000});
      await page.getByRole('button',{name:'Review teeth',exact:true}).click();
      const panel=page.getByRole('region',{name:'Tooth review'});
      await panel.getByRole('button',{name:'Accept outline'}).click();
      await expect(panel.getByLabel('Selected tooth instance')).toContainText('accepted');
      await panel.getByLabel('Import model result',{exact:true}).setInputFiles(join(root!,'cases','onevolume-skin.cbcter.zip'));
      if(mobile) await expect(panel.getByRole('alert')).toContainText('too large');
      else {
        await expect(panel.getByText('Loaded model results (2)')).toBeVisible({timeout:45000});
        await expect(panel.getByLabel('Selected tooth instance')).toContainText('accepted');
      }
      expect(errors).toEqual([]);
    });
    test('streams a full Sidexis anatomy result within the device cache budget',async({page})=>{
      test.setTimeout(120000);await page.goto('/');
      await page.getByTestId('zip-input').setInputFiles(join(root!,'cases','sidexis-dental.cbct.zip'));
      await expect(page.getByTestId('streaming-status')).toHaveText('Full-resolution slices',{timeout:60000});
      await page.getByLabel('Contrast preset').selectOption('bone');
      await expect(page.getByTestId('streaming-status')).toHaveText('Full-resolution slices');
    });
  });
}
