import { describe, expect, it } from 'vitest';
import { planToothExport } from './exportBudget';

const MiB = 1024 * 1024;

describe('planToothExport', () => {
  it('keeps the plan when it fits', () => {
    const plan = planToothExport({
      teeth: 6,
      unionVoxels: 4e6,
      archModel: true,
      smaller: true,
      budgetBytes: 350 * MiB,
    });
    expect(plan.archModel).toBe(true);
    expect(plan.note).toBeNull();
  });

  it('drops the printable model on a phone for a whole arch', () => {
    const plan = planToothExport({
      teeth: 12,
      unionVoxels: 14e6,
      archModel: true,
      smaller: false,
      budgetBytes: 350 * MiB,
    });
    expect(plan.archModel).toBe(false);
    expect(plan.note).toMatch(/printable model/);
  });

  it('warns when even the teeth alone are too much', () => {
    const plan = planToothExport({
      teeth: 28,
      unionVoxels: 40e6,
      archModel: false,
      smaller: false,
      budgetBytes: 200 * MiB,
    });
    expect(plan.note).toMatch(/smaller files/);
  });
});
