import { describe, expect, it } from 'vitest';
import { encodeQr, qrToSvg, qrVersionFor } from './qr';

const toHex = (matrix: boolean[][]) =>
  matrix.map((row) =>
    parseInt(row.map((dark) => (dark ? '1' : '0')).join(''), 2)
      .toString(16)
      .padStart(Math.ceil(row.length / 4), '0'),
  );

/** Reads a 7x7 finder pattern whose top-left corner is at (x, y). */
function isFinderAt(matrix: boolean[][], x: number, y: number): boolean {
  for (let dy = 0; dy < 7; dy++) {
    for (let dx = 0; dx < 7; dx++) {
      const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
      if (matrix[y + dy][x + dx] !== (ring !== 2)) return false;
    }
  }
  return true;
}

describe('QR encoder', () => {
  it('picks the smallest version that fits (byte mode)', () => {
    expect(encodeQr('HELLO WORLD', 'M')).toHaveLength(21);
    // Capacities from ISO/IEC 18004 Table 7 (byte mode).
    expect(qrVersionFor(14, 'M')).toBe(1);
    expect(qrVersionFor(15, 'M')).toBe(2);
    expect(qrVersionFor(17, 'L')).toBe(1);
    expect(qrVersionFor(7, 'H')).toBe(1);
    expect(qrVersionFor(8, 'H')).toBe(2);
    expect(qrVersionFor(180, 'M')).toBe(9);
    expect(qrVersionFor(181, 'M')).toBe(10); // 16-bit count indicator from v10
    expect(qrVersionFor(2331, 'M')).toBe(40);
    expect(() => qrVersionFor(2332, 'M')).toThrow(RangeError);
    expect(encodeQr('x'.repeat(181))).toHaveLength(10 * 4 + 17);
  });

  it('counts UTF-8 bytes, not UTF-16 units', () => {
    // 'Zahn 33 – Wurzel ä' is 18 chars but 21 UTF-8 bytes (> 14, so v2).
    expect(encodeQr('Zahn 33 – Wurzel ä')).toHaveLength(25);
  });

  it('draws finder and timing patterns', () => {
    const matrix = encodeQr('https://ahzs645.github.io/CBCTer/#url=x&tooth=33');
    const size = matrix.length;
    expect(isFinderAt(matrix, 0, 0)).toBe(true);
    expect(isFinderAt(matrix, size - 7, 0)).toBe(true);
    expect(isFinderAt(matrix, 0, size - 7)).toBe(true);
    expect(isFinderAt(matrix, size - 7, size - 7)).toBe(false);
    for (let i = 8; i < size - 8; i++) {
      expect(matrix[6][i]).toBe(i % 2 === 0);
      expect(matrix[i][6]).toBe(i % 2 === 0);
    }
    expect(matrix[size - 8][8]).toBe(true); // always-dark module
  });

  it('writes version information from version 7', () => {
    const matrix = encodeQr('x'.repeat(122), 'M');
    expect(matrix).toHaveLength(45);
    // Version 7 → 0x07C94 (ISO/IEC 18004 Annex D), LSB at the block's corner.
    let bits = 0;
    for (let i = 17; i >= 0; i--) {
      const dark = matrix[Math.floor(i / 3)][45 - 11 + (i % 3)];
      expect(matrix[45 - 11 + (i % 3)][Math.floor(i / 3)]).toBe(dark);
      bits = (bits << 1) | (dark ? 1 : 0);
    }
    expect(bits).toBe(0x07c94);
  });

  it('is deterministic', () => {
    const text = 'https://ahzs645.github.io/CBCTer/#url=https%3A%2F%2Fhuggingface.co%2Fcase.cbct.zip&tooth=33';
    expect(encodeQr(text, 'Q')).toEqual(encodeQr(text, 'Q'));
    expect(encodeQr(text, 'Q')).not.toEqual(encodeQr(text, 'L'));
  });

  it('matches a matrix verified with OpenCV and segno', () => {
    // 'HELLO WORLD', byte mode, level M, version 1, mask 4. Decoded by
    // cv2.QRCodeDetector(Aruco) and bit-identical to the segno reference.
    expect(toHex(encodeQr('HELLO WORLD', 'M'))).toEqual([
      '1fd97f', '104241', '174a5d', '17525d', '175d5d', '105241', '1fd57f',
      '001300', '117ef9', '02170f', '07e6d2', '1f1880', '1f5566', '0015eb',
      '1fdd5a', '104bb3', '175ac6', '17491b', '174e38', '104280', '1fdff5',
    ]);
  });
});

describe('qrToSvg', () => {
  it('renders one path with a quiet zone and an escaped title', () => {
    const matrix = encodeQr('HELLO WORLD');
    const svg = qrToSvg(matrix, { moduleSize: 2, margin: 4, title: 'Case <33> & "x"' });
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" role="img"')).toBe(true);
    expect(svg).toContain('viewBox="0 0 29 29"');
    expect(svg).toContain('width="58" height="58"');
    expect(svg).toContain('<title>Case &lt;33&gt; &amp; &quot;x&quot;</title>');
    expect(svg.match(/<path /g)).toHaveLength(1);
    // Top-left finder row 0 is a 7-module run starting at the margin.
    expect(svg).toContain('M4 4h7v1h-7z');
  });

  it('omits the title when none is given', () => {
    expect(qrToSvg([[true]])).not.toContain('<title>');
  });
});
