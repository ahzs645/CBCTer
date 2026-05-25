/**
 * Visual theme for the viewer components. Only covers the semantically
 * meaningful, data-driven colors (the per-plane colors that drive crosshairs
 * and axis badges). The surrounding chrome is styled with Tailwind utility
 * classes in the components themselves.
 */
export interface ViewerTheme {
  /** Color per anatomical plane, used for axis labels, badges, crosshairs. */
  planeColors: {
    axial: string;
    coronal: string;
    sagittal: string;
  };
  /** Fallback crosshair color when a pane does not specify per-axis colors. */
  crosshairColor: string;
}

export const defaultViewerTheme: ViewerTheme = {
  planeColors: {
    axial: '#38bdf8',
    coronal: '#f59e0b',
    sagittal: '#a78bfa',
  },
  crosshairColor: '#7dd3fc',
};
