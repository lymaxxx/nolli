# Nolli — interface description

For redesign in pen.dev. Everything here describes the app as it is today (macOS, SwiftUI). The screenshots in `screens/` are the source of truth. `nolli-ui.html` is a rebuilt, editable copy, and `tokens.json` / `tokens.css` hold the measured values.

## What the product is

Nolli is a Mac app for designing wayfinding maps (the maps on physical signs and boards) from OpenStreetMap data. A designer chooses an area, fetches roads, water, buildings and so on as separate layers, styles them like vector artwork, and exports clean SVG, PDF or an Illustrator script. A second mode places **signs** on the map and produces a print-ready map face for each one, rotated to the direction the sign faces.

Users are graphic and wayfinding designers who already work in Illustrator and Figma. They care about typographic control (road names set on a path along the road), predictable output, and speed. The interface should feel like Figma: a calm, dense, three-column editor where the canvas is the hero.

## Layout

One window, 1360 × 811 in the screenshots, resizable. Three columns under a top bar, and a status bar:

| Region | Size | Contents |
|---|---|---|
| Top bar | 46 px high | Left to right: panel toggle, location search, document title (centred), tools, refresh, document and export, Design/Signs switch, settings |
| Left panel | 256 px | Tabs **Layers** and **Components**. Layers is a tree; Components holds the icon library and saved text styles |
| Map | fills the rest | The map itself, plus a floating zoom control (bottom right), the OpenStreetMap credit (bottom left) and a hint pill (top centre) in edit mode |
| Right panel | 300 px | Tabs **Design** and **Signs**. Design shows an inspector for whatever is selected |
| Status bar | 22 px | Zoom or pointer coordinates on the left, last action on the right |

The panels are docked and opaque (no floating cards). One button hides both side panels together.

## Top bar, left to right

1. **Panel toggle** — hides or shows both sidebars.
2. **Search** — finds a place; suggestions drop down under the field.
3. **Title** — document name; "— Edited" is appended when there are unsaved changes.
4. **Tools** (a single segmented group, one active at a time): Drag (pan and select), Edit (nodes and label dots), Bounding box (draw the area to export).
5. **Fetch** (refresh icon) — downloads OpenStreetMap data for the area; shows progress.
6. **Document** (a menu) and **Export** (opens the export sheet).
7. **Design / Signs** — switches the right panel. Note that the right panel also has its own Design / Signs tabs, so this control is duplicated.
8. **Settings** (gear) — opens the settings sheet.

In Edit mode two extra buttons appear before the Fetch button: **Revert All** (red text) and **Save** (blue, filled).

## Left panel — Layers

A tree, rows 28 px high, 18 px indent per level, a count on the right in grey.

- **Layer rows**: one per data layer (Transport, Pedestrian Zones, Parks & Green Space, Water, Buildings, Roads, Background). Each has an icon, a name, a visibility toggle on hover, and a feature count. Layers stack top to bottom, so the top row draws on top. Drag to reorder.
- **Child rows** under a layer: **Icons** (symbols placed on features) and **Labels** (the names on the map). They only appear once added.
- **Roads** is special. It has five road types as children (Primary, Secondary, Local, Pedestrian & Paths, Cycling) for line styling, then a **Labels** group with the same five names for label styling. This duplication is deliberate (each type inherits from its master) but makes the tree long.
- **Add layer** (+) opens a menu grouped Roads / Areas / Points of interest.
- States: normal, hover (5% tint), selected (pale accent tint), hidden (dimmed), renaming (inline field).
- Empty state (new project): a short explanation and two buttons, **Use Current View** and **Draw Area**.

**Components tab**: a segmented control **Icons | Text Styles**. Icons shows an **Import SVG…** button and a grid of imported icons (empty state: "Import SVG files to build your icon library"). Text Styles lists saved typography presets with Edit and Delete.

## Right panel — Design

The panel shows one inspector depending on the selection. Each inspector is a stack of **sections**: a bold title, an optional switch on the right, then rows. Sections are separated by a 1 px hairline, with no boxes or cards. Padding is 12 px all round.

| Selection | What the inspector shows |
|---|---|
| Nothing (press Esc) | **Frame**: background fill, map tiles (opacity), view rotation, north arrow, base zoom ("design scale"), sign defaults |
| An area layer (Water, Buildings…) | Fill (colour, opacity), stroke, then link rows **Labels ›** and **Icons ›** |
| A point layer (Transport…) | Marker shape and size, fill, stroke, then **Labels** and **Icons** |
| Roads | Stroke (colour, width, caps, joins), casing, **Labels ›**, and **Manual edits** with a reset button |
| A road type (Primary…) | The same stroke controls, the OSM road types it covers, **Labels ›** |
| A Labels row | Text, placement, overlap, halo, shadow, callouts, text source. Starts with a line such as "10 of 20 names on the map…" |
| A road type's labels | The same controls, each inheriting from the Roads master |

Inspector header: a back chevron (for child inspectors), a bold title, and a grey subtitle.

### Property rows

A row is a 68 px grey label on the left and a control on the right, 24 px high, 8 px gap. The controls:

- **Slider + number field**: slider in the accent colour, field 58 px wide. The field accepts typing, ↑/↓ steps (Shift = ×10) and drag-to-scrub on its prefix. Values can go past the slider's visible range.
- **Colour**: a swatch + hex text, and a separate opacity field. Clicking opens the colour panel.
- **Picker**: a menu button (font, style, case, mode…). The font picker is a searchable list with each name set in its own typeface.
- **Segmented control**: Butt | Round | Square, Above | On | Below.
- **Switch**: a mini toggle, used in section headers.
- **Anchor grid**: a 3 × 3 grid of squares for label placement.
- **Hint**: 10 px grey help text.

### Inheritance (road types)

A road type's controls inherit from its master. A field the type has changed shows a small **blue dot** before its label and the label turns accent-coloured; clicking the dot resets that field. A button "Reset All to Master" appears when anything is overridden.

### Colour panel (popover)

Two tabs, **Color** and **Schemes**. Color has a saturation/brightness square, a hue bar, a greyscale bar, a HEX | RGB | HSB | CMYK switch with its fields, an opacity field, and a column of saved **Swatches** (+ to add). Schemes applies a whole-map palette.

## Map canvas

- Tiles (OpenStreetMap, reference only, never exported) sit under vector layers drawn by the app.
- Zoom: pinch, scroll wheel, or the floating control (A▲ north reset, fit area, −, level, +). Two fingers pan; Option-drag or a twist rotates.
- **Edit mode**: a red dot appears on each label or icon of the *selected* layer. Dragging a road-name dot slides the name along its road; other labels move freely. Selecting a building or road shows its vertices to drag. A pill at the top explains this.
- **Bounding box** tool: draws a dashed red rectangle that defines the export area.
- **Signs** are shown as a small marker with a needle for the facing direction.

## Signs tab

A list of signs with a **+** (then click the map to place one) and an export button. Selecting a sign shows: name, facing angle, double-sided switch, size in mm, DPI, label and icon scale, and a live **preview** of the sign face, with an eye button beside it. The preview framing can be dragged to choose what the sign shows.

## Sheets

- **Export sheet** (420 px, centred, scrim behind): format (SVG | PDF | Illustrator), an option to write curved road names as live type for Illustrator, an artboard size in mm with **Fit to Area**, DPI with the resulting pixel size, then Cancel and a filled **Export…** button.
- **Settings sheet**: OpenStreetMap cache duration, the data server address, and export defaults.

## Visual language today

- Flat and quiet: white panels, 1 px hairlines, very small grey fields (`#F3F3F3`, 5 px radius), no shadows except on popovers and sheets.
- Type: the system font at 11 px; section titles 11 px semibold; hints 10 px.
- One accent colour for everything interactive (selected tool, slider fill, switch, selected segment, primary button, selected layer row tint). It follows the macOS system accent, which is red on the author's Mac, so the screenshots are red.
- Light mode is shown. Dark mode follows the system automatically.
- Icons are SF Symbols. Layer kinds use `road.lanes`, `leaf`, `drop`, `building.2`, `figure.walk`, `square.fill`, `mappin`, `tram`; the toolbar uses a hand, a pencil, a dashed rectangle, a circular arrow, a document, a share arrow, sliders, a signpost and a gear.

## Things worth rethinking

These come from looking at the screenshots, not from user research. Treat them as questions.

1. **The right-panel inspectors are long.** The label inspector runs well past the bottom of the window (Halo and Shadow are already cut off in the screenshots). Scroll bars are hidden, so nothing signals that more is below. Sections cannot be collapsed.
2. **Two parallel trees for Roads.** The same five names appear once for line style and once for labels. Selecting one does not highlight its twin.
3. **Duplicated Design / Signs switch** (top bar and right panel tabs).
4. **Icon-only toolbar.** Nine icons, no labels. The grouping (tools | fetch | document | panels | settings) relies on proximity alone.
5. **Accent used for everything.** Selected, active, primary, slider fill and switch are the same strong colour, and in edit mode a red **Revert All** sits beside a blue **Save**, which clashes with it.
6. **Add-layer menu** looks cut off at the bottom (Education is partly hidden; it may scroll, which isn't obvious).
7. **Fields are small and tight.** At 300 px, labels such as "Repeat every" had to be shortened; sliders are short.
8. **Feedback about *why* something isn't shown** exists only as one grey sentence at the top of the label inspector.
9. **Inheritance dots are tiny** (5 px) for something users must find to reset a value.
10. The map's own labels (road names) are part of the product's output, not UI, so they should keep their typography when the interface is restyled.

## Constraints for a redesign

- Native macOS app: system fonts, SF Symbols and system controls where possible; it must still look right in dark mode.
- The right panel must stay about 300 px and the left 256 px, or the map loses too much room.
- The map canvas has to stay the largest element and must not be covered by floating panels.
- Everything numeric needs a typed field, arrow-key stepping and Shift for large steps.
- Panels hide with one control, and toolbar order is fixed: `(drag | edit | bounding box) (fetch) (document | export) (style | sign) (settings)`.
