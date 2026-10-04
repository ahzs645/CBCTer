# Viewer Controls

The viewer is laid out for a dental CBCT read, modelled on the vendor viewers
that ship on export discs (J. Morita i-Dixel One Volume Viewer, Sirona
Sidexis 4 viewer): an XYZ view of axial / coronal / sagittal slices plus 3D,
contrast presets, measurements, a tooth chart and a printable case report.
Everything is reference-only; it is not a diagnostic device.

## Desktop (≥ 768 px wide)

- **Toolbar** (top): Navigate, Contrast (window/level drag), Distance,
  Angle, Area + density (ellipse ROI with mean value), Polygon area; contrast
  preset menu; Invert; zoom; layout; Panoramic, Tooth extraction, Save views
  (PNG), Case report, keyboard help, and the side-panel toggle.
- **Layouts**: *MPR + 3D* (2×2: axial | 3D over coronal | sagittal),
  *Axial focus* (large axial with coronal and sagittal stacked) and *3D only*.
  Any pane can be maximized from its header button or with `F`.
- **Slices**: the mouse wheel pages slices (one per notch; trackpads scroll
  smoothly), Ctrl/⌘ + wheel or pinch zooms, and each pane has a slider with
  previous/next buttons. Click or drag on a slice to move the crosshair.
- **Status bar** (bottom): crosshair position in mm, slice indices, hovered
  voxel value, window/level, zoom and a hint for the active tool.
- **Side panel**: the *Chart* tab (tooth chart, default) and *Measures* tab
  sit next to the existing study, mask, surface and export tools. Below
  1100 px wide (tablets in portrait) it starts hidden; open it from the
  toolbar.

### Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `N` / `Esc` | Navigate tool |
| `W` | Contrast (window/level) tool |
| `D` `A` `E` `P` | Distance, Angle, Area + density, Polygon area |
| `I` | Invert grayscale |
| `1`–`6` | Contrast presets (Scan default, Auto, Bone, Teeth, Soft tissue, Metal) |
| `↑` / `↓`, `PgUp` / `PgDn` | Previous / next slice of the active pane (`Shift` or page keys = 10) |
| `+` `−` `0` | Zoom in / out / reset |
| `F` | Maximize the active pane |
| `S` | Save views as PNG |
| `?` | Show the shortcut list |

## Phone (< 768 px wide)

- View tabs at the top switch between Axial, Coronal, Sagittal and 3D; the
  selected view fills the screen with a large slice slider underneath.
- The bottom dock has 44 px+ targets: **Navigate**, **Measure** (tool picker
  and measurement list), **Contrast** (presets, invert, window/level drag and
  sliders), **Chart** (tooth chart) and **More** (case report, PNG, panoramic,
  tooth extraction, the full study panel, open folder, close scan).
- Sheets slide up over the bottom dock; close them by tapping above the
  sheet, swiping the handle down, or ✕.
- While a measuring or contrast tool is active a pill shows the tool with an
  **OK** button that returns to navigation. Pinch zooms.

## Contrast presets

CBCT gray values are only loosely HU-calibrated and differ per machine, so
the presets are scan-relative: each one maps a fraction of the scan's own
intensity span (2nd–99.9th percentile of the non-padding voxels) onto the
display. *Scan default* is the window the importer derived for the scan.

## Measurements

Distance, angle, ellipse and polygon measurements are stored with the plane
and slice they were drawn on and stay drawn on that slice. The list (side
panel *Measures* tab, or the phone *Measure* sheet) supports go-to-slice,
rename, show/hide, delete, delete all and CSV export. Ellipse and polygon
ROIs also record the mean voxel value inside the ROI.

## Tooth chart

An FDI odontogram (permanent or primary dentition, patient right on the
viewer's left). For each tooth record findings (caries, periapical lesion,
root canal treated, restoration/crown, implant, missing, impacted, bone loss,
fracture, resorption, other) and a note, and pin the current crosshair
position. Pinned teeth show as markers on the slices that pass through them
and *Go to tooth* jumps back. Case notes are free text. The chart and notes
are saved in project archives and can be exported as CSV.

## Case report

*Case report* opens a printable page (use the browser's *Save as PDF*) with
the scan details, axial / coronal / sagittal snapshots at the crosshair
(current contrast, invert, overlays and measurements, with a scale bar), the
measurement table, the tooth chart findings and the case notes. If the
browser blocks the new tab, the report is downloaded as an HTML file.

## Masks and segmentation

- Load a sample, folder, NIfTI file, ZIP, or remote URL from the import page.
- Use mask tools to draw, erase, threshold, grow, split, and create surfaces.

Mask brush strokes interpolate between pointer samples so fast strokes leave
continuous edits. Brush size is spacing-aware and is expressed in millimeters.

Future VolView-inspired viewer work:

- crop bounds and clipping planes.
- labelmap-style segment groups.
- richer scalar probe and metadata overlays.
