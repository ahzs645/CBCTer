import type { SegmentationItem } from './types';

export type ManualToothLibraryItem = SegmentationItem & {
  source: 'manual';
};

type Listener = () => void;

const items = new Map<number, ManualToothLibraryItem>();
const objectUrls = new Set<string>();
const listeners = new Set<Listener>();
let revision = 0;

function emit() {
  revision += 1;
  for (const listener of listeners) listener();
}

export function addManualToothItem(item: ManualToothLibraryItem, urls: string[]) {
  const previous = items.get(item.fdi ?? item.label);
  if (previous?.stl?.startsWith('blob:')) URL.revokeObjectURL(previous.stl);
  if (previous?.preview?.startsWith('blob:')) URL.revokeObjectURL(previous.preview);
  items.set(item.fdi ?? item.label, item);
  for (const url of urls) objectUrls.add(url);
  emit();
}

export function listManualToothItems(): ManualToothLibraryItem[] {
  return [...items.values()].sort(
    (a, b) => (a.fdi ?? a.label) - (b.fdi ?? b.label),
  );
}

export function subscribeManualToothItems(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getManualToothRevision(): number {
  return revision;
}

export function clearManualToothItems() {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls.clear();
  items.clear();
  emit();
}
