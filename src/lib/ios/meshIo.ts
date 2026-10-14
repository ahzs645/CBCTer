/** Triangle mesh in mm: xyz per vertex, three vertex indices per triangle. */
export interface TriMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

/** Parse an STL (binary or ASCII), PLY (ASCII or binary) or OBJ surface. */
export function parseMesh(bytes: Uint8Array, name: string): TriMesh {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  const head = latin1(bytes.subarray(0, Math.min(bytes.length, 512)));
  if (/^ply\r?\n/.test(head)) return parsePly(bytes);
  if (isBinaryStl(bytes)) return parseBinaryStl(bytes);
  if (/^\s*solid\b/.test(head) || ext === 'stl') {
    if (/^\s*solid\b/.test(head)) return parseAsciiStl(bytes);
    throw new Error(
      `${name}: not a valid STL file (binary size check failed and no "solid" header).`,
    );
  }
  if (ext === 'obj' || /^\s*(#.*\r?\n\s*)*(v|o|g|mtllib)\s/m.test(head))
    return parseObj(bytes, name);
  if (ext === 'ply')
    throw new Error(`${name}: PLY file is missing the "ply" header line.`);
  throw new Error(
    `${name}: unsupported surface format. Use STL, PLY or OBJ (in millimetres).`,
  );
}

/** Binary STL with per-face normals. */
export function meshToBinaryStl(mesh: TriMesh): Uint8Array {
  const { positions: p, indices } = mesh;
  const count = Math.floor(indices.length / 3);
  const out = new Uint8Array(84 + count * 50);
  out.set(new TextEncoder().encode('CBCTer surface (mm)'));
  const view = new DataView(out.buffer);
  view.setUint32(80, count, true);
  let o = 84;
  for (let t = 0; t < count; t++) {
    const a = indices[t * 3] * 3,
      b = indices[t * 3 + 1] * 3,
      c = indices[t * 3 + 2] * 3;
    const ux = p[b] - p[a],
      uy = p[b + 1] - p[a + 1],
      uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a],
      vy = p[c + 1] - p[a + 1],
      vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    view.setFloat32(o, nx, true);
    view.setFloat32(o + 4, ny, true);
    view.setFloat32(o + 8, nz, true);
    o += 12;
    for (const v of [a, b, c]) {
      view.setFloat32(o, p[v], true);
      view.setFloat32(o + 4, p[v + 1], true);
      view.setFloat32(o + 8, p[v + 2], true);
      o += 12;
    }
    o += 2;
  }
  return out;
}

function latin1(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192)
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return s;
}

function isBinaryStl(bytes: Uint8Array): boolean {
  if (bytes.length < 84) return false;
  const count = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(80, true);
  // Some exporters pad a few bytes; an ASCII file never matches by accident.
  const expected = 84 + count * 50;
  return bytes.length >= expected && bytes.length - expected < 50;
}

function parseBinaryStl(bytes: Uint8Array): TriMesh {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  const raw = new Float32Array(count * 9);
  for (let t = 0; t < count; t++) {
    const o = 84 + t * 50 + 12;
    for (let k = 0; k < 9; k++)
      raw[t * 9 + k] = view.getFloat32(o + k * 4, true);
  }
  return weldSoup(raw, 'STL');
}

function parseAsciiStl(bytes: Uint8Array): TriMesh {
  const text = new TextDecoder().decode(bytes);
  const coords: number[] = [];
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
  for (let m = re.exec(text); m; m = re.exec(text))
    coords.push(Number(m[1]), Number(m[2]), Number(m[3]));
  if (coords.length === 0 || coords.length % 9 !== 0)
    throw new Error('ASCII STL: no complete triangles found.');
  return weldSoup(Float32Array.from(coords), 'ASCII STL');
}

/** Merge bit-identical vertices of a triangle soup (9 floats per triangle). */
function weldSoup(raw: Float32Array, format: string): TriMesh {
  for (let i = 0; i < raw.length; i++) {
    if (!Number.isFinite(raw[i]))
      throw new Error(`${format}: file contains non-numeric coordinates.`);
    raw[i] += 0; // fold -0 into +0 so both hash alike
  }
  const bits = new Uint32Array(raw.buffer, raw.byteOffset, raw.length);
  const n = raw.length / 3;
  let size = 1;
  while (size < n * 2) size <<= 1;
  const table = new Int32Array(size).fill(-1);
  const remap = new Uint32Array(n);
  const positions = new Float32Array(raw.length);
  let unique = 0;
  for (let v = 0; v < n; v++) {
    const x = bits[v * 3],
      y = bits[v * 3 + 1],
      z = bits[v * 3 + 2];
    let h =
      (Math.imul(x, 0x9e3779b1) ^
        Math.imul(y, 0x85ebca77) ^
        Math.imul(z, 0xc2b2ae3d)) >>>
      0;
    h = (h ^ (h >>> 15)) & (size - 1);
    for (;;) {
      const slot = table[h];
      if (slot < 0) {
        table[h] = unique;
        positions[unique * 3] = raw[v * 3];
        positions[unique * 3 + 1] = raw[v * 3 + 1];
        positions[unique * 3 + 2] = raw[v * 3 + 2];
        remap[v] = unique++;
        break;
      }
      if (
        positions[slot * 3] === raw[v * 3] &&
        positions[slot * 3 + 1] === raw[v * 3 + 1] &&
        positions[slot * 3 + 2] === raw[v * 3 + 2]
      ) {
        remap[v] = slot;
        break;
      }
      h = (h + 1) & (size - 1);
    }
  }
  return checked(
    { positions: positions.slice(0, unique * 3), indices: remap },
    format,
  );
}

const PLY_TYPES: Record<string, [number, string]> = {
  char: [1, 'Int8'],
  int8: [1, 'Int8'],
  uchar: [1, 'Uint8'],
  uint8: [1, 'Uint8'],
  short: [2, 'Int16'],
  int16: [2, 'Int16'],
  ushort: [2, 'Uint16'],
  uint16: [2, 'Uint16'],
  int: [4, 'Int32'],
  int32: [4, 'Int32'],
  uint: [4, 'Uint32'],
  uint32: [4, 'Uint32'],
  float: [4, 'Float32'],
  float32: [4, 'Float32'],
  double: [8, 'Float64'],
  float64: [8, 'Float64'],
};

interface PlyProperty {
  name: string;
  type: string;
  countType?: string;
}
interface PlyElement {
  name: string;
  count: number;
  props: PlyProperty[];
}

function plyType(t: string): [number, string] {
  const info = PLY_TYPES[t];
  if (!info) throw new Error(`PLY: unknown property type "${t}".`);
  return info;
}

function parsePly(bytes: Uint8Array): TriMesh {
  const head = latin1(bytes.subarray(0, Math.min(bytes.length, 65536)));
  const end = head.search(/end_header\r?\n/);
  if (end < 0) throw new Error('PLY: header has no "end_header" line.');
  const bodyStart = end + head.slice(end).indexOf('\n') + 1;
  let format = '';
  const elements: PlyElement[] = [];
  for (const line of head.slice(0, end).split(/\r?\n/)) {
    const w = line.trim().split(/\s+/);
    if (w[0] === 'format') format = w[1];
    else if (w[0] === 'element')
      elements.push({ name: w[1], count: Number(w[2]), props: [] });
    else if (w[0] === 'property') {
      const el = elements[elements.length - 1];
      if (!el) throw new Error('PLY: property declared before any element.');
      if (w[1] === 'list') {
        plyType(w[2]);
        plyType(w[3]);
        el.props.push({ name: w[4], type: w[3], countType: w[2] });
      } else {
        plyType(w[1]);
        el.props.push({ name: w[2], type: w[1] });
      }
    }
  }
  const vertex = elements.find((e) => e.name === 'vertex');
  if (!vertex) throw new Error('PLY: no vertex element.');
  const axes = ['x', 'y', 'z'].map((a) =>
    vertex.props.findIndex((p) => p.name === a && !p.countType),
  );
  if (axes.some((i) => i < 0))
    throw new Error('PLY: vertices need x, y and z properties.');
  const positions = new Float32Array(vertex.count * 3);
  const tris: number[] = [];
  const faceIndex = (el: PlyElement) =>
    el.name === 'face'
      ? el.props.findIndex(
          (p) =>
            p.countType &&
            (p.name === 'vertex_indices' || p.name === 'vertex_index'),
        )
      : -1;
  const pushFace = (poly: number[]) => {
    for (let k = 1; k + 1 < poly.length; k++)
      tris.push(poly[0], poly[k], poly[k + 1]);
  };

  if (format === 'ascii') {
    const text = new TextDecoder().decode(bytes.subarray(bodyStart));
    const tokens = text.split(/\s+/).filter(Boolean);
    let t = 0;
    const next = () => {
      if (t >= tokens.length) throw new Error('PLY: file ends early.');
      return Number(tokens[t++]);
    };
    for (const el of elements) {
      const fi = faceIndex(el);
      for (let r = 0; r < el.count; r++)
        el.props.forEach((p, pi) => {
          if (p.countType) {
            const n = next();
            const list: number[] = [];
            for (let k = 0; k < n; k++) list.push(next());
            if (pi === fi) pushFace(list);
          } else {
            const value = next();
            if (el === vertex) {
              const axis = axes.indexOf(pi);
              if (axis >= 0) positions[r * 3 + axis] = value;
            }
          }
        });
    }
  } else if (
    format === 'binary_little_endian' ||
    format === 'binary_big_endian'
  ) {
    const little = format === 'binary_little_endian';
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let o = bodyStart;
    const read = (type: string): number => {
      const [size, kind] = plyType(type);
      if (o + size > bytes.length) throw new Error('PLY: file ends early.');
      let v: number;
      switch (kind) {
        case 'Int8':
          v = view.getInt8(o);
          break;
        case 'Uint8':
          v = view.getUint8(o);
          break;
        case 'Int16':
          v = view.getInt16(o, little);
          break;
        case 'Uint16':
          v = view.getUint16(o, little);
          break;
        case 'Int32':
          v = view.getInt32(o, little);
          break;
        case 'Uint32':
          v = view.getUint32(o, little);
          break;
        case 'Float32':
          v = view.getFloat32(o, little);
          break;
        default:
          v = view.getFloat64(o, little);
      }
      o += size;
      return v;
    };
    for (const el of elements) {
      const fi = faceIndex(el);
      for (let r = 0; r < el.count; r++)
        for (let pi = 0; pi < el.props.length; pi++) {
          const p = el.props[pi];
          if (p.countType) {
            const n = read(p.countType);
            if (pi === fi) {
              const list: number[] = [];
              for (let k = 0; k < n; k++) list.push(read(p.type));
              pushFace(list);
            } else o += n * plyType(p.type)[0];
          } else {
            const value = read(p.type);
            if (el === vertex) {
              const axis = axes.indexOf(pi);
              if (axis >= 0) positions[r * 3 + axis] = value;
            }
          }
        }
    }
  } else throw new Error(`PLY: unsupported format "${format}".`);
  return checked({ positions, indices: Uint32Array.from(tris) }, 'PLY');
}

function parseObj(bytes: Uint8Array, name: string): TriMesh {
  const text = new TextDecoder().decode(bytes);
  const coords: number[] = [];
  const tris: number[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('v ') || line.startsWith('v\t')) {
      const w = line.split(/\s+/);
      coords.push(Number(w[1]), Number(w[2]), Number(w[3]));
    } else if (line.startsWith('f ') || line.startsWith('f\t')) {
      const count = coords.length / 3;
      const poly = line
        .split(/\s+/)
        .slice(1)
        .map((token) => {
          const i = parseInt(token, 10);
          if (!Number.isFinite(i) || i === 0)
            throw new Error(`${name}: bad OBJ face "${line}".`);
          return i < 0 ? count + i : i - 1;
        });
      for (let k = 1; k + 1 < poly.length; k++)
        tris.push(poly[0], poly[k], poly[k + 1]);
    }
  }
  return checked(
    { positions: Float32Array.from(coords), indices: Uint32Array.from(tris) },
    'OBJ',
  );
}

/** Reject empty meshes, NaN coordinates and out-of-range indices. */
function checked(mesh: TriMesh, format: string): TriMesh {
  const n = mesh.positions.length / 3;
  if (n === 0 || mesh.indices.length === 0)
    throw new Error(`${format}: file has no triangles.`);
  for (let i = 0; i < mesh.positions.length; i++)
    if (!Number.isFinite(mesh.positions[i]))
      throw new Error(`${format}: file contains non-numeric coordinates.`);
  for (let i = 0; i < mesh.indices.length; i++)
    if (mesh.indices[i] >= n)
      throw new Error(`${format}: face refers to a missing vertex.`);
  return mesh;
}
