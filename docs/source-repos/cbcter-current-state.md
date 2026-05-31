# CBCTer — current state (analysis snapshot)

CBCTer is a local-first browser CBCT dental viewer plus client-side tooth segmentation app.

## Stack

- React 19
- Vite 8
- TypeScript
- three.js
- onnxruntime-web
- itk-wasm dicom
- dexie
- convex scaffolded
- Python MONAI offline
- i18next

## Capabilities

| Capability | Status | Key files |
|---|---|---|
| DICOM import (custom parser plus ITK/GDCM) | done | `src/lib/import/adapters/dicom/itkGdcm.ts`<br>`src/lib/import/adapters/dicom/parser.ts`<br>`src/lib/import/adapters/dicom/reader.ts`<br>`src/lib/import/adapters/dicom/heuristics.ts`<br>`src/lib/import/adapters/index.ts`<br>`src/workers/volume/assemble/dicom.ts` |
| Proprietary CBCT import (Galileos and OneVolume) | done | `src/lib/import/adapters/galileos/parser.ts`<br>`src/lib/import/adapters/onevolume/parser.ts`<br>`src/workers/volume/assemble/galileos.ts`<br>`src/workers/volume/assemble/onevolume.ts` |
| Import infra (archive expand, folder scan, remote range fetch, source pickers) | done | `src/lib/import/archive.ts`<br>`src/lib/import/scan-folder.ts`<br>`src/lib/import/remoteRange.ts`<br>`src/lib/import/source-picker/index.ts`<br>`src/lib/import/fileTypes.ts` |
| 2D MPR slice viewer (window level, crosshair, zoom) | done | `src/viewer/useVolumeViewerState.ts`<br>`src/viewer/react/SliceCanvas.tsx`<br>`src/viewer/react/AxisViewportGrid.tsx`<br>`src/viewer/react/useSliceInteraction.ts`<br>`src/viewer/core/index.ts` |
| 3D volume rendering (three.js ray-march shader, colormaps, presets, crop clipping) | done | `src/viewer/react/VolumeViewport3D.tsx`<br>`src/lib/volume/three-preview/volume-object.ts`<br>`src/lib/volume/three-preview/index.ts`<br>`src/lib/volume/three-preview/camera.ts`<br>`src/lib/volume/three-preview/cursor-planes.ts` |
| Labelmap brush erase threshold editing | done | `src/lib/segmentation/paintBrush.ts`<br>`src/workers/mask.worker.ts`<br>`src/lib/segmentation/runMaskWorker.ts`<br>`src/pages/ViewerPage.tsx`<br>`src/components/StudyWorkflowPanel.tsx` |
| Mask operations (threshold, connected-components, keep-largest, fill-holes, watershed) | done | `src/lib/segmentation/maskOperations.ts`<br>`src/lib/segmentation/connectedComponents.ts`<br>`src/lib/segmentation/watershed.ts` |
| Crop and ROI bounds | done | `src/lib/segmentation/roi.ts`<br>`src/domain/types.ts`<br>`src/pages/ViewerPage.tsx` |
| Client-side ONNX tooth segmentation (MONAI UNet via onnxruntime-web in worker) | done | `src/lib/segmentation/toothInference.ts`<br>`src/workers/toothSeg.worker.ts`<br>`public/models/tooth-unet-96.onnx` |
| In-browser tooth library generation (segment, watershed split, mesh, manifest, QC) | done | `src/lib/segmentation/generateLibrary.ts`<br>`src/lib/segmentation/useSegmentation.ts`<br>`src/components/LiveToothSegmentation.tsx`<br>`src/components/BrowserLibraryGenerator.tsx`<br>`src/pages/ToothExtractionPage.tsx` |
| Tooth arch and mesh review UI (preview, STL viewport, accept review hide, CSV and HTML report) | done | `src/components/ToothArchViewport.tsx`<br>`src/components/ToothMeshViewport.tsx`<br>`src/lib/segmentation/report.ts` |
| Surface mesh generation from masks to STL and PLY with area and volume metrics | partial | `src/lib/surface/generateSurface.ts`<br>`src/workers/surface.worker.ts`<br>`src/lib/segmentation/maskMesh.ts` |
| Panoramic curved-planar reformation (arch spline fit, MIP or mean) | partial | `src/lib/panoramic/reformation.ts`<br>`src/lib/panoramic/archFit.ts`<br>`src/lib/panoramic/spline.ts`<br>`src/workers/panoramic.worker.ts`<br>`src/pages/PanoramicPage.tsx` |
| Measurements (distance, angle, ellipse, polygon, density HU ROI) | done | `src/lib/measurements/geometry.ts`<br>`src/viewer/react/MeasurementOverlay.tsx`<br>`src/domain/types.ts` |
| Project archive export import (versioned manifest, masks labelmaps surfaces, migrations) | done | `src/lib/project/exportProject.ts`<br>`src/lib/project/localProjectStore.ts`<br>`src/domain/studyState.ts` |
| Local persistence (Dexie IndexedDB data client, the real backend) | done | `src/local-dexie/db.ts`<br>`src/local-dexie/dexieDataClient.ts`<br>`src/data/client.ts`<br>`src/data/hooks.ts` |
| Convex cloud backend (studies and presets schema and CRUD) | scaffolded | `convex/schema.ts`<br>`convex/studies.ts` |
| i18n (English and Ukrainian) | done | `src/i18n/index.ts`<br>`src/i18n/locales/en.json`<br>`src/i18n/locales/uk.json` |
| Study viewer state model (tools, masks, segment groups, surfaces, annotations, layout) | done | `src/domain/types.ts`<br>`src/domain/studyState.ts`<br>`src/components/ViewerSidebar.tsx` |
| PWA offline (service worker, manifest, icons) | partial | `src/sw.ts`<br>`public/manifest.webmanifest` |
