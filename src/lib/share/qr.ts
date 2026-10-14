/**
 * Dependency-free QR Code encoder (ISO/IEC 18004, model 2): byte mode with
 * UTF-8 text, versions 1–40, error correction levels L/M/Q/H, Reed–Solomon
 * ECC over GF(256), block interleaving and automatic mask selection. Used to
 * print scannable share links on the case report.
 */

export type QrEcc = 'L' | 'M' | 'Q' | 'H';

export interface QrSvgOptions {
  /** Size of one module in SVG user units (default 4). */
  moduleSize?: number;
  /** Quiet zone width in modules (default 4, the spec minimum). */
  margin?: number;
  dark?: string;
  light?: string;
  /** Accessible name, rendered as <title>. */
  title?: string;
}

const ECC_INDEX: Record<QrEcc, number> = { L: 0, M: 1, Q: 2, H: 3 };
/** Two-bit format-information code per level. */
const ECC_FORMAT_BITS: Record<QrEcc, number> = { L: 1, M: 0, Q: 3, H: 2 };

/** ECC codewords per block, indexed [level][version] (index 0 unused). */
const ECC_CODEWORDS_PER_BLOCK: readonly (readonly number[])[] = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];

/** Number of error-correction blocks, indexed [level][version]. */
const NUM_ECC_BLOCKS: readonly (readonly number[])[] = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

const MIN_VERSION = 1;
const MAX_VERSION = 40;

/** Modules available for data + ECC (everything but function patterns). */
function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function dataCodewords(version: number, ecc: QrEcc): number {
  const level = ECC_INDEX[ecc];
  return (
    Math.floor(rawDataModules(version) / 8) -
    ECC_CODEWORDS_PER_BLOCK[level][version] * NUM_ECC_BLOCKS[level][version]
  );
}

/** Bits of the character-count indicator for byte mode. */
function byteCountBits(version: number): number {
  return version <= 9 ? 8 : 16;
}

// --- GF(256) Reed–Solomon (primitive polynomial x^8+x^4+x^3+x^2+1) -------

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

/** Generator polynomial coefficients (highest power omitted) of given degree. */
function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] ^= gfMultiply(coef, factor);
    });
  }
  return result;
}

// --- Codeword construction --------------------------------------------------

function buildDataCodewords(bytes: Uint8Array, version: number, ecc: QrEcc): number[] {
  const capacityBits = dataCodewords(version, ecc) * 8;
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, byteCountBits(version));
  bytes.forEach((byte) => push(byte, 8));
  push(0, Math.min(4, capacityBits - bits.length)); // terminator
  push(0, (8 - (bits.length % 8)) % 8);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }
  for (let pad = 0xec; codewords.length < capacityBits / 8; pad ^= 0xec ^ 0x11) {
    codewords.push(pad);
  }
  return codewords;
}

/** Splits data into blocks, appends ECC to each, and interleaves them. */
function addEccAndInterleave(data: readonly number[], version: number, ecc: QrEcc): number[] {
  const level = ECC_INDEX[ecc];
  const numBlocks = NUM_ECC_BLOCKS[level][version];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[level][version];
  const rawCodewords = Math.floor(rawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const divisor = rsDivisor(blockEccLen);

  const blocks: number[][] = [];
  for (let i = 0, offset = 0; i < numBlocks; i++) {
    const length = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
    const block = data.slice(offset, offset + length);
    offset += length;
    const eccBytes = rsRemainder(block, divisor);
    if (i < numShortBlocks) block.push(0); // placeholder, skipped below
    blocks.push(block.concat(eccBytes));
  }

  const result: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]);
    });
  }
  return result;
}

// --- Matrix construction ----------------------------------------------------

function alignmentPositions(version: number, size: number): number[] {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

class QrMatrix {
  readonly version: number;
  readonly ecc: QrEcc;
  readonly size: number;
  readonly modules: boolean[][];
  readonly isFunction: boolean[][];

  constructor(version: number, ecc: QrEcc) {
    this.version = version;
    this.ecc = ecc;
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.isFunction = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.drawFunctionPatterns();
  }

  private setFunction(x: number, y: number, dark: boolean): void {
    this.modules[y][x] = dark;
    this.isFunction[y][x] = true;
  }

  private drawFunctionPatterns(): void {
    const { size } = this;
    for (let i = 0; i < size; i++) {
      this.setFunction(6, i, i % 2 === 0);
      this.setFunction(i, 6, i % 2 === 0);
    }
    this.drawFinder(3, 3);
    this.drawFinder(size - 4, 3);
    this.drawFinder(3, size - 4);
    const positions = alignmentPositions(this.version, size);
    const last = positions.length - 1;
    positions.forEach((y, i) => {
      positions.forEach((x, j) => {
        const overlapsFinder =
          (i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0);
        if (!overlapsFinder) this.drawAlignment(x, y);
      });
    });
    // Reserve the format/version areas (light) so codewords skip them; they
    // are filled in after mask selection, as ISO/IEC 18004 §7.8 specifies.
    this.placeFormatBits(0, false);
    if (this.version >= 7) this.placeVersionBits(0);
  }

  private drawFinder(cx: number, cy: number): void {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= this.size || y >= this.size) continue;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        this.setFunction(x, y, dist !== 2 && dist !== 4);
      }
    }
  }

  private drawAlignment(cx: number, cy: number): void {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  /** Writes the 15-bit BCH-protected format information for the mask. */
  drawFormatBits(mask: number): void {
    const data = (ECC_FORMAT_BITS[this.ecc] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    this.placeFormatBits(((data << 10) | rem) ^ 0x5412, true);
  }

  private placeFormatBits(bits: number, darkModule: boolean): void {
    const bit = (i: number) => ((bits >>> i) & 1) !== 0;
    const { size } = this;
    // Copy around the top-left finder.
    for (let i = 0; i <= 5; i++) this.setFunction(8, i, bit(i));
    this.setFunction(8, 7, bit(6));
    this.setFunction(8, 8, bit(7));
    this.setFunction(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.setFunction(14 - i, 8, bit(i));
    // Split copy beside the other two finders.
    for (let i = 0; i < 8; i++) this.setFunction(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.setFunction(8, size - 15 + i, bit(i));
    this.setFunction(8, size - 8, darkModule); // the always-dark module
  }

  /** Writes the 18-bit Golay-protected version information (v7+). */
  drawVersionBits(): void {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    this.placeVersionBits((this.version << 12) | rem);
  }

  private placeVersionBits(bits: number): void {
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunction(a, b, dark);
      this.setFunction(b, a, dark);
    }
  }

  /** Places codewords in the two-column zigzag, skipping function modules. */
  drawCodewords(codewords: readonly number[]): void {
    const { size } = this;
    const totalBits = codewords.length * 8;
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // skip the vertical timing column
      const upward = ((right + 1) & 2) === 0;
      for (let vert = 0; vert < size; vert++) {
        const y = upward ? size - 1 - vert : vert;
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          if (this.isFunction[y][x] || i >= totalBits) continue;
          this.modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
    }
  }

  /** XORs a mask over the data area; applying it twice undoes it. */
  applyMask(mask: number): void {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (!this.isFunction[y][x] && maskBit(mask, x, y)) this.modules[y][x] = !this.modules[y][x];
      }
    }
  }
}

function maskBit(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

const FINDER_CORE = [true, false, true, true, true, false, true];

/**
 * N3: counts dark-light-dark×3-light-dark cores with four light modules on
 * at least one side (the quiet zone beyond the edge counts as light).
 */
function finderLikePenalty(at: (k: number) => boolean, size: number): number {
  const lightRun = (from: number, to: number) => {
    for (let k = Math.max(from, 0); k < Math.min(to, size); k++) if (at(k)) return false;
    return true;
  };
  let penalty = 0;
  let idx = 0;
  while (idx + 7 <= size) {
    let match = true;
    for (let m = 0; m < 7 && match; m++) if (at(idx + m) !== FINDER_CORE[m]) match = false;
    if (!match) {
      idx++;
      continue;
    }
    if (lightRun(idx - 4, idx) || lightRun(idx + 7, idx + 11)) {
      penalty += 40;
      idx += 7;
    } else {
      idx += 4;
    }
  }
  return penalty;
}

/** Standard mask penalty (rules N1–N4 of ISO/IEC 18004 §7.8.3). */
function maskPenalty(modules: readonly (readonly boolean[])[]): number {
  const size = modules.length;
  let penalty = 0;
  const line = (index: number, horizontal: boolean) => (k: number) =>
    horizontal ? modules[index][k] : modules[k][index];

  for (let index = 0; index < size; index++) {
    for (const horizontal of [true, false]) {
      const at = line(index, horizontal);
      // N1: runs of five or more same-colour modules.
      let run = 1;
      for (let k = 1; k <= size; k++) {
        if (k < size && at(k) === at(k - 1)) {
          run++;
        } else {
          if (run >= 5) penalty += 3 + (run - 5);
          run = 1;
        }
      }
      penalty += finderLikePenalty(at, size);
    }
  }

  // N2: 2x2 blocks of one colour.
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = modules[y][x];
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) {
        penalty += 3;
      }
    }
  }

  // N4: dark proportion, 10 points per 5% deviation from 50%.
  let dark = 0;
  for (const row of modules) for (const cell of row) if (cell) dark++;
  const percent = (dark * 100) / (size * size);
  penalty += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return penalty;
}

/** Smallest version whose capacity fits `byteLength` bytes at the given level. */
export function qrVersionFor(byteLength: number, ecc: QrEcc = 'M'): number {
  for (let version = MIN_VERSION; version <= MAX_VERSION; version++) {
    const needed = 4 + byteCountBits(version) + byteLength * 8;
    if (needed <= dataCodewords(version, ecc) * 8) return version;
  }
  throw new RangeError(`QR code: ${byteLength} bytes exceed version 40 capacity at level ${ecc}`);
}

/**
 * Encodes UTF-8 text as a QR code (byte mode). Returns rows of modules,
 * `true` = dark, without the quiet zone.
 */
export function encodeQr(text: string, ecc: QrEcc = 'M'): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  const version = qrVersionFor(bytes.length, ecc);
  const codewords = addEccAndInterleave(buildDataCodewords(bytes, version, ecc), version, ecc);
  const matrix = new QrMatrix(version, ecc);
  matrix.drawCodewords(codewords);

  let bestMask = 0;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    matrix.applyMask(mask);
    const penalty = maskPenalty(matrix.modules);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = mask;
    }
    matrix.applyMask(mask); // undo
  }
  matrix.applyMask(bestMask);
  matrix.drawFormatBits(bestMask);
  matrix.drawVersionBits();
  return matrix.modules.map((row) => row.slice());
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Renders a module matrix as a standalone SVG string. Dark modules are one
 * <path> made of horizontal runs; the quiet zone is included in the viewBox.
 */
export function qrToSvg(matrix: readonly (readonly boolean[])[], options: QrSvgOptions = {}): string {
  const moduleSize = options.moduleSize ?? 4;
  const margin = options.margin ?? 4;
  const dark = options.dark ?? '#000';
  const light = options.light ?? '#fff';
  const total = matrix.length + margin * 2;
  const pixels = total * moduleSize;

  const segments: string[] = [];
  matrix.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue;
      const start = x;
      while (x + 1 < row.length && row[x + 1]) x++;
      segments.push(`M${start + margin} ${y + margin}h${x - start + 1}v1h-${x - start + 1}z`);
    }
  });

  const title = options.title ? `<title>${escapeXml(options.title)}</title>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" role="img" viewBox="0 0 ${total} ${total}" ` +
    `width="${pixels}" height="${pixels}" shape-rendering="crispEdges">` +
    title +
    `<rect width="${total}" height="${total}" fill="${escapeXml(light)}"/>` +
    `<path fill="${escapeXml(dark)}" d="${segments.join('')}"/>` +
    `</svg>`
  );
}
