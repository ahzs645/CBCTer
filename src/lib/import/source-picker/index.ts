import type { DirectoryPickerWindow } from '../../../types';
import { createDirectoryHandlePicker } from './directory-handle-picker';
import { createDirectoryUploadPicker } from './directory-upload-picker';
import type { ScanFolderPicker } from './types';

export type { ScanFolderPicker } from './types';

const unsupportedPicker: ScanFolderPicker = {
  supported: false,
  async pickSource() {
    return null;
  },
};

export function createDefaultScanFolderPicker(): ScanFolderPicker {
  // Prefer the universal folder-upload picker (webkitdirectory): it works in
  // every modern browser without File System Access permission prompts, and
  // since import reads every file anyway the handle API's lazy reads add no
  // benefit here. Fall back to the Chromium-only directory-handle picker.
  if (typeof navigator !== 'undefined' && typeof document !== 'undefined') {
    const uploadPicker = createDirectoryUploadPicker(navigator, document);
    if (uploadPicker.supported) return uploadPicker;
  }

  if (typeof window !== 'undefined') {
    const handlePicker = createDirectoryHandlePicker(
      window as DirectoryPickerWindow,
    );
    if (handlePicker.supported) return handlePicker;
  }

  return unsupportedPicker;
}
