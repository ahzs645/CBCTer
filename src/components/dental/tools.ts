import {
  Circle,
  Contrast,
  Crosshair,
  Pentagon,
  Ruler,
  Triangle,
  type LucideIcon,
} from 'lucide-react';
import type { StudyTool } from '../../domain/types';
import type { MeasureMode } from '../../viewer';

export interface DentalToolDefinition {
  tool: StudyTool;
  icon: LucideIcon;
  /** i18n key under `dental.toolbar`. */
  labelKey: string;
  shortcut: string;
}

export const DENTAL_TOOLS: DentalToolDefinition[] = [
  { tool: 'crosshair', icon: Crosshair, labelKey: 'navigate', shortcut: 'N' },
  { tool: 'window-level', icon: Contrast, labelKey: 'contrast', shortcut: 'W' },
  { tool: 'measure-distance', icon: Ruler, labelKey: 'distance', shortcut: 'D' },
  { tool: 'measure-angle', icon: Triangle, labelKey: 'angle', shortcut: 'A' },
  { tool: 'measure-ellipse', icon: Circle, labelKey: 'area', shortcut: 'E' },
  { tool: 'measure-polygon', icon: Pentagon, labelKey: 'polygon', shortcut: 'P' },
];

export const MEASURE_TOOLS = DENTAL_TOOLS.filter((item) =>
  item.tool.startsWith('measure-'),
);

export function measureModeForTool(tool: StudyTool): MeasureMode {
  switch (tool) {
    case 'measure-distance':
      return 'distance';
    case 'measure-angle':
      return 'angle';
    case 'measure-ellipse':
      return 'ellipse';
    case 'measure-polygon':
      return 'polygon';
    default:
      return 'off';
  }
}

export type DentalLayout = 'quad' | 'focus' | '3d';
