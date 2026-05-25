export const SliceCanvasFit = {
  Contain: 'contain',
  Cover: 'cover',
} as const;

export type SliceCanvasFit =
  (typeof SliceCanvasFit)[keyof typeof SliceCanvasFit];
