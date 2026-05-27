import { Box, PanelRightClose } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ViewerApp } from '../app/useViewerApp';
import { useCompactViewerLayout } from '../app/viewer-layout';
import { Button } from '../components/Button';
import { ViewerSidebar } from '../components/ViewerSidebar';
import {
  AxisViewportGrid,
  type CompletedSliceMeasurement,
  ViewportFrame,
  VolumeViewport3D,
  type VolumeViewport3DHandle,
} from '../viewer';
import {
  appViewerTheme,
  useAxisViewportLabels,
  useVolumeViewport3DLabels,
} from '../app/viewer-i18n';
import { APP_ROUTES } from '../constants';
import {
  createEmptyStudyState,
  createFullCropBounds,
  createStudyAnnotation,
  createStudyImageLayer,
  createStudyMeasurement,
  createStudyMask,
  createStudySegment,
  createStudySegmentGroup,
  createStudySurface,
  normalizeStudyState,
} from '../domain/studyState';
import type { ScanStudy, StudyState } from '../domain/types';
import { createAppId } from '../domain/ids';
import { useTranslation } from '../i18n';
import { densityStats } from '../lib/measurements/geometry';
import {
  buildProjectArchive,
  loadLatestProject,
  projectArchiveName,
  readProjectArchive,
  saveLatestProject,
} from '../lib/project';
import {
  countMaskVoxels,
  extractLabelmapOverlayImage,
  extractMaskOverlayImage,
  fillMaskHoles,
  regionGrowMask,
  thresholdVolume,
} from '../lib/segmentation/maskOperations';
import {
  axisPointToVoxel,
  labelmapToMask,
  paintLabelmapStroke,
} from '../lib/segmentation/paintBrush';
import { maskToAsciiPly } from '../lib/segmentation/maskMesh';
import {
  keepLargestMaskComponentInWorker,
  splitMaskComponentsInWorker,
} from '../lib/segmentation/runMaskWorker';
import {
  generateSurfaceInWorker,
  type SurfaceGenerationQuality,
} from '../lib/surface';
import type { SurfaceMeshPreview } from '../lib/volume/three-preview';
import { VolumeAxis, type SliceImage } from '../types';
import { cn } from '../utils/cn';

interface ViewerPageProps {
  app: ViewerApp;
}

type MaskBufferMap = Record<string, Uint8Array>;
type SurfaceBlobMap = Record<string, Blob>;
type SurfaceUrlMap = Record<string, string>;
type LabelmapBufferMap = Record<string, Uint8Array>;
type SliceProbe = {
  axis: VolumeAxis;
  voxel: [number, number, number];
  value: number;
  label?: string;
} | null;

interface MaskSnapshot {
  masks: StudyState['masks'];
  segmentGroups: StudyState['segmentGroups'];
  activeMaskId?: string;
  buffers: MaskBufferMap;
  labelmaps: LabelmapBufferMap;
}

interface MaskEditSession {
  snapshot: MaskSnapshot;
  maskId: string;
  buffer: Uint8Array;
  labelmapGroupId?: string;
  labelmap?: Uint16Array;
  segmentValue?: number;
  touched: Set<number>;
  lastVoxel?: [number, number, number];
}

function cloneMaskBuffers(buffers: MaskBufferMap): MaskBufferMap {
  return Object.fromEntries(
    Object.entries(buffers).map(([id, buffer]) => [id, new Uint8Array(buffer)]),
  );
}

function volumeMaskDims(dimensions: [number, number, number]): [number, number, number] {
  return [dimensions[2], dimensions[1], dimensions[0]];
}

function sameVec3(
  left: [number, number, number],
  right: [number, number, number],
): boolean {
  return left[0] === right[0] && left[1] === right[1] && left[2] === right[2];
}

function byteRangeToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function uint16ArrayToBytes(values: Uint16Array): Uint8Array {
  return new Uint8Array(
    values.buffer.slice(
      values.byteOffset,
      values.byteOffset + values.byteLength,
    ),
  );
}

function bytesToUint16Array(bytes: Uint8Array): Uint16Array {
  const copy = new Uint8Array(bytes);
  return new Uint16Array(copy.buffer);
}

function buildLabelmapBuffers(
  groups: StudyState['segmentGroups'],
  maskBuffers: MaskBufferMap,
  voxelCount: number,
): LabelmapBufferMap {
  const labelmaps: LabelmapBufferMap = {};
  for (const group of groups) {
    const labelmap = new Uint16Array(voxelCount);
    for (const segment of group.segments) {
      if (!segment.maskId) continue;
      const mask = maskBuffers[segment.maskId];
      if (!mask) continue;
      for (let index = 0; index < Math.min(mask.length, labelmap.length); index += 1) {
        if (mask[index]) labelmap[index] = segment.value;
      }
    }
    labelmaps[group.id] = uint16ArrayToBytes(labelmap);
  }
  return labelmaps;
}

function maskToLabelmap(mask: Uint8Array, value: number): Uint16Array {
  const labelmap = new Uint16Array(mask.length);
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index]) labelmap[index] = value;
  }
  return labelmap;
}

function clampIndex(value: number, max: number): number {
  return Math.min(max, Math.max(0, value));
}

function pointInPolygon(
  point: { xRatio: number; yRatio: number },
  polygon: Array<{ xRatio: number; yRatio: number }>,
): boolean {
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1
  ) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    if (
      currentPoint.yRatio > point.yRatio !== previousPoint.yRatio > point.yRatio &&
      point.xRatio <
        ((previousPoint.xRatio - currentPoint.xRatio) *
          (point.yRatio - currentPoint.yRatio)) /
          (previousPoint.yRatio - currentPoint.yRatio || Number.EPSILON) +
          currentPoint.xRatio
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInMeasurementRoi(
  point: { xRatio: number; yRatio: number },
  roi: CompletedSliceMeasurement['densityRoi'],
): boolean {
  if (!roi) return false;
  if (roi.kind === 'polygon') return pointInPolygon(point, roi.points);
  const [first, second] = roi.points;
  if (!first || !second) return false;
  const centerX = (first.xRatio + second.xRatio) / 2;
  const centerY = (first.yRatio + second.yRatio) / 2;
  const radiusX = Math.abs(second.xRatio - first.xRatio) / 2;
  const radiusY = Math.abs(second.yRatio - first.yRatio) / 2;
  if (radiusX <= 0 || radiusY <= 0) return false;
  const normalizedX = (point.xRatio - centerX) / radiusX;
  const normalizedY = (point.yRatio - centerY) / radiusY;
  return normalizedX * normalizedX + normalizedY * normalizedY <= 1;
}

function blankSeedOverlay(
  axis: VolumeAxis,
  dimensions: [number, number, number],
  spacing: [number, number, number],
): SliceImage {
  const [width, height, depth] = dimensions;
  const shape =
    axis === VolumeAxis.Axial
      ? { width, height }
      : axis === VolumeAxis.Coronal
        ? { width, height: depth }
        : { width: height, height: depth };
  const displayAspect =
    axis === VolumeAxis.Axial
      ? spacing[0] / spacing[1] || 1
      : axis === VolumeAxis.Coronal
        ? spacing[0] / spacing[2] || 1
        : spacing[1] / spacing[2] || 1;
  return {
    ...shape,
    data: new Uint8ClampedArray(shape.width * shape.height * 4),
    displayAspect,
    pixelated: true,
  };
}

function drawMarkerPixel(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  color: [number, number, number],
): void {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const offset = (y * width + x) * 4;
  data[offset] = color[0];
  data[offset + 1] = color[1];
  data[offset + 2] = color[2];
  data[offset + 3] = 235;
}

function withWatershedSeedMarkers(
  image: SliceImage | null,
  axis: VolumeAxis,
  cursor: { x: number; y: number; z: number },
  dimensions: [number, number, number],
  spacing: [number, number, number],
  seeds: StudyState['maskWorkflow']['watershedSeeds'],
): SliceImage | null {
  if (seeds.length === 0) return image;
  const overlay = image
    ? { ...image, data: new Uint8ClampedArray(image.data) }
    : blankSeedOverlay(axis, dimensions, spacing);
  let drew = false;
  const [, , depth] = dimensions;
  for (const seed of seeds) {
    const [x, y, z] = seed.point;
    let sx: number;
    let sy: number;
    if (axis === VolumeAxis.Axial) {
      if (z !== cursor.z) continue;
      sx = x;
      sy = y;
    } else if (axis === VolumeAxis.Coronal) {
      if (y !== cursor.y) continue;
      sx = x;
      sy = depth - 1 - z;
    } else {
      if (x !== cursor.x) continue;
      sx = y;
      sy = depth - 1 - z;
    }
    const color: [number, number, number] =
      seed.kind === 'foreground' ? [34, 197, 94] : [248, 113, 113];
    for (let delta = -3; delta <= 3; delta += 1) {
      drawMarkerPixel(overlay.data, overlay.width, overlay.height, sx + delta, sy, color);
      drawMarkerPixel(overlay.data, overlay.width, overlay.height, sx, sy + delta, color);
    }
    drawMarkerPixel(overlay.data, overlay.width, overlay.height, sx, sy, [255, 255, 255]);
    drew = true;
  }
  return drew ? overlay : image;
}

export default function ViewerPage({ app }: ViewerPageProps) {
  const compactLayout = useCompactViewerLayout();
  const { t } = useTranslation();
  const axisLabels = useAxisViewportLabels();
  const volume3DLabels = useVolumeViewport3DLabels();
  const navigate = useNavigate();
  const openTeeth = () => navigate(APP_ROUTES.teeth);
  const openPanoramic = () => navigate(APP_ROUTES.panoramic);
  const viewport3DRef = useRef<VolumeViewport3DHandle>(null);
  const [studyState, setStudyState] = useState<StudyState>(() =>
    createEmptyStudyState(),
  );
  const [maskBuffers, setMaskBuffers] = useState<MaskBufferMap>({});
  const [labelmapBuffers, setLabelmapBuffers] = useState<LabelmapBufferMap>({});
  const [surfaceBlobs, setSurfaceBlobs] = useState<SurfaceBlobMap>({});
  const [surfaceUrls, setSurfaceUrls] = useState<SurfaceUrlMap>({});
  const [surfacePreviews, setSurfacePreviews] = useState<SurfaceMeshPreview[]>([]);
  const [surfaceStatus, setSurfaceStatus] = useState<string | undefined>();
  const [maskStatus, setMaskStatus] = useState<string | undefined>();
  const [sliceProbe, setSliceProbe] = useState<SliceProbe>(null);
  const surfaceUrlsRef = useRef<SurfaceUrlMap>({});
  const dicomImportEngineRef = useRef(app.dicomImportEngine);
  const surfaceAbortRef = useRef<AbortController | null>(null);
  const maskAbortRef = useRef<AbortController | null>(null);
  const maskEditSessionRef = useRef<MaskEditSession | null>(null);
  const [undoStack, setUndoStack] = useState<MaskSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<MaskSnapshot[]>([]);

  useEffect(() => {
    dicomImportEngineRef.current = app.dicomImportEngine;
  }, [app.dicomImportEngine]);

  const scanStudy = useMemo<ScanStudy | null>(() => {
    if (!app.volume) return null;
    return {
      id: `study_${app.volume.meta.scanId}`,
      name: app.volume.meta.scanId,
      source: app.sourceLabel.toLowerCase().includes('sample')
        ? 'sample'
        : 'local-folder',
      fileCount: app.volume.meta.sliceCount,
      totalBytes: app.volume.voxels.byteLength,
      modality: app.volume.meta.formatLabel,
      status: 'indexed',
      createdAt: 0,
      updatedAt: 0,
    };
  }, [app.sourceLabel, app.volume]);
  const maskSliceEditEnabled =
    studyState.activeTool === 'mask-brush' ||
    studyState.activeTool === 'mask-erase' ||
    studyState.activeTool === 'mask-threshold' ||
    studyState.activeTool === 'mask-watershed-seed';

  const maskOverlays = useMemo<Partial<Record<VolumeAxis, SliceImage | null>>>(
    () => {
      if (!app.cursor || !app.volume) return {};
      const labelmapLayers = studyState.segmentGroups
        .map((group) => {
          const buffer = labelmapBuffers[group.id];
          if (!buffer) return null;
          return {
            labelmap: new Uint16Array(
              buffer.buffer,
              buffer.byteOffset,
              buffer.byteLength / 2,
            ),
            opacity: group.opacity,
            visible: group.visible,
            segments: group.segments.map((segment) => ({
              value: segment.value,
              color: segment.color,
              opacity: segment.opacity,
              visible: segment.visible,
            })),
          };
        })
        .filter((layer): layer is NonNullable<typeof layer> => layer != null);
      const layers = studyState.masks
        .map((mask) => {
          const buffer = maskBuffers[mask.id];
          if (!buffer) return null;
          return {
            mask: buffer,
            color: mask.color,
            opacity: mask.opacity,
            visible: mask.visible,
          };
        })
        .filter((layer): layer is NonNullable<typeof layer> => layer != null);

      const coronal = labelmapLayers.length
        ? extractLabelmapOverlayImage(
          labelmapLayers,
          VolumeAxis.Coronal,
          app.cursor,
          app.volume.meta.dimensions,
          app.volume.meta.spacing,
        )
        : extractMaskOverlayImage(
          layers,
          VolumeAxis.Coronal,
          app.cursor,
          app.volume.meta.dimensions,
          app.volume.meta.spacing,
        );
      const sagittal = labelmapLayers.length
        ? extractLabelmapOverlayImage(
          labelmapLayers,
          VolumeAxis.Sagittal,
          app.cursor,
          app.volume.meta.dimensions,
          app.volume.meta.spacing,
        )
        : extractMaskOverlayImage(
          layers,
          VolumeAxis.Sagittal,
          app.cursor,
          app.volume.meta.dimensions,
          app.volume.meta.spacing,
        );
      const axial = labelmapLayers.length
        ? extractLabelmapOverlayImage(
          labelmapLayers,
          VolumeAxis.Axial,
          app.cursor,
          app.volume.meta.dimensions,
          app.volume.meta.spacing,
        )
        : extractMaskOverlayImage(
          layers,
          VolumeAxis.Axial,
          app.cursor,
          app.volume.meta.dimensions,
          app.volume.meta.spacing,
        );

      return {
        [VolumeAxis.Coronal]: withWatershedSeedMarkers(
          coronal,
          VolumeAxis.Coronal,
          app.cursor,
          app.volume.meta.dimensions,
          app.volume.meta.spacing,
          studyState.maskWorkflow.watershedSeeds,
        ),
        [VolumeAxis.Sagittal]: withWatershedSeedMarkers(
          sagittal,
          VolumeAxis.Sagittal,
          app.cursor,
          app.volume.meta.dimensions,
          app.volume.meta.spacing,
          studyState.maskWorkflow.watershedSeeds,
        ),
        [VolumeAxis.Axial]: withWatershedSeedMarkers(
          axial,
          VolumeAxis.Axial,
          app.cursor,
          app.volume.meta.dimensions,
          app.volume.meta.spacing,
          studyState.maskWorkflow.watershedSeeds,
        ),
      };
    },
    [
      app.cursor,
      app.volume,
      maskBuffers,
      labelmapBuffers,
      studyState.maskWorkflow.watershedSeeds,
      studyState.masks,
      studyState.segmentGroups,
    ],
  );

  const cropRects = useMemo(() => {
    const crop = studyState.cropBounds;
    if (!crop || !app.volume) return {};
    const [width, height, depth] = app.volume.meta.dimensions;
    return {
      [VolumeAxis.Axial]: {
        enabled: crop.enabled,
        min: {
          xRatio: crop.min[0] / Math.max(1, width - 1),
          yRatio: crop.min[1] / Math.max(1, height - 1),
        },
        max: {
          xRatio: crop.max[0] / Math.max(1, width - 1),
          yRatio: crop.max[1] / Math.max(1, height - 1),
        },
      },
      [VolumeAxis.Coronal]: {
        enabled: crop.enabled,
        min: {
          xRatio: crop.min[0] / Math.max(1, width - 1),
          yRatio: 1 - crop.max[2] / Math.max(1, depth - 1),
        },
        max: {
          xRatio: crop.max[0] / Math.max(1, width - 1),
          yRatio: 1 - crop.min[2] / Math.max(1, depth - 1),
        },
      },
      [VolumeAxis.Sagittal]: {
        enabled: crop.enabled,
        min: {
          xRatio: crop.min[1] / Math.max(1, height - 1),
          yRatio: 1 - crop.max[2] / Math.max(1, depth - 1),
        },
        max: {
          xRatio: crop.max[1] / Math.max(1, height - 1),
          yRatio: 1 - crop.min[2] / Math.max(1, depth - 1),
        },
      },
    };
  }, [app.volume, studyState.cropBounds]);

  const annotationOverlays = useMemo(() => {
    if (!app.cursor || !app.volume) return {};
    const [width, height, depth] = app.volume.meta.dimensions;
    const visible = studyState.annotations.filter((annotation) => annotation.visible);
    return {
      [VolumeAxis.Axial]: visible
        .filter((annotation) => annotation.point[2] === app.cursor?.z)
        .map((annotation) => ({
          id: annotation.id,
          point: {
            xRatio: annotation.point[0] / Math.max(1, width - 1),
            yRatio: annotation.point[1] / Math.max(1, height - 1),
          },
          label: annotation.name,
          color: annotation.color,
          selected: annotation.id === studyState.activeAnnotationId,
        })),
      [VolumeAxis.Coronal]: visible
        .filter((annotation) => annotation.point[1] === app.cursor?.y)
        .map((annotation) => ({
          id: annotation.id,
          point: {
            xRatio: annotation.point[0] / Math.max(1, width - 1),
            yRatio: 1 - annotation.point[2] / Math.max(1, depth - 1),
          },
          label: annotation.name,
          color: annotation.color,
          selected: annotation.id === studyState.activeAnnotationId,
        })),
      [VolumeAxis.Sagittal]: visible
        .filter((annotation) => annotation.point[0] === app.cursor?.x)
        .map((annotation) => ({
          id: annotation.id,
          point: {
            xRatio: annotation.point[1] / Math.max(1, height - 1),
            yRatio: 1 - annotation.point[2] / Math.max(1, depth - 1),
          },
          label: annotation.name,
          color: annotation.color,
          selected: annotation.id === studyState.activeAnnotationId,
        })),
    };
  }, [app.cursor, app.volume, studyState.activeAnnotationId, studyState.annotations]);

  const brushPreviews = useMemo(() => {
    if (!app.volume || !maskSliceEditEnabled) return {};
    const [width, height, depth] = app.volume.meta.dimensions;
    const [sx, sy, sz] = app.volume.meta.spacing;
    const radiusMm = Math.max(0.25, studyState.maskWorkflow.brushSizeMm / 2);
    const activeGroup = studyState.segmentGroups.find(
      (group) => group.id === studyState.activeSegmentGroupId,
    );
    const activeSegment = activeGroup?.segments.find(
      (segment) => segment.value === activeGroup.activeSegmentValue,
    );
    const activeMask = studyState.masks.find(
      (mask) => mask.id === studyState.activeMaskId,
    );
    const color = activeSegment?.color ?? activeMask?.color ?? '#38bdf8';
    return {
      [VolumeAxis.Axial]: {
        visible: true,
        color,
        radiusXRatio: radiusMm / Math.max(0.001, sx) / Math.max(1, width - 1),
        radiusYRatio: radiusMm / Math.max(0.001, sy) / Math.max(1, height - 1),
      },
      [VolumeAxis.Coronal]: {
        visible: true,
        color,
        radiusXRatio: radiusMm / Math.max(0.001, sx) / Math.max(1, width - 1),
        radiusYRatio: radiusMm / Math.max(0.001, sz) / Math.max(1, depth - 1),
      },
      [VolumeAxis.Sagittal]: {
        visible: true,
        color,
        radiusXRatio: radiusMm / Math.max(0.001, sy) / Math.max(1, height - 1),
        radiusYRatio: radiusMm / Math.max(0.001, sz) / Math.max(1, depth - 1),
      },
    };
  }, [
    app.volume,
    maskSliceEditEnabled,
    studyState.activeMaskId,
    studyState.activeSegmentGroupId,
    studyState.maskWorkflow.brushSizeMm,
    studyState.masks,
    studyState.segmentGroups,
  ]);

  // Push cursor changes to the 3D viewport imperatively so scrubbing never
  // re-renders (and re-serializes) the heavy prepared-volume prop.
  useEffect(() => {
    viewport3DRef.current?.focusCursor(app.cursor);
  }, [app.cursor]);

  useEffect(() => {
    const controller = new AbortController();
    if (!app.volume || !scanStudy) {
      queueMicrotask(() => {
        if (!controller.signal.aborted) setStudyState(createEmptyStudyState());
      });
      return () => controller.abort();
    }

    queueMicrotask(() => {
      if (controller.signal.aborted || !app.volume) return;
      const image = createStudyImageLayer(scanStudy.id, {
        name: app.volume.meta.scanId,
        source: scanStudy.source,
        dimensions: app.volume.meta.dimensions,
        spacing: app.volume.meta.spacing,
      });

      setStudyState({
        ...createEmptyStudyState(scanStudy),
        images: [image],
        activeImageId: image.id,
        dicomImportEngine: dicomImportEngineRef.current,
        cropBounds: createFullCropBounds(app.volume.meta.dimensions),
      });
      setMaskBuffers({});
      setLabelmapBuffers({});
      setSurfaceBlobs({});
      setSurfacePreviews([]);
      setSurfaceUrls((current) => {
        Object.values(current).forEach((url) => URL.revokeObjectURL(url));
        return {};
      });
      setUndoStack([]);
      setRedoStack([]);
    });
    return () => controller.abort();
  }, [app.volume?.meta.scanId, app.volume, scanStudy]);

  useEffect(() => {
    surfaceUrlsRef.current = surfaceUrls;
  }, [surfaceUrls]);

  useEffect(() => {
    let canceled = false;
    const surfaces = studyState.surfaces;
    void Promise.all(
      surfaces.map(async (surface) => {
        const blob = surfaceBlobs[surface.id];
        if (!blob) return null;
        return {
          id: surface.id,
          stl: await blob.arrayBuffer(),
          color: surface.color,
          opacity: surface.opacity,
          visible: surface.visible,
        } satisfies SurfaceMeshPreview;
      }),
    ).then((items) => {
      if (!canceled) setSurfacePreviews(items.filter((item) => item !== null));
    });
    return () => {
      canceled = true;
    };
  }, [studyState.surfaces, surfaceBlobs]);

  useEffect(
    () => () => {
      Object.values(surfaceUrlsRef.current).forEach((url) =>
        URL.revokeObjectURL(url),
      );
    },
    [],
  );

  const snapshotMasks = (): MaskSnapshot => ({
    masks: studyState.masks.map((mask) => ({ ...mask })),
    segmentGroups: studyState.segmentGroups.map((group) => ({
      ...group,
      segments: group.segments.map((segment) => ({ ...segment })),
    })),
    activeMaskId: studyState.activeMaskId,
    buffers: cloneMaskBuffers(maskBuffers),
    labelmaps: cloneMaskBuffers(labelmapBuffers),
  });

  const commitMaskEdit = (
    nextMasks: StudyState['masks'],
    nextBuffers: MaskBufferMap,
    activeMaskId: string | undefined,
    activeTool: StudyState['activeTool'],
  ) => {
    const nextUndo = [...undoStack, snapshotMasks()].slice(-24);
    setUndoStack(nextUndo);
    setRedoStack([]);
    setMaskBuffers(nextBuffers);
    setStudyState((current) => ({
      ...current,
      masks: nextMasks,
      activeMaskId,
      activeTool,
      maskWorkflow: {
        ...current.maskWorkflow,
        canUndo: nextUndo.length > 0,
        canRedo: false,
      },
    }));
  };

  const appendMaskSegmentGroup = (
    mask: StudyState['masks'][number],
    name = `${mask.name} labels`,
  ): StudyState['segmentGroups'][number] | null => {
    if (!studyState.study || !studyState.activeImageId) return null;
    return createStudySegmentGroup(studyState.study.id, studyState.activeImageId, {
      name,
      segments: [
        createStudySegment({
          value: 1,
          name: mask.name,
          color: mask.color,
          opacity: mask.opacity,
          visible: mask.visible,
          maskId: mask.id,
          voxelCount: mask.voxelCount,
        }),
      ],
    });
  };

  const updateStudyViewState = (
    patch: Partial<
      Pick<
        StudyState,
        | 'dicomImportEngine'
        | 'cropBounds'
        | 'layoutPreset'
        | 'activeSegmentGroupId'
        | 'activeAnnotationId'
      >
    >,
  ) => {
    setStudyState((current) => ({ ...current, ...patch }));
    if (patch.dicomImportEngine) {
      app.setDicomImportEngine(patch.dicomImportEngine);
    }
    if (patch.layoutPreset) {
      app.setAxisViewsVisible(patch.layoutPreset !== 'single');
    }
  };

  const updateCropFromAxis = (
    axis: VolumeAxis,
    rect: {
      min: { xRatio: number; yRatio: number };
      max: { xRatio: number; yRatio: number };
      enabled: boolean;
    },
  ) => {
    if (!app.volume) return;
    const volume = app.volume;
    const [width, height, depth] = volume.meta.dimensions;
    setStudyState((current) => {
      const crop =
        current.cropBounds ?? createFullCropBounds(volume.meta.dimensions, true);
      const next = {
        ...crop,
        enabled: rect.enabled,
        min: [...crop.min] as [number, number, number],
        max: [...crop.max] as [number, number, number],
      };
      if (axis === VolumeAxis.Axial) {
        next.min[0] = clampIndex(Math.round(rect.min.xRatio * (width - 1)), width - 1);
        next.max[0] = clampIndex(Math.round(rect.max.xRatio * (width - 1)), width - 1);
        next.min[1] = clampIndex(Math.round(rect.min.yRatio * (height - 1)), height - 1);
        next.max[1] = clampIndex(Math.round(rect.max.yRatio * (height - 1)), height - 1);
      } else if (axis === VolumeAxis.Coronal) {
        next.min[0] = clampIndex(Math.round(rect.min.xRatio * (width - 1)), width - 1);
        next.max[0] = clampIndex(Math.round(rect.max.xRatio * (width - 1)), width - 1);
        next.max[2] = clampIndex(Math.round((1 - rect.min.yRatio) * (depth - 1)), depth - 1);
        next.min[2] = clampIndex(Math.round((1 - rect.max.yRatio) * (depth - 1)), depth - 1);
      } else {
        next.min[1] = clampIndex(Math.round(rect.min.xRatio * (height - 1)), height - 1);
        next.max[1] = clampIndex(Math.round(rect.max.xRatio * (height - 1)), height - 1);
        next.max[2] = clampIndex(Math.round((1 - rect.min.yRatio) * (depth - 1)), depth - 1);
        next.min[2] = clampIndex(Math.round((1 - rect.max.yRatio) * (depth - 1)), depth - 1);
      }
      return { ...current, cropBounds: next };
    });
  };

  const updateProbeFromAxis = (
    axis: VolumeAxis,
    point: { xRatio: number; yRatio: number } | null,
  ) => {
    if (!point || !app.volume || !app.cursor) {
      setSliceProbe(null);
      return;
    }
    const voxel = axisPointToVoxel(axis, point, app.cursor, app.volume.meta.dimensions);
    const [x, y, z] = voxel;
    const [width, height] = app.volume.meta.dimensions;
    const index = (z * height + y) * width + x;
    const label = studyState.segmentGroups
      .flatMap((group) => {
        const bytes = labelmapBuffers[group.id];
        if (!bytes) return [];
        const labelmap = new Uint16Array(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength / 2,
        );
        const value = labelmap[index];
        return group.segments
          .filter((segment) => segment.value === value)
          .map((segment) => segment.name);
      })[0];
    setSliceProbe({ axis, voxel, value: app.volume.voxels[index], label });
  };

  const selectAnnotation = (annotationId: string) => {
    setStudyState((current) => ({
      ...current,
      activeAnnotationId: annotationId,
      annotations: current.annotations.map((annotation) => ({
        ...annotation,
        selected: annotation.id === annotationId,
      })),
    }));
  };

  const moveAnnotation = (
    axis: VolumeAxis,
    annotationId: string,
    point: { xRatio: number; yRatio: number },
  ) => {
    if (!app.volume || !app.cursor) return;
    const voxel = axisPointToVoxel(axis, point, app.cursor, app.volume.meta.dimensions);
    setStudyState((current) => ({
      ...current,
      annotations: current.annotations.map((annotation) =>
        annotation.id === annotationId
          ? { ...annotation, point: voxel, updatedAt: Date.now() }
          : annotation,
      ),
    }));
  };


  const createThresholdMask = (preset: {
    label: string;
    range: [number, number];
    color: string;
  }) => {
    if (!app.volume || !studyState.study || !studyState.activeImageId) return;
    const mask = thresholdVolume(app.volume.voxels, preset.range);
    const voxelCount = countMaskVoxels(mask);
    const nextMask = createStudyMask(
      studyState.study.id,
      studyState.activeImageId,
      {
        name: preset.label,
        color: preset.color,
        thresholdRange: preset.range,
        voxelCount,
      },
    );
    const nextGroup = appendMaskSegmentGroup(nextMask);
    commitMaskEdit(
      [...studyState.masks, nextMask],
      { ...maskBuffers, [nextMask.id]: mask },
      nextMask.id,
      'mask-threshold',
    );
    setStudyState((current) => ({
      ...current,
      segmentGroups: nextGroup
        ? [...current.segmentGroups, nextGroup]
        : current.segmentGroups,
      activeSegmentGroupId: nextGroup?.id ?? current.activeSegmentGroupId,
      maskWorkflow: {
        ...current.maskWorkflow,
        operation: 'threshold',
        thresholdRange: preset.range,
      },
    }));
    if (nextGroup) {
      setLabelmapBuffers((current) => ({
        ...current,
        [nextGroup.id]: uint16ArrayToBytes(maskToLabelmap(mask, 1)),
      }));
    }
  };

  const regionGrowFromCursor = (preset: {
    label: string;
    range: [number, number];
    color: string;
  }) => {
    if (!app.volume || !app.cursor || !studyState.study || !studyState.activeImageId) return;
    const dims = volumeMaskDims(app.volume.meta.dimensions);
    const mask = regionGrowMask(
      app.volume.voxels,
      dims,
      [app.cursor.x, app.cursor.y, app.cursor.z],
      preset.range,
      6,
    );
    const voxelCount = countMaskVoxels(mask);
    const nextMask = createStudyMask(
      studyState.study.id,
      studyState.activeImageId,
      {
        name: `${preset.label} region`,
        color: preset.color,
        thresholdRange: preset.range,
        voxelCount,
      },
    );
    const nextGroup = appendMaskSegmentGroup(nextMask, `${nextMask.name} labels`);
    commitMaskEdit(
      [...studyState.masks, nextMask],
      { ...maskBuffers, [nextMask.id]: mask },
      nextMask.id,
      'mask-region-grow',
    );
    if (nextGroup) {
      setLabelmapBuffers((current) => ({
        ...current,
        [nextGroup.id]: uint16ArrayToBytes(maskToLabelmap(mask, 1)),
      }));
      setStudyState((current) => ({
        ...current,
        segmentGroups: [...current.segmentGroups, nextGroup],
        activeSegmentGroupId: nextGroup.id,
      }));
    }
  };

  const updateActiveMaskBuffer = (
    transform: (buffer: Uint8Array) => Uint8Array,
    activeTool: StudyState['activeTool'],
  ) => {
    const activeMaskId = studyState.activeMaskId;
    if (!app.volume || !activeMaskId || !maskBuffers[activeMaskId]) return;
    const nextBuffer = transform(maskBuffers[activeMaskId]);
    const voxelCount = countMaskVoxels(nextBuffer);
    const nextMasks = studyState.masks.map((mask) =>
      mask.id === activeMaskId
        ? { ...mask, voxelCount, edited: true, updatedAt: Date.now() }
        : mask,
    );
    commitMaskEdit(
      nextMasks,
      { ...maskBuffers, [activeMaskId]: nextBuffer },
      activeMaskId,
      activeTool,
    );
  };

  const keepLargestActiveMaskComponent = async () => {
    if (!app.volume || maskStatus) return;
    const activeMaskId = studyState.activeMaskId;
    if (!activeMaskId || !maskBuffers[activeMaskId]) return;
    const activeSegment = studyState.segmentGroups
      .flatMap((group) => group.segments)
      .find((segment) => segment.maskId === activeMaskId);
    if (activeSegment?.locked) return;
    const dims = volumeMaskDims(app.volume.meta.dimensions);
    const controller = new AbortController();
    maskAbortRef.current = controller;
    setMaskStatus('Keeping largest component');
    try {
      const result = await keepLargestMaskComponentInWorker({
        mask: maskBuffers[activeMaskId],
        dims,
        connectivity: 26,
        signal: controller.signal,
      });
      updateActiveMaskBuffer(() => result.mask, 'mask-region-grow');
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        window.alert(error instanceof Error ? error.message : 'Mask operation failed.');
      }
    } finally {
      if (maskAbortRef.current === controller) maskAbortRef.current = null;
      setMaskStatus(undefined);
    }
  };

  const fillActiveMaskHoles = () => {
    if (!app.volume) return;
    const dims = volumeMaskDims(app.volume.meta.dimensions);
    updateActiveMaskBuffer((buffer) => fillMaskHoles(buffer, dims), 'mask-brush');
  };

  const splitActiveMaskComponents = async () => {
    const activeMaskId = studyState.activeMaskId;
    if (
      !app.volume ||
      !studyState.study ||
      !studyState.activeImageId ||
      !activeMaskId ||
      maskStatus
    ) {
      return;
    }
    const sourceMask = studyState.masks.find((mask) => mask.id === activeMaskId);
    const sourceBuffer = maskBuffers[activeMaskId];
    if (!sourceMask || !sourceBuffer) return;

    const dims = volumeMaskDims(app.volume.meta.dimensions);
    const controller = new AbortController();
    maskAbortRef.current = controller;
    setMaskStatus('Splitting components');
    let components: Awaited<ReturnType<typeof splitMaskComponentsInWorker>>;
    try {
      components = await splitMaskComponentsInWorker({
        mask: sourceBuffer,
        dims,
        connectivity: 26,
        limit: 24,
        signal: controller.signal,
      });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        window.alert(error instanceof Error ? error.message : 'Mask operation failed.');
      }
      return;
    } finally {
      if (maskAbortRef.current === controller) maskAbortRef.current = null;
      setMaskStatus(undefined);
    }
    if (components.length <= 1) return;

    const nextMasks = studyState.masks.filter((mask) => mask.id !== activeMaskId);
    const nextBuffers = { ...maskBuffers };
    const nextGroups: StudyState['segmentGroups'] = [];
    delete nextBuffers[activeMaskId];
    for (const [index, component] of components.entries()) {
      const nextMask = createStudyMask(
        studyState.study.id,
        studyState.activeImageId,
        {
          name: `${sourceMask.name} ${index + 1}`,
          color: sourceMask.color,
          opacity: sourceMask.opacity,
          thresholdRange: sourceMask.thresholdRange,
          voxelCount: component.voxels,
        },
      );
      nextMasks.push({ ...nextMask, edited: true });
      nextBuffers[nextMask.id] = component.mask;
      const group = appendMaskSegmentGroup(nextMask, `${nextMask.name} labels`);
      if (group) nextGroups.push(group);
    }
    commitMaskEdit(nextMasks, nextBuffers, nextMasks.at(-1)?.id, 'mask-region-grow');
    if (nextGroups.length > 0) {
      setLabelmapBuffers((current) => {
        const next = { ...current };
        for (const [index, group] of nextGroups.entries()) {
          next[group.id] = uint16ArrayToBytes(
            maskToLabelmap(components[index].mask, 1),
          );
        }
        return next;
      });
      setStudyState((current) => ({
        ...current,
        segmentGroups: [
          ...current.segmentGroups.filter(
            (group) =>
              !group.segments.some((segment) => segment.maskId === activeMaskId),
          ),
          ...nextGroups,
        ],
        activeSegmentGroupId: nextGroups.at(-1)?.id,
      }));
    }
  };

  const cancelMaskOperation = () => {
    maskAbortRef.current?.abort();
  };

  const selectMask = (maskId: string) => {
    setStudyState((current) => ({
      ...current,
      activeMaskId: maskId,
      activeSegmentGroupId:
        current.segmentGroups.find((group) =>
          group.segments.some((segment) => segment.maskId === maskId),
        )?.id ?? current.activeSegmentGroupId,
      segmentGroups: current.segmentGroups.map((group) => {
        const segment = group.segments.find((item) => item.maskId === maskId);
        return segment
          ? { ...group, activeSegmentValue: segment.value, updatedAt: Date.now() }
          : group;
      }),
    }));
  };

  const selectSegment = (groupId: string, segmentId: string) => {
    setStudyState((current) => {
      const group = current.segmentGroups.find((item) => item.id === groupId);
      const segment = group?.segments.find((item) => item.id === segmentId);
      if (!group || !segment) return current;
      return {
        ...current,
        activeMaskId: segment.maskId ?? current.activeMaskId,
        activeSegmentGroupId: groupId,
        segmentGroups: current.segmentGroups.map((item) =>
          item.id === groupId
            ? { ...item, activeSegmentValue: segment.value, updatedAt: Date.now() }
            : item,
        ),
      };
    });
  };

  const addSegment = (groupId: string) => {
    if (!studyState.study || !studyState.activeImageId || !app.volume) return;
    const group = studyState.segmentGroups.find((item) => item.id === groupId);
    if (!group) return;
    const voxelCount = app.volume.voxels.length;
    const nextValue =
      Math.max(0, ...group.segments.map((segment) => segment.value)) + 1;
    const colors = ['#38bdf8', '#fb7185', '#34d399', '#fbbf24', '#a78bfa', '#f97316'];
    const color = colors[(nextValue - 1) % colors.length];
    const mask = createStudyMask(studyState.study.id, studyState.activeImageId, {
      name: `Segment ${nextValue}`,
      color,
      voxelCount: 0,
    });
    const segment = createStudySegment({
      value: nextValue,
      name: mask.name,
      color,
      maskId: mask.id,
      voxelCount: 0,
    });
    const nextUndo = [...undoStack, snapshotMasks()].slice(-24);
    setUndoStack(nextUndo);
    setRedoStack([]);
    setMaskBuffers((current) => ({
      ...current,
      [mask.id]: new Uint8Array(voxelCount),
    }));
    setLabelmapBuffers((current) => ({
      ...current,
      [groupId]: current[groupId] ?? uint16ArrayToBytes(new Uint16Array(voxelCount)),
    }));
    setStudyState((current) => ({
      ...current,
      masks: [...current.masks, mask],
      activeMaskId: mask.id,
      activeSegmentGroupId: groupId,
      segmentGroups: current.segmentGroups.map((item) =>
        item.id === groupId
          ? {
              ...item,
              activeSegmentValue: segment.value,
              updatedAt: Date.now(),
              segments: [...item.segments, segment],
            }
          : item,
      ),
      maskWorkflow: {
        ...current.maskWorkflow,
        canUndo: nextUndo.length > 0,
        canRedo: false,
      },
    }));
  };

  const deleteSegment = (groupId: string, segmentId: string) => {
    const group = studyState.segmentGroups.find((item) => item.id === groupId);
    const segment = group?.segments.find((item) => item.id === segmentId);
    if (!group || !segment) return;
    const nextUndo = [...undoStack, snapshotMasks()].slice(-24);
    setUndoStack(nextUndo);
    setRedoStack([]);
    setLabelmapBuffers((current) => {
      const bytes = current[groupId];
      if (!bytes) return current;
      const labelmap = bytesToUint16Array(bytes);
      for (let index = 0; index < labelmap.length; index += 1) {
        if (labelmap[index] === segment.value) labelmap[index] = 0;
      }
      return { ...current, [groupId]: uint16ArrayToBytes(labelmap) };
    });
    setMaskBuffers((current) => {
      if (!segment.maskId) return current;
      const next = { ...current };
      delete next[segment.maskId];
      return next;
    });
    setStudyState((current) => {
      const nextGroups = current.segmentGroups.map((item) => {
        if (item.id !== groupId) return item;
        const segments = item.segments.filter((entry) => entry.id !== segmentId);
        return {
          ...item,
          segments,
          activeSegmentValue:
            item.activeSegmentValue === segment.value
              ? segments[0]?.value
              : item.activeSegmentValue,
          updatedAt: Date.now(),
        };
      });
      const nextActiveSegment = nextGroups
        .find((item) => item.id === groupId)
        ?.segments.find(
          (item) =>
            item.value ===
            nextGroups.find((nextGroup) => nextGroup.id === groupId)
              ?.activeSegmentValue,
        );
      return {
        ...current,
        masks: segment.maskId
          ? current.masks.filter((mask) => mask.id !== segment.maskId)
          : current.masks,
        activeMaskId:
          current.activeMaskId === segment.maskId
            ? nextActiveSegment?.maskId
            : current.activeMaskId,
        segmentGroups: nextGroups,
        maskWorkflow: {
          ...current.maskWorkflow,
          canUndo: nextUndo.length > 0,
          canRedo: false,
        },
      };
    });
  };

  const updateMaskAppearance = (
    maskId: string,
    patch: Partial<Pick<StudyState['masks'][number], 'color' | 'opacity'>>,
  ) => {
    setStudyState((current) => ({
      ...current,
      masks: current.masks.map((mask) =>
        mask.id === maskId
          ? {
              ...mask,
              ...patch,
              opacity:
                patch.opacity === undefined
                  ? mask.opacity
                  : Math.min(1, Math.max(0.05, patch.opacity)),
              updatedAt: Date.now(),
            }
          : mask,
      ),
    }));
  };

  const updateMaskWorkflow = (
    patch: Partial<StudyState['maskWorkflow']> & {
      activeTool?: StudyState['activeTool'];
    },
  ) => {
    const { activeTool, ...workflowPatch } = patch;
    setStudyState((current) => ({
      ...current,
      activeTool: activeTool ?? current.activeTool,
      maskWorkflow: {
        ...current.maskWorkflow,
        ...workflowPatch,
      },
    }));
  };

  const updateSegment = (
    groupId: string,
    segmentId: string,
    patch: Partial<
      Pick<
        StudyState['segmentGroups'][number]['segments'][number],
        'color' | 'opacity' | 'visible' | 'locked'
      >
    >,
  ) => {
    setStudyState((current) => ({
      ...current,
      segmentGroups: current.segmentGroups.map((group) =>
        group.id === groupId
          ? {
              ...group,
              updatedAt: Date.now(),
              segments: group.segments.map((segment) =>
                segment.id === segmentId
                  ? { ...segment, ...patch, updatedAt: Date.now() }
                  : segment,
              ),
            }
          : group,
      ),
    }));
  };

  const finishMaskEditSession = () => {
    const session = maskEditSessionRef.current;
    if (!session) return;
    maskEditSessionRef.current = null;
    if (session.touched.size === 0) return;

    const voxelCount = countMaskVoxels(session.buffer);
    const nextMasks = studyState.masks.map((mask) =>
      mask.id === session.maskId
        ? { ...mask, voxelCount, edited: true, updatedAt: Date.now() }
        : mask,
    );
    const nextUndo = [...undoStack, session.snapshot].slice(-24);
    setUndoStack(nextUndo);
    setRedoStack([]);
    if (session.labelmapGroupId && session.labelmap && session.segmentValue) {
      const mask = labelmapToMask(session.labelmap, session.segmentValue);
      setMaskBuffers((current) => ({
        ...current,
        [session.maskId]: mask,
      }));
      setLabelmapBuffers((current) => ({
        ...current,
        [session.labelmapGroupId as string]: uint16ArrayToBytes(session.labelmap as Uint16Array),
      }));
    } else {
      setMaskBuffers((current) => ({
        ...current,
        [session.maskId]: session.buffer,
      }));
    }
    setStudyState((current) => ({
      ...current,
      masks: nextMasks,
      segmentGroups: current.segmentGroups.map((group) => ({
        ...group,
        segments: group.segments.map((segment) =>
          segment.maskId === session.maskId
            ? { ...segment, voxelCount, updatedAt: Date.now() }
            : segment,
        ),
      })),
      activeMaskId: session.maskId,
      maskWorkflow: {
        ...current.maskWorkflow,
        canUndo: nextUndo.length > 0,
        canRedo: false,
      },
    }));
  };

  const addWatershedSeed = (point: [number, number, number]) => {
    setStudyState((current) => ({
      ...current,
      activeTool: 'mask-watershed-seed',
      maskWorkflow: {
        ...current.maskWorkflow,
        watershedSeeds: [
          ...current.maskWorkflow.watershedSeeds,
          {
            id: createAppId('seed'),
            kind: current.maskWorkflow.watershedSeedKind,
            point,
          },
        ],
      },
    }));
  };

  const addWatershedSeedAtCursor = () => {
    if (!app.cursor) return;
    addWatershedSeed([app.cursor.x, app.cursor.y, app.cursor.z]);
  };

  const clearWatershedSeeds = () => {
    setStudyState((current) => ({
      ...current,
      maskWorkflow: {
        ...current.maskWorkflow,
        watershedSeeds: [],
      },
    }));
  };

  const applyWatershedSeeds = () => {
    const volume = app.volume;
    if (!volume) return;
    const seeds = studyState.maskWorkflow.watershedSeeds;
    if (seeds.length === 0) return;
    const dims = volumeMaskDims(volume.meta.dimensions);
    updateActiveMaskBuffer((buffer) => {
      const next = new Uint8Array(buffer);
      for (const seed of seeds) {
        const grown = regionGrowMask(
          volume.voxels,
          dims,
          seed.point,
          studyState.maskWorkflow.thresholdRange,
          6,
        );
        for (let index = 0; index < next.length; index += 1) {
          if (!grown[index]) continue;
          next[index] = seed.kind === 'background' || seed.kind === 'erase' ? 0 : 1;
        }
      }
      return next;
    }, 'mask-watershed-seed');
    clearWatershedSeeds();
  };

  const editMaskOnSlice = (
    axis: VolumeAxis,
    point: { xRatio: number; yRatio: number },
    phase: 'start' | 'move' | 'end',
  ) => {
    if (!app.volume || !app.cursor) return;
    if (studyState.activeTool === 'mask-watershed-seed') {
      if (phase === 'start') {
        addWatershedSeed(
          axisPointToVoxel(axis, point, app.cursor, app.volume.meta.dimensions),
        );
      }
      return;
    }
    if (
      studyState.activeTool !== 'mask-brush' &&
      studyState.activeTool !== 'mask-erase' &&
      studyState.activeTool !== 'mask-threshold'
    ) {
      return;
    }

    const activeMaskId = studyState.activeMaskId;
    if (!activeMaskId || !maskBuffers[activeMaskId]) return;
    const activeGroup =
      studyState.segmentGroups.find(
        (group) => group.id === studyState.activeSegmentGroupId,
      ) ??
      studyState.segmentGroups.find((group) =>
        group.segments.some((segment) => segment.maskId === activeMaskId),
      );
    const activeSegment =
      activeGroup?.segments.find((segment) => segment.maskId === activeMaskId) ??
      activeGroup?.segments.find(
        (segment) => segment.value === activeGroup.activeSegmentValue,
      ) ??
      activeGroup?.segments[0];
    if (activeSegment?.locked) return;
    const segmentValue = activeSegment?.value ?? 1;
    const groupId = activeGroup?.id;
    if (phase === 'start' || !maskEditSessionRef.current) {
      const labelmap =
        groupId && labelmapBuffers[groupId]
          ? bytesToUint16Array(labelmapBuffers[groupId])
          : maskToLabelmap(maskBuffers[activeMaskId], segmentValue);
      maskEditSessionRef.current = {
        snapshot: snapshotMasks(),
        maskId: activeMaskId,
        buffer: new Uint8Array(maskBuffers[activeMaskId]),
        labelmapGroupId: groupId,
        labelmap,
        segmentValue,
        touched: new Set<number>(),
      };
    }
    const session = maskEditSessionRef.current;
    if (!session || session.maskId !== activeMaskId) return;
    if (!session.labelmap || session.segmentValue !== segmentValue) return;
    const voxel = axisPointToVoxel(
      axis,
      point,
      app.cursor,
      app.volume.meta.dimensions,
    );
    paintLabelmapStroke(
      session.labelmap,
      session.lastVoxel,
      voxel,
      session.touched,
      {
        axis,
        cursor: app.cursor,
        dimensions: app.volume.meta.dimensions,
        spacing: app.volume.meta.spacing,
        voxels: app.volume.voxels,
        brushSizeMm: studyState.maskWorkflow.brushSizeMm,
        brushShape: studyState.maskWorkflow.brushShape,
        operation:
          studyState.activeTool === 'mask-erase'
            ? 'erase'
            : studyState.activeTool === 'mask-threshold'
              ? 'threshold'
              : 'draw',
        thresholdRange: studyState.maskWorkflow.thresholdRange,
        segmentValue,
        lockedValues: new Set(
          activeGroup?.segments
            .filter((segment) => segment.locked)
            .map((segment) => segment.value) ?? [],
        ),
      },
    );
    session.buffer = labelmapToMask(session.labelmap, segmentValue);
    session.lastVoxel = voxel;
    setMaskBuffers((current) => ({
      ...current,
      [session.maskId]: new Uint8Array(session.buffer),
    }));
    if (session.labelmapGroupId) {
      setLabelmapBuffers((current) => ({
        ...current,
        [session.labelmapGroupId as string]: uint16ArrayToBytes(
          session.labelmap as Uint16Array,
        ),
      }));
    }
    if (phase === 'end') finishMaskEditSession();
  };

  const addSliceMeasurement = (
    axis: VolumeAxis,
    measurement: CompletedSliceMeasurement,
  ) => {
    const volume = app.volume;
    const cursor = app.cursor;
    if (!volume || !cursor || !studyState.study) return;
    const points = measurement.points.map((point) =>
      axisPointToVoxel(axis, point, cursor, volume.meta.dimensions),
    );
    const nextMeasurement = createStudyMeasurement(studyState.study.id, {
      kind: measurement.kind,
      name:
        measurement.kind === 'distance'
          ? `Distance ${studyState.measurements.length + 1}`
          : measurement.kind === 'angle'
            ? `Angle ${studyState.measurements.length + 1}`
            : measurement.kind === 'ellipse'
              ? `Ellipse ROI ${studyState.measurements.length + 1}`
              : `Polygon ROI ${studyState.measurements.length + 1}`,
      points,
      value: measurement.value,
      unit: measurement.unit,
    });
    const densityMeasurement = (() => {
      if (!measurement.densityRoi) return null;
      const values: number[] = [];
      const [width, height, depth] = volume.meta.dimensions;
      const sliceStride = width * height;
      const planeWidth =
        axis === VolumeAxis.Sagittal ? height : width;
      const planeHeight =
        axis === VolumeAxis.Axial ? height : depth;
      for (let v = 0; v < planeHeight; v += 1) {
        for (let u = 0; u < planeWidth; u += 1) {
          const ratioPoint = {
            xRatio: planeWidth > 1 ? u / (planeWidth - 1) : 0,
            yRatio: planeHeight > 1 ? v / (planeHeight - 1) : 0,
          };
          if (!pointInMeasurementRoi(ratioPoint, measurement.densityRoi)) {
            continue;
          }
          const x =
            axis === VolumeAxis.Sagittal ? cursor.x : u;
          const y =
            axis === VolumeAxis.Coronal
              ? cursor.y
              : axis === VolumeAxis.Sagittal
                ? u
                : v;
          const z =
            axis === VolumeAxis.Axial ? cursor.z : depth - 1 - v;
          values.push(volume.voxels[z * sliceStride + y * width + x]);
        }
      }
      const stats = densityStats(values);
      if (stats.count === 0) return null;
      return createStudyMeasurement(studyState.study.id, {
        kind: 'density',
        name: `${nextMeasurement.name} density (${stats.min.toFixed(0)} to ${stats.max.toFixed(0)} HU)`,
        points,
        value: stats.mean,
        unit: 'HU',
      });
    })();
    const measurementAnnotation = createStudyAnnotation(studyState.study.id, {
      kind: 'measurement',
      name: nextMeasurement.name,
      text: `${nextMeasurement.value.toFixed(1)} ${
        nextMeasurement.unit === 'degrees' ? 'deg' : nextMeasurement.unit
      }`,
      point: points[0] ?? [cursor.x, cursor.y, cursor.z],
      measurementId: nextMeasurement.id,
      selected: true,
    });
    setStudyState((current) => ({
      ...current,
      measurements: [
        ...current.measurements,
        nextMeasurement,
        ...(densityMeasurement ? [densityMeasurement] : []),
      ],
      annotations: [
        ...current.annotations.map((annotation) => ({
          ...annotation,
          selected: false,
        })),
        measurementAnnotation,
      ],
      activeMeasurementId: densityMeasurement?.id ?? nextMeasurement.id,
      activeAnnotationId: measurementAnnotation.id,
      activeTool:
        measurement.kind === 'distance'
          ? 'measure-distance'
          : measurement.kind === 'angle'
            ? 'measure-angle'
            : measurement.kind === 'ellipse'
              ? 'measure-ellipse'
              : 'measure-polygon',
    }));
  };

  const deleteMeasurement = (measurementId: string) => {
    setStudyState((current) => ({
      ...current,
      measurements: current.measurements.filter(
        (measurement) => measurement.id !== measurementId,
      ),
      annotations: current.annotations.filter(
        (annotation) => annotation.measurementId !== measurementId,
      ),
      activeMeasurementId:
        current.activeMeasurementId === measurementId
          ? undefined
          : current.activeMeasurementId,
      activeAnnotationId:
        current.annotations.find((annotation) => annotation.measurementId === measurementId)
          ?.id === current.activeAnnotationId
          ? undefined
          : current.activeAnnotationId,
    }));
  };

  const undoMaskEdit = () => {
    const previous = undoStack.at(-1);
    if (!previous) return;
    const nextRedo = [snapshotMasks(), ...redoStack].slice(0, 24);
    const nextUndo = undoStack.slice(0, -1);
    setUndoStack(nextUndo);
    setRedoStack(nextRedo);
    setMaskBuffers(cloneMaskBuffers(previous.buffers));
    setLabelmapBuffers(cloneMaskBuffers(previous.labelmaps));
    setStudyState((current) => ({
      ...current,
      masks: previous.masks,
      segmentGroups: previous.segmentGroups,
      activeMaskId: previous.activeMaskId,
      maskWorkflow: {
        ...current.maskWorkflow,
        canUndo: nextUndo.length > 0,
        canRedo: true,
      },
    }));
  };

  const redoMaskEdit = () => {
    const next = redoStack[0];
    if (!next) return;
    const nextUndo = [...undoStack, snapshotMasks()].slice(-24);
    const nextRedo = redoStack.slice(1);
    setUndoStack(nextUndo);
    setRedoStack(nextRedo);
    setMaskBuffers(cloneMaskBuffers(next.buffers));
    setLabelmapBuffers(cloneMaskBuffers(next.labelmaps));
    setStudyState((current) => ({
      ...current,
      masks: next.masks,
      segmentGroups: next.segmentGroups,
      activeMaskId: next.activeMaskId,
      maskWorkflow: {
        ...current.maskWorkflow,
        canUndo: true,
        canRedo: nextRedo.length > 0,
      },
    }));
  };

  const toggleMaskVisibility = (maskId: string) => {
    setStudyState((current) => ({
      ...current,
      masks: current.masks.map((mask) =>
        mask.id === maskId
          ? { ...mask, visible: !mask.visible, updatedAt: Date.now() }
          : mask,
      ),
    }));
  };

  const createSurfaceFromActiveMask = async (
    quality: SurfaceGenerationQuality = 'balanced',
  ) => {
    const activeMaskId = studyState.activeMaskId;
    if (!app.volume || !studyState.study || !activeMaskId || surfaceStatus) return;
    const activeGroup = studyState.segmentGroups.find(
      (group) => group.id === studyState.activeSegmentGroupId,
    );
    const activeSegment = activeGroup?.segments.find(
      (segment) =>
        segment.maskId === activeMaskId ||
        segment.value === activeGroup.activeSegmentValue,
    );
    const labelmapBytes = activeGroup ? labelmapBuffers[activeGroup.id] : undefined;
    const labelmapMask =
      labelmapBytes && activeSegment
        ? labelmapToMask(bytesToUint16Array(labelmapBytes), activeSegment.value)
        : undefined;
    const sourceBuffer = labelmapMask ?? maskBuffers[activeMaskId];
    const sourceMask =
      studyState.masks.find((item) => item.id === activeSegment?.maskId) ??
      studyState.masks.find((item) => item.id === activeMaskId);
    if (!sourceBuffer || !sourceMask || !sourceMask.voxelCount) return;

    const dims = volumeMaskDims(app.volume.meta.dimensions);
    const controller = new AbortController();
    surfaceAbortRef.current = controller;
    setSurfaceStatus('Preparing surface');
    try {
      const generated = await generateSurfaceInWorker({
        mask: sourceBuffer,
        dims,
        spacing: app.volume.meta.spacing,
        quality,
        signal: controller.signal,
        onProgress: (phase) => {
          setSurfaceStatus(
            phase === 'preprocess'
              ? 'Preparing mask'
              : phase === 'mesh'
                ? 'Generating mesh'
                : 'Measuring surface',
          );
        },
      });
      const surface = createStudySurface(studyState.study.id, {
        maskId: activeMaskId,
        name: `${activeSegment?.name ?? sourceMask.name} ${quality} surface`,
        color: activeSegment?.color ?? sourceMask.color,
        areaMm2: generated.areaMm2,
        triangleCount: generated.triangleCount,
        volumeMm3: generated.volumeMm3,
      });
      const url = URL.createObjectURL(generated.blob);

      setSurfaceBlobs((current) => ({ ...current, [surface.id]: generated.blob }));
      setSurfaceUrls((current) => ({ ...current, [surface.id]: url }));
      setStudyState((current) => ({
        ...current,
        surfaces: [...current.surfaces, surface],
        activeSurfaceId: surface.id,
        activeTool: 'surface-select',
      }));
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        window.alert(
          error instanceof Error ? error.message : 'Surface generation failed.',
        );
      }
    } finally {
      if (surfaceAbortRef.current === controller) surfaceAbortRef.current = null;
      setSurfaceStatus(undefined);
    }
  };

  const cancelSurfaceGeneration = () => {
    surfaceAbortRef.current?.abort();
  };

  const toggleSurfaceVisibility = (surfaceId: string) => {
    setStudyState((current) => ({
      ...current,
      surfaces: current.surfaces.map((surface) =>
        surface.id === surfaceId
          ? { ...surface, visible: !surface.visible, updatedAt: Date.now() }
          : surface,
      ),
    }));
  };

  const downloadSurface = (surfaceId: string) => {
    const surface = studyState.surfaces.find((item) => item.id === surfaceId);
    const url = surfaceUrls[surfaceId];
    if (!surface || !url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = `${surface.name.replace(/[^a-z0-9_-]+/gi, '_')}.stl`;
    link.click();
  };

  const downloadSurfacePly = (surfaceId: string) => {
    const surface = studyState.surfaces.find((item) => item.id === surfaceId);
    if (!app.volume || !surface?.maskId) return;
    const mask = maskBuffers[surface.maskId];
    if (!mask) return;
    const sourceMask = studyState.masks.find((item) => item.id === surface.maskId);
    const stride = (sourceMask?.voxelCount ?? 0) > 750_000 ? 2 : 1;
    const blob = maskToAsciiPly(
      mask,
      volumeMaskDims(app.volume.meta.dimensions),
      app.volume.meta.spacing,
      [0, 0, 0],
      stride,
      {
        extraction: 'iso',
        smoothIterations: 0,
        decimateReduction: 0,
      },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${surface.name.replace(/[^a-z0-9_-]+/gi, '_')}.ply`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const exportProject = async () => {
    const volume = app.volume;
    if (!volume) return;
    const surfaces = await Promise.all(
      studyState.surfaces
        .map((surface) => {
          const blob = surfaceBlobs[surface.id];
          return blob ? { surface, blob } : null;
        })
        .filter((item): item is { surface: StudyState['surfaces'][number]; blob: Blob } => item != null)
        .map(async ({ surface, blob }) => ({
          id: surface.id,
          data: new Uint8Array(await blob.arrayBuffer()),
        })),
    );

    const archive = await buildProjectArchive({
      state: studyState,
      masks: Object.entries(maskBuffers).map(([id, data]) => ({
        id,
        data,
      })),
      labelmaps: Object.entries({
        ...buildLabelmapBuffers(
          studyState.segmentGroups,
          maskBuffers,
          volume.voxels.length,
        ),
        ...labelmapBuffers,
      }).map(([id, data]) => ({ id, data })),
      surfaces,
    });
    const url = URL.createObjectURL(archive);
    const link = document.createElement('a');
    link.href = url;
    link.download = projectArchiveName(studyState);
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const applyProjectArchive = (archive: Awaited<ReturnType<typeof readProjectArchive>>) => {
    const volume = app.volume;
    if (!volume) return;
    const restoredImage = archive.manifest.state.images.find((image) =>
      sameVec3(image.dimensions, volume.meta.dimensions),
    );
    if (!restoredImage) {
      throw new Error(
        'Project package does not match the loaded volume dimensions.',
      );
    }

    const expectedMaskBytes =
      volume.meta.dimensions[0] *
      volume.meta.dimensions[1] *
      volume.meta.dimensions[2];
    const nextMaskBuffers: MaskBufferMap = {};
    for (const mask of archive.masks) {
      if (mask.data.byteLength !== expectedMaskBytes) {
        throw new Error(`Mask ${mask.id} does not match this volume.`);
      }
      nextMaskBuffers[mask.id] = new Uint8Array(mask.data);
    }
    for (const labelmap of archive.labelmaps) {
      if (labelmap.data.byteLength !== expectedMaskBytes * 2) {
        throw new Error(`Labelmap ${labelmap.id} does not match this volume.`);
      }
    }
    const nextLabelmapBuffers: LabelmapBufferMap = Object.fromEntries(
      archive.labelmaps.map((labelmap) => [
        labelmap.id,
        new Uint8Array(labelmap.data),
      ]),
    );

    setSurfaceBlobs({});
    setSurfaceUrls((current) => {
      Object.values(current).forEach((url) => URL.revokeObjectURL(url));
      return {};
    });
    const nextSurfaceBlobs: SurfaceBlobMap = {};
    const nextSurfaceUrls: SurfaceUrlMap = {};
    for (const surface of archive.surfaces) {
      const blob = new Blob([byteRangeToArrayBuffer(surface.data)], {
        type: 'model/stl',
      });
      nextSurfaceBlobs[surface.id] = blob;
      nextSurfaceUrls[surface.id] = URL.createObjectURL(blob);
    }

    const restoredState = normalizeStudyState(archive.manifest.state);
    app.setDicomImportEngine(restoredState.dicomImportEngine);
    setStudyState({
      ...restoredState,
      study: scanStudy ?? archive.manifest.state.study,
      images: restoredState.images.map((image) =>
        image.id === restoredImage.id
          ? {
              ...image,
              dimensions: volume.meta.dimensions,
              spacing: volume.meta.spacing,
            }
          : image,
      ),
      activeImageId: restoredImage.id,
    });
    setMaskBuffers(nextMaskBuffers);
    setLabelmapBuffers(nextLabelmapBuffers);
    setSurfaceBlobs(nextSurfaceBlobs);
    setSurfaceUrls(nextSurfaceUrls);
    setUndoStack([]);
    setRedoStack([]);
  };

  const importProject = async (file: File) => {
    if (!app.volume) return;
    try {
      applyProjectArchive(await readProjectArchive(file));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Project import failed.');
    }
  };

  const saveLocalProject = async () => {
    const surfaces = await Promise.all(
      Object.entries(surfaceBlobs).map(async ([id, blob]) => ({
        id,
        data: new Uint8Array(await blob.arrayBuffer()),
      })),
    );
    await saveLatestProject({
      state: studyState,
      masks: Object.entries(maskBuffers).map(([id, data]) => ({ id, data })),
      surfaces,
    });
  };

  const restoreLocalProject = async () => {
    try {
      const archive = await loadLatestProject();
      if (!archive) throw new Error('No local project has been saved yet.');
      applyProjectArchive(archive);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Local restore failed.');
    }
  };

  if (!app.volume) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
        <div className="rounded border border-slate-800 bg-slate-950/90 px-4 py-3 text-sm text-slate-400">
          {t('viewerPage.loading')}
        </div>
      </main>
    );
  }

  const show3DViewport = studyState.layoutPreset !== 'mpr-only';
  const showMprViewports =
    app.axisViewsVisible && studyState.layoutPreset !== 'single';

  return (
    <main className="h-screen overflow-hidden bg-slate-950 text-slate-100">
      <div className="relative h-full overflow-hidden bg-slate-800">
        <div
          className={cn(
            'grid h-full gap-px',
            compactLayout
              ? 'grid-cols-1'
              : app.sidebarVisible
                ? 'grid-cols-[minmax(0,1fr)_minmax(288px,22vw)]'
                : 'grid-cols-1',
          )}
        >
          <section className="min-h-0 min-w-0">
            <div
              className={cn(
                'grid h-full min-h-0 min-w-0 gap-px bg-slate-800',
                show3DViewport && showMprViewports
                  ? compactLayout
                    ? 'grid-rows-[minmax(0,1.1fr)_minmax(260px,0.9fr)]'
                    : 'grid-rows-[1.22fr_0.95fr]'
                  : 'grid-rows-1',
              )}
            >
              {show3DViewport ? (
                <div className="grid min-h-0 min-w-0 grid-cols-1 gap-px bg-slate-800">
                <ViewportFrame
                  title={
                    <span className="inline-flex items-center gap-1.5">
                      <Box
                        className="h-4 w-4 text-slate-400"
                        aria-hidden="true"
                      />
                      3D
                    </span>
                  }
                  subtitle={t('viewerPage.mainNavigationVolume')}
                  status={
                    app.prepared3D
                      ? app.prepared3D.downsampled
                        ? t('viewerPage.downsampledStatus')
                        : t('viewerPage.nativeStatus')
                      : t('viewerPage.preparingStatus')
                  }
                >
                  <VolumeViewport3D
                    ref={viewport3DRef}
                    volume={app.prepared3D}
                    axisViewsVisible={app.axisViewsVisible}
                    onAxisViewsVisibleChange={app.setAxisViewsVisible}
                    sidebarVisible={app.sidebarVisible}
                    onSidebarVisibleChange={app.setSidebarVisible}
                    onDownsampledChange={app.setDownsampled3D}
                    labels={volume3DLabels}
                  surfaces={surfacePreviews}
                  cropBounds={studyState.cropBounds}
                  />
                </ViewportFrame>
                </div>
              ) : null}

              {showMprViewports ? (
                <AxisViewportGrid
                  compact={compactLayout}
                  hasVolume={Boolean(app.volume)}
                  cursor={app.cursor}
                  dimensions={app.dimensions}
                  spacing={app.spacing}
                  slices={app.slices}
                  mprZoom={app.mprZoom}
                  overlays={maskOverlays}
                  cropRects={cropRects}
                  annotations={annotationOverlays}
                  brushPreviews={brushPreviews}
                  selectedAxis={app.selectedAxis}
                  theme={appViewerTheme}
                  labels={axisLabels}
                  onEditAxis={maskSliceEditEnabled ? editMaskOnSlice : undefined}
                  onProbeAxis={updateProbeFromAxis}
                  onCropAxis={updateCropFromAxis}
                  onAnnotationSelect={selectAnnotation}
                  onAnnotationMove={moveAnnotation}
                  onMeasurementComplete={addSliceMeasurement}
                  onZoomChange={app.setMprZoom}
                  onSelectedAxisChange={app.setSelectedAxis}
                  onWindowLevelDrag={
                    studyState.activeTool === 'window-level'
                      ? app.handleWindowLevelDrag
                      : undefined
                  }
                  onSelectAxis={app.updateCursor}
                />
              ) : null}
            </div>
          </section>

          {!compactLayout && app.sidebarVisible ? (
            <ViewerSidebar
              volumeMeta={app.volume?.meta ?? null}
              studyState={studyState}
              sourceLabel={app.sourceLabel}
              dimensions={app.dimensions}
              spacing={app.spacing}
              maskStatus={maskStatus}
              surfaceStatus={surfaceStatus}
              windowBounds={app.windowBounds}
              levelBounds={app.levelBounds}
              windowLevelDraft={app.windowLevelDraft}
              progress={app.progress}
              issue={app.issue}
              cursor={app.cursor}
              downsampled3D={app.downsampled3D}
              selectedSeriesId={app.selectedSeriesId}
              seriesChoices={app.seriesChoices}
              onWindowChange={app.handleWindowChange}
              onWindowCommit={app.handleWindowCommit}
              onCancelMaskOperation={cancelMaskOperation}
              onCancelSurfaceGeneration={cancelSurfaceGeneration}
              onCreateThresholdMask={createThresholdMask}
              onCreateSurfaceFromActiveMask={createSurfaceFromActiveMask}
              onDeleteMeasurement={deleteMeasurement}
              onDownloadSurface={downloadSurface}
              onDownloadSurfacePly={downloadSurfacePly}
              onExportProject={() => void exportProject()}
              onFillMaskHoles={fillActiveMaskHoles}
              onImportProject={(file) => void importProject(file)}
              onSaveLocalProject={() => void saveLocalProject()}
              onRestoreLocalProject={() => void restoreLocalProject()}
              onKeepLargestMaskComponent={keepLargestActiveMaskComponent}
              onSelectMask={selectMask}
              onSplitMaskComponents={splitActiveMaskComponents}
              onUpdateMaskAppearance={updateMaskAppearance}
              onUpdateMaskWorkflow={updateMaskWorkflow}
              onUpdateStudyViewState={updateStudyViewState}
              onUpdateSegment={updateSegment}
              onAddSegment={addSegment}
              onDeleteSegment={deleteSegment}
              onSelectSegment={selectSegment}
              onAddWatershedSeedAtCursor={addWatershedSeedAtCursor}
              onApplyWatershedSeeds={applyWatershedSeeds}
              onClearWatershedSeeds={clearWatershedSeeds}
              onLevelChange={app.handleLevelChange}
              onLevelCommit={app.handleLevelCommit}
              onRedoMaskEdit={redoMaskEdit}
              onRegionGrowFromCursor={regionGrowFromCursor}
              onToggleSurfaceVisibility={toggleSurfaceVisibility}
              onToggleMaskVisibility={toggleMaskVisibility}
              onUndoMaskEdit={undoMaskEdit}
              onSeriesChange={(seriesId) => void app.selectSeries(seriesId)}
              onOpenDirectory={() => void app.openDirectory()}
              onOpenTeeth={openTeeth}
              onOpenPanoramic={openPanoramic}
              onBackToImport={app.resetViewer}
            />
          ) : null}
        </div>

        {compactLayout && app.sidebarVisible ? (
          <div className="absolute inset-0 z-40 flex justify-end">
            <button
              type="button"
              aria-label={t('viewerPage.closeStudyPanel')}
              className="absolute inset-0 bg-slate-950/60 backdrop-blur-[1px]"
              onClick={() => app.setSidebarVisible(false)}
            />
            <div className="relative flex h-full w-[min(24rem,92vw)] flex-col border-l border-slate-800 bg-slate-900">
              <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/95 px-3 py-2">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  {t('viewerPage.studyPanel')}
                </div>
                <Button
                  variant="overlay"
                  size="sm"
                  onClick={() => app.setSidebarVisible(false)}
                >
                  <PanelRightClose className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('common.hide')}
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto bg-slate-800 p-px">
                <ViewerSidebar
                  volumeMeta={app.volume?.meta ?? null}
                  studyState={studyState}
                  sourceLabel={app.sourceLabel}
                  dimensions={app.dimensions}
                  spacing={app.spacing}
                  maskStatus={maskStatus}
                  surfaceStatus={surfaceStatus}
                  windowBounds={app.windowBounds}
                  levelBounds={app.levelBounds}
                  windowLevelDraft={app.windowLevelDraft}
                  progress={app.progress}
                  issue={app.issue}
                  cursor={app.cursor}
                  downsampled3D={app.downsampled3D}
                  selectedSeriesId={app.selectedSeriesId}
                  seriesChoices={app.seriesChoices}
                  onWindowChange={app.handleWindowChange}
                  onWindowCommit={app.handleWindowCommit}
                  onCancelMaskOperation={cancelMaskOperation}
                  onCancelSurfaceGeneration={cancelSurfaceGeneration}
                  onCreateThresholdMask={createThresholdMask}
                  onCreateSurfaceFromActiveMask={createSurfaceFromActiveMask}
                  onDeleteMeasurement={deleteMeasurement}
                  onDownloadSurface={downloadSurface}
                  onDownloadSurfacePly={downloadSurfacePly}
                  onExportProject={() => void exportProject()}
                  onFillMaskHoles={fillActiveMaskHoles}
                  onImportProject={(file) => void importProject(file)}
                  onSaveLocalProject={() => void saveLocalProject()}
                  onRestoreLocalProject={() => void restoreLocalProject()}
                  onKeepLargestMaskComponent={keepLargestActiveMaskComponent}
                  onSelectMask={selectMask}
                  onSplitMaskComponents={splitActiveMaskComponents}
                  onUpdateMaskAppearance={updateMaskAppearance}
                  onUpdateMaskWorkflow={updateMaskWorkflow}
                  onUpdateStudyViewState={updateStudyViewState}
                  onUpdateSegment={updateSegment}
                  onAddSegment={addSegment}
                  onDeleteSegment={deleteSegment}
                  onSelectSegment={selectSegment}
                  onAddWatershedSeedAtCursor={addWatershedSeedAtCursor}
                  onApplyWatershedSeeds={applyWatershedSeeds}
                  onClearWatershedSeeds={clearWatershedSeeds}
                  onLevelChange={app.handleLevelChange}
                  onLevelCommit={app.handleLevelCommit}
                  onRedoMaskEdit={redoMaskEdit}
                  onRegionGrowFromCursor={regionGrowFromCursor}
                  onToggleSurfaceVisibility={toggleSurfaceVisibility}
                  onToggleMaskVisibility={toggleMaskVisibility}
                  onUndoMaskEdit={undoMaskEdit}
                  onSeriesChange={(seriesId) => void app.selectSeries(seriesId)}
                  onOpenDirectory={() => void app.openDirectory()}
                  onOpenTeeth={openTeeth}
                  onOpenPanoramic={openPanoramic}
                  onBackToImport={app.resetViewer}
                />
              </div>
            </div>
          </div>
        ) : null}
        {sliceProbe ? (
          <div className="pointer-events-none absolute left-3 bottom-3 z-30 rounded border border-slate-700 bg-slate-950/85 px-2.5 py-1.5 text-xs text-slate-200 shadow">
            {sliceProbe.axis} [{sliceProbe.voxel.join(', ')}] {sliceProbe.value} HU
            {sliceProbe.label ? ` · ${sliceProbe.label}` : ''}
          </div>
        ) : null}
      </div>
    </main>
  );
}
