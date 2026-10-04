# Dental viewer: changes, upload guide and test report

This page records the work that turned the CBCTer viewer into a
dentist-oriented CBCT reader on desktop, tablet and phone: what changed,
what to upload from the two example vendor exports, the data-correctness
fixes found along the way, and how everything was tested.

Day-to-day controls and keyboard shortcuts are in
[viewer-controls.md](./viewer-controls.md). Supported folder formats are in
[importing-data.md](./importing-data.md).

CBCTer stays **reference-only**. It is not a diagnostic device, and none of
the tools are validated for treatment or implant planning.

## Pipeline: vendor export → slim package → any device

```text
 vendor disc / folder                 CBCTer (desktop)                  any device
 ──────────────────────               ─────────────────                 ──────────
 OneVolume …SL folder      ┐                                            Open ZIP file
 Sidexis disc (DICOM/,     ├─ Open folder ─┐                            ├─ desktop: full resolution
   S4Viewer/, installers)  │               ├─ view ─ Export slim ──►    │
 …or a ZIP of either       ┘─ Open ZIP ────┘         package            └─ phone: phone level only
                                                     (.cbct.zip)
```

1. **Import** the export as delivered: the folder (*Open folder*) or a zip
   of it (*Open ZIP file*). Only the scan files are used.
2. **Export slim package** → *Full + phone version*. That writes one
   `.cbct.zip` containing just the scan: a manifest, the full-resolution
   voxels and a half-resolution phone level.
3. **Use the package from then on.** *Open ZIP file* on any device:
   desktops open full resolution, phones open the phone level, and you can
   switch between them in the viewer.

Measured on the two example exports:

| Example | Vendor export | Import as folder | Import as ZIP | Slim package | Phone reads |
| --- | --- | --- | --- | --- | --- |
| Morita OneVolume | 271 MB folder, 82 files (159 MB zipped) | 4.8 s | 11.6 s | **47.9 MB** | 5.4 MB |
| Sirona Sidexis disc | 867 MB folder, 743 files (770 MB zipped) | 12.2 s | 29.0 s | **167 MB** | 18.9 MB |

Both import routes produce the same package.

Do step 1 on a desktop. A zipped vendor export is unpacked entirely in the
browser, vendor software included; that was about 870 MB for the Sidexis
disc. A folder import reads only the scan files. Step 3 is fine on phones.

Not carried by the package:
- **Measurements, tooth chart and case notes:** use the project export for
  those.
- **The scan date:** the default name contains the scan date/time, so
  rename it before sharing outside the clinic.

Format details: [scan-package.md](./scan-package.md).

## Reference material

The design follows the viewers that ship on two real export discs, which
were used as examples and as test data. The exports contain patient data and
are **not** in the repository.

| Example | Vendor viewer on the disc | Scan |
| --- | --- | --- |
| April 2026 | J. Morita *i-Dixel One Volume Viewer* (manual v2.8) | OneVolume `CT_0.vol`, 341 × 341 × 344 source voxels at 0.125 mm (displayed 340³), 40 × 40 mm field of view |
| Aug 2025 | Sirona *Sidexis 4 Viewer* | DICOMDIR disc, `CT3` series: 512 × 512 × 512 at 0.16 mm, 82 mm field of view (Sirona XG3D) |

From the One Volume Viewer manual the viewer adopts:
- the four-pane "XYZ" layout: axial, coronal and sagittal slices plus 3D;
- contrast presets, invert, and length / angle / area measurements with a
  measurement list;
- region statistics (the mean value inside an ROI);
- saving images for patient communication.

## What changed

### Desktop (≥ 768 px)

- **Toolbar** with the dental tools:
  - Navigate, Contrast drag;
  - Distance, Angle, Area + density, Polygon area;
  - contrast presets, Invert, zoom;
  - layout: *MPR + 3D* 2×2, *Axial focus*, or *3D only*;
  - Panoramic, Tooth extraction, Save views (PNG), Case report;
  - shortcut help, side-panel toggle.
- **Any pane can be maximized** from its header or with `F`.
- **Each slice pane has a slider** with previous/next buttons.
- **Mouse wheel pages one slice per notch.** Ctrl/⌘ + wheel or pinch zooms.
- **Status bar:** crosshair position in mm, slice indices, hovered voxel
  value, window/level and zoom.
- **Side panel:** a *Chart* tab (the tooth chart, shown by default) and a
  *Measures* tab. Below 1100 px wide (tablets in portrait, small laptops)
  the panel starts hidden so the slices keep their size.

### Phone (< 768 px)

- **View tabs** for Axial / Coronal / Sagittal / 3D. Axial is the default.
- **One full-screen view** with a large slice slider.
- **Bottom bar:** Navigate, Measure, Contrast, Chart, More. All targets are
  at least 44 px.
- **Sheets** slide up *over* the bottom bar. Close them by tapping above,
  swiping the handle down, or tapping ✕.
- **Active-tool pill:** while measuring or adjusting contrast, a pill shows
  the tool with an **OK** button.

### Tools on every screen size

- **Measurements** keep the plane and slice they were drawn on and stay drawn
  there. You can go to, rename, hide or delete them, and export them as CSV.
  Ellipse and polygon areas also record the mean value inside.
- **Tooth chart** (FDI, permanent or primary teeth):
  - findings per tooth: caries, periapical lesion, root canal treated,
    restoration/crown, implant, missing, impacted, bone loss, fracture,
    resorption, other;
  - a note per tooth;
  - a crosshair bookmark per tooth, shown as a marker on the slices with
    *Go to tooth*;
  - case notes, CSV export.
  - The chart is saved in project archives (`toothFindings`, `caseNotes` in
    the study state; older projects load with empty values).
- **Case report:** a printable page (save as PDF) with:
  - scan details;
  - axial / coronal / sagittal snapshots at the crosshair, with the current
    contrast, overlays, measurements and a scale bar;
  - the measurement table;
  - the tooth-chart findings and case notes.
- **Contrast presets** are relative to each scan's intensity span (2nd–99.9th
  percentile of the non-padding voxels): *Scan default*, *Auto*, *Bone*,
  *Teeth*, *Soft tissue*, *Metal*. Fixed HU windows were tried and rejected:
  these scanners' gray values are not true HU.

### Fixes to existing behaviour

| Area | Problem | Fix |
| --- | --- | --- |
| OneVolume import | Scaled values left the Int16 range and wrapped around. The brightest enamel/metal showed as **black speckle inside teeth**, which can look like caries. | Use the header calibration `HU = (raw / 1000) × tfSystemV2HuSlope + tfSystemV2HuIntercept`, clamped. With that reading, the scan's own saved window lands on a normal air-to-enamel range. |
| DICOM import | Sidexis/DICOMDIR discs name slices `000`, `001`, … with no extension, so the folder was rejected as "Unsupported folder layout". | When no format matches, files without an extension are checked for the `DICM` signature and treated as DICOM (the `DICOMDIR` index is skipped). |
| 3D view | View presets (F/Bk/L/R/T/Bo) showed about half the volume and came out rolled 45°. Portrait phones cut off the sides. The crosshair-plane tint read as a cut through the teeth. | Presets reuse the whole-volume fit with anatomical up axes. The fit uses the narrower field of view. Plane fills were made much fainter. |
| Panoramic page | The arch editor drew at 0 × 0 on desktop and collapsed on phones. | The editor is sized with a ResizeObserver. The phone layout scrolls, with arch handles of about 44 px. |
| Measurements | Each measurement could be recorded twice in development builds (React StrictMode). | Completion moved out of the state updater. |

## What to upload

Pick any of these on any device:

| You have | Use | Notes |
| --- | --- | --- |
| A whole vendor export folder (OneVolume `…SL` folder, Sidexis disc with `DICOM/`, `S4Viewer/`, installers) | *Open folder* | Only the scan files are read. The whole examples import in about 5 s (OneVolume) and 12 s (Sidexis disc). |
| Just the scan folder (`CT_<date>` or `…/CT3`) | *Open folder* | Fastest from a vendor export. |
| A ZIP of either of the above | *Open ZIP file* | Unzipped in the browser, so it needs memory for both the zip and everything in it; use a desktop. The examples took 11.6 s and 29.0 s. |
| A CBCTer scan package `*.cbct.zip` | *Open ZIP file* | Best for phones and sharing. See [scan-package.md](./scan-package.md). |

**Recommended workflow:**
1. Open the full vendor export once on a desktop.
2. *Export slim package* with *Full + phone version*.
3. Open that one `.cbct.zip` anywhere. Desktops open full resolution;
   phones open the phone level and read only that part of the zip.

The examples shrink from 271 MB to one 47.9 MB package (phones read
5.4 MB of it), and from 867 MB to one 167 MB package (phones read
18.9 MB).

**Phones**
- **iPhone/iPad:** *Open ZIP file* works from the Files app on any iOS
  version. *Open folder* needs iOS/iPadOS 18.4 or later.
- **Android:** *Open ZIP file* uses the normal file chooser. Folder picking
  was not verified on a real device.
- **Memory:** phones have far less memory. Two-level packages open the
  phone level automatically; *Load full resolution* on a phone needs
  several hundred MB of RAM for a 512³ scan.

## Test report (Oct 2026)

### Voxel data

The app's in-memory volume was compared with the raw files, recomputed
independently in Python, at 2000 random voxels per scan:

| Scan | Check | Result |
| --- | --- | --- |
| OneVolume | value = (raw / 1000) × 190 − 400, crop offset (0, 0, 1), source layout z-fastest | **2000 / 2000** match |
| Sirona DICOM | value = raw × 1 − 1024 (RescaleSlope/Intercept), slice order by ImagePositionPatient z | **2000 / 2000** match. Reversed z order: 23 / 2000. Flipped y: 19 / 2000. Orientation confirmed. |
| Sirona DICOM | geometry vs header | 512 × 512 × 512, PixelSpacing 0.16, z step 0.16 mm (−45.61 → +36.15 mm), W 4096 / L 1024 all match |

Note for anyone writing a verifier: the Sirona slices carry about 197 KB of
data *after* the pixel block. Locate pixel data via the `(7FE0,0010)`
element, not from the end of the file.

### Measurements on the real scans

Clicks at known fractions of each slice, compared with the values expected
from voxel count × spacing:

| Scan | Axial distance | Coronal distance | Right angle | Ellipse area |
| --- | --- | --- | --- | --- |
| OneVolume | 21.19 → **21.2 mm** | 25.43 → **25.4 mm** | **90.0°** | 56.41 → **56.4 mm²** |
| Sirona | 40.88 → **40.9 mm** | 49.06 → **49.1 mm** | **90.0°** | 210.01 → **210.0 mm²** |

The hovered value in the status bar matched the raw voxel, for example 150 at
the Sirona volume centre (raw 1174 − 1024).

### Devices

Run in Chromium with Playwright device emulation (viewport, pixel ratio,
touch, user agent; iOS profiles use an iOS 18.4 Safari user agent). This is
emulation in Chromium, not Safari/WebKit or a physical device; WebKit is not
installed in the test environment.

| Profile | Viewport | OneVolume load | Sirona load | Horizontal overflow | Phone targets < 32 px | Page errors |
| --- | --- | --- | --- | --- | --- | --- |
| iPhone SE | 320 × 568 | 8.0 s | – | 0 | 0 | 0 |
| iPhone 15 Pro Max | 430 × 739 | 7.8 s | 16.1 s | 0 | 0 | 0 |
| Pixel 7 | 412 × 839 | 8.0 s | – | 0 | 0 | 0 |
| Galaxy S8 | 360 × 740 | 8.0 s | 15.1 s | 0 | 0 | 0 |
| iPad Mini (portrait) | 768 × 1024 | 7.9 s | 15.1 s | 0 | – | 0 |
| iPad Pro 11 (landscape) | 1194 × 834 | 8.0 s | – | 0 | – | 0 |
| Laptop | 1366 × 768 | 8.0 s | – | 0 | – | 0 |
| Desktop | 1920 × 1080 | 7.9 s | 15.3 s | 0 | – | 0 |

Load times are from the test container with software WebGL; real devices
will differ.

### Automated tests added

- `src/lib/dental/dental.test.ts`: contrast presets, tooth-chart edits, CSV
  quoting, report HTML escaping.
- `src/workers/volume/assemble/onevolume.test.ts`: OneVolume calibration,
  monotonic over the full raw range, no wrap-around.
- `src/lib/import/adapters/dicom/extensionless.test.ts`: Sidexis-style
  extensionless slices are detected and `DICOMDIR` is skipped.
- `src/lib/import/scanPackage.test.ts`: package round trip through zip and
  the importer, both levels in one package, automatic level choice, reading
  only the requested level, byte-shuffle, validation, anonymous names.
- `src/lib/import/zipIndex.test.ts`: random-access zip reading.
- `tests/e2e/dental-viewer.spec.ts`:
  - export a `.cbct.zip`, reopen it with *Open ZIP file*, switch levels;
  - a phone opens the phone level of a two-level package and loads full
    resolution on request;
  - desktop measure + chart + slice paging;
  - phone views and sheets;
  - voxel geometry: 3.1 mm across half the synthetic sample, probe reads
    1800 inside the sphere and −800 outside, position in mm.

Run them with:

```bash
npm test          # unit tests
npm run lint
npm run build
npm run test:e2e  # builds the synthetic sample and runs Playwright
```

`src/lib/segmentation/fdiNumbering.test.ts` ("preserves an interior FDI gap
when a tooth is missing") already failed before this work and still does. It
is unrelated to the viewer.

The two e2e screenshot baselines were regenerated in a container with a
different Chromium build from the one CI installs. If CI reports small pixel
differences, refresh them with `npm run test:e2e:update`.

## Known limitations

- **The scan edge looks like clipping in 3D.** On small fields of view (the
  40 mm OneVolume example) the scanned cylinder ends partway through the
  crowns: slice 1 of 340 still contains enamel. The flat edge reads as
  clipping when the volume is rotated.
- **Phone uploads.** Android folder picking is unverified, and iOS folder
  picking needs 18.4+. *Open ZIP file* works on both.
- **Not tested on real browsers.** Safari/WebKit and physical devices are
  untested.
- **Translations.** New dental strings exist in English only; Ukrainian falls
  back to English.
- **Calibration is inferred.** The OneVolume value calibration is inferred
  from the header and the vendor's saved window, not from vendor
  documentation.
- **Not yet available:** nerve-canal tracing and implant overlays (both in
  the One Volume Viewer) are not implemented.
- **Vendor ZIP memory.** A zipped vendor export is unpacked entirely in
  memory, viewer software included. Use folder import, or a desktop, for
  large discs.
- **Very large packages.** Scan packages use classic ZIP, so each file must
  be under 4 GB (a 512³ scan is 268 MB uncompressed). Larger volumes would
  need ZIP64 support in `zipIndex.ts`.
- **What packages leave out.** Packages hold the volume only, without
  measurements or the tooth chart. The default name keeps the scan date.

## How to repeat the checks

These manual checks complement the automated tests. They need the real
exports, which contain patient data and must stay outside the repository.

1. **Voxel values.**
   1. Load a scan in the dev build.
   2. From the browser console, read a few thousand random voxels from the
      loaded volume. A temporary `window.__vol = app.volume` in
      `ViewerPage` is enough; remove it afterwards.
   3. Recompute the same voxels from the vendor files in a separate script:
      - **OneVolume:** `round(raw / 1000 × tfSystemV2HuSlope +
        tfSystemV2HuIntercept)`. The raw layout is z fastest, then y, then
        x, after the crop offset. Use JavaScript's half-up rounding.
      - **DICOM:** `raw × RescaleSlope + RescaleIntercept`, with slices
        ordered by ImagePositionPatient z. Find the pixel data through the
        `(7FE0,0010)` element; Sidexis files carry data after it.
2. **Measurements.**
   1. Click at known fractions of a slice (for example 25% → 75% of the
      width).
   2. Compare with `Δfraction × (voxels − 1) × spacing`.
3. **Packages.**
   1. Export from a whole-export import.
   2. Decode `volume.i16` / `volume-half.i16`: un-shuffle, i.e. the low
      bytes come first.
   3. Compare with step 1 (full level) and with 2×2×2 averages of it
      (phone level).
   4. Confirm the manifest contains no patient name, ID or folder name.
4. **Devices.** Run Playwright with device descriptors (`iPhone SE`,
   `iPhone 15 Pro Max`, `Pixel 7`, `Galaxy S8`, `iPad Mini`,
   `iPad Pro 11 landscape`, plus 1366 × 768 and 1920 × 1080). Check:
   - load time and page errors;
   - horizontal overflow (`scrollWidth − innerWidth`);
   - phone controls smaller than 32 px.

   iOS profiles need an iOS ≥ 18.4 user agent for folder picking.
5. **Bytes read on phones.** Wrap `Blob.prototype.arrayBuffer` in an init
   script to sum the sizes read while opening a package. A phone profile
   should read only the phone level.

## History of this work

| Step | What was added |
| --- | --- |
| Dentist viewer | Desktop toolbar, 2×2 / axial-focus / 3D layouts, slice sliders and wheel paging, persistent measurements, tooth chart, case report, PNG export, keyboard shortcuts; phone view tabs, bottom bar and sheets; scan-relative contrast presets; OneVolume value fix (no more speckle in enamel); panoramic page layout fix |
| 3D and phone polish | 3D presets frame the whole volume upright and fit portrait screens; fainter crosshair planes; phone sheets cover the bottom bar and swipe down to close |
| Sidexis and validation | Extensionless DICOM (DICOMDIR discs); voxel, measurement and device validation; tablets start with the side panel hidden; softer Bone preset |
| Scan packages | *Open ZIP file*; `.cbct.zip` export with byte-shuffled voxels; anonymous default names |
| Phone level | Full + phone level in one package; random-access zip reading so phones read only their level; Full/Phone switch in the viewer |

## Where the code lives

| Area | Files |
| --- | --- |
| Toolbar, phone chrome, panels | `src/components/dental/*` |
| Presets, tooth chart, report, snapshots | `src/lib/dental/*` |
| Page wiring, shortcuts, report/PNG | `src/pages/ViewerPage.tsx` |
| Layouts, maximize, slice slider | `src/viewer/react/AxisViewportGrid.tsx` |
| Persistent measurements, controlled tools | `src/viewer/react/MeasurementOverlay.tsx`, `SliceCanvas.tsx` |
| Wheel paging | `src/viewer/react/useSliceInteraction.ts` |
| Slice stepping, preset application | `src/viewer/useVolumeViewerState.ts`, `src/app/useViewerApp.ts` |
| 3D framing | `src/lib/volume/three-preview/index.ts`, `cursor-planes.ts` |
| OneVolume calibration | `src/workers/volume/assemble/onevolume.ts` |
| Extensionless DICOM | `src/lib/import/adapters/dicom/reader.ts`, `src/lib/import/load-volume.ts` |
| Scan package format, import, export | `src/lib/import/scanPackage.ts`, `scanPackageZip.ts`, `zipIndex.ts`, `src/lib/import/adapters/package/`, `src/components/dental/ExportPackageDialog.tsx`, `PackageLevelSwitch.tsx` |
| Panoramic layout | `src/pages/PanoramicPage.tsx`, `src/components/ArchEditor.tsx` |
