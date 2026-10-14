import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  DENTAL_SEG_VARIANTS,
  type DentalSegVariantId,
} from '../../lib/segmentation/dentalSegVariants';
import { useState } from 'react';
import type { StudyState } from '../../domain/types';
import type { ToothInstance } from '../../lib/case/types';
import { FDI_NUMBERS } from '../../lib/case/teeth';
import {
  archOrder,
  selectionIds,
  teethInGroup,
  toothLabel,
  type ToothGroupId,
} from '../../lib/case/toothSelection';
import {
  ToothArchGrid,
  ToothGroupChips,
  ToothModelExportForm,
  ToothShowControl,
  type ToothModelRequest,
} from './ToothPicker';
interface Props {
  state: StudyState;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSelect: (id: string, additive?: boolean) => void;
  onPickGroup: (group: ToothGroupId) => void;
  onSeparate: (
    source: string,
    values: number[],
    minMm3: number,
    core: number,
  ) => void;
  onChange: (id: string, changes: Partial<ToothInstance>) => void;
  onCorrect: (erase: boolean) => void;
  onNewTooth: () => void;
  onImportModel: (file: File) => void;
  onAnatomy: (variant: DentalSegVariantId) => void;
  anatomyBusy: boolean;
  onCancelAnatomy: () => void;
  onSurface: () => void;
  surfaceBusy: boolean;
  onSplit: (axis: 0 | 1 | 2) => void;
  onMerge: (id: string) => void;
  onVisibility: (
    mode: 'all' | 'selected' | 'hide-teeth',
    bone: boolean,
  ) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Most numbers sit on the wrong side of the midline. */
  mirrored: boolean;
  onSwapSides: () => void;
  overlaps: Array<[ToothInstance, ToothInstance]>;
  /** Pairs that share a large surface: one tooth the model cut in two. */
  splits?: Array<{ a: ToothInstance; b: ToothInstance; sharedMm2: number }>;
  onMergePair?: (keepId: string, mergeId: string) => void;
  onFocus?: (id: string) => void;
  exportBusy: boolean;
  exportStatus: string;
  onExportModel: (request: ToothModelRequest) => void;
}
const field =
  'min-h-8 [@media(pointer:coarse)]:min-h-9 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs';
const button =
  'inline-flex min-h-8 [@media(pointer:coarse)]:min-h-9 items-center justify-center gap-1 rounded border border-slate-600 bg-slate-800 px-2.5 py-1 text-xs hover:bg-slate-700 disabled:opacity-40';
const heading =
  'text-[11px] font-semibold uppercase tracking-wide text-slate-400';

/**
 * Review of proposed tooth outlines. The arch grid and the selected tooth's
 * actions come first; ways to add outlines (draw, import, run a model,
 * separate a mask) sit in a collapsed section below.
 */
export function ToothReviewPanel(p: Props) {
  const teeth = p.state.toothInstances ?? [],
    selected = teeth.find((t) => t.id === p.state.selectedInstanceId);
  const chosen = selectionIds(p.state);
  const live = teeth.filter((t) => t.review !== 'rejected');
  const reviewed = teeth.filter((t) => t.review !== 'unreviewed').length;
  const ordered = archOrder(live);
  const [model, setModel] = useState<DentalSegVariantId>('full');
  const [source, setSource] = useState(
      p.state.activeSegmentGroupId ?? p.state.activeMaskId ?? '',
    ),
    [values, setValues] = useState('3,4'),
    [minMm3, setMinMm3] = useState(0.5),
    [core, setCore] = useState(3),
    [axis, setAxis] = useState<0 | 1 | 2>(0),
    [merge, setMerge] = useState(''),
    [multi, setMulti] = useState(false);
  const step = (delta: number, from = selected?.id) => {
    if (!ordered.length) return;
    const index = ordered.findIndex((t) => t.id === from);
    p.onSelect(ordered[(index + delta + ordered.length) % ordered.length].id);
  };
  const acceptAndNext = () => {
    if (!selected) return;
    p.onChange(selected.id, { review: 'accepted' });
    const next = ordered
      .slice(ordered.findIndex((t) => t.id === selected.id) + 1)
      .concat(ordered)
      .find((t) => t.review === 'unreviewed' && t.id !== selected.id);
    if (next) p.onSelect(next.id);
  };
  return (
    <aside
      role="region"
      aria-label="Tooth review"
      className="absolute inset-x-0 bottom-0 z-40 max-h-[60dvh] space-y-2.5 overflow-y-auto rounded-t-2xl border border-slate-700 bg-slate-900 p-3 shadow-xl md:inset-x-auto md:bottom-8 md:right-2 md:top-14 md:max-h-none md:w-96 md:rounded-xl"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Review teeth</h2>
          {teeth.length ? (
            <p className="text-xs text-slate-400">
              {reviewed} of {teeth.length} reviewed
            </p>
          ) : null}
        </div>
        <button
          className={button}
          onClick={p.onClose}
          aria-label="Close tooth review"
        >
          Close
        </button>
      </div>
      {teeth.length ? (
        <div
          className="h-1.5 overflow-hidden rounded-full bg-slate-800"
          aria-hidden="true"
        >
          <div
            className="h-full bg-emerald-500"
            style={{ width: `${(reviewed / teeth.length) * 100}%` }}
          />
        </div>
      ) : null}
      {p.error && (
        <p className="text-sm text-rose-300" role="alert">
          {p.error}
        </p>
      )}
      {p.mirrored ? (
        <div className="rounded border border-amber-400/40 bg-amber-950/40 p-2 text-xs text-amber-100">
          Left and right numbers look swapped: most teeth sit on the opposite
          side of the midline from their number. Check a tooth you know first.
          <button className={`${button} mt-2 block`} onClick={p.onSwapSides}>
            Swap left and right numbers
          </button>
        </div>
      ) : null}
      {p.splits?.length ? (
        <div className="rounded border border-amber-400/40 bg-amber-950/30 p-2 text-xs text-amber-100">
          <p>Cut in two by the model (the parts share a large surface):</p>
          <ul className="mt-1 space-y-0.5">
            {p.splits.map(({ a, b, sharedMm2 }) => (
              <li key={`${a.id}-${b.id}`} className="flex items-center gap-2">
                <span className="flex-1">
                  {toothLabel(a)} + {toothLabel(b)} · {Math.round(sharedMm2)}{' '}
                  mm²
                </span>
                {p.onMergePair ? (
                  <button
                    type="button"
                    className="underline"
                    onClick={() =>
                      (a.fdi ?? 99) <= (b.fdi ?? 99)
                        ? p.onMergePair!(a.id, b.id)
                        : p.onMergePair!(b.id, a.id)
                    }
                  >
                    Merge
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {p.overlaps.length ? (
        <div className="rounded border border-amber-400/40 bg-amber-950/30 p-2 text-xs text-amber-100">
          {p.overlaps.map(([a, b]) => (
            <p key={`${a.id}-${b.id}`}>
              {toothLabel(a)} and {toothLabel(b)} overlap: probably one tooth
              split in two. Select one, then merge the other into it.
            </p>
          ))}
        </div>
      ) : null}
      {teeth.length ? (
        <section className="space-y-2">
          <ToothArchGrid
            teeth={teeth}
            selectedIds={chosen}
            focusId={selected?.id}
            multi={multi}
            onSelect={(id, additive) => p.onSelect(id, additive)}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Previous tooth"
              className={button}
              onClick={() => step(-1)}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <label className="min-w-0 flex-1">
              <span className="sr-only">Selected tooth</span>
              <select
                className={field}
                aria-label="Selected tooth instance"
                value={selected?.id ?? ''}
                onChange={(e) => p.onSelect(e.target.value)}
              >
                <option value="">Select a tooth</option>
                {teeth.map((t, i) => (
                  <option key={t.id} value={t.id}>
                    {t.fdi ? `FDI ${t.fdi}` : `Unassigned ${i + 1}`} ·{' '}
                    {t.review} · {t.voxelCount} voxels
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              aria-label="Next tooth"
              className={button}
              onClick={() => step(1)}
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <label className="flex min-h-8 items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              className="h-4 w-4 accent-sky-400"
              checked={multi}
              onChange={(e) => setMulti(e.target.checked)}
            />
            Select several (or Ctrl/⌘-click)
          </label>
          <ToothGroupChips
            available={(group) => teethInGroup(teeth, group).length}
            onPick={p.onPickGroup}
          />
        </section>
      ) : null}
      {selected && (
        <section className="grid gap-2">
          <div className="flex items-center gap-2">
            <h3 className={`${heading} flex-1`}>
              {toothLabel(selected)} · {selected.review}
            </h3>
            {p.onFocus ? (
              <button
                type="button"
                className={`${button} border-sky-500/60`}
                onClick={() => p.onFocus!(selected.id)}
              >
                Focus on this tooth
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              className={`${button} border-emerald-500/50`}
              onClick={acceptAndNext}
              title="Accept this outline and go to the next unreviewed tooth"
            >
              Accept &amp; next
            </button>
            <button
              className={button}
              onClick={() => p.onChange(selected.id, { review: 'accepted' })}
            >
              Accept outline
            </button>
            <button
              className={button}
              onClick={() => p.onChange(selected.id, { review: 'rejected' })}
            >
              Reject outline
            </button>
            <label className="text-xs">
              <span className="sr-only">FDI number</span>
              <select
                className={field}
                aria-label="FDI number"
                value={selected.fdi ?? ''}
                onChange={(e) =>
                  p.onChange(selected.id, {
                    fdi: e.target.value ? Number(e.target.value) : null,
                  })
                }
              >
                <option value="">Unassigned</option>
                {FDI_NUMBERS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <details>
            <summary className="cursor-pointer py-1.5 text-xs">
              Fix the outline
            </summary>
            <div className="grid gap-2">
              <div className="grid grid-cols-2 gap-2">
                <button className={button} onClick={() => p.onCorrect(false)}>
                  Correct outline
                </button>
                <button className={button} onClick={() => p.onCorrect(true)}>
                  Erase outline
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  className={field}
                  aria-label="Split plane"
                  value={axis}
                  onChange={(e) => setAxis(Number(e.target.value) as 0 | 1 | 2)}
                >
                  <option value={0}>Sagittal (X)</option>
                  <option value={1}>Coronal (Y)</option>
                  <option value={2}>Axial (Z)</option>
                </select>
                <button className={button} onClick={() => p.onSplit(axis)}>
                  Split at crosshair
                </button>
              </div>
              <label className="text-xs">
                Merge into selected tooth
                <select
                  className={field}
                  aria-label="Merge tooth"
                  value={merge}
                  onChange={(e) => setMerge(e.target.value)}
                >
                  <option value="">Choose another tooth</option>
                  {teeth
                    .filter(
                      (t) =>
                        t.id !== selected.id && t.groupId === selected.groupId,
                    )
                    .map((t, i) => (
                      <option key={t.id} value={t.id}>
                        {t.fdi ? `FDI ${t.fdi}` : `Unassigned ${i + 1}`}
                      </option>
                    ))}
                </select>
              </label>
              <button
                disabled={!merge}
                className={button}
                onClick={() => {
                  p.onMerge(merge);
                  setMerge('');
                }}
              >
                Merge outlines
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  className={button}
                  disabled={!p.canUndo}
                  onClick={p.onUndo}
                >
                  Undo correction
                </button>
                <button
                  className={button}
                  disabled={!p.canRedo}
                  onClick={p.onRedo}
                >
                  Redo correction
                </button>
              </div>
            </div>
          </details>
          <button
            className={button}
            disabled={p.surfaceBusy}
            onClick={p.onSurface}
          >
            {p.surfaceBusy
              ? 'Generating surface…'
              : 'Regenerate tooth 3D surface'}
          </button>
        </section>
      )}
      <section className="space-y-2">
        <h3 className={heading}>Show</h3>
        <ToothShowControl
          mode={p.state.toothVisibility ?? 'all'}
          hasSelection={chosen.length > 0}
          onChange={(mode) =>
            p.onVisibility(mode, p.state.showSurroundingBone ?? false)
          }
        />
        <label className="flex min-h-8 items-center gap-2 text-xs">
          <input
            type="checkbox"
            className="h-4 w-4 accent-sky-400"
            checked={p.state.showSurroundingBone ?? false}
            onChange={(e) =>
              p.onVisibility(p.state.toothVisibility ?? 'all', e.target.checked)
            }
          />
          Show surrounding bone
        </label>
      </section>
      {teeth.length ? (
        <section className="space-y-2">
          <h3 className={heading}>Export model (STL)</h3>
          <ToothModelExportForm
            count={teeth.filter((t) => chosen.includes(t.id)).length}
            busy={p.exportBusy}
            status={p.exportStatus}
            onExport={p.onExportModel}
          />
        </section>
      ) : null}
      <details
        open={!teeth.length}
        className="rounded border border-slate-800 p-2"
      >
        <summary className="cursor-pointer py-1.5 text-xs font-medium">
          Add or propose outlines
        </summary>
        <div className="space-y-2">
          <button className={button} onClick={p.onNewTooth}>
            Draw a new tooth outline
          </button>
          <label className={`${button} block cursor-pointer`}>
            Import model result
            <input
              aria-label="Import model result"
              type="file"
              accept=".zip"
              className="sr-only"
              disabled={p.busy || p.anatomyBusy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) p.onImportModel(file);
                e.target.value = '';
              }}
            />
          </label>
          <p className="text-xs text-slate-400">
            Choose a .cbcter.zip result for this scan. Imported proposals need
            review; your notes and corrections are kept.
          </p>
          {(p.state.analysisModels ?? []).length > 0 && (
            <details>
              <summary className="cursor-pointer py-1.5 text-xs">
                Loaded model results ({p.state.analysisModels!.length})
              </summary>
              <ul className="text-xs text-slate-300">
                {p.state.analysisModels!.map((m) => (
                  <li key={m.id}>
                    {m.name} —{' '}
                    {p.state.analysisLayers?.some(
                      (l) => l.modelId === m.id && l.role === 'teeth',
                    )
                      ? `${(p.state.toothInstances ?? []).filter((t) => t.review === 'unreviewed' && p.state.analysisLayers?.some((l) => l.id === t.groupId && l.modelId === m.id)).length} teeth awaiting review`
                      : 'Structure proposals'}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <details>
            <summary className="cursor-pointer py-1.5 text-xs">
              Propose outlines with a model
            </summary>
            <label className="text-xs">
              Anatomy model
              <select
                className={field}
                aria-label="Anatomy model"
                value={model}
                disabled={p.anatomyBusy}
                onChange={(e) => setModel(e.target.value as DentalSegVariantId)}
              >
                {Object.values(DENTAL_SEG_VARIANTS).map((m) => (
                  <option value={m.id} key={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={button}
              disabled={p.anatomyBusy}
              onClick={() => p.onAnatomy(model)}
            >
              {p.anatomyBusy ? 'Segmenting…' : 'Run anatomy model'}
            </button>
            {p.anatomyBusy && (
              <button className={button} onClick={p.onCancelAnatomy}>
                Cancel model
              </button>
            )}
            <p className="mt-2 text-xs text-slate-400">
              Requires installed ONNX weights and enough device memory. Full and
              pediatric models label anatomy; the universal model also proposes
              tooth identities. All proposals need review.
            </p>
            <a
              className={`${button} mt-2 block text-center`}
              target="_blank"
              rel="noreferrer"
              href="https://colab.research.google.com/github/ahzs645/CBCTer/blob/main/notebooks/CBCTer_GPU_models.ipynb"
            >
              Open cloud model runner
            </a>
            <p className="mt-2 text-xs text-slate-400">
              Experimental OralSeg and TIPs runner. You choose a scan to upload
              to your Colab runtime, then import its result here. A GPU runtime
              is required.
            </p>
          </details>
          <details open={!teeth.length}>
            <summary className="cursor-pointer py-1.5 text-xs">
              Separate individual teeth
            </summary>
            <div className="grid gap-2">
              <label className="text-xs">
                Source
                <select
                  aria-label="Separation source"
                  className={field}
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                >
                  <option value="">Select a mask or label group</option>
                  {p.state.segmentGroups
                    .filter(
                      (g) =>
                        !p.state.analysisLayers?.some(
                          (l) => l.id === g.id && l.role === 'teeth',
                        ),
                    )
                    .map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  {p.state.masks.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} (binary mask)
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs">
                Tooth label values (comma separated)
                <input
                  className={field}
                  value={values}
                  onChange={(e) => setValues(e.target.value)}
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs">
                  Minimum size (mm³)
                  <input
                    type="number"
                    min=".01"
                    step=".1"
                    className={field}
                    value={minMm3}
                    onChange={(e) => setMinMm3(Number(e.target.value))}
                  />
                </label>
                <label className="text-xs">
                  Core size (voxels)
                  <input
                    type="number"
                    min="1"
                    max="20"
                    className={field}
                    value={core}
                    onChange={(e) => setCore(Number(e.target.value))}
                  />
                </label>
              </div>
              <button
                className={button}
                disabled={p.busy || !source}
                onClick={() =>
                  p.onSeparate(
                    source,
                    values.split(',').map(Number),
                    minMm3,
                    core,
                  )
                }
              >
                {p.busy ? 'Separating…' : 'Propose separate teeth'}
              </button>
              <p className="text-xs text-slate-400">
                Run anatomy segmentation in Study if no mask is available.
                Anatomy model weights are required. Separation uses a watershed
                and may need splits or merges.
              </p>
            </div>
          </details>
        </div>
      </details>
    </aside>
  );
}
