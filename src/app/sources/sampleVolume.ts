export type SampleVolumeManifest = {
  name: string;
  source: string;
  file: string;
  dtype: "int16";
  byteOrder: "little-endian";
  dimensions: {
    width: number;
    height: number;
    depth: number;
  };
  spacing: {
    x: number;
    y: number;
    z: number;
  };
  modality?: string;
  manufacturer?: string;
  studyInstanceUid?: string;
  seriesInstanceUid?: string;
  transferSyntaxUid?: string;
  fileCount: number;
  totalBytes: number;
  scalarRange: [number, number];
  window: {
    center: number;
    width: number;
  };
};

export type SampleVolume = {
  manifest: SampleVolumeManifest;
  voxels: Int16Array;
};

let activeSampleVolume: SampleVolume | null = null;

export function setActiveSampleVolume(volume: SampleVolume | null) {
  activeSampleVolume = volume;
}

export function getActiveSampleVolume() {
  return activeSampleVolume;
}

export async function loadSampleVolume(
  basePath = "/sample-cbct",
): Promise<SampleVolume> {
  const manifestResponse = await fetch(`${basePath}/manifest.json`);
  const contentType = manifestResponse.headers.get("content-type") ?? "";

  if (!manifestResponse.ok || !contentType.includes("json")) {
    throw new Error(
      "Sample volume has not been generated yet. Run npm run sample:build.",
    );
  }

  const manifest = (await manifestResponse.json()) as SampleVolumeManifest;
  const volumeResponse = await fetch(`${basePath}/${manifest.file}`);

  if (!volumeResponse.ok) {
    throw new Error("Sample volume raw data is missing.");
  }

  const buffer = await volumeResponse.arrayBuffer();
  const expectedVoxels =
    manifest.dimensions.width *
    manifest.dimensions.height *
    manifest.dimensions.depth;

  if (buffer.byteLength !== expectedVoxels * Int16Array.BYTES_PER_ELEMENT) {
    throw new Error("Sample volume size does not match its manifest.");
  }

  return {
    manifest,
    voxels: new Int16Array(buffer),
  };
}

export function windowPixel(value: number, center: number, width: number) {
  const min = center - width / 2;
  const max = center + width / 2;
  const normalized = (value - min) / Math.max(1, max - min);
  return Math.max(0, Math.min(255, Math.round(normalized * 255)));
}

export function sampleVoxel(
  volume: SampleVolumeManifest,
  x: number,
  y: number,
  z: number,
) {
  const activeVolume = getActiveSampleVolume();

  if (!activeVolume) {
    return 0;
  }

  const { width, height } = volume.dimensions;
  return activeVolume.voxels[z * width * height + y * width + x];
}
