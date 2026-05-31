/**
 * Read/write 3D Slicer Markups fiducial files (`.mrk.json`) — the landmark
 * interchange format used across SADT (ALI, ASO, AReg). CBCTer had no fiducial
 * concept; this adds a minimal `Landmark` type plus parse/serialise so the app
 * can ingest landmark sets produced by Slicer/SADT and emit compatible files.
 *
 * Slicer stores control points in either LPS (default for storage) or RAS
 * (Slicer's world). The two differ by negating X and Y, so this module can
 * convert on read/write to whatever frame the caller works in.
 */
import type { Vec3 } from '../../types';

export type MarkupCoordinateSystem = 'LPS' | 'RAS';

export interface Landmark {
  /** Short label, e.g. "N", "Ba", "RPo". */
  label: string;
  /** Position `[x, y, z]` in the file/struct coordinate system. */
  position: Vec3;
  id?: string;
  description?: string;
}

export interface MarkupSet {
  landmarks: Landmark[];
  coordinateSystem: MarkupCoordinateSystem;
}

const MARKUPS_SCHEMA =
  'https://raw.githubusercontent.com/slicer/slicer/main/Modules/Loadable/Markups/Resources/Schema/markups-schema-v1.0.3.json#';

/** Negate X and Y to convert a point between LPS and RAS (self-inverse). */
export function flipPointLpsRas(p: Vec3): Vec3 {
  return [-p[0], -p[1], p[2]];
}

function normalizeSystem(value: unknown): MarkupCoordinateSystem {
  // Slicer accepts "LPS"/"RAS" and sometimes numeric/extended codes; default LPS.
  if (typeof value === 'string' && value.toUpperCase().startsWith('R')) {
    return 'RAS';
  }
  return 'LPS';
}

interface SlicerControlPoint {
  id?: string;
  label?: string;
  description?: string;
  position?: number[];
}

interface SlicerMarkup {
  type?: string;
  coordinateSystem?: string;
  controlPoints?: SlicerControlPoint[];
}

interface SlicerMarkupsFile {
  markups?: SlicerMarkup[];
}

/**
 * Parse a Slicer `.mrk.json` document. Collects control points from every
 * markup in the file. If `targetSystem` is given and differs from the file's
 * coordinate system, positions are converted.
 */
export function parseSlicerMarkups(
  source: string | SlicerMarkupsFile,
  options: { targetSystem?: MarkupCoordinateSystem } = {},
): MarkupSet {
  const doc: SlicerMarkupsFile =
    typeof source === 'string' ? JSON.parse(source) : source;
  const markups = Array.isArray(doc.markups) ? doc.markups : [];

  const fileSystem = normalizeSystem(markups[0]?.coordinateSystem);
  const targetSystem = options.targetSystem ?? fileSystem;
  const needsFlip = fileSystem !== targetSystem;

  const landmarks: Landmark[] = [];
  for (const markup of markups) {
    for (const point of markup.controlPoints ?? []) {
      const position = point.position;
      if (!Array.isArray(position) || position.length < 3) continue;
      const xyz: Vec3 = [position[0], position[1], position[2]];
      landmarks.push({
        label: point.label ?? '',
        position: needsFlip ? flipPointLpsRas(xyz) : xyz,
        id: point.id,
        description: point.description,
      });
    }
  }

  return { landmarks, coordinateSystem: targetSystem };
}

/**
 * Serialise landmarks to a Slicer `.mrk.json` fiducial file. `coordinateSystem`
 * is the frame the input `landmarks` are already in (written verbatim into the
 * file header); pass `sourceSystem` if the landmarks need converting first.
 */
export function serializeSlicerMarkups(
  landmarks: Landmark[],
  options: {
    coordinateSystem?: MarkupCoordinateSystem;
    sourceSystem?: MarkupCoordinateSystem;
  } = {},
): string {
  const coordinateSystem = options.coordinateSystem ?? 'LPS';
  const sourceSystem = options.sourceSystem ?? coordinateSystem;
  const needsFlip = sourceSystem !== coordinateSystem;

  const controlPoints = landmarks.map((landmark, index) => {
    const position = needsFlip
      ? flipPointLpsRas(landmark.position)
      : landmark.position;
    return {
      id: landmark.id ?? String(index + 1),
      label: landmark.label,
      description: landmark.description ?? '',
      position: [position[0], position[1], position[2]],
      orientation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      selected: true,
      locked: false,
      visibility: true,
      positionStatus: 'defined',
    };
  });

  return JSON.stringify(
    {
      '@schema': MARKUPS_SCHEMA,
      markups: [
        {
          type: 'Fiducial',
          coordinateSystem,
          coordinateUnits: 'mm',
          controlPoints,
        },
      ],
    },
    null,
    2,
  );
}
