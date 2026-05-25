import { prepareVolumeFor3D } from "../lib/volume";
import type { LoadedVolume, PreparedVolumeFor3D, Vec3 } from "../types";
import { VolumeAxis } from "../types";
import { loadSampleVolume, type SampleVolumeManifest } from "./sampleVolume";

export interface LoadedSample {
  volume: LoadedVolume;
  prepared3D: PreparedVolumeFor3D;
  label: string;
}

function buildLoadedVolume(
  manifest: SampleVolumeManifest,
  voxels: Int16Array,
): LoadedVolume {
  const dimensions: Vec3 = [
    manifest.dimensions.width,
    manifest.dimensions.height,
    manifest.dimensions.depth,
  ];
  const spacing: Vec3 = [
    manifest.spacing.x,
    manifest.spacing.y,
    manifest.spacing.z,
  ];

  return {
    meta: {
      format: "dicom",
      formatLabel: manifest.modality
        ? `Sample CBCT · ${manifest.modality}`
        : "Sample CBCT",
      scanId: manifest.name,
      dimensions,
      spacing,
      scalarRange: manifest.scalarRange,
      initialWindowLevel: {
        window: manifest.window.width,
        level: manifest.window.center,
      },
      sliceCount: manifest.dimensions.depth,
      bytesPerVoxel: 2,
      headerFileName: manifest.file,
      slicePrefix: "",
      sliceFiles: [],
      nativeAxis: VolumeAxis.Axial,
      seriesChoices: [],
    },
    voxels,
    histogram: new Uint32Array(0),
  };
}

export async function loadSample(
  basePath = "/sample-cbct",
): Promise<LoadedSample> {
  const sample = await loadSampleVolume(basePath);
  const volume = buildLoadedVolume(sample.manifest, sample.voxels);

  return {
    volume,
    prepared3D: prepareVolumeFor3D(volume),
    label: sample.manifest.name,
  };
}
