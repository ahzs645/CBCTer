# Interface review: sharing, tooth isolation and retainer models

October 2026. A full walk through the viewer with a real case, followed by
changes to make it smoother, harder to crash and consistent between screens.
Four design reviews (structure, tooth review, sharing and loading, phone and
design system) and a competitor survey fed into it.

The test case was a Sirona XG3D scan exported as a complete `.cbct.zip`: 512 × 512 × 511
voxels at 0.16 mm, with 28 ToothSeg GPU tooth proposals. It stays outside the
repository. Timings come from headless Chromium with software WebGL in a
container, so real devices will be faster for 3D.

## What the walkthrough found

| Area | Finding | Status |
| --- | --- | --- |
| Two viewers | The streamed viewer, which phones and anyone opening a shared case see, had its own header, raw dropdowns and no tooth chart. The full viewer looked completely different. "Load full volume for advanced tools" and "Review and export case" did the same thing. | **Fixed.** The streamed viewer now uses the same toolbar, status bar, phone dock and sheets as the full viewer. |
| Phone | Controls took about 55% of the screen in the streamed viewer, leaving the image about 40%. | **Fixed.** Phones now show view tabs, the image and the bottom dock (Navigate, Measure, Contrast, Teeth, More). |
| Phones cannot load the full case | The 512³ case is over the phone memory budget, so phones only ever get the streamed viewer. | Kept as a guard. The streamed viewer now does what phones need: tooth picking, isolation, 3D and export. |
| Tooth isolation froze the page | "Show selected tooth" looped over 134 M voxels with a new array per voxel: the main thread was blocked for **17 s**. | **Fixed.** Isolation crops to the chosen teeth (for example 199 × 98 × 180 voxels for 33–43), so it builds in well under a second. Rebuilding the 3D view takes about 2.4 s in the container's software WebGL. |
| Isolated tooth was a speck in 3D | The camera stayed framed on the whole 82 mm volume. | **Fixed.** The cropped volume frames the teeth at full resolution. |
| Only one tooth at a time | No way to isolate canine to canine, an arch or several teeth. | **Fixed.** Arch grid with multi-select, plus groups: 13–23, 33–43, upper arch, lower arch, all teeth. |
| Tooth picking | Teeth were only in a `<select>` ("FDI 33 · unreviewed · 134669 voxels"). Setup tools came before the tooth list. | **Fixed.** An FDI arch grid shows the review state. Review gets **Accept & next**, previous/next, and a progress bar. Setup tools moved to "Add or propose outlines". |
| Left/right numbering | In this case "33" (lower *left* canine) sits on the patient's *right* according to the scan's stated axes. All quadrants are mirrored. | **Detected.** A banner offers "Swap left and right numbers": stored in the full editor, view-only in the streamed viewer. Confirm against a tooth you know. |
| One tooth split in two | "41" and "42" occupy the same space; their voxel counts add up to about one incisor. Only five lower front teeth were segmented. | **Detected.** A warning names the pair; merge them in Review teeth. The missing sixth incisor may be a real extraction or a missed tooth. |
| Tooth outlines arrive late | On first open, outlines appear about 4 s after the slices: the 64 MB chunk cache thrashes across three planes plus labels. | Status now reads "Loading tooth outlines…". The cache size is unchanged. |
| Blank page on any error | There was no React error boundary anywhere. | **Fixed.** Page-level and route-level boundaries offer Try again / Reload / Close scan. Inline boundaries around the 3D view and side panels keep the slices usable. A stale chunk after a redeploy reloads once. |
| Import page | No drag-and-drop. "Load sample CBCT" was the primary button although Pages ships no sample. Errors said "Could not open this folder" for a zip. There was no way to cancel a load. | **Fixed.** Drag-and-drop anywhere, Open ZIP is primary, the sample button appears only when a sample exists, wording reads "this scan", and a Cancel button is added. |
| Contrast | The streamed viewer opened at window 4096 (washed out) with the preset reading "Custom". | **Fixed.** It opens on *Auto* unless the case saved a view. Keys 1–6 work in both viewers. |
| Spacing | Showed `0.16000000000000014 mm`. | **Fixed** with the shared formatter. |
| Sharing | "Open URL" streamed `.cbct.zip` files, but there was no link to share, and hosts that hide `Content-Range` failed. | **Fixed.** See below. |

## Sharing a case

* **Share link:** `https://<site>/#url=<encoded .cbct.zip URL>&tooth=33` opens
  the package straight into the viewer and selects the tooth. The hash never
  reaches the web server. `?url=` also works. Only `https://` package URLs are
  accepted.
* **Copy share link** appears in the side panel (desktop) or More (phone) when
  the scan came from a URL. A read-only field holds the link in case the
  clipboard is blocked.
* **Hosts that work** must allow cross-site reads and range requests:
  * Hugging Face `/resolve/` URLs (`Content-Range` exposed, verified).
  * `raw.githubusercontent.com` (hides `Content-Range`; files under 100 MB, verified).
  * Any S3 / R2 / GCS bucket with a CORS rule allowing GET with `Range`.

  The reader now works out the file size from the ZIP's end record when a host
  hides `Content-Range`. A local server set up the same way opened the 185 MB
  case after reading 24.8 MB.
* **Hosts that cannot work:** Google Drive, Dropbox, OneDrive, iCloud and
  WeTransfer. Drive's direct-download host returns CORS headers to curl, but
  answers real browser requests with **403** because browsers send
  `Sec-Fetch-Site: cross-site`, which pages cannot change. Pasting such a link
  now explains this instead of failing with "Failed to fetch". The recipient
  downloads the file and drops it on the page.
* **Privacy:** anyone with a share link can download the scan. The default
  package name contains the scan date and time; rename before sharing. Teeth
  and faces are identifying in themselves.

## Isolating teeth

1. Open the **Teeth** panel: the side panel on desktop, the Teeth button in the
   phone dock, or **Review teeth** in the full editor.
2. Tap a tooth in the arch grid or click it in a slice. Ctrl/⌘-click, or tick
   "Select several", to add more. The group chips select canine to canine
   (13–23, 33–43) or a whole arch.
3. **Show → Only selected** limits the slices to those teeth and builds a
   full-resolution 3D view of just them. **Show surrounding bone** keeps the
   bone around them in the crop. **Hide teeth** shows bone only.
4. Keyboard: `[` / `]` previous/next tooth, plus the viewer shortcuts.

## Retainer models and the gumline

**What CBCT can and cannot do:**

- **Gums:** CBCT barely shows gums. The lips and cheeks press on the gingiva,
  so there is no air edge to outline. Studies could only measure gingiva on
  scans taken with a lip retractor or cotton rolls. The best AI result on such
  scans (Dice ≈ 80%) is well below tooth segmentation (92–96%).
- **Crowns:** CBCT-derived crowns are typically 0.07–0.24 mm off in vitro at
  0.15 mm voxels, against about 0.02–0.05 mm for an intraoral scan. Incisal
  edges, contacts and undercuts are blunted.

**What the export does:** Teeth panel → **Export model (STL)** writes a ZIP for
the selected teeth.

**What it contains:**

- **Per-tooth and combined STL:** one STL per tooth plus one combined STL, in
  millimetres in the scan frame, so the teeth keep their arch positions.
- **README:** states how the model was made and what it cannot be trusted for.

**Shape options:**

- **Crowns above gumline:** the gumline is *estimated*, not seen.
  - Walking from the crown tip toward the root, the bone crest is the first
    level where most of a thin ring around the tooth is bone-dense for 2 mm.
    The threshold comes from Otsu thresholding of that ring.
  - The gingival margin is placed a set distance crownward of the crest:
    2 mm by default, adjustable 0–4 mm.
  - On this case the six lower front crowns came out 7.5–9.3 mm high. Tooth
    42's crown is 4 mm because its outline is the split fragment.
- **Whole teeth:** crowns and roots.

**Caveats for a retainer:**

- **Scan with teeth closed:** this case was taken with the teeth together, so
  the biting surfaces of the upper and lower teeth fuse where they touch.
- **Bonded retainer wire:** an existing bonded retainer causes streaks on the
  lingual surfaces, exactly where a bonded 3–3 wire sits.
- **Tooth movement:** teeth move after the scan date.
- **Retainer type:** an Essix retainer from such a model is a plausible
  stopgap. A bonded wire needs a more exact lingual contour than CBCT gives.
- **Bottom line:** take the model to your orthodontist or lab as a reference.
  A fresh intraoral scan or impression remains the right basis for a
  replacement. If a bonded retainer breaks, see them quickly: teeth start to
  relapse within days to weeks.

## Second round: the roadmap items, built and tested

Every item below was run in the browser against the same Sirona case. The
streamed viewer (what phones and shared links get) has all of them; the full
editor has focus, split detection and merge, export and the report QR code.

### Focus on one tooth and the dark-area check

**Focus on this tooth** opens three views of the selected tooth, resampled
along its own long axis:
- two long-axis slices, like a periapical film;
- a cross-section that moves from crown to root.

Controls:
- sliders to turn around the tooth, shift the slice depth, and set contrast;
- the tooth's length;
- an automatic **dark-area check**.

How the check works:
- It builds an envelope of the tooth outline, with about 1.5 mm closing
  so cavities that open onto the surface still count as inside.
- It looks for regions below 60% of the tooth's dentine density.
- **Pulp-like:** long along the tooth, or enclosed at least 0.6 mm inside.
- **Focal:** compact, reaching the surface, at least 3 mm³ and below 42%
  of dentine density.
- **Minor:** small specks in the biting fifth of the tooth, which are
  fissures or bite gaps.

**Look for dark areas in every tooth** runs the check over the whole arch:
28 teeth in about 40 s with software rendering.

On this case only the tooth labelled 23 is flagged:
- a 17.7 mm³ dark area at the neck of the tooth, about 3 × 3 × 5 mm;
- it reaches within 0.3 mm of the labial surface;
- it is 34% of dentine density;
- this tooth also has no visible pulp canal;
- with the mirrored numbering, this is probably the patient's upper *right*
  canine.

Every other tooth shows a normal pulp. Tooth lengths, measured along each
tooth's axis, are average or longer, so there is no sign of apical root
shortening.

A compact cervical radiolucency can be external cervical resorption (linked
to orthodontic treatment), cervical caries, a radiolucent filling or an
artifact. This is not a diagnosis; it needs a dentist and a periapical
radiograph.

### Teeth the model cut in two

Two outlines that share a large surface are one tooth. Neighbouring teeth
only touch at contact points.

On this case:
- 41 + 42 share 69 mm², the two upper premolar crown/root pairs 14 + 15
  share 53 mm² and 24 + 25 share 73 mm²;
- real contacts are at most 4 mm².

So there is one upper premolar per side, consistent with orthodontic
premolar extraction, which the patient can confirm. Phones offer **Treat as
one**, which applies to the view, isolation, 3D and STL export. The full
editor offers **Merge**, which is saved.

### Printable arch model

**Printable model on a base** adds `arch-model.stl` to the export:
- the crowns above the estimated gumline;
- a horseshoe base 5–15 mm high with a flat bottom, joined into one closed,
  outward-facing piece.

The lower 33–43 model was 648k triangles, 31.7 × 13.3 × 18.1 mm, with every
edge shared by exactly two triangles and one shell.

The mesher used for exports produced inconsistently wound triangles. All
exported STLs are now re-oriented, and decimation is off because it opened
holes.

### Splitting upper from lower (bite check)

Every export reports which upper and lower teeth lie within 1 mm of each
other. In this scan the closest pair is 2.1 mm apart (a bite block was
probably used), so biting edges are not fused and no occlusion split is
needed. When teeth do touch, the per-tooth labels already keep upper and
lower crowns apart. The README then warns that those edges may be merged or
clipped.

### Structure layer list

**Layers** in the Teeth panel:
- shows or hides each tooth outline;
- sets its colour;
- sets one opacity (0–200%) for all outlines.

### Nerve canal tracing

**Nerve canal → Trace right / left**, then click both ends of the canal on
any slice. The app:
1. snaps each click to the centre of the nearby dark tube;
2. follows the canal between them along a least-cost path that prefers dark
   voxels wrapped in bone;
3. draws it on every slice;
4. lists how close the lower teeth come to it (surface to canal wall,
   assuming a 2.5 mm canal).

In this scan the canal is visible at the back of the mandible on both sides
and runs out of the 82 mm field of view behind. Tracing took about 5 s per
side. The lower first molars are the closest teeth, about 6.6–6.8 mm away.

This is not for implant or surgical planning.

### QR code on the case report

The case report (desktop toolbar, or More on phones) prints a QR code and
the link when the scan was opened from a share link.

The encoder is built in and needs no dependencies:
- byte mode, ECC M, versions 1–40;
- 173 test codes decoded exactly with OpenCV;
- bit-identical to the `segno` reference encoder.

On phones the report includes the dark-area findings.

### Smaller controls and the phone 3D view

Buttons in the review and teeth panels are now 32 px (36 px on touch
screens) with 12 px text. The 3D controls sit at the top of the 3D pane in
the streamed viewer instead of 56 px down.

## What other tools offer (survey summary)

The tools surveyed:

- Diagnocat, Relu, CephX/ORCA, Planmeca Romexis
- Dentsply Sirona Sidexis 4 / DS Core, Carestream CS 3D, Morita i-Dixel
- Invivo, OnDemand3D, Blue Sky Plan, 3Shape, exocad, coDiagnostiX, Dolphin
- Pearl, and 3D Slicer with DentalSegmentator and SlicerAutomatedDentalTools

Prioritised gaps for CBCTer:

1. **Per-tooth / per-arch STL ZIP:** done in this change (crown-only or whole).
2. **Printable arch model:** join the selected crowns, close the mesh and add a
   base, for thermoforming (Relu "retainer models").
3. **Occlusion split:** separate upper from lower where closed-bite contacts
   fuse, and warn when the scan was taken closed.
4. **Scan-fitness report:** voxel size, coverage of the incisors, metal
   streaks near lingual surfaces, closed bite, with an "approximate, verify
   fit" badge.
5. **Intraoral scan import and fusion** (in progress, see below): register an STL/PLY to the CBCT and
   replace CBCT crowns with scanned ones (Romexis, Relu, CephX). This cuts
   crown error from about 0.07–0.24 mm to 0.04–0.09 mm.
6. **Structure layer panel:** visibility, opacity and colour per structure,
   with contour outlines on slices (Diagnocat).
7. **More anatomy:** maxilla, mandible, pulp, sinus and airway, using the
   open DentalSegmentator / AMASSS models.
8. **Mandibular canal tracing:** with tooth-to-canal distance.
9. **Recipient viewer link with a QR code** on the PDF report. The share link
   in this change is the first step.
10. **Per-tooth oblique slices and cross-sections along the pano curve.**
11. **Interoperability:** DICOM-SEG / NIfTI label export and anonymised DICOM
    re-export.
12. **Two-scan superimposition:** compare scans over time, for example to
    show retention relapse.

## Consistency work still open

From the four design reviews, not done in this change:

- **One mounted shell:** lift a single viewer shell into `ViewerPage`, so
  loading the full volume becomes a quiet upgrade (a "Streaming → Full
  volume" chip) instead of a screen swap.
- **Teeth as a panel tab:** dock **Review teeth** as a tab in the side panel
  rather than an overlay. Link the findings chart to tooth outlines, so the
  chart shows outlined teeth and "Go to" falls back to the outline centroid.
- **One button style:** about 20 ad-hoc button styles and 13 raw `<select>`s
  remain. Standardise on `Button` (sky primary, quiet, danger, pressed, icon
  sizes), `Select`, and design tokens in `styles.css`. Add a visible focus
  ring and a `touch:` variant instead of `touch` props.
- **Accessible sheets:** sheets now close with Escape and are `aria-modal`.
  Still missing: focus trap and return, and `aria-expanded` on dock buttons.
- **Robustness:**
  - restart a crashed decoding worker;
  - retry range reads on network errors;
  - warn before closing with unsaved edits;
  - add a recent-cases list;
  - give the service worker a versioned cache with pruning.
- **Translations:** new strings are English only (Ukrainian falls back).
