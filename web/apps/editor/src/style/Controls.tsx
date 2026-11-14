import type { LabelStyle } from '@nolli/core';
import { useState, type ReactNode } from 'react';

export function CollapsibleSection({
  title,
  defaultOpen = true,
  trailing,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  trailing?: ReactNode;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="inspector-section">
      <div className="section-header">
        <button
          type="button"
          className="section-toggle"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="section-chevron" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          <span className="section-title">{title}</span>
        </button>
        {trailing && <div className="section-trailing">{trailing}</div>}
      </div>
      {open && children && <div className="section-body">{children}</div>}
    </section>
  );
}

export function PropRow({
  label,
  overridden = false,
  onReset,
  children,
}: {
  label: string;
  overridden?: boolean;
  onReset?: () => void;
  children: ReactNode;
}) {
  return (
    <div className={`prop-row${overridden ? ' is-overridden' : ''}`}>
      <div className="prop-label-wrap">
        {overridden && onReset ? (
          <button
            type="button"
            className="override-dot-btn"
            title={`Reset ${label} to master`}
            aria-label={`Reset ${label}`}
            onClick={onReset}
          >
            <span className="override-dot" />
          </button>
        ) : null}
        <span className="prop-label">{label}</span>
      </div>
      <div className="prop-controls">{children}</div>
    </div>
  );
}

export function NumberInput({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  digits = 0,
  prefix,
  unit,
  ariaLabel,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  digits?: number;
  prefix?: string;
  unit?: string;
  ariaLabel?: string;
}) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  const formatted = Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;

  return (
    <label className="number-field">
      {prefix && <span className="number-prefix">{prefix}</span>}
      <input
        type="number"
        aria-label={ariaLabel ?? prefix}
        value={formatted}
        min={Number.isFinite(min) ? min : undefined}
        max={Number.isFinite(max) ? max : undefined}
        step={step}
        onChange={(event) => {
          const parsed = Number.parseFloat(event.target.value);
          if (Number.isFinite(parsed)) onChange(clamp(parsed));
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            const dir = event.key === 'ArrowUp' ? 1 : -1;
            const mult = event.shiftKey ? 10 : 1;
            const next = clamp(Number((value + dir * step * mult).toFixed(Math.max(digits, 4))));
            onChange(next);
          }
        }}
      />
      {unit && <span className="number-unit">{unit}</span>}
    </label>
  );
}

export function SliderNumberRow({
  label,
  value,
  onChange,
  min,
  max,
  hardMin,
  hardMax,
  step = 1,
  digits = 0,
  unit,
  overridden = false,
  onReset,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  hardMin?: number;
  hardMax?: number;
  step?: number;
  digits?: number;
  unit?: string;
  overridden?: boolean;
  onReset?: () => void;
}) {
  const sliderValue = Math.max(min, Math.min(max, value));
  return (
    <PropRow label={label} overridden={overridden} onReset={onReset}>
      <input
        type="range"
        className="prop-slider"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={sliderValue}
        onChange={(event) => onChange(Number.parseFloat(event.target.value))}
      />
      <NumberInput
        value={value}
        onChange={onChange}
        min={hardMin ?? min}
        max={hardMax ?? max}
        step={step}
        digits={digits}
        unit={unit}
        ariaLabel={`${label} value`}
      />
    </PropRow>
  );
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (next: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="segmented-control" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`segment-btn${value === option.value ? ' active' : ''}`}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function SwitchToggle({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={`switch-toggle${checked ? ' is-on' : ''}`}
      onClick={(event) => {
        event.stopPropagation();
        onChange(!checked);
      }}
    >
      <span className="switch-thumb" />
    </button>
  );
}

const ANCHOR_CELLS: readonly { value: LabelStyle['placement']; label: string }[] = [
  { value: 'top_left', label: 'Top left' },
  { value: 'top', label: 'Top' },
  { value: 'top_right', label: 'Top right' },
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
  { value: 'bottom_left', label: 'Bottom left' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'bottom_right', label: 'Bottom right' },
];

export function AnchorGrid({
  value,
  onChange,
}: {
  value: LabelStyle['placement'];
  onChange: (next: LabelStyle['placement']) => void;
}) {
  const normalized = value === 'above' ? 'top' : value === 'below' ? 'bottom' : value;
  return (
    <div className="anchor-grid" role="radiogroup" aria-label="Label anchor">
      {ANCHOR_CELLS.map((cell) => {
        const active = normalized === cell.value;
        return (
          <button
            key={cell.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={cell.label}
            title={cell.label}
            className={`anchor-cell${active ? ' active' : ''}`}
            onClick={() => onChange(cell.value)}
          >
            <span className="anchor-dot" />
          </button>
        );
      })}
    </div>
  );
}
