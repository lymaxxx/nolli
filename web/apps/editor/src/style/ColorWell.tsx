import {
  cmykToRgb,
  colorToHex,
  cssColor,
  hexToColor,
  hsbToRgb,
  paletteSample,
  rgbToCmyk,
  rgbToHsb,
  sameColor,
  type CodableColor,
  type MapColorScheme,
} from '@nolli/core';
import { useEffect, useRef, useState } from 'react';
import { NumberInput, PropRow, SegmentedControl } from './Controls';

export interface ColorLibraryActions {
  swatches: readonly CodableColor[];
  schemes: readonly MapColorScheme[];
  onAddSwatch: (color: CodableColor) => void;
  onRemoveSwatch: (index: number) => void;
  onSaveScheme: (name: string) => void;
  onApplyScheme: (scheme: MapColorScheme) => void;
  onDeleteScheme: (id: string) => void;
}

type ColorMode = 'HEX' | 'RGB' | 'HSB' | 'CMYK';
type PanelTab = 'Color' | 'Schemes';

export function ColorRow({
  label,
  color,
  onChange,
  opacity,
  onOpacityChange,
  overridden = false,
  onReset,
  library,
}: {
  label: string;
  color: CodableColor;
  onChange: (next: CodableColor) => void;
  opacity?: number;
  onOpacityChange?: (next: number) => void;
  overridden?: boolean;
  onReset?: () => void;
  library?: ColorLibraryActions;
}) {
  return (
    <PropRow label={label} overridden={overridden} onReset={onReset}>
      <ColorWell label={label} color={color} onChange={onChange} library={library} />
      {opacity !== undefined && onOpacityChange ? (
        <NumberInput
          value={Math.round(opacity * 100)}
          onChange={(pct) => onOpacityChange(Math.max(0, Math.min(100, pct)) / 100)}
          min={0}
          max={100}
          step={1}
          digits={0}
          unit="%"
          ariaLabel={`${label} opacity`}
        />
      ) : null}
    </PropRow>
  );
}

export function ColorWell({
  label,
  color,
  onChange,
  library,
}: {
  label: string;
  color: CodableColor;
  onChange: (next: CodableColor) => void;
  library?: ColorLibraryActions;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<PanelTab>('Color');
  const [mode, setMode] = useState<ColorMode>('HEX');
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const [schemeName, setSchemeName] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  const hsb = rgbToHsb(color);
  const cmyk = rgbToCmyk(color);
  const displayedHex = hexDraft ?? colorToHex(color);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const commitHex = (raw: string) => {
    const parsed = hexToColor(raw, color.a);
    setHexDraft(null);
    if (parsed) {
      onChange(parsed);
    }
  };

  return (
    <div className="color-well-wrap" ref={wrapRef}>
      <div className="color-well-field">
        <button
          type="button"
          className="color-swatch-btn"
          aria-label={`Open ${label} colour picker`}
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="color-swatch-chip" style={{ background: cssColor(color) }} />
        </button>
        <input
          type="text"
          className="color-hex-inline"
          aria-label={`${label} hex`}
          value={displayedHex}
          maxLength={7}
          onChange={(event) => {
            const val = event.target.value;
            setHexDraft(val);
            const parsed = hexToColor(val, color.a);
            if (parsed && val.replace(/^#/, '').length === 6) {
              onChange(parsed);
            }
          }}
          onBlur={() => commitHex(displayedHex)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitHex(displayedHex);
          }}
        />
      </div>

      {open && (
        <div className="color-popover" role="dialog" aria-label={`${label} colour panel`}>
          <SegmentedControl
            value={tab}
            options={[
              { value: 'Color', label: 'Color' },
              { value: 'Schemes', label: 'Schemes' },
            ]}
            onChange={setTab}
            ariaLabel="Colour panel tab"
          />

          {tab === 'Color' ? (
            <div className="color-popover-grid">
              <div className="color-editor-col">
                <div
                  className="color-sb-pad"
                  style={{
                    backgroundColor: cssColor(hsbToRgb(hsb.h, 1, 1, 1)),
                  }}
                  onMouseDown={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    const updateFromMouse = (clientX: number, clientY: number) => {
                      const s = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
                      const b = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
                      onChange(hsbToRgb(hsb.h, s, b, color.a));
                    };
                    updateFromMouse(event.clientX, event.clientY);
                    const onMove = (moveEvent: MouseEvent) =>
                      updateFromMouse(moveEvent.clientX, moveEvent.clientY);
                    const onUp = () => {
                      window.removeEventListener('mousemove', onMove);
                      window.removeEventListener('mouseup', onUp);
                    };
                    window.addEventListener('mousemove', onMove);
                    window.addEventListener('mouseup', onUp);
                  }}
                >
                  <span
                    className="color-sb-thumb"
                    style={{
                      left: `${hsb.s * 100}%`,
                      top: `${(1 - hsb.b) * 100}%`,
                    }}
                  />
                </div>

                <label className="color-strip-row">
                  <span>Hue</span>
                  <input
                    type="range"
                    className="hue-slider"
                    aria-label="Hue"
                    min={0}
                    max={360}
                    step={1}
                    value={Math.round(hsb.h * 360)}
                    onChange={(event) => {
                      const h = Number.parseFloat(event.target.value) / 360;
                      onChange(hsbToRgb(h, Math.max(hsb.s, 0.01), Math.max(hsb.b, 0.01), color.a));
                    }}
                  />
                </label>

                <SegmentedControl
                  value={mode}
                  options={[
                    { value: 'HEX', label: 'HEX' },
                    { value: 'RGB', label: 'RGB' },
                    { value: 'HSB', label: 'HSB' },
                    { value: 'CMYK', label: 'CMYK' },
                  ]}
                  onChange={setMode}
                  ariaLabel="Colour mode"
                />

                {mode === 'HEX' && (
                  <label className="hex-box-row">
                    <span>#</span>
                    <input
                      type="text"
                      aria-label="Hex colour code"
                      value={displayedHex}
                      onChange={(event) => setHexDraft(event.target.value)}
                      onBlur={() => commitHex(displayedHex)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') commitHex(displayedHex);
                      }}
                    />
                  </label>
                )}

                {mode === 'RGB' && (
                  <div className="channel-row">
                    <NumberInput
                      prefix="R"
                      value={Math.round(color.r * 255)}
                      min={0}
                      max={255}
                      onChange={(r) => onChange({ ...color, r: r / 255 })}
                    />
                    <NumberInput
                      prefix="G"
                      value={Math.round(color.g * 255)}
                      min={0}
                      max={255}
                      onChange={(g) => onChange({ ...color, g: g / 255 })}
                    />
                    <NumberInput
                      prefix="B"
                      value={Math.round(color.b * 255)}
                      min={0}
                      max={255}
                      onChange={(b) => onChange({ ...color, b: b / 255 })}
                    />
                  </div>
                )}

                {mode === 'HSB' && (
                  <div className="channel-row">
                    <NumberInput
                      prefix="H"
                      value={Math.round(hsb.h * 360)}
                      min={0}
                      max={360}
                      onChange={(h) => onChange(hsbToRgb(h / 360, hsb.s, hsb.b, color.a))}
                    />
                    <NumberInput
                      prefix="S"
                      value={Math.round(hsb.s * 100)}
                      min={0}
                      max={100}
                      onChange={(s) => onChange(hsbToRgb(hsb.h, s / 100, hsb.b, color.a))}
                    />
                    <NumberInput
                      prefix="B"
                      value={Math.round(hsb.b * 100)}
                      min={0}
                      max={100}
                      onChange={(b) => onChange(hsbToRgb(hsb.h, hsb.s, b / 100, color.a))}
                    />
                  </div>
                )}

                {mode === 'CMYK' && (
                  <div className="channel-row">
                    <NumberInput
                      prefix="C"
                      value={Math.round(cmyk.c * 100)}
                      min={0}
                      max={100}
                      onChange={(c) => onChange(cmykToRgb(c / 100, cmyk.m, cmyk.y, cmyk.k, color.a))}
                    />
                    <NumberInput
                      prefix="M"
                      value={Math.round(cmyk.m * 100)}
                      min={0}
                      max={100}
                      onChange={(m) => onChange(cmykToRgb(cmyk.c, m / 100, cmyk.y, cmyk.k, color.a))}
                    />
                    <NumberInput
                      prefix="Y"
                      value={Math.round(cmyk.y * 100)}
                      min={0}
                      max={100}
                      onChange={(y) => onChange(cmykToRgb(cmyk.c, cmyk.m, y / 100, cmyk.k, color.a))}
                    />
                    <NumberInput
                      prefix="K"
                      value={Math.round(cmyk.k * 100)}
                      min={0}
                      max={100}
                      onChange={(k) => onChange(cmykToRgb(cmyk.c, cmyk.m, cmyk.y, k / 100, color.a))}
                    />
                  </div>
                )}
              </div>

              {library && (
                <div className="swatches-col">
                  <div className="swatches-header">
                    <span>Swatches</span>
                    <button
                      type="button"
                      className="icon-btn"
                      title="Save current colour as swatch"
                      aria-label="Save swatch"
                      onClick={() => library.onAddSwatch(color)}
                    >
                      +
                    </button>
                  </div>
                  {library.swatches.length === 0 ? (
                    <p className="hint">Press + to keep the current colour here.</p>
                  ) : (
                    <div className="swatches-grid">
                      {library.swatches.map((swatch, index) => (
                        <div key={`${colorToHex(swatch)}-${index}`} className="swatch-item">
                          <button
                            type="button"
                            className={`swatch-btn${sameColor(swatch, color) ? ' active' : ''}`}
                            style={{ background: cssColor(swatch) }}
                            title={`#${colorToHex(swatch)}`}
                            aria-label={`Apply swatch #${colorToHex(swatch)}`}
                            onClick={() => onChange(swatch)}
                          />
                          <button
                            type="button"
                            className="swatch-del"
                            title="Delete swatch"
                            aria-label={`Delete swatch #${colorToHex(swatch)}`}
                            onClick={() => library.onRemoveSwatch(index)}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="schemes-panel">
              <p className="hint">
                A scheme stores every colour on the map: lines, fills, labels and background.
              </p>
              {library && (
                <>
                  <div className="scheme-save-row">
                    <input
                      type="text"
                      placeholder="Scheme name"
                      aria-label="Scheme name"
                      value={schemeName}
                      onChange={(event) => setSchemeName(event.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        library.onSaveScheme(
                          schemeName.trim() || `Scheme ${library.schemes.length + 1}`,
                        );
                        setSchemeName('');
                      }}
                    >
                      Save Current
                    </button>
                  </div>
                  {library.schemes.length === 0 ? (
                    <p className="hint">No schemes saved yet.</p>
                  ) : (
                    <ul className="scheme-list">
                      {library.schemes.map((scheme) => (
                        <li key={scheme.id} className="scheme-row">
                          <span className="scheme-palette" aria-hidden="true">
                            {paletteSample(scheme).map((sample, idx) => (
                              <span
                                key={idx}
                                className="scheme-chip"
                                style={{ background: cssColor(sample) }}
                              />
                            ))}
                          </span>
                          <span className="scheme-name">{scheme.name}</span>
                          <button type="button" onClick={() => library.onApplyScheme(scheme)}>
                            Apply
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            title="Delete scheme"
                            aria-label={`Delete ${scheme.name}`}
                            onClick={() => library.onDeleteScheme(scheme.id)}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
