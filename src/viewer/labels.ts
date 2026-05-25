import { VolumeAxis } from '../types';

/**
 * All user-facing strings for the viewer components are injected as props so
 * the components carry no i18n dependency. Each label set ships an English
 * default; consumers can spread a default and override individual fields, or
 * map their own i18n framework onto the shape.
 */

export interface AxisViewportLabels {
  selectAxisView: string;
  options: { coronal: string; sagittal: string; axial: string };
  coronal: { label: string; orientation: string };
  sagittal: { label: string; orientation: string };
  axial: { label: string; orientation: string };
  noVolume: string;
  /** Slice-position readout, e.g. `Y 128/256`. */
  status: (axis: VolumeAxis, current: number, total: number) => string;
}

export const defaultAxisViewportLabels: AxisViewportLabels = {
  selectAxisView: 'Select axis view',
  options: { coronal: 'Coronal', sagittal: 'Sagittal', axial: 'Axial' },
  coronal: { label: 'Coronal', orientation: 'Frontal · superior at top' },
  sagittal: { label: 'Sagittal', orientation: 'Lateral · superior at top' },
  axial: { label: 'Axial', orientation: 'Occlusal' },
  noVolume: 'No volume',
  status: (axis, current, total) => {
    const letter =
      axis === VolumeAxis.Coronal ? 'Y' : axis === VolumeAxis.Sagittal ? 'X' : 'Z';
    return `${letter} ${current}/${total}`;
  },
};

interface ToggleLabels {
  hideShort: string;
  showShort: string;
  hideLong: string;
  showLong: string;
}

export interface VolumeViewport3DLabels {
  render: string;
  snapshot: string;
  resetView: string;
  threshold: string;
  opacity: string;
  colormap: string;
  grid: string;
  previewError: string;
  presets: { default: string; bone: string; soft: string; xray: string };
  colormaps: { grayscale: string; bone: string; hot: string; viridis: string };
  axisViews: ToggleLabels;
  sidebar: ToggleLabels;
  planes: ToggleLabels;
}

export const defaultVolumeViewport3DLabels: VolumeViewport3DLabels = {
  render: 'Render',
  snapshot: 'PNG',
  resetView: 'Reset view',
  threshold: 'Threshold',
  opacity: 'Opacity',
  colormap: 'Colormap',
  grid: 'Reference grid',
  previewError: '3D preview failed',
  presets: {
    default: 'Default',
    bone: 'Bone surface',
    soft: 'Soft tissue',
    xray: 'X-ray',
  },
  colormaps: {
    grayscale: 'Grayscale',
    bone: 'Bone',
    hot: 'Hot',
    viridis: 'Viridis',
  },
  axisViews: {
    hideShort: 'Hide axes',
    showShort: 'Show axis',
    hideLong: 'Hide axis views',
    showLong: 'Show axis views',
  },
  sidebar: {
    hideShort: 'Hide panel',
    showShort: 'Show panel',
    hideLong: 'Hide sidebar',
    showLong: 'Show sidebar',
  },
  planes: {
    hideShort: 'Planes off',
    showShort: 'Planes on',
    hideLong: 'Hide planes',
    showLong: 'Show planes',
  },
};

export interface MeasurementLabels {
  measureDistance: string;
  measureAngle: string;
  clear: string;
  savePng: string;
}

export const defaultMeasurementLabels: MeasurementLabels = {
  measureDistance: 'Measure distance (reference only)',
  measureAngle: 'Measure angle (reference only)',
  clear: 'Clear measurement',
  savePng: 'Save slice as PNG',
};
