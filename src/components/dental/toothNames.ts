import type { TFunction } from 'i18next';

/** Primary teeth 1–5 share names with permanent positions 1, 2, 3, 6, 7. */
const PRIMARY_POSITIONS = [1, 2, 3, 6, 7];

/**
 * Translated tooth name for an FDI number, permanent (11–48) or primary
 * (51–85). In English it reads exactly like `toothName()` from
 * `lib/dental/toothChart`, e.g. 11 → "Upper Right Central Incisor".
 */
export function localToothName(t: TFunction, fdi: number): string {
  const quadrant = Math.floor(fdi / 10);
  const position = fdi % 10;
  const primary = quadrant >= 5 && quadrant <= 8;
  const valid = primary
    ? position >= 1 && position <= 5
    : quadrant >= 1 && quadrant <= 4 && position >= 1 && position <= 8;
  if (!valid) return t('dental.toothNames.unknown', { fdi });
  const name = t('dental.toothNames.format', {
    quadrant: t(`dental.toothNames.quadrant.${primary ? quadrant - 4 : quadrant}`),
    position: t(
      `dental.toothNames.position.${primary ? PRIMARY_POSITIONS[position - 1] : position}`,
    ),
  });
  return primary ? t('dental.toothNames.primary', { name }) : name;
}
