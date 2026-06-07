export interface TriangleMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

function floatKey(x: number, y: number, z: number): string {
  return `${x.toFixed(5)}|${y.toFixed(5)}|${z.toFixed(5)}`;
}

export function parseBinaryStl(bytes: Uint8Array): TriangleMesh {
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  const triangleCount = view.getUint32(80, true);
  const vertices: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const vertexIds = new Map<string, number>();
  let offset = 84;

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const normal = [
      view.getFloat32(offset, true),
      view.getFloat32(offset + 4, true),
      view.getFloat32(offset + 8, true),
    ];
    offset += 12;
    for (let point = 0; point < 3; point += 1) {
      const x = view.getFloat32(offset, true);
      const y = view.getFloat32(offset + 4, true);
      const z = view.getFloat32(offset + 8, true);
      offset += 12;
      const key = floatKey(x, y, z);
      let vertexId = vertexIds.get(key);
      if (vertexId === undefined) {
        vertexId = vertices.length / 3;
        vertexIds.set(key, vertexId);
        vertices.push(x, y, z);
        normals.push(normal[0], normal[1], normal[2]);
      }
      indices.push(vertexId);
    }
    offset += 2;
  }

  return {
    positions: new Float32Array(vertices),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}

export function meshToObj(mesh: TriangleMesh, name: string): Uint8Array {
  const lines = [`o ${name.replace(/[^a-z0-9_-]+/gi, '_')}`];
  for (let index = 0; index < mesh.positions.length; index += 3) {
    lines.push(
      `v ${mesh.positions[index]} ${mesh.positions[index + 1]} ${
        mesh.positions[index + 2]
      }`,
    );
  }
  for (let index = 0; index < mesh.normals.length; index += 3) {
    lines.push(
      `vn ${mesh.normals[index]} ${mesh.normals[index + 1]} ${
        mesh.normals[index + 2]
      }`,
    );
  }
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const a = mesh.indices[index] + 1;
    const b = mesh.indices[index + 1] + 1;
    const c = mesh.indices[index + 2] + 1;
    lines.push(`f ${a}//${a} ${b}//${b} ${c}//${c}`);
  }
  return new TextEncoder().encode(`${lines.join('\n')}\n`);
}

function pad4(bytes: Uint8Array, fill = 0): Uint8Array {
  const padded = new Uint8Array(Math.ceil(bytes.byteLength / 4) * 4);
  if (fill !== 0) padded.fill(fill);
  padded.set(bytes);
  return padded;
}

function minMax(values: Float32Array): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < values.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = values[index + axis];
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }
  return { min, max };
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

export function meshToGlb(mesh: TriangleMesh, name: string): Uint8Array {
  const positions = new Uint8Array(mesh.positions.buffer.slice(0));
  const normals = new Uint8Array(mesh.normals.buffer.slice(0));
  const indices = new Uint8Array(mesh.indices.buffer.slice(0));
  const positionOffset = 0;
  const normalOffset = pad4(positions).byteLength;
  const indexOffset = normalOffset + pad4(normals).byteLength;
  const bin = concatBytes([pad4(positions), pad4(normals), pad4(indices)]);
  const bounds = minMax(mesh.positions);
  const json = {
    asset: { version: '2.0', generator: 'CBCTer' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1 },
            indices: 2,
            mode: 4,
          },
        ],
      },
    ],
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: positionOffset, byteLength: positions.byteLength, target: 34962 },
      { buffer: 0, byteOffset: normalOffset, byteLength: normals.byteLength, target: 34962 },
      { buffer: 0, byteOffset: indexOffset, byteLength: indices.byteLength, target: 34963 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: mesh.positions.length / 3,
        type: 'VEC3',
        min: bounds.min,
        max: bounds.max,
      },
      {
        bufferView: 1,
        componentType: 5126,
        count: mesh.normals.length / 3,
        type: 'VEC3',
      },
      {
        bufferView: 2,
        componentType: 5125,
        count: mesh.indices.length,
        type: 'SCALAR',
      },
    ],
  };
  const jsonBytes = pad4(
    new TextEncoder().encode(JSON.stringify(json)),
    0x20,
  );
  const buffer = new ArrayBuffer(12 + 8 + jsonBytes.byteLength + 8 + bin.byteLength);
  const view = new DataView(buffer);
  let offset = 0;
  view.setUint32(offset, 0x46546c67, true);
  offset += 4;
  view.setUint32(offset, 2, true);
  offset += 4;
  view.setUint32(offset, buffer.byteLength, true);
  offset += 4;
  view.setUint32(offset, jsonBytes.byteLength, true);
  offset += 4;
  view.setUint32(offset, 0x4e4f534a, true);
  offset += 4;
  new Uint8Array(buffer, offset, jsonBytes.byteLength).set(jsonBytes);
  offset += jsonBytes.byteLength;
  view.setUint32(offset, bin.byteLength, true);
  offset += 4;
  view.setUint32(offset, 0x004e4942, true);
  offset += 4;
  new Uint8Array(buffer, offset, bin.byteLength).set(bin);
  return new Uint8Array(buffer);
}
