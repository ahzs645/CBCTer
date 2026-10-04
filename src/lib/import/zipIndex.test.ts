import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readZipEntry, readZipIndex } from './zipIndex';

describe('zipIndex', () => {
  const payload = new Uint8Array(5000).map((_, index) => index % 7);
  const zipped = zipSync({
    'a/stored.txt': [strToU8('hello'), { level: 0 }],
    'b.bin': [payload, { level: 6 }],
  });
  const blob = new Blob([zipped as Uint8Array<ArrayBuffer>]);

  it('lists entries with their compression method and sizes', async () => {
    const index = await readZipIndex(blob);
    expect(index.map((entry) => [entry.name, entry.method, entry.size])).toEqual([
      ['a/stored.txt', 0, 5],
      ['b.bin', 8, 5000],
    ]);
  });

  it('extracts stored and deflated entries', async () => {
    const [stored, deflated] = await readZipIndex(blob);
    expect(new TextDecoder().decode(await readZipEntry(blob, stored))).toBe('hello');
    expect(Array.from(await readZipEntry(blob, deflated))).toEqual(Array.from(payload));
  });

  it('rejects files that are not zips', async () => {
    await expect(readZipIndex(new Blob([new Uint8Array(100)]))).rejects.toThrow(/Not a ZIP/);
  });
});

it('detects corruption in a ZIP-stored payload instead of accepting altered voxels', async()=>{
  const bytes=zipSync({'volume.bin':[new Uint8Array([1,2,3,4]),{level:0}]});
  const v=new DataView(bytes.buffer);const offset=30+v.getUint16(26,true)+v.getUint16(28,true);bytes[offset]^=255;
  const blob=new Blob([bytes as Uint8Array<ArrayBuffer>]);const [entry]=await readZipIndex(blob);
  await expect(readZipEntry(blob,entry)).rejects.toThrow(/Corrupt ZIP payload/);
});
