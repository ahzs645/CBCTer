export const BadgeVariant = {
  Default: 'default',
  Overlay: 'overlay',
} as const;

export type BadgeVariant = (typeof BadgeVariant)[keyof typeof BadgeVariant];
