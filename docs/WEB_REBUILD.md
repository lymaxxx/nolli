# Rebuilding Nolli as a web app with desktop wrappers

Goal: a Figma-style editor in the browser, with the same features as the macOS app, wrapped for Mac, Windows and Linux. This is a plan and a set of recommendations. Nothing here has been built or tried yet, and the choices marked **Decision** are yours.

## Goals

1. Open every `.nolli` file the macOS app saved, and save files it can open back (`PROJECT_FORMAT.md`).
2. Same output: the same labels in the same places, the same SVG, PDF and Illustrator script.
3. The same interface structure (`design/INTERFACE.md`), redesigned in pen.dev if you like.
4. One codebase that runs in a browser and inside a desktop wrapper.

Not in version 1: accounts, cloud storage, real-time collaboration. Design the document model so they can be added (immutable snapshots make this much easier), but don't build them yet.

## Recommended stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript, strict | The layout and geometry code is the risky part; types catch a lot |
| Build | Vite | Fast, plain, no framework lock-in |
| UI panels | React | Largest ecosystem for Figma-like panels (menus, popovers, colour pickers). **Decision:** Svelte or Solid are fine alternatives |
| Map canvas | Custom, plain Canvas 2D at first, in a worker (`OffscreenCanvas`) | The app draws thousands of road segments plus text on paths. A canvas you own gives the same control the Swift version had. WebGL can come later for speed |
| State | One document store with immutable snapshots (Zustand or hand-rolled) | Maps directly to the Swift `documentChanged()` and undo snapshots |
| Tests | Vitest, plus parity tests against exports from the macOS app | See "Proving parity" |
| Desktop wrapper | **Electron** | See below |

### Why Electron and not Tauri

Tauri is smaller and faster to start, but it uses each system's own web view: WKWebView on Mac, WebView2 on Windows, WebKitGTK on Linux. Those differ in text rendering, canvas speed and font access, and this app is mostly canvas and text. Electron ships one Chromium everywhere, so what you test is what users get, and it supports the Local Font Access API that the font picker and PDF export will want. The price is a bigger download. You can revisit this later because the web app doesn't depend on the wrapper. **Decision.**

Also available at no cost: ship it as an installable web app (PWA) with no wrapper, for users who don't need one.

## Module map: Swift to TypeScript

Paths are in `macos/Nolli/`. Line counts are from the current source and show where the effort is.

| Swift | Lines | Becomes | Notes |
|---|---|---|---|
| `Models/MapLayer`, `Styles`, `OSMFeature`, `SignOutput`, `BoundingBox` | ~1,050 | `core/model` | Types plus a runtime validator (zod). Defaults live here |
| `Services/ProjectManager` | 227 | `core/project` | Load with default-filling (`upgraded`) and the version 7 migration; save |
| `Models/MapCamera`, `Views/MapProjection` | ~300 | `core/camera`, `core/projection` | Pure Web Mercator maths. Easy and a good first port |
| `Models/PolygonCenter` | 95 | `geo/polygonCenter` | Pure functions; watch the `[lat, lon]` return order |
| `Services/OSMFetcher` | 205 | `data/overpass` | Includes multipolygon assembly. The default server answers browser requests (tested: HTTP 200 with `access-control-allow-origin: *`; the other public server was busy but sent the same header) |
| `Services/GeocoderService` | 45 | `data/geocode` | Nominatim; browser requests allowed (tested). Its usage policy still applies |
| `Services/TileStore` | 156 | `render/tiles` | Fetch plus cache (memory and IndexedDB). Fall back to the parent tile while loading |
| **`Views/LabelRendering`** | **878** | **`layout/labels`** | **The hardest part.** Text on a path with bend, repeat and overlap rules, stitching of ways, pins |
| `Views/SceneRenderer` | 701 | `render/scene` | Compile the document into drawable chunks, then draw |
| `Views/MapSurfaceView` | 1,111 | `canvas/MapCanvas` | Gestures, edit handles, overlay. Move the finished bitmap with CSS transforms during gestures |
| `Services/SVGExporter` (includes the Illustrator script) | 823 | `export/svg`, `export/jsx` | Mostly string building; straightforward once layout exists |
| `Services/PDFExporter`, `SignExporter` | 214 | `export/pdf`, `export/sign` | PDF needs fonts embedded; see risks |
| `Models/AppState`, `Services/DocumentActions` | ~630 | `core/store`, `core/actions` | One edit path that redraws, marks dirty and records undo |
| `Views/*` panels and inspectors | ~3,600 | `ui/*` | Rebuild from `design/` (`tokens.css` is ready to use) |

Roughly 10,000 lines of Swift in total. The UI is about 36 percent of it; the part that decides whether the result is right is the layout engine and exporters.

## What to carry over unchanged

These design decisions came out of real use and cost real effort to get right. Keep them:

1. **One camera** (centre, zoom, rotation) drives everything.
2. **Artwork space** is Web Mercator pixels at the project's base zoom, relative to a scene origin. Line widths, text and icons scale with it like vector artwork. Labels never depend on the current zoom.
3. **Rotation is heading-up**: `x' = x cos r + y sin r`. Labels and icons stay upright; curved labels keep a forward and a reversed run and pick the one that reads upright.
4. **Layout is computed once and cached** by a hash of the values that affect placement (colour changes don't invalidate it).
5. **Priority order**: icons claim space first, then hand-placed pins, then automatic labels in layer order, top row first.
6. **Inheritance per field**: road types inherit from their master; `lineOverrides` and `labelOverrides` list what a type has changed.
7. **Defaults on load**: fill missing keys before validating.
8. **Exports use the same layout as the screen**, so they match.

## Risks, from experience with the macOS version

1. **Text metrics differ between platforms.** The Swift version measures with CoreText. In the browser use `measureText`, or `opentype.js` for exact glyph advances and kerning. Labels will not match to the pixel, so decide the tolerance early (see parity tests).
2. **Fonts.** A web page can only use fonts the machine has, or fonts you host. `queryLocalFonts()` (Chromium and Electron only, with permission) lists system fonts and gives access to the bytes. Projects use fonts such as "Onsite Standard TRIAL" that are licensed to you, not the repository, so never commit font files.
3. **PDF.** Needs real vector text with embedded fonts. Check that `pdf-lib` or `pdfkit` can embed the same fonts, and test with a non-Latin name.
4. **Map tiles.** The OpenStreetMap tile server does answer browser requests (tested), but its policy rules out a public app with real traffic. For anything beyond personal use choose a provider with an API key (MapTiler, Stadia, or your own server) and keep tiles as a reference layer only, as now. **Decision.**
5. **Illustrator script.** It has only been checked to compile, never run in Illustrator. Test it there before building on it.
6. **Performance.** The Swift version rasterizes in the background and moves the bitmap with the GPU during gestures. In the browser, render to an `OffscreenCanvas` in a worker and move the result with a CSS transform until it needs redrawing. Measure early on a large file (about 1,200 roads and 1,900 buildings).
7. **Gestures.** Trackpad pinch, two-finger pan and twist behave differently across browsers (`wheel` with `ctrlKey` for pinch in Chromium, Safari gesture events). The macOS version's gestures have not been tested with a trackpad either.

## Proving parity

The macOS app is the reference, so use it:

1. Export SVG and the layout from the macOS app for each real project at fixed settings, and store them as fixtures (not committed if they hold client data).
2. In the web app, compare: same labels placed, text, rotation, and position within a tolerance (suggest 1 to 2 px at design scale).
3. Run the comparison for several rotations and zoom levels, because label placement must not change with them.

## Milestones

Each one ends with something you can open and check.

| # | Milestone | Done when |
|---|---|---|
| M0 | Scaffolding: Vite + TypeScript + React, lint, tests, CI on every push | `npm test` and `npm run build` pass in CI; an empty app loads |
| M1 | Document model and loader | All real `.nolli` files load, round-trip through save, and match the format notes |
| M2 | Camera and vector rendering | A project's roads, water, parks and buildings draw at any zoom and rotation, styled from the file |
| M3 | Tiles and gestures | OSM tiles under the vectors, mouse and trackpad pan, zoom to cursor, rotate; no drift between tiles and vectors |
| M4 | Label engine | Placement matches the macOS fixtures within tolerance; max bend, repeat distance, margin, priority |
| M5 | Panels | Layers tree, inspectors, colour panel, number fields with arrow and Shift stepping; undo and redo |
| M6 | Edit mode | Label dots, sliding along roads, pins, vertex editing, save and revert |
| M7 | Export | SVG, Illustrator script, PDF; sign artwork |
| M8 | Data | Overpass fetch, geocoding search, bounding box |
| M9 | Desktop | Electron wrapper; installers for Mac, Windows and Linux built by GitHub Actions; file open and save through the OS |
| M10 | Polish | Dark mode, redesigned UI from pen.dev, accessibility pass |

M0 to M4 give you something real: a viewer that opens your projects and places labels. Everything after that is editing and output.

## Decisions for you

1. **UI framework**: React (recommended) or Svelte/Solid.
2. **Desktop wrapper**: Electron (recommended) or Tauri.
3. **Tile provider** for anything public.
4. **Local-first only** (files on disk, no server), or accounts and cloud storage later. Recommended: local-first for version 1.
5. **Licence** for the repository (none chosen yet).
6. **Signing**: macOS distribution needs an Apple Developer account and notarisation, Windows needs a code-signing certificate. Unsigned builds work for testing.

## Starting the work with Claude Code

Open the repository in Claude Code and begin with something like:

> Read README.md, CLAUDE.md and docs/WEB_REBUILD.md. Do milestone M0 in web/: Vite, TypeScript, React, Vitest, ESLint and a GitHub Actions workflow. Then do M1: port the file format in docs/PROJECT_FORMAT.md, with tests that load my real project files from a local folder I'll point you to. Tell me exactly what you ran and what you didn't.
