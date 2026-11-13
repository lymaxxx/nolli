import { matchFont, type FontMatch, type FontRequest } from '@nolli/core';
import { useRef } from 'react';
import { canReadInstalledFonts, fontKey, type FontEntry } from './fontStore';

interface Props {
  requests: readonly FontRequest[];
  entries: readonly FontEntry[];
  busy: boolean;
  onFindInstalled: () => void;
  onChooseFile: (request: FontRequest, file: File) => void;
  onRemove: (entry: FontEntry) => void;
}

function describe(match: FontMatch, entry: FontEntry | undefined): string {
  switch (match.kind) {
    case 'exact':
      return entry?.source === 'file' ? 'Using the file you chose' : 'Using the installed font';
    case 'family':
      return `Using the closest face: ${match.style}`;
    case 'fallback':
      return 'Not found. Noto Sans is drawn instead';
  }
}

/**
 * Says which of the project's fonts the app has, and lets the user supply the
 * missing ones. Until a font is supplied, labels use Noto Sans and will not
 * match the project's real lettering.
 */
export function FontPanel({ requests, entries, busy, onFindInstalled, onChooseFile, onRemove }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<FontRequest | null>(null);
  if (requests.length === 0) return null;

  const missing = requests.filter((request) => matchFont(entries, request).kind === 'fallback').length;

  return (
    <section className="font-panel" aria-label="Fonts">
      <h2>Fonts</h2>
      <p className="hint">
        {missing === 0
          ? 'Every font this project uses is available, or matched to its closest face.'
          : `${missing} of ${requests.length} fonts not found. Labels in those fonts are drawn in Noto Sans, so their width and look will differ from the project's.`}
      </p>
      <ul>
        {requests.map((request) => {
          const match = matchFont(entries, request);
          const entry = entries.find((candidate) => fontKey(candidate.family, candidate.style) === fontKey(request.family, request.style));
          return (
            <li key={fontKey(request.family, request.style)} data-status={match.kind}>
              <div className="font-name">
                <strong>{request.family}</strong> <span>{request.style}</span>
              </div>
              <div className="font-status">{describe(match, entry)}</div>
              <div className="font-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    pending.current = request;
                    input.current?.click();
                  }}
                >
                  Choose file…
                </button>
                {entry?.source === 'file' && (
                  <button type="button" className="link-button" onClick={() => onRemove(entry)}>
                    Remove
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {canReadInstalledFonts() ? (
        <button type="button" disabled={busy} onClick={onFindInstalled}>
          Find installed fonts
        </button>
      ) : (
        <p className="hint">This browser cannot list installed fonts. Choose the font files instead.</p>
      )}
      <input
        ref={input}
        type="file"
        accept=".ttf,.otf,font/ttf,font/otf"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          const request = pending.current;
          event.target.value = '';
          if (file && request) onChooseFile(request, file);
        }}
      />
    </section>
  );
}
