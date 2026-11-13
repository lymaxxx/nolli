# Nolli: UI/UX redesign and implementation brief

For Claude Code. Read this file first, then `../INTERFACE.md` and `../tokens.json` (the previous app, then called MapCraft) and the JPEGs in `screens/` (converted from the handoff's PNGs).

**Context change:** the product is now called **Nolli** and is a **web app** with desktop wrappers for macOS, Windows and Linux. It was a native SwiftUI Mac app (MapCraft). The old interface description and measured tokens in `reference/` are about that app; the behaviour carries over, the platform assumptions do not.

I (the designer's assistant) have **not seen any source code**, old or new. Nothing here names real files. Explore the repo first, and ask before large refactors or stack choices.

## Package contents

| Path | What it is |
|---|---|
| `REDESIGN-BRIEF.md` | This file |
| `screens/01-macos-style-roads-labels.jpg` | Style phase, Roads → Labels, macOS wrapper |
| `screens/02-macos-signs.jpg` | Signs, macOS wrapper |
| `screens/03-macos-export-sheet.jpg` | Export sheet over the editor |
| `screens/04-windows-style.jpg` | Same Style screen, Windows wrapper |
| `screens/05-linux-style.jpg` | Same Style screen, Linux wrapper |
| `nolli-redesign.pen` | Source design (pen.dev). Frames are named "Nolli – <OS> · <screen>" |
| `../../../web/apps/editor/src/tokens.css` | Design tokens as CSS custom properties, kept with the web app that uses them (light designed; dark is a proposal) |
| `../INTERFACE.md`, `../tokens.json` | Original description and tokens of the old native app (the handoff's `reference/` duplicates, omitted here) |

### Designed vs only described
- **Designed:** the visual language, the two-tier chrome (titlebar + toolbar) for three OSes, layers panel, Roads inspector with type chips, Signs inspector, Export sheet.
- **Only described here:** the four-phase flow, Area phase, Export view, Edit-mode bar, Map row, ⌘K palette, dark mode, narrow-window behaviour, the browser (non-wrapped) variant. Follow the text and the same visual language; ask when ambiguous.

## Product

Nolli turns OpenStreetMap data into wayfinding maps (the kind printed on signs and boards). A designer picks an area, fetches roads, water, buildings and so on as layers, styles them like vector artwork (road names set on a path), optionally places signs that each get a print-ready map face, then exports SVG, PDF or an Illustrator script. Users are graphic and wayfinding designers who live in Illustrator and Figma. The canvas is the hero. The feel is Figma: calm, dense, three-column.

## Goals
1. Follow the job: **Area → Style → Signs → Export**.
2. Remove duplication (two road trees, two Design/Signs switches).
3. Make state visible (overrides, hidden labels and why, unsaved changes).
4. Shorten inspectors with progressive disclosure.
5. One restrained accent; red only for destructive.
6. One UI that works in a browser and in three OS wrappers, where the wrapper chrome is part of the product, not an empty strip.

## Platform: web app plus wrappers

The app is a single web codebase. The wrappers only host it and supply window chrome.

**Stack (recommendation, confirm with the designer):** TypeScript, React, Vite; Tailwind with shadcn/ui primitives (the design file was built on a shadcn-style kit, so tokens map cleanly). The map renderer is the largest decision. It must support: vector styling per layer, text set on a path with per-type inheritance, manual vertex and label-dot edits, and clean SVG/PDF export. Evaluate MapLibre GL, a custom Canvas/SVG renderer, or a hybrid before committing. Prototype road-name-on-path first, it is the riskiest part.

**Wrapper choice (open question):** Electron gives identical Chromium rendering on all three OSes, which matters for typography, fonts and canvas output. Tauri is far smaller but uses WebKit on macOS and WebKitGTK on Linux, whose text, canvas and font behaviour differ. For a type-heavy design tool I lean Electron; decide with the team.

**Things that change versus the native app:**
- **Fonts.** Designers expect to use their installed fonts. The Local Font Access API exists only in Chromium; Safari and Firefox users get a bundled font list plus upload. Electron has it. Plan for font upload and a clear fallback state in the font picker.
- **Files.** The native app opened `.mapcraft` documents. Use `.nolli`. In the browser use the File System Access API where available (Chromium) and download/upload elsewhere; wrappers get real open/save dialogs. Autosave to IndexedDB (or the wrapper's disk) so "Saved/Edited" is honest.
- **Menus and shortcuts.** The browser has no menu bar, so the **Nolli menu** and **File menu** in the UI carry what the macOS menu bar did. Shortcuts use ⌘ on macOS and Ctrl elsewhere; show the right glyph per OS. Avoid browser-reserved combinations (Ctrl+W, Ctrl+T, Ctrl+N in a tab).
- **Gestures.** Pinch zoom arrives as ctrl+wheel in browsers; two-finger rotate has no standard web event (Safari only). Provide Option/Alt-drag rotate and a numeric rotation field as the baseline.
- **Data and tiles.** OSM tile servers have a usage policy that forbids heavy app traffic: use a configurable tile source (today's "data server" setting) and an Overpass endpoint with CORS or a small proxy. Reference tiles are never exported.
- **Dark mode** follows `prefers-color-scheme` with a manual override in Settings.
- **Resizing.** The browser window can be narrow. Below ~1100 px width collapse the right panel to an overlay; below ~800 px show a "best on a larger screen" notice rather than a broken layout.

## Window chrome: two tiers, like Figma

The previous version had a bare strip with three buttons above the toolbar. The chrome is now two bands. The **titlebar** belongs to the app (identity, documents, account). The **toolbar** belongs to the work (what I do on this map).

### Tier 1: Titlebar (40 px, tinted `--nolli-chrome`)

Left to right:
1. **OS window controls** (per wrapper, see below).
2. **Nolli menu**: accent monogram tile + "Nolli" wordmark + chevron. Opens a menu: New project, Open, Recent, Preferences, Help, About, Check for updates, Sign out. This is the app identity and is visually unlike the project name. **Replace the monogram with the real logo when it exists.**
3. **Project tabs**: one per open project. The active tab is white and merges into the toolbar below (top corners rounded 8, bottom flat). A tab = map icon, project name, green "saved" dot (or accent "edited" dot), close ×. Inactive tabs are plain text on the chrome. `+` opens a new project. The tab is the **only** place the project name appears; there is no second title in the toolbar. Double-click to rename. Tabs overflow into a scrollable strip with a dropdown listing all.
4. **Drag region** (the empty middle). In the wrapper it must be a window-drag area; interactive children opt out.
5. **Account cluster**: Help, **Settings**, Account (avatar). Settings moved here from the toolbar because it is app-level, not map-level.

**Per-OS differences. Everything else is identical.**

| | macOS | Windows | Linux |
|---|---|---|---|
| Controls | Traffic lights at far left, 14 px inset, before the Nolli menu | Minimise / maximise / close at far right, 46 × 40 px, flush to the edge | Round 24 px buttons at far right (minimise, maximise, close), GNOME-style |
| Nolli menu | After the lights | First item, 10 px inset | First item, 10 px inset |
| Right cluster inset | 12 px | 0 (controls touch the edge) | 12 px |

Implementation notes:
- Electron: `titleBarStyle: 'hidden'` with `titleBarOverlay` on Windows (native min/max/close drawn over your bar; reserve the env area), `hiddenInset` traffic lights on macOS. On Linux there is no overlay: draw the three round buttons yourself and wire them to IPC.
- Use CSS `-webkit-app-region: drag` on the bar and `no-drag` on tabs and buttons. Respect `env(titlebar-area-x/width)` where available so tabs never slide under native controls.
- Windows 11's snap-layout flyout comes only with the native overlay buttons; prefer them over drawn ones there.
- **In a plain browser** there is no OS chrome: render the same titlebar without window controls (the browser's own tab strip sits above it). Keep it, because the project tabs and Nolli menu are product UI.

### Tier 2: Toolbar (52 px, white)

Three zones whose edges line up with the columns below (256 | flexible | 300), 14 px side padding, hairline dividers, controls 28–30 px tall and vertically centred.

| Zone | Contents | Role |
|---|---|---|
| Left (256) | Toggle panels, Undo, Redo | History and layout |
| Map (flexible) | **Search + Fetch data** left; **Mode tabs** (Design / Signs; later the four phases) exactly centred; **Map tools** (Select, Edit, Area) right | What I'm working on |
| Output (300) | File menu (Save, Duplicate, Revert…), **Export** right-aligned, the only filled button | What leaves the app |

Control styles by function:
- **Mode tabs**: navigation. Text and icon, full bar height, 2 px accent underline on the active one, no background.
- **Map tools**: icon-only 30 px buttons, no shared track, soft accent tint on the active one. Tooltips show name and shortcut (V, E, A).
- **Actions**: outlined or ghost; Export alone is filled.

Moved out of the toolbar in this round: document title (now the tab), settings (now the titlebar), the macOS-style window controls (now the per-OS titlebar).

## The new flow (four phases)

Phase tabs **Area · Style · Signs · Export** replace the Design/Signs switch, with ⌘/Ctrl 1–4. Phases are navigation, not a locked wizard; free-jump once data exists.

1. **Area.** New projects open here. Search, then **Use Current View** or **Draw Area**. Checklist of layers to fetch with approximate counts. **Fetch data** is the primary action, with progress and cancel. After the first fetch, offer a palette/preset (today's "Schemes"). Later this phase shows the area and **Refresh data**.
2. **Style.** Left: layer list with a first row **Map** (background, tiles opacity, rotation, north arrow, base zoom, sign defaults), selected by default. **Roads is one row**; the inspector has chips `All roads · Primary · Secondary · Local · Paths · Cycling` and tabs `Line | Labels`; chips with overrides show a dot. Overridden fields get an accent label and a dot (≥ 6 px, ≥ 20 px hit area, click resets). A bar says "N values differ from All roads" with **Reset all**. Sections collapse and remember state; default open: Text, Along the road; closed: Overlap, Halo, Shadow, Callouts. "130 of 196 names fit" is an amber banner in the Labels tab plus a warning on the layer row. **Select / Edit** is a mode; Edit shows a bar on the map with hint, **Revert All** (destructive) and **Save** (primary), only while editing.
3. **Signs.** Left: list with name and one-line summary; `+` then click the map (decide whether a direct click should place). Right: large live preview first (drag to reframe, eye toggles it on the map), then Placement, Size, Artwork. The marker shows a facing needle; dragging it rotates. **Export all signs** under the list.
4. **Export.** A view, not a modal; the bounding-box (artboard) tool lives here. Right panel: format cards (SVG, PDF, Illustrator), artboard W/H in mm with **Fit to area**, DPI with resulting pixels, live-type toggle for curved road names, **Export…**. Signs batch export is a second option. Until built, keep the sheet from `screens/03-macos-export-sheet.jpg`.

## Visual spec

See `screens/` and `tokens.css`.
- White panels, 1 px hairlines, no cards in inspectors; sections separated by hairlines.
- Selected rows/cards: `--nolli-accent-soft` with accent text and icon.
- Controls 26 px, fields `--nolli-field`, radius 6; property label column 70 px.
- Segmented controls: grey track, raised white selected segment.
- Type: Inter (bundled) with system fallback; 12 body, 13 row titles, 14 inspector titles, 11 captions, 11 semibold tracked overlines.
- Accent only for: selected, primary, slider fill, switch, selected chip, override dot, active mode-tab underline. Red only for destructive.
- Build on accessible primitives (Radix via shadcn): Tabs, Switch, Slider, Select, Popover, Dialog, Collapsible, Tooltip, DropdownMenu. Chips and the 3 × 3 anchor grid are custom.
- Numeric fields everywhere: typed input, ↑/↓ stepping, Shift = ×10, drag-to-scrub on the prefix, values may exceed the slider range.
- The map's own labels (road names) are output, not UI; do not restyle their typography.
- Side panels stay 256 / 300 px; the map is the largest element and is not covered by floating panels (zoom control and hint pill are fine). One control hides both panels.

## Implementation plan

Separate, reviewable steps. After each: run, compare with the screenshots.
1. **Foundations.** Project setup, `tokens.css`, theme (light/dark), font bundling, shortcut layer with OS-aware glyphs.
2. **App shell.** Titlebar (tabs, Nolli menu, account cluster), toolbar zones, panel layout, resize behaviour. Browser first, then the Electron/Tauri wrapper with per-OS chrome.
3. **Layers panel** (flat list, Map row, warning indicator, drag reorder, hide/show).
4. **Inspector shell** (header, road chips, tabs, collapsible sections, override bar and dots), Roads first.
5. **Map renderer spike**, in parallel from step 2: road names on path, per-type inheritance, SVG export. Decide the renderer here.
6. **Area phase** (empty state, fetch checklist, progress).
7. **Signs** (list, preview, marker).
8. **Export view.**
9. **Polish.** ⌘K palette, empty/loading/error states, keyboard navigation, ARIA, screen-reader labels for chips and override dots, update checks, autosave and file handling per platform.

## Acceptance criteria
- A new user can go from an empty project to an exported PDF without opening a menu or guessing an icon.
- Roads appear once in the layer list; default-open inspector sections fit without scrolling at 1360 × 811.
- Overrides are visible without hovering; one click resets a field, one click resets all.
- The project name appears once (the tab); the app name appears once (Nolli menu); they look different.
- macOS, Windows, Linux and plain-browser builds each show correct window controls and drag behaviour; tabs never overlap native controls.
- Light and dark pass WCAG AA contrast for text.
- Numeric fields keep typing, stepping, Shift ×10, scrub.
- Documents saved by the old app can be imported (confirm the format with the designer).

## Open questions (ask, don't guess)
1. Electron or Tauri?
2. Map renderer: MapLibre, custom, or hybrid? (Run the spike in step 5.)
3. Phase tabs: toolbar centre (as drawn for Design/Signs) or elsewhere; free-jump or gated?
4. Does a click on the map in Signs place a sign directly?
5. Real Nolli logo and wordmark: replace the placeholder monogram when available.
6. Are projects local files only, or is there an account and cloud sync? The Account button in the titlebar is a placeholder until this is decided.
7. Import path for old `.mapcraft` documents?
8. Dark palette: use the proposal in `tokens.css` or design it explicitly?

## Suggested first message to Claude Code

> Read `REDESIGN-BRIEF.md` and look at `screens/`. Explore the repo, then tell me how the plan maps to what exists, which of the open questions block step 1, and what you would do first. Don't edit anything until I approve the plan for step 1.
