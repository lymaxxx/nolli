import { exportPixelSize, fitHeightToArea, type ProjectSnapshot, type SvgExportOptions } from '@nolli/core';
import { useState } from 'react';
import { CollapsibleSection, NumberInput, PropRow, SegmentedControl, SwitchToggle } from '../style/Controls';
import { Icon } from '../style/Icon';

interface Props {
  project: ProjectSnapshot | null;
  /** Writes the file. Rejects with a message the panel shows. */
  onExport: (options: SvgExportOptions) => Promise<void>;
}

/** Pixels beyond which a single SVG gets slow to open in most editors. */
const LARGE_PIXELS = 12000;

/**
 * The Export phase's panel: artboard size, text handling, and the export
 * button. The artboard starts from the project's own defaults.
 */
export function ExportInspector({ project, onExport }: Props) {
  const [widthMM, setWidthMM] = useState(project?.settings.defaultWidthMM ?? 400);
  const [heightMM, setHeightMM] = useState(project?.settings.defaultHeightMM ?? 400);
  const [dpi, setDpi] = useState(project?.settings.defaultDPI ?? 300);
  const [text, setText] = useState<SvgExportOptions['text']>('outlines');
  const [embedBBoxMeta, setEmbedBBoxMeta] = useState(false);
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'working' } | { kind: 'ok'; text: string } | { kind: 'error'; text: string }>({ kind: 'idle' });

  const bbox = project?.boundingBox;
  const pixels = exportPixelSize({ widthMM, heightMM, dpi });
  const large = Math.max(pixels.width, pixels.height) > LARGE_PIXELS;
  const working = state.kind === 'working';

  async function run() {
    setState({ kind: 'working' });
    try {
      await onExport({ widthMM, heightMM, dpi, text, embedBBoxMeta });
      setState({ kind: 'ok', text: 'Exported.' });
    } catch (error) {
      setState({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <aside className="right-panel" aria-label="Export">
      <header className="inspector-header">
        <span className="inspector-icon" aria-hidden="true">
          <Icon name="share" size={18} />
        </span>
        <div>
          <h2>Export</h2>
          <p className="inspector-subtitle">Write the map as a file</p>
        </div>
      </header>

      <div className="inspector-scroll">
        <CollapsibleSection title="Format">
          <SegmentedControl
            ariaLabel="Format"
            value="svg"
            options={[{ value: 'svg', label: 'SVG' }]}
            onChange={() => {}}
          />
          <p className="hint">PDF and an Illustrator script are not available yet.</p>
        </CollapsibleSection>

        <CollapsibleSection title="Artboard">
          <PropRow label="Width">
            <NumberInput value={widthMM} onChange={setWidthMM} min={10} max={5000} step={10} digits={0} unit="mm" ariaLabel="Width in millimetres" />
          </PropRow>
          <PropRow label="Height">
            <NumberInput value={heightMM} onChange={setHeightMM} min={10} max={5000} step={10} digits={0} unit="mm" ariaLabel="Height in millimetres" />
          </PropRow>
          <PropRow label="Resolution">
            <NumberInput value={dpi} onChange={setDpi} min={36} max={1200} step={12} digits={0} unit="dpi" ariaLabel="Resolution in dots per inch" />
          </PropRow>
          <button
            type="button"
            disabled={!bbox}
            onClick={() => bbox && setHeightMM(Math.round(fitHeightToArea(bbox, widthMM)))}
          >
            Fit to area
          </button>
          <p className="hint" data-testid="export-pixels">
            {Math.round(pixels.width).toLocaleString()} × {Math.round(pixels.height).toLocaleString()} px
          </p>
          {large && <p className="hint warn">That is a large file. Some editors will be slow to open it.</p>}
        </CollapsibleSection>

        <CollapsibleSection title="Text">
          <SegmentedControl
            ariaLabel="Text"
            value={text}
            options={[
              { value: 'outlines', label: 'Outlines' },
              { value: 'live', label: 'Live text' },
            ]}
            onChange={setText}
          />
          <p className="hint">
            {text === 'outlines'
              ? 'Names become shapes. They look the same everywhere and in every script, but cannot be edited as text.'
              : 'Names stay editable text. They show whatever font the viewer has, so install the project fonts first. Illustrator flattens curved names on import.'}
          </p>
          <PropRow label="Bounds">
            <SwitchToggle checked={embedBBoxMeta} onChange={setEmbedBBoxMeta} ariaLabel="Write the area bounds into the file" />
          </PropRow>
        </CollapsibleSection>

        <div className="export-actions">
          {!bbox && project && (
            <p className="hint warn">This project has no area to export yet.</p>
          )}
          <button type="button" className="primary" disabled={!project || !bbox || working} onClick={() => void run()}>
            {working ? 'Exporting…' : 'Export SVG…'}
          </button>
          {state.kind === 'ok' && (
            <p className="hint" role="status">
              {state.text}
            </p>
          )}
          {state.kind === 'error' && (
            <p className="hint warn" role="alert">
              {state.text}
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
