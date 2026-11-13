# Redesign (pen.dev handoff)

The interface redesign, made in pen.dev from `../INTERFACE.md`. It was written for the macOS SwiftUI app; the web rebuild uses it as its UI spec. `docs/WEB_REBUILD.md` says how it is adapted.

| File | What it is |
|---|---|
| `REDESIGN-BRIEF.md` | Goals, the Area → Style → Signs → Export flow, per-screen spec, acceptance criteria. Renamed to Nolli, otherwise as received |
| `screens/` | The three designed screens (2880 × 1800, converted from PNG to JPEG to keep the repository small) |
| `nolli-redesign.pen` | The pen.dev source file, with the name changed in its text |
| `DesignTokens.swift` | Tokens as Swift constants, as received (useful if the macOS app is restyled) |
| `../../../web/apps/editor/src/tokens.css` | The same tokens as CSS variables, plus provisional dark values. It lives in the web app, which is what uses it |

## Read these caveats before building from it

- **Only three screens are drawn.** The four-phase tabs, the Area phase, the Export view, the edit-mode bar, the Map row, the command palette and dark mode exist only as text in the brief.
- **The screenshots still show the old top bar** (a Design / Signs switch and a Fetch button, no phase tabs). The brief's text replaces those; follow the text.
- **The screenshots say "Penrith.mapcraft"** in the status bar. That is the old name baked into the image.
- **The brief's constraints mention SwiftUI, SF Pro and SF Symbols.** For the web app use Inter and Lucide, which the design file already uses.
- **Edit mode differs from the brief.** The brief keeps Revert All and Save; the web app drops them in favour of undo and a Reset edits action.
- The original handoff also carried a `reference/` folder. It is left out because it duplicates `../INTERFACE.md` and `../tokens.json`.
