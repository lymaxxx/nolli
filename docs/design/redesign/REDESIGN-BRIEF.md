# Nolli UI/UX redesign: implementation brief

For Claude Code, working in the Nolli macOS app (SwiftUI). Read this file first, then `reference/INTERFACE-original.md` (what the app does today) and the PNGs in `screens/`.

I (the designer's assistant) have **not seen the Swift source**. Nothing here names real files or types. Start by exploring the repo and mapping each item below to the code that owns it. Ask before large refactors.

## What is in this package

| Path | What it is |
|---|---|
| `REDESIGN-BRIEF.md` | This file: goals, flow, per-screen spec, plan, acceptance criteria |
| `screens/01-style-roads-labels.png` | Style phase, Roads selected, Labels tab, Primary type chip active |
| `screens/02-signs-mode.png` | Signs phase: list, live preview, placement and size |
| `screens/03-export-sheet.png` | Export sheet (to become an Export view, see Phase 4) |
| `nolli-redesign.pen` | Source design file (pen.dev). Frames: "Editor – Roads labels", "Editor – Signs mode", "Editor – Export sheet" |
| `DesignTokens.swift` | Colour, size and type tokens as Swift constants |
| `reference/` | Original interface description and measured tokens of the current app |

### Designed vs only described

- **Designed (3 screens above):** visual language, toolbar, layers panel, road-type chips, collapsible inspector sections, banner and override patterns, Signs inspector, Export sheet.
- **Only described in this brief (not drawn):** the four-phase flow, the Area phase and its empty state, the Export *view*, the Edit-mode bar, the Map row, the ⌘K palette, dark mode. Use the text as the spec and keep to the same visual language. If something is ambiguous, ask rather than invent.

## Product in one paragraph

Nolli turns OpenStreetMap data into wayfinding maps. A designer picks an area, fetches roads/water/buildings as layers, styles them like vector art (road names set on a path), optionally places signs that each get a print-ready map face, then exports SVG, PDF or an Illustrator script. Users are graphic designers who live in Illustrator and Figma. The canvas is the hero; the UI should feel like a calm, dense Figma-style editor.

## Goals

1. Make the UI follow the job: **Area → Style → Signs → Export**.
2. Remove duplication (two road trees, two Design/Signs switches).
3. Make state visible (what is overridden, what is hidden and why, what is unsaved).
4. Shorten the inspector with progressive disclosure.
5. One restrained accent colour; red only for destructive.

## Hard constraints (unchanged from the original brief)

- Native macOS, SwiftUI, system font (SF Pro) and SF Symbols. Design file uses Inter and Lucide only as stand-ins.
- Must look right in dark mode (not yet designed: see Open questions).
- Left panel 256 pt, right panel 300 pt. Map is the largest element and is never covered by floating panels (small overlays like zoom control and hint pill are fine).
- Every numeric field: typed input, ↑/↓ stepping, Shift for ×10, drag-to-scrub on its prefix. Values may exceed the slider range.
- One control hides both side panels.
- The map's own labels (road names) are output, not UI. Do not restyle their typography.
- Keep existing behaviour of inheritance (road type inherits from master), colour panel, undo, and file format. This is a UI change, not a data-model change.

## The new flow

Top bar centre or left (your call, see Open questions): phase tabs **Area · Style · Signs · Export**, shortcuts ⌘1–⌘4. Each phase swaps the toolbar contents and side panels. Phases are navigation, not a locked wizard: the user can jump anywhere once data exists.

### 1. Area
- New project opens here. Search field, then two actions: **Use Current View** and **Draw Area**.
- Checklist of layers to fetch (Roads, Water, Buildings, Parks, Transport, Pedestrian) with approximate counts; all on by default.
- **Fetch data** is the primary action, with a progress bar and cancel.
- After a successful first fetch, offer a palette/preset (today's "Schemes") before landing in Style.
- Afterwards this phase shows the area and a **Refresh data** action. The refresh icon in the old toolbar goes away.

### 2. Style
- Left: layer list. First row **Map** (today's "Frame": background, tiles opacity, rotation, north arrow, base zoom, sign defaults), selected by default. This replaces "press Esc to see Frame".
- Layer rows have icon, name, count. Icons and Labels child rows are removed; they become inspector tabs.
- **Roads is one row.** Inspector shows chips `All roads · Primary · Secondary · Local · Paths · Cycling` and tabs `Line | Labels`. Selecting a chip keeps the tab, so the user can compare Line and Labels for the same type. Chips with overrides show a dot.
- Inheritance: overridden fields get an accent label and a dot (make the dot at least 6 pt with a ≥ 20 pt hit area; click resets the field). A bar above the sections says "N values differ from All roads" with **Reset all**.
- Inspector sections are collapsible, state remembered per section. Default open: Text, Along the road. Default closed: Overlap, Halo, Shadow, Callouts.
- Label visibility problems ("130 of 196 names fit") appear as an amber banner at the top of the Labels tab **and** as a small warning on the layer row and map status. They also say what to do.
- **Select / Edit** is a mode toggle. In Edit mode a bar on the map shows the hint plus **Revert All** (destructive style) and **Save** (primary). Those two buttons exist only in Edit mode.

### 3. Signs
- Left: sign list with name and one-line summary (facing, size, two-sided). `+` then click the map; first-use hint under the list. Ideal: clicking the map while Signs is active places a sign directly (decide with the user).
- Right: large live preview at the top (drag to reframe, eye button to toggle on map), then Placement, Size, Artwork sections.
- Marker on the map shows position and a needle for facing. Dragging the needle rotates.
- **Export all signs** at the bottom of the list.

### 4. Export
- Replaces the modal sheet. The **bounding box (artboard) tool lives here**, since it defines the export area, not the fetch area.
- Right panel: format cards (SVG, PDF, Illustrator), artboard W/H in mm with **Fit to area**, DPI with resulting pixel size, live-type toggle for curved road names, primary **Export…** button. Signs batch export is a second option in the same panel.
- Phase 4 can ship last. Until then, keep the sheet from `screens/03-export-sheet.png` and open it from the toolbar's Export button.

### Toolbar (all phases)

Left to right: window controls, panel toggle, location search, document title with save state (green dot + "Saved", or "Edited"). Right: phase-specific tools, document menu, **Export** (the single filled button), settings. The dedicated Design/Signs switch and the duplicate right-panel tabs are removed; the phase tabs replace them. Tools get text labels (Select, Edit, Area). Rare actions (settings, text styles, cache) are also reachable via a ⌘K command palette.

## Visual spec (see screenshots and `DesignTokens.swift`)

- Panels white, 1 pt hairlines, no cards or boxes inside inspectors. Sections separated by hairline only.
- Selected rows and cards: soft accent tint (`accentSoft`) with accent text/icon.
- Controls 26 pt high, fields `field` grey, radius 6. Property label column 70 pt.
- Segmented controls: grey track, white raised selected segment, accent icon on the selected one.
- Type: 12 pt body, 13 pt row titles, 14 pt inspector title, 11 pt captions, 11 pt semibold tracked overlines.
- Accent is used for: selected row, primary button, slider fill, switch, selected chip, override dot. Not for decoration.
- Prefer SwiftUI system controls (Toggle, Picker, Slider, Stepper, DisclosureGroup, Table) and style them rather than drawing custom ones, unless the screenshot needs something the system control cannot do. Chips and the 3×3 anchor grid are custom.

## Implementation plan

Do these as separate, reviewable steps. After each, build, run, and compare with the screenshots.

1. **Tokens and theme.** Add `DesignTokens.swift`. Replace hard-coded colours and system-accent use for interactive states. Add dark variants.
2. **Layers panel.** Flatten the tree, remove Icons/Labels child rows, add the Map row, add the warning indicator. Keep drag-to-reorder and hide/show.
3. **Inspector shell.** Header, road-type chips, tabs, collapsible sections with remembered state, override bar and larger reset dot. Do Roads first, then area and point layers.
4. **Toolbar.** New layout, labelled tools, Edit-mode bar (Revert All / Save), remove the duplicate Design/Signs control.
5. **Phase navigation.** Introduce the phase tabs and Area phase (including the empty state and fetch checklist). Style and Signs keep their panels from steps 2–3.
6. **Signs inspector.** Large preview, grouped sections, list summaries.
7. **Export view.** Move export into its own phase; keep artboard tool here.
8. **Polish.** ⌘K palette, ⌘1–⌘4, empty/loading/error states, keyboard navigation, accessibility labels, VoiceOver for chips and override dots.

## Acceptance criteria

- A new user can go from empty project to exported PDF without opening a menu or guessing an icon.
- Roads appear once in the layer list; no layer inspector needs vertical scrolling for its default-open sections at 811 pt window height.
- Overridden values are visible without hovering; one click resets a field; one click resets all.
- No red and blue buttons side by side; destructive actions are the only red.
- All numeric fields keep typing, arrow stepping, Shift ×10, scrub.
- Works at 1360 × 811 and larger; panels keep 256/300 pt.
- Light and dark mode both pass a contrast check (WCAG AA for text).
- Existing documents open unchanged.

## Open questions (ask the designer, do not guess)

1. Phase tabs in the toolbar centre or left? Phases free-jump or gated until data exists? (Recommended: free-jump.)
2. Should clicking the map in Signs phase place a sign directly, or keep the + step?
3. Dark-mode palette: derive from system colours, or define explicit dark tokens?
4. The Frame/"Map" settings: one row in the layer list, or a separate Map tab?
5. If users are mostly experts, is the phase bar too much? Fallback: keep the free-form toolbar and ship only the Area and Export changes.

## Suggested first message to Claude Code

> Read `REDESIGN-BRIEF.md` and look at `screens/`. Explore the repo, then tell me how each plan step maps to the code and what you would change first. Don't edit anything until I approve the plan for step 1.
