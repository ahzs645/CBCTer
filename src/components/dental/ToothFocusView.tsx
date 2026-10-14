import { Crosshair, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { compute } from '../../lib/dental/computeClient';
import { useTranslation } from '../../i18n';
import type { ToothCropReader } from '../../lib/case/toothExport';
import {
  crownDirectionFor,
  selectionBounds,
  toothValues,
} from '../../lib/case/toothSelection';
import type { ToothInstance } from '../../lib/case/types';
import {
  obliqueToRgba,
  sampleOblique,
  toothAxes,
  type DarkArea,
  type ObliqueImage,
  type ToothAxes,
} from '../../lib/dental/toothFocus';
import type { SliceWindowLevel, Vec3 } from '../../types';
import { cn } from '../../utils/cn';
import { Button } from '../Button';
import { FOCUS_RING } from '../Button.constants';
import { useFocusTrap } from './useFocusTrap';

const rotate = (a: Vec3, b: Vec3, degrees: number): Vec3 => {
  const r = (degrees * Math.PI) / 180;
  return [0, 1, 2].map((k) => a[k] * Math.cos(r) + b[k] * Math.sin(r)) as Vec3;
};

function SliceImageCanvas({
  image,
  windowLevel,
  marker,
  label,
}: {
  image: ObliqueImage | null;
  windowLevel: SliceWindowLevel;
  /** Fraction (0–1) down the image where the cross-section sits. */
  marker?: number;
  label: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !image) return;
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const data = new ImageData(image.width, image.height);
    data.data.set(obliqueToRgba(image, windowLevel));
    ctx.putImageData(data, 0, 0);
    if (marker !== undefined) {
      ctx.strokeStyle = 'rgba(56,189,248,0.9)';
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      const y = Math.round(marker * (image.height - 1)) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(image.width, y);
      ctx.stroke();
    }
  }, [image, windowLevel, marker]);
  return (
    <figure className="flex min-h-0 min-w-0 flex-col items-center gap-1">
      <figcaption className="text-[11px] text-slate-400">{label}</figcaption>
      <canvas
        ref={ref}
        aria-label={label}
        className="max-h-[52dvh] w-full rounded bg-black object-contain [image-rendering:auto]"
        style={{
          aspectRatio: image ? `${image.width} / ${image.height}` : '1',
        }}
      />
    </figure>
  );
}

export interface ToothFocusProps {
  tooth: ToothInstance;
  name: string;
  allTeeth: ToothInstance[];
  dims: Vec3;
  spacing: Vec3;
  superiorSign?: 1 | -1;
  read: ToothCropReader;
  windowLevel: SliceWindowLevel;
  onClose: () => void;
  /** Move the main viewer's crosshair to a scan voxel. */
  onJump?: (voxel: Vec3) => void;
}

/**
 * One tooth on its own: slices along its long axis (like a periapical film),
 * a cross-section that can be moved from crown to root, its length, and a
 * check for dark areas inside it that are not shaped like the pulp canal.
 */
export function ToothFocusView(props: ToothFocusProps) {
  const { tooth, dims, spacing, read } = props;
  const { t: tr } = useTranslation();
  const dialogRef = useFocusTrap<HTMLDivElement>();
  const [crop, setCrop] = useState<{
    scan: ArrayLike<number>;
    labels: Uint16Array;
    start: Vec3;
    shape: Vec3;
  } | null>(null);
  const [error, setError] = useState('');
  const [areas, setAreas] = useState<DarkArea[] | null>(null);
  const [rotation, setRotation] = useState(0);
  const [depthMm, setDepthMm] = useState(0);
  const [along, setAlong] = useState(0.3);
  const [windowLevel, setWindowLevel] = useState(props.windowLevel);
  const values = useMemo(() => toothValues(tooth), [tooth]);

  useEffect(() => {
    // The parent remounts this view per tooth (key), so state starts empty.
    let cancelled = false;
    const box = selectionBounds([tooth], dims, Math.round(3 / spacing[0]))!;
    read(tooth.groupId, box.start, box.shape).then(
      (result) => {
        if (!cancelled)
          setCrop({ ...result, start: box.start, shape: box.shape });
      },
      (e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [tooth, dims, spacing, read]);

  const axes = useMemo<ToothAxes | null>(
    () =>
      crop
        ? toothAxes(
            crop.labels,
            crop.shape,
            values,
            spacing,
            crownDirectionFor(tooth, props.allTeeth, props.superiorSign ?? 1),
          )
        : null,
    [crop, values, spacing, tooth, props.allTeeth, props.superiorSign],
  );

  useEffect(() => {
    if (!crop || !axes) return;
    // The check runs in a worker; the slices stay interactive meanwhile.
    let cancelled = false;
    compute('toothCheck', {
      scan: crop.scan,
      labels: crop.labels,
      shape: crop.shape,
      spacing,
      values,
      crownDirection: crownDirectionFor(
        tooth,
        props.allTeeth,
        props.superiorSign ?? 1,
      ),
    }).then(
      (result) => {
        if (!cancelled) setAreas(result.areas);
      },
      (e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [crop, axes, spacing, values, tooth, props.allTeeth, props.superiorSign]);

  const views = useMemo(() => {
    if (!crop || !axes) return null;
    // Root up for upper teeth and down for lower teeth, as in the mouth.
    const sign = axes.long[2] * (props.superiorSign ?? 1) > 0 ? 1 : -1;
    const up = axes.long.map((v) => v * sign) as Vec3;
    const rightA = rotate(axes.wide, axes.thin, rotation);
    const rightB = rotate(axes.wide, axes.thin, rotation + 90);
    const half = axes.lengthMm / 2 + 2;
    const width = Math.max(6, half * 0.6);
    const shift = (normal: Vec3): Vec3 =>
      axes.centre.map((c, k) => c + (normal[k] * depthMm) / spacing[k]) as Vec3;
    const common = {
      scan: crop.scan,
      labels: crop.labels,
      values,
      shape: crop.shape,
      spacing,
      mmPerPixel: 0.1,
    };
    const a = sampleOblique({
      ...common,
      centre: shift(rightB),
      right: rightA,
      up,
      halfWidthMm: width,
      halfHeightMm: half,
    });
    const b = sampleOblique({
      ...common,
      centre: shift(rightA),
      right: rightB,
      up,
      halfWidthMm: width,
      halfHeightMm: half,
    });
    const t = axes.tipMm + along * axes.lengthMm;
    const crossCentre = axes.centre.map(
      (c, k) => c + (axes.long[k] * t) / spacing[k],
    ) as Vec3;
    const cross = sampleOblique({
      ...common,
      centre: crossCentre,
      right: rightA,
      up: rightB,
      halfWidthMm: width,
      halfHeightMm: width,
    });
    // Where the cross-section sits on the long views (0 = top row).
    const tipRow =
      sign === 1
        ? 1 - (half + axes.tipMm) / (2 * half)
        : (half + axes.tipMm) / (2 * half);
    const apexRow =
      sign === 1
        ? 1 - (half + axes.apexMm) / (2 * half)
        : (half + axes.apexMm) / (2 * half);
    return { a, b, cross, marker: tipRow + (apexRow - tipRow) * along };
  }, [
    crop,
    axes,
    rotation,
    depthMm,
    along,
    spacing,
    values,
    props.superiorSign,
  ]);

  const focal = areas?.filter((area) => area.kind === 'focal') ?? [];
  const pulp = areas?.some((area) => area.kind === 'pulp-like');
  const showArea = (area: DarkArea) => {
    if (!axes || !crop) return;
    setAlong(area.alongTooth);
    const rightB = rotate(axes.wide, axes.thin, rotation + 90);
    const rel = area.centre.map((c, k) => (c - axes.centre[k]) * spacing[k]);
    setDepthMm(
      Math.max(
        -4,
        Math.min(
          4,
          rel[0] * rightB[0] + rel[1] * rightB[1] + rel[2] * rightB[2],
        ),
      ),
    );
    props.onJump?.(
      area.centre.map((c, k) => Math.round(c + crop.start[k])) as Vec3,
    );
  };

  const range = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (value: number) => void,
    format: (value: number) => string,
  ) => (
    <label className="block text-[11px] text-slate-300">
      <span className="flex justify-between">
        <span>{label}</span>
        <span className="font-mono">{format(value)}</span>
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-6 w-full accent-sky-400"
      />
    </label>
  );

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={tr('dental.focus.dialogLabel', { name: props.name })}
      className="fixed inset-0 z-[60] flex items-stretch justify-center bg-slate-950/80 p-0 outline-none backdrop-blur-sm md:items-center md:p-6"
      onKeyDown={(e) => {
        if (e.key === 'Escape') props.onClose();
      }}
    >
      <div className="flex max-h-dvh w-full max-w-5xl flex-col overflow-y-auto border-slate-700 bg-slate-900 md:max-h-[92dvh] md:rounded-xl md:border">
        <header className="flex items-center gap-2 border-b border-slate-800 px-3 py-2">
          <h2 className="flex-1 text-sm font-semibold">
            {props.name}
            {axes ? (
              <span className="ml-2 font-normal text-slate-400">
                {tr('dental.focus.length', {
                  length: axes.lengthMm.toFixed(1),
                })}
              </span>
            ) : null}
          </h2>
          <Button
            variant="quiet"
            size="icon"
            onClick={props.onClose}
            aria-label={tr('dental.focus.close')}
            className="h-8 w-8 text-slate-200"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </header>
        {error ? (
          <p role="alert" className="px-3 py-2 text-sm text-rose-300">
            {error}
          </p>
        ) : null}
        {!views ? (
          <p
            role="status"
            className="px-3 py-6 text-center text-sm text-slate-400"
          >
            {tr('dental.focus.loading', { name: props.name })}
          </p>
        ) : (
          <div className="grid gap-3 p-3 md:grid-cols-[1fr_1fr_1fr_14rem]">
            <SliceImageCanvas
              image={views.a}
              windowLevel={windowLevel}
              marker={views.marker}
              label={tr('dental.focus.along')}
            />
            <SliceImageCanvas
              image={views.b}
              windowLevel={windowLevel}
              marker={views.marker}
              label={tr('dental.focus.turned')}
            />
            <SliceImageCanvas
              image={views.cross}
              windowLevel={windowLevel}
              label={tr('dental.focus.cross')}
            />
            <div className="space-y-2">
              {range(
                tr('dental.focus.rotate'),
                rotation,
                0,
                179,
                1,
                setRotation,
                (v) => `${v}°`,
              )}
              {range(
                tr('dental.focus.depth'),
                depthMm,
                -4,
                4,
                0.1,
                setDepthMm,
                (v) =>
                  tr('dental.units.mm', {
                    value: `${v >= 0 ? '+' : ''}${v.toFixed(1)}`,
                  }),
              )}
              {range(
                tr('dental.focus.crossPosition'),
                along,
                0,
                1,
                0.01,
                setAlong,
                (v) => `${Math.round(v * 100)}%`,
              )}
              {range(
                tr('dental.focus.window'),
                windowLevel.window,
                200,
                6000,
                50,
                (window) => setWindowLevel((v) => ({ ...v, window })),
                (v) => String(v),
              )}
              {range(
                tr('dental.focus.level'),
                windowLevel.level,
                -500,
                3000,
                10,
                (level) => setWindowLevel((v) => ({ ...v, level })),
                (v) => String(v),
              )}
              <section className="rounded border border-slate-800 p-2 text-xs">
                <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  {tr('dental.focus.darkTitle')}
                </h3>
                {!areas ? (
                  <p role="status" className="text-slate-400">
                    {tr('dental.focus.checking')}
                  </p>
                ) : (
                  <>
                    <p
                      className={cn(pulp ? 'text-slate-300' : 'text-amber-100')}
                    >
                      {pulp
                        ? tr('dental.focus.pulpVisible')
                        : tr('dental.focus.pulpMissing')}
                    </p>
                    {focal.length ? (
                      focal.map((area, index) => (
                        <div
                          key={index}
                          className="mt-1 rounded border border-amber-400/40 bg-amber-950/30 p-1.5 text-amber-100"
                        >
                          {tr('dental.focus.darkArea', {
                            volume: area.volumeMm3.toFixed(1),
                            where:
                              area.alongTooth < 0.25
                                ? tr('dental.focus.where.crown')
                                : area.alongTooth < 0.5
                                  ? tr('dental.focus.where.neck')
                                  : tr('dental.focus.where.root'),
                            density: Math.round(area.relativeDensity * 100),
                          })}
                          <button
                            type="button"
                            onClick={() => showArea(area)}
                            className={cn(
                              'mt-1 flex items-center gap-1 rounded underline',
                              FOCUS_RING,
                            )}
                          >
                            <Crosshair className="h-3 w-3" aria-hidden="true" />
                            {tr('dental.focus.showIt')}
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="text-slate-400">
                        {tr('dental.focus.noAreas')}
                      </p>
                    )}
                    <p className="mt-1 text-[10px] leading-snug text-slate-400">
                      {tr('dental.focus.disclaimer')}
                    </p>
                  </>
                )}
              </section>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
