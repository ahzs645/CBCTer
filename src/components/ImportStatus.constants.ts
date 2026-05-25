export const ImportStatusStage = {
  Import: 'import',
  Viewer: 'viewer',
} as const;

export type ImportStatusStage =
  (typeof ImportStatusStage)[keyof typeof ImportStatusStage];
