import { describe, expect, it } from 'vitest';
import { filenameFromContentDisposition } from './remote';

describe('remote import helpers', () => {
  it('extracts RFC 5987 filenames from Content-Disposition', () => {
    expect(
      filenameFromContentDisposition("attachment; filename*=UTF-8''scan%20one.zip"),
    ).toBe('scan one.zip');
  });

  it('extracts quoted filenames from Content-Disposition', () => {
    expect(
      filenameFromContentDisposition('attachment; filename="study.cbcter.zip"'),
    ).toBe('study.cbcter.zip');
  });
});
