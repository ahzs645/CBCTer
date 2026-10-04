import type { ImportFormatAdapter } from '../types';
import { dicomFormatAdapter } from './dicom';
import { galileosFormatAdapter } from './galileos';
import { oneVolumeFormatAdapter } from './onevolume';
import { scanPackageFormatAdapter } from './package';

export const importFormatAdapters: ImportFormatAdapter[] = [
  // First: a package folder is unambiguous and needs no vendor parsing.
  scanPackageFormatAdapter,
  galileosFormatAdapter,
  dicomFormatAdapter,
  oneVolumeFormatAdapter,
];

export {
  dicomFormatAdapter,
  galileosFormatAdapter,
  oneVolumeFormatAdapter,
  scanPackageFormatAdapter,
};
