import type { ReactNode } from 'react';
import { Icon } from './Icon';

/** Controls of the design system: ValueChip (tap to change), ValueTile (computed), Segmented, Notice. */

export function Chip({
  label,
  value,
  unit,
  onClick,
  state,
  className,
  disabled,
}: {
  label: string;
  value: string;
  unit?: string;
  onClick: () => void;
  state?: 'error' | 'warning' | 'selected';
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`bb-chip ${state ? `is-${state}` : ''} ${className ?? ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <span className="bb-chip-label">{label}</span>
      <span className="bb-chip-value">
        {value}
        {unit && <span className="bb-unit"> {unit}</span>}
      </span>
    </button>
  );
}

export function Tile({ label, value, unit, big }: { label: string; value: string; unit?: string; big?: boolean }) {
  return (
    <div className={`bb-tile ${big ? 'bb-tile--big' : ''}`}>
      <span className="bb-tile-label">{label}</span>
      <span className="bb-tile-value">
        {value}
        {unit && <span className="bb-unit"> {unit}</span>}
      </span>
    </div>
  );
}

export function Seg<T extends string>({
  label,
  value,
  options,
  onChange,
  block,
  tall,
  className,
}: {
  label: string;
  value: T;
  options: { value: T; label: ReactNode; icon?: ReactNode }[];
  onChange: (v: T) => void;
  block?: boolean;
  tall?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`bb-seg ${block ? 'bb-seg--block' : ''} ${tall ? 'bb-seg--tall' : ''} ${className ?? ''}`}
      role="radiogroup"
      aria-label={label}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={`bb-seg-opt ${o.value === value ? 'is-selected' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onChange(o.value);
          }}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Notice({ tone, children }: { tone: 'danger' | 'warning' | 'ok' | 'info'; children: ReactNode }) {
  const icon = tone === 'danger' ? 'stop' : tone === 'warning' ? 'warn' : tone === 'ok' ? 'check' : null;
  return (
    <div className={`bb-notice bb-notice--${tone}`}>
      {icon && <Icon name={icon} />}
      <span className="bb-notice-text">{children}</span>
    </div>
  );
}
