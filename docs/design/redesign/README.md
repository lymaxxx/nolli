# Redesign (pen.dev handoff)

Updated interface handoff for the web app and its desktop wrappers. `docs/WEB_REBUILD.md` records the implementation decisions and where Nolli deliberately departs from this brief.

| File | What it is |
|---|---|
| `REDESIGN-BRIEF.md` | Goals, two-tier window chrome, the Area → Style → Signs → Export flow, per-screen spec and acceptance criteria. Repository paths and screenshot extensions have been adapted; the design content is as received |
| `screens/` | Five designed screens at 2880 × 1800, converted from the handoff's PNGs to JPEG: Style and Signs on macOS, the macOS Export sheet, and Style on Windows and Linux |
| `nolli-redesign.pen` | The pen.dev source file, with frames named `Nolli – <OS> · <screen>` |
| `DesignTokens.swift` | Tokens from the earlier native-Mac handoff, retained only as a reference for restyling the macOS app; it is not the web design source |
| `../../../web/apps/editor/src/tokens.css` | Current `--nolli-*` web tokens. Light values are designed; dark values are a proposal and still need contrast checks |

## Read these caveats before building from it

- **The five screens show Design / Signs mode tabs.** The four-phase tabs, Area phase, Export view, edit-mode bar, Map row, command palette, dark mode, narrow-window behaviour and plain-browser chrome exist only as text. The brief's text supersedes the older controls baked into the pictures.
- **The titlebar and toolbar are separate tiers.** The titlebar owns the Nolli menu, project tabs and app-level actions; the toolbar owns map work. Desktop chrome differs by OS; a plain browser omits the window controls. The project name appears only in its tab.
- **Inter and Lucide are the web choices.** The earlier SwiftUI / SF Pro constraints no longer apply. `DesignTokens.swift` must not be used as the source of web tokens.
- **Edit mode differs from the brief.** The brief keeps Revert All and Save; the web app drops them in favour of undo and a Reset edits action.
- The handoff's `reference/` folder is omitted because it duplicates `../INTERFACE.md` and `../tokens.json`.
