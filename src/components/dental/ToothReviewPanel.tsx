import {
  DENTAL_SEG_VARIANTS,
  type DentalSegVariantId,
} from '../../lib/segmentation/dentalSegVariants';
import { useState } from 'react';
import type { StudyState } from '../../domain/types';
import type { ToothInstance } from '../../lib/case/types';
import { FDI_NUMBERS } from '../../lib/case/teeth';
interface Props {
  state: StudyState;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSelect: (id: string) => void;
  onSeparate: (
    source: string,
    values: number[],
    minMm3: number,
    core: number,
  ) => void;
  onChange: (id: string, changes: Partial<ToothInstance>) => void;
  onCorrect: (erase: boolean) => void;
  onNewTooth:()=>void;
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
}
const field =
  'min-h-11 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm';
const button =
  'min-h-11 rounded border border-slate-600 bg-slate-800 px-3 py-2 text-sm disabled:opacity-40';
export function ToothReviewPanel(p: Props) {
  const teeth = p.state.toothInstances ?? [],
    selected = teeth.find((t) => t.id === p.state.selectedInstanceId);
  const [model, setModel] = useState<DentalSegVariantId>('full');
  const [source, setSource] = useState(
      p.state.activeSegmentGroupId ?? p.state.activeMaskId ?? '',
    ),
    [values, setValues] = useState('3,4'),
    [minMm3, setMinMm3] = useState(0.5),
    [core, setCore] = useState(3),
    [axis, setAxis] = useState<0 | 1 | 2>(0),
    [merge, setMerge] = useState('');
  return (
    <aside
      role="region"
      aria-label="Tooth review"
      className="absolute inset-x-0 bottom-0 z-40 max-h-[48dvh] overflow-y-auto rounded-t-xl border border-slate-700 bg-slate-900 p-3 shadow-xl md:inset-x-auto md:bottom-8 md:right-2 md:top-14 md:max-h-none md:w-80 md:rounded-xl"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Review teeth</h2>
        <button
          className={button}
          onClick={p.onClose}
          aria-label="Close tooth review"
        >
          Close
        </button>
      </div>
      <p className="my-2 text-xs text-slate-400">
        Proposed regions need dentist review. Tooth numbers are separate from
        mask IDs. Click a tooth in a slice or chart to select it.
      </p>
      <button className={button} onClick={p.onNewTooth}>Draw a new tooth outline</button>
      <label className={`${button} mt-2 block cursor-pointer`}>
        Import model result
        <input aria-label="Import model result" type="file" accept=".zip" className="sr-only"
          disabled={p.busy || p.anatomyBusy}
          onChange={e => {const file = e.target.files?.[0]; if (file) p.onImportModel(file); e.target.value = '';}} />
      </label>
      <p className="my-2 text-xs text-slate-400">Choose a .cbcter.zip result for this scan. Imported proposals need review; your notes and corrections are kept.</p>
      {(p.state.analysisModels ?? []).length > 0 && <details>
        <summary className="min-h-11 cursor-pointer py-2 text-sm">Loaded model results ({p.state.analysisModels!.length})</summary>
        <ul className="text-xs text-slate-300">{p.state.analysisModels!.map(m => <li key={m.id}>{m.name} — {p.state.analysisLayers?.some(l => l.modelId === m.id && l.role === 'teeth') ? `${(p.state.toothInstances ?? []).filter(t => t.review === 'unreviewed' && p.state.analysisLayers?.some(l => l.id === t.groupId && l.modelId === m.id)).length} teeth awaiting review` : 'Structure proposals'}</li>)}</ul>
      </details>}
      <details>
        <summary className="min-h-11 cursor-pointer py-2 text-sm">
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
        <a className={`${button} mt-2 block text-center`} target="_blank" rel="noreferrer"
          href="https://colab.research.google.com/github/ahzs645/CBCTer/blob/main/notebooks/CBCTer_GPU_models.ipynb">
          Open cloud model runner
        </a>
        <p className="mt-2 text-xs text-slate-400">Experimental OralSeg and TIPs runner. You choose a scan to upload to your Colab runtime, then import its result here. A GPU runtime is required.</p>
      </details>
      <details open={!teeth.length}>
        <summary className="min-h-11 cursor-pointer py-2 text-sm">
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
              p.onSeparate(source, values.split(',').map(Number), minMm3, core)
            }
          >
            {p.busy ? 'Separating…' : 'Propose separate teeth'}
          </button>
          <p className="text-xs text-slate-400">
            Run anatomy segmentation in Study if no mask is available. Anatomy
            model weights are required. Separation uses a watershed and may need
            splits or merges.
          </p>
        </div>
      </details>
      {p.error && (
        <p className="my-2 text-sm text-rose-300" role="alert">
          {p.error}
        </p>
      )}
      <label className="mt-2 block text-xs">
        Selected tooth
        <select
          className={field}
          aria-label="Selected tooth instance"
          value={selected?.id ?? ''}
          onChange={(e) => p.onSelect(e.target.value)}
        >
          <option value="">Select a tooth</option>
          {teeth.map((t, i) => (
            <option key={t.id} value={t.id}>
              {t.fdi ? `FDI ${t.fdi}` : `Unassigned ${i + 1}`} · {t.review} ·{' '}
              {t.voxelCount} voxels
            </option>
          ))}
        </select>
      </label>
      {selected && (
        <div className="mt-2 grid gap-2">
          <label className="text-xs">
            FDI number
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
          <div className="grid grid-cols-2 gap-2">
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
            <button className={button} onClick={() => p.onCorrect(false)}>
              Correct outline
            </button>
            <button className={button} onClick={() => p.onCorrect(true)}>
              Erase outline
            </button>
          </div>
          <button
            className={button}
            disabled={p.surfaceBusy}
            onClick={p.onSurface}
          >
            {p.surfaceBusy
              ? 'Generating surface…'
              : 'Regenerate tooth 3D surface'}
          </button>
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
                  (t) => t.id !== selected.id && t.groupId === selected.groupId,
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
        </div>
      )}
      <label className="mt-2 block text-xs">
        Structure visibility
        <select
          className={field}
          aria-label="Structure visibility"
          value={p.state.toothVisibility ?? 'all'}
          onChange={(e) =>
            p.onVisibility(
              e.target.value as 'all' | 'selected' | 'hide-teeth',
              p.state.showSurroundingBone ?? false,
            )
          }
        >
          <option value="all">Show all structures</option>
          <option value="selected" disabled={!selected}>
            Show selected tooth
          </option>
          <option value="hide-teeth">Hide teeth</option>
        </select>
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={p.state.showSurroundingBone ?? false}
          onChange={(e) =>
            p.onVisibility(p.state.toothVisibility ?? 'all', e.target.checked)
          }
        />
        Show surrounding bone
      </label>
      <div className="grid grid-cols-2 gap-2">
        <button className={button} disabled={!p.canUndo} onClick={p.onUndo}>
          Undo correction
        </button>
        <button className={button} disabled={!p.canRedo} onClick={p.onRedo}>
          Redo correction
        </button>
      </div>
    </aside>
  );
}
