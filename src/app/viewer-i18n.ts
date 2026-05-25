import { useMemo } from 'react';
import { PLANE_COLORS } from '../constants';
import { useTranslation } from '../i18n';
import { VolumeAxis } from '../types';
import type {
  AxisViewportLabels,
  ViewerTheme,
  VolumeViewport3DLabels,
} from '../viewer';

/**
 * Example glue: maps the app's i18next catalog and plane-color constants onto
 * the viewer module's prop contracts. The viewer components stay framework- and
 * locale-agnostic; this hook is how *this* app injects its own i18n + theme.
 */

export const appViewerTheme: ViewerTheme = {
  planeColors: {
    axial: PLANE_COLORS.axial,
    coronal: PLANE_COLORS.coronal,
    sagittal: PLANE_COLORS.sagittal,
  },
  crosshairColor: '#7dd3fc',
};

export function useAxisViewportLabels(): AxisViewportLabels {
  const { t } = useTranslation();
  return useMemo<AxisViewportLabels>(
    () => ({
      selectAxisView: t('axisViewport.selectAxisView'),
      options: {
        coronal: t('axisViewport.options.coronal'),
        sagittal: t('axisViewport.options.sagittal'),
        axial: t('axisViewport.options.axial'),
      },
      coronal: {
        label: t('axisViewport.coronal.label'),
        orientation: t('axisViewport.coronal.orientation'),
      },
      sagittal: {
        label: t('axisViewport.sagittal.label'),
        orientation: t('axisViewport.sagittal.orientation'),
      },
      axial: {
        label: t('axisViewport.axial.label'),
        orientation: t('axisViewport.axial.orientation'),
      },
      noVolume: t('axisViewport.noVolume'),
      status: (axis, current, total) => {
        const key =
          axis === VolumeAxis.Coronal
            ? 'axisViewport.coronal.status'
            : axis === VolumeAxis.Sagittal
              ? 'axisViewport.sagittal.status'
              : 'axisViewport.axial.status';
        return t(key, { current, total });
      },
    }),
    [t],
  );
}

export function useVolumeViewport3DLabels(): VolumeViewport3DLabels {
  const { t } = useTranslation();
  return useMemo<VolumeViewport3DLabels>(
    () => ({
      render: t('volumeViewport3d.render'),
      snapshot: t('volumeViewport3d.snapshot'),
      resetView: t('volumeViewport3d.resetView'),
      threshold: t('volumeViewport3d.threshold'),
      opacity: t('volumeViewport3d.opacity'),
      colormap: t('volumeViewport3d.colormap'),
      grid: t('volumeViewport3d.grid'),
      previewError: t('volumeViewport3d.previewError'),
      presets: {
        default: t('volumeViewport3d.presets.default'),
        bone: t('volumeViewport3d.presets.bone'),
        soft: t('volumeViewport3d.presets.soft'),
        xray: t('volumeViewport3d.presets.xray'),
      },
      colormaps: {
        grayscale: t('volumeViewport3d.colormaps.grayscale'),
        bone: t('volumeViewport3d.colormaps.bone'),
        hot: t('volumeViewport3d.colormaps.hot'),
        viridis: t('volumeViewport3d.colormaps.viridis'),
      },
      axisViews: {
        hideShort: t('volumeViewport3d.hideAxisViewsShort'),
        showShort: t('volumeViewport3d.showAxisViewsShort'),
        hideLong: t('volumeViewport3d.hideAxisViewsLong'),
        showLong: t('volumeViewport3d.showAxisViewsLong'),
      },
      sidebar: {
        hideShort: t('volumeViewport3d.hideSidebarShort'),
        showShort: t('volumeViewport3d.showSidebarShort'),
        hideLong: t('volumeViewport3d.hideSidebarLong'),
        showLong: t('volumeViewport3d.showSidebarLong'),
      },
      planes: {
        hideShort: t('volumeViewport3d.hidePlanesShort'),
        showShort: t('volumeViewport3d.showPlanesShort'),
        hideLong: t('volumeViewport3d.hidePlanesLong'),
        showLong: t('volumeViewport3d.showPlanesLong'),
      },
    }),
    [t],
  );
}
