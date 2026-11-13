# Nolli — Product Design Document

> Describes the macOS app in `macos/`. Source paths below are relative to `macos/Nolli/`.

## Purpose

Nolli is a native macOS app for designing professional wayfinding maps from OpenStreetMap data. It replaces the QGIS + MapPublisher workflow with a purpose-built authoring tool that:

- Fetches real OSM data for any bounding box
- Styles each feature type (roads, parks, buildings, POIs…) with live preview
- Renders typographically rich labels following road curvature
- Places and previews physical wayfinding signs at real-world lat/lon positions
- Exports clean SVG (with editable `<textPath>` labels), PDF, and sign artwork at press DPI

---

## Architecture Overview

Nolli has **one native rendering pipeline**. There is no web view.

| Piece | File | Role |
|---|---|---|
| Camera | `Models/MapCamera.swift` | Centre, zoom, rotation. Single source of truth for everything on the map. Separate from `AppState` so panels don't re-render during gestures. |
| Projection | `Views/MapProjection.swift` | Web Mercator maths; `artworkTransform` is the one CTM all drawing goes through. |
| Tiles | `Services/TileStore.swift` | OSM raster tiles: disk + memory cache, newest-first queue, parent-tile fallback while loading. Reference only, never exported. |
| Layout | `Views/LabelRendering.swift` | Zoom- and rotation-independent placement of labels and icons, in artwork space. |
| Scene | `Views/SceneRenderer.swift` | `CompiledScene`: immutable, drawable from any thread. Used by the live map, sign previews, PNG and PDF. |
| Surface | `Views/MapSurfaceView.swift` | The map view: rasterizes tiles + scene into one bitmap on a background queue, GPU-transforms it during gestures, re-rasters when it runs out or motion stops. Overlay draws handles and markers. All mouse, trackpad and keyboard input. |
| Document | `Models/AppState.swift`, `Services/DocumentActions.swift` | `documentChanged()` is the one way to report an edit: redraw, dirty flag, undo step. |

Artwork space = Mercator world pixels at the project's base zoom, relative to the scene origin. Base-zoom units are 1:1, so line widths, text and icons scale with the map like vector artwork. Tiles and vectors share one bitmap, so they cannot drift apart.

### Input

Two-finger drag pans, pinch zooms at the cursor, two-finger twist rotates (8° dead zone), mouse wheel zooms, Option-drag rotates, Space-drag pans in any tool. Keys: H/V drag, E edit, B bounding box, Esc steps back to deselect, Delete removes a selected road label. ⌘Z, ⇧⌘Z, ⌘S, ⌘\\ (panels), ⌘0 (north), ⌘1 (fit area).

---

## Layer System

### Layer kinds

```
Roads          — line features, split into RoadSubLayers by highway= tag
Parks          — polygon features
Water          — polygon features
Buildings      — polygon features
PedestrianZones / Plazas — polygon features
Landmarks / Transport / Dining / Accommodation /
Healthcare / Parking / Shopping / Education — point features
Background     — polygon (fill-only, typically a colour wash)
```

### MapLayer model

`MapLayer` is an `ObservableObject` owned by `AppState.layers` (an ordered array — **index 0 = top of panel = renders on top of map**).

Each layer carries:
- Style structs: `RoadStyle`, `AreaStyle`, `POIStyle`, `LabelStyle`, `SymbolStyle`
- Feature arrays: `lineFeatures`, `polygonFeatures`, `pointFeatures` (populated by `OSMFetcher`)
- `roadSubLayers: [RoadSubLayer]` — for roads only; each sub-layer groups highway types and can override the parent `RoadStyle`
- `fetchStatus: FetchStatus` (.idle / .fetching / .loaded / .error)
- `labelOffsets: [Int64: CGVector]` — per-feature label nudges set in edit mode
- `symbolOffsets: [Int64: CGVector]` — per-feature icon nudges
- `labelPins: [Int64: [Double]]` — hand-placed road labels, as arc distances

### Z-order

Layer array index 0 = top of the layer panel = **renders on top of the map**. Inside a layer, subtypes follow the same rule. Icons and labels always draw over all geometry.

---

## OSM Fetch

`OSMFetcher` (actor) sends Overpass queries, falling back to public mirrors. Each `LayerKind` has an `overpassQuery` template with `{bbox}` replaced at runtime. Relations are assembled into multipolygons, so rivers such as the Thames come through as water areas.

Flow (`Services/DocumentActions.swift`):
1. The user sets an area (Bounding Box tool or Use Current View).
2. Fetch runs on the toolbar button, or automatically when the box changes and layers are already loaded.
3. `startFetch` cancels any running fetch and fetches layers one at a time.
4. Results go into the `MapLayer`s and `documentChanged()` redraws.

Responses are cached by the full query for `settings.cacheDurationDays` (default 7).

---

## Label System

Layout lives in `Views/LabelRendering.swift`, drawing in `Views/SceneRenderer.swift`. Placement is computed once in artwork space and does not depend on zoom or rotation, so labels behave like vector artwork, the same on screen and in exports.

### Modes (`LabelStyle.lineLabelMode`)

| Mode | Behaviour |
|---|---|
| `horizontal` | Axis-aligned, stays upright on screen |
| `parallel` | Whole string rotated to the road's angle |
| `curved` | Text on a path: each glyph placed along the road |

### Placement rules

- Ways of one street are stitched together when they continue within 60°.
- **Max angle**: a curved label never sits across a bend sharper than this; it slides along the road or is dropped.
- **Repeat distance**: minimum gap between labels with the same name.
- **Margin**: full clearance around each label against everything already placed.
- Priority: icons claim space first, then hand-placed pins, then automatic labels in layer order, top row first.
- A label never competes with its own icon; without Label Binding it sits clear of the icon, and a centred label goes under it.
- Any layer can mix feature kinds: Pedestrian Zones has areas and streets, Water has lakes and rivers. Areas and points are labelled at their centre, lines along the line. A street also mapped as a named area gets one label, on the area.
- Curved labels hold a forward and a reverse run; the one that reads upright is picked from the view rotation.

Layout results are cached by a hash of the values that affect placement. Colour changes don't re-run it.

---

### LabelStyle fields (key)

```
tagKey / fallbackTagKey    — OSM tag to read (default: "name")
fontName / fontWeight / fontSize
color / opacity
haloColor / haloWidth / bufferEnabled / bufferOpacity
shadowEnabled / shadowColor / shadowBlur / shadowOffsetX / shadowOffsetY
typeCase                   — as-stored / uppercase / lowercase / titleCase / sentenceCase
tracking / wordSpacing
lineLabelMode              — curved / horizontal / parallel
linePosition               — above / on / below
distanceFromLine
repeatInterval / minSpacing
overlapMode / showAllLabels / priority
calloutsEnabled / calloutStyle / calloutColor / calloutWidth
```

---

## Style System

All style structs are `Codable` and stored on `MapLayer`.

**`RoadStyle`** — color, width, opacity, lineCap, lineJoin, casingEnabled, casingColor, casingWidth  
**`AreaStyle`** — fillColor, fillOpacity, strokeEnabled, strokeColor, strokeWidth  
**`POIStyle`** — shape (circle/square/diamond/triangle), size, fillColor, strokeColor, strokeWidth  
**`LabelStyle`** — see above  
**`SymbolStyle`** — enabled, isVisible, svgIconId, size, opacity, blending, placement (centroid / geometric / visual), density

### Text Styles library

`appState.textStyles: [TextStyle]` — reusable typography presets. A `TextStyle` captures a subset of `LabelStyle` fields; `TextStyle.apply(to:)` writes them onto a label style.

### Road sub-layers

The `roads` layer gets `RoadSubLayer.defaults`, one per `highway=` group. Each inherits per field from the layer's master: `lineOverrides` and `labelOverrides` list the fields the user has pinned, and `MapLayer.syncSubLineStyles` copies everything else down after a change. Visibility is toggled independently.

---

## Export

Every exporter works from the same layout as the screen.

### SVG (`SVGExporter`)
Geometry as `<path>`, point labels as `<text>`, curved labels as `<textPath>`. Icons and labels sit in their own top groups, with one sub-group per layer. With the Illustrator option on, curved labels are left out of the SVG and written to a companion `…-labels.jsx`, because Illustrator breaks `textPath` up on import.

### Illustrator script (`JSXExporter`, in `SVGExporter.swift`)
Builds the whole map in Illustrator with named layers and live type on a path (`textFrames.pathText`). Icons go in a `Nolli-icons` folder beside the script.

### PDF (`PDFExporter`)
Single-page vector PDF with real text, drawn by `CompiledScene`.

### Signs (`SignExporter`)
PNG per sign (plus `_back.png` for double-sided), and a multi-page vector PDF with one page per face.

---

## Sign System

Produces artwork for **physical wayfinding signs** placed at a lat/lon and facing a compass direction. A sign shows the same scene as the main map (`SceneStore`), centred on the sign and rotated to its facing angle, heading-up. Labels and icons stay upright.

### SignOutput model

```swift
var lat, lon: Double                    // placement on map
var rotation: Double                    // facing direction (degrees CW from north)
var isDoubleSided: Bool                 // front + back faces
var backRotation: Double                // back face angle
var widthMM, heightMM: Double           // physical size
var dpi: Double                         // print resolution
var labelScale, iconScale: Double       // multipliers on label and icon sizes
var centerOffsetLat, centerOffsetLon: Double  // framing, set by dragging the preview
```

Frame extent is defined at `signDesignPPI` (96); print DPI only raises resolution, so thumbnails, previews and exports show the same crop.

### Workflow

Signs tab in the right panel: Add puts the map in place mode, and the next click creates a sign. The overlay draws a marker with a facing needle for each sign. `SignArtworkView` draws previews and PNGs through the same `CompiledScene`.

---

## Edit Mode

Nodes appear only for the current selection:
- **Labels row / road type labels**: a dot at each string's centre. Curved road names slide along their road, live, and get pinned (`labelPins`: exact arc distances per stitched street; an empty list hides the name). Other labels move freely (`labelOffsets`).
- **Icons row**: a dot on each icon (`symbolOffsets`).
- **Layer / road type**: click a shape to show its vertices, then drag them. Junction nodes shared with other ways of the layer move together.

Changes are staged: Save / Revert All appear in the top bar. "Reset to Layer Settings" in the layer's inspector clears all manual edits. All of it persists in the project file.

---

## UI Layout

```
[Top bar: collapse · search · title · (drag|edit|bbox) · (fetch) · (document|export) · (style|sign) · (settings)]
[Layers | Components]   [map]   [Design | Signs]
[Status bar]
```

Docked, opaque panels in Figma's structure. Tokens and shared controls are in `Views/Theme.swift`: `PanelSection`, `PropRow`, `PropSlider`, `NumberInput` (type, arrows with ⇧ ×10, scrub), `ColorRow`. Colour panel: `Views/ColorPanel.swift`.

Nothing selected (Esc) shows the frame: background fill, map tiles, view rotation, base zoom, sign defaults.

Road types inherit per field from the layer's master, for both line style (`lineOverrides`) and labels (`labelOverrides`). A blue dot marks a field the type overrides; clicking it resets the field.

---

## Project Files

`.nolli` format — JSON encoded `ProjectSnapshot` via `ProjectManager`: layers with features, styles, manual edits, signs, icon library, text styles, swatches, colour schemes, frame settings and camera. Files from older versions load because `ProjectManager.upgraded` fills missing keys with defaults before decoding (synthesized `Codable` otherwise fails on any missing key).

---

## Dependencies

No third-party code. Network services: OpenStreetMap tiles (`tile.openstreetmap.org`), Overpass API (with public mirrors as fallback), Nominatim geocoding. Attribution is always shown on the map when tiles are visible.

---

## Build

```bash
cd macos && scripts/build.sh      # builds macos/build/Nolli.app
```

The script uses `xcodebuild` when the Xcode licence is accepted and falls back to compiling with `swiftc` from the Command Line Tools otherwise. Deployment target: macOS 26. New `.swift` files must be added to `macos/Nolli.xcodeproj/project.pbxproj` by hand (the swiftc path picks up every file under `macos/Nolli` automatically, so a missing pbxproj entry only breaks the Xcode path). Set `NOLLI_PERF=1` to log compile and raster timings to stderr.
