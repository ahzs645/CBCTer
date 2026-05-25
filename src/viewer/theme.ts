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
}

export const defaultViewerTheme: ViewerTheme = {
  planeColors: {
    axial: '#38bdf8',
    coronal: '#f59e0b',
    sagittal: '#a78bfa',
  },
};
