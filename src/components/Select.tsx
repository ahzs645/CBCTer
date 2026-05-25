import { Check, ChevronDown } from 'lucide-react';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../utils/cn';

export interface SelectOption {
  value: string;
  label: ReactNode;
}

const VARIANT_CLASSES = {
  default:
    'border-slate-700 bg-slate-950 text-slate-100 hover:border-slate-600 focus-visible:border-sky-500',
  overlay:
    'border-slate-700/80 bg-slate-950/75 text-slate-200 hover:border-slate-600 focus-visible:border-sky-500',
  bare: 'border-transparent bg-transparent text-slate-100 hover:text-white focus-visible:border-transparent',
} as const;

const SIZE_CLASSES = {
  md: 'py-1.5 pl-2.5 pr-8 text-sm',
  sm: 'py-1 pl-2 pr-7 text-xs',
} as const;

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  variant?: keyof typeof VARIANT_CLASSES;
  size?: keyof typeof SIZE_CLASSES;
  block?: boolean;
  align?: 'left' | 'right';
  className?: string;
  buttonClassName?: string;
  'aria-label'?: string;
}

interface MenuPosition {
  top: number;
  left: number;
  minWidth: number;
  maxHeight: number;
  placement: 'down' | 'up';
}

/**
 * Fully styled dropdown built as an accessible listbox (not a native
 * <select>), so the open menu matches the app instead of the OS popup.
 * The menu is portaled and fixed-positioned to avoid clipping inside
 * scroll containers and overflow-hidden viewports.
 */
export function Select({
  value,
  onChange,
  options,
  variant = 'default',
  size = 'md',
  block = false,
  align = 'left',
  className,
  buttonClassName,
  'aria-label': ariaLabel,
}: SelectProps) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<MenuPosition | null>(null);

  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const selectedLabel = options[selectedIndex]?.label ?? '';

  const computePosition = (): MenuPosition | null => {
    const trigger = triggerRef.current;
    if (!trigger) return null;
    const rect = trigger.getBoundingClientRect();
    const margin = 8;
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const placement = spaceBelow < 200 && spaceAbove > spaceBelow ? 'up' : 'down';
    const maxHeight = Math.min(300, placement === 'down' ? spaceBelow : spaceAbove);
    const left = align === 'right' ? rect.right - Math.max(rect.width, 160) : rect.left;
    return {
      top: placement === 'down' ? rect.bottom + 4 : rect.top - 4,
      left: Math.max(8, left),
      minWidth: rect.width,
      maxHeight,
      placement,
    };
  };

  useLayoutEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      setPosition(computePosition());
    });
    const update = () => setPosition(computePosition());
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !listRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () =>
      document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  const openMenu = () => {
    setActiveIndex(selectedIndex);
    setOpen(true);
  };

  const close = (focusTrigger = true) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  };

  const commit = (index: number) => {
    const option = options[index];
    if (option) onChange(option.value);
    close();
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) return openMenu();
        setActiveIndex((i) => Math.min(options.length - 1, i + 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!open) return openMenu();
        setActiveIndex((i) => Math.max(0, i - 1));
        break;
      case 'Home':
        if (open) {
          event.preventDefault();
          setActiveIndex(0);
        }
        break;
      case 'End':
        if (open) {
          event.preventDefault();
          setActiveIndex(options.length - 1);
        }
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (open) commit(activeIndex);
        else openMenu();
        break;
      case 'Escape':
        if (open) {
          event.preventDefault();
          close();
        }
        break;
      case 'Tab':
        if (open) setOpen(false);
        break;
      default:
        break;
    }
  };

  return (
    <span
      className={cn(
        'relative inline-flex items-center',
        block ? 'w-full' : '',
        className,
      )}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={onKeyDown}
        className={cn(
          'inline-flex w-full items-center justify-between gap-1 rounded border font-medium outline-none transition',
          VARIANT_CLASSES[variant],
          SIZE_CLASSES[size],
          buttonClassName,
        )}
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown
          className={cn(
            'pointer-events-none shrink-0 text-slate-400 transition-transform',
            size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4',
            open ? 'rotate-180' : '',
          )}
          aria-hidden="true"
        />
      </button>

      {open && position
        ? createPortal(
            <ul
              ref={listRef}
              role="listbox"
              aria-activedescendant={`${id}-opt-${activeIndex}`}
              tabIndex={-1}
              onKeyDown={onKeyDown}
              style={{
                position: 'fixed',
                top: position.placement === 'down' ? position.top : undefined,
                bottom:
                  position.placement === 'up'
                    ? window.innerHeight - position.top
                    : undefined,
                left: position.left,
                minWidth: position.minWidth,
                maxHeight: position.maxHeight,
              }}
              className="z-[60] overflow-y-auto rounded-md border border-slate-700 bg-slate-900 p-1 text-sm text-slate-100 shadow-xl shadow-slate-950/40 ring-1 ring-black/20 focus:outline-none"
            >
              {options.map((option, index) => {
                const isSelected = option.value === value;
                const isActive = index === activeIndex;
                return (
                  <li
                    key={option.value}
                    id={`${id}-opt-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => commit(index)}
                    className={cn(
                      'flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 text-xs',
                      isActive ? 'bg-sky-500/15 text-sky-100' : 'text-slate-200',
                    )}
                  >
                    <span className="truncate">{option.label}</span>
                    {isSelected ? (
                      <Check
                        className="h-3.5 w-3.5 shrink-0 text-sky-400"
                        aria-hidden="true"
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>,
            document.body,
          )
        : null}
    </span>
  );
}
