# Viewer Controls

Core controls:

- Load a sample, folder, NIfTI file, ZIP, or remote URL from the import page.
- Scroll or pinch on a slice to zoom MPR views.
- Drag a slice with the crosshair tool to move the shared cursor.
- Select the window-level tool and drag on a slice:
  - horizontal drag changes level.
  - vertical drag changes window.
- Use mask tools to draw, erase, threshold, grow, split, and create surfaces.

Mask brush strokes interpolate between pointer samples so fast strokes leave
continuous edits. Brush size is spacing-aware and is expressed in millimeters.

Future VolView-inspired viewer work:

- persistent editable annotations.
- crop bounds and clipping planes.
- labelmap-style segment groups.
- layout presets and maximized view slots.
- richer scalar probe and metadata overlays.
