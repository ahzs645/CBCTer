import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';
import { cn } from '../utils/cn';
import { COARSE_TARGET, FOCUS_RING } from './Button.constants';

/**
 * The app's one button. Colours come from the tokens in `styles.css`
 * (`primary`, `focus`, `danger`).
 *
 * - `primary`: the main action of a panel or dialog (sky).
 * - `secondary`: filled neutral action.
 * - `ghost`: outlined, transparent (the default).
 * - `quiet`: no border or fill until hovered; toolbars, row and icon actions.
 * - `danger`: destructive action.
 * - `overlay`: translucent, for controls drawn over the image.
 *
 * `pressed` marks a toggle: it sets `aria-pressed` and the sky "on" style.
 * Passing `aria-pressed` directly gets the same style.
 */
const VARIANT_CLASSES = {
  primary:
    'border-primary/60 bg-primary/15 font-medium text-primary-fg hover:bg-primary/25',
  secondary: 'border-slate-600 bg-slate-800 text-slate-100 hover:bg-slate-700',
  ghost: 'border-slate-800 bg-transparent text-slate-300 hover:bg-slate-900',
  quiet:
    'border-transparent bg-transparent text-slate-400 hover:bg-slate-800 hover:text-slate-100',
  danger:
    'border-danger/60 bg-danger/10 text-danger-fg hover:bg-danger/20',
  overlay:
    'border-slate-700/80 bg-slate-950/75 text-slate-300 hover:bg-slate-900',
} as const;

const PRESSED_CLASSES =
  'border-primary/70 bg-primary/15 text-sky-100 hover:bg-primary/20';

/**
 * Sizes by role, the same on every device: `xs` 24 px for actions inside a
 * line of text or a notice, `sm` 28 px for normal panel actions, `md` 32 px
 * for a panel's main action, `icon` 28 px square. On touch screens the tap
 * area (not the look) grows to 44 px through `.touch-target`.
 */
const SIZE_CLASSES = {
  // Inline actions sit close together, so on touch they look a little
  // taller too and their 44 px tap areas barely overlap.
  xs: 'min-h-6 px-2 text-[11px] [@media(pointer:coarse)]:min-h-7',
  sm: 'min-h-7 px-2.5 text-xs',
  md: 'min-h-8 px-3 text-sm',
  icon: 'h-7 w-7 p-0',
} as const;

export type ButtonVariant = keyof typeof VARIANT_CLASSES;
export type ButtonSize = keyof typeof SIZE_CLASSES;

type ButtonOwnProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  /** Toggle state: sets `aria-pressed` and the pressed style. */
  pressed?: boolean;
  children: ReactNode;
};

export type ButtonProps<T extends ElementType = 'button'> = ButtonOwnProps & {
  as?: T;
} & Omit<ComponentPropsWithoutRef<T>, keyof ButtonOwnProps | 'as'>;

type ResolvedButtonProps = ButtonProps<ElementType>;

export function Button<T extends ElementType = 'button'>(
  buttonProps: ButtonProps<T>,
) {
  const {
    as: Component = 'button',
    variant = 'ghost',
    size = 'md',
    block = false,
    pressed,
    className,
    children,
    ...props
  } = buttonProps as ResolvedButtonProps;

  const ariaPressed = props['aria-pressed'];
  const isPressed =
    pressed ?? (ariaPressed === true || ariaPressed === 'true');

  const classes = cn(
    'inline-flex items-center justify-center gap-1.5 rounded border transition [&_svg]:shrink-0 disabled:cursor-not-allowed disabled:opacity-50',
    FOCUS_RING,
    COARSE_TARGET,
    isPressed ? PRESSED_CLASSES : VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    block ? 'w-full' : '',
    className,
  );

  return (
    <Component
      {...props}
      type={props.type ?? (Component === 'button' ? 'button' : undefined)}
      aria-pressed={ariaPressed ?? pressed}
      className={classes}
    >
      {children}
    </Component>
  );
}
