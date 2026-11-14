# Nolli

A design tool for **wayfinding maps**: the maps on physical signs and boards. Pick an area, fetch OpenStreetMap data as layers, style it like vector artwork, set road names on a path along the road, place signs and export SVG, PDF or an Illustrator script.

Today it exists as a native macOS app. It is being rebuilt as a web app (Figma-style) with desktop wrappers for Mac, Windows and Linux, as an accessible alternative to ArcGIS Maps and MAPublisher for graphic and wayfinding designers. See [docs/WEB_REBUILD.md](docs/WEB_REBUILD.md) for the rebuild and [docs/ROADMAP.md](docs/ROADMAP.md) for what comes after.

## Repository layout

```
macos/        The current native app (SwiftUI, ~10,000 lines of Swift). Works today.
  Nolli/       Source
  scripts/build.sh  Builds Nolli.app
web/          The web rebuild. Scaffolding and text shaping only so far (see web/README.md)
docs/
  DESIGN.md         How the macOS app is built: architecture, label system, export
  WEB_REBUILD.md    Plan for the web + desktop rebuild
  ROADMAP.md        Features beyond parity, and Illustrator integration
  PROJECT_FORMAT.md The .nolli file format (the web app must open these)
  design/           The current interface: description, screenshots, tokens, HTML copy
  design/redesign/  The redesigned interface (pen.dev handoff) that the web app follows
CLAUDE.md     Context for continuing work with Claude Code
```

## Build the macOS app

Needs macOS 26 and either Xcode or the Command Line Tools (`xcode-select --install`).

```bash
cd macos
scripts/build.sh
open build/Nolli.app
```

The app is signed ad hoc, which is enough to run it on the machine that built it. It is not notarised and not ready for distribution.

## Status

What works (checked by running it): opening and saving projects, pan/zoom/rotate with tiles and vectors kept in step, OSM fetch, per-layer styling with per-field inheritance for road types, curved road labels with bend, spacing and overlap rules, edit mode, signs, and SVG, PDF and Illustrator-script export.

What has **not** been checked in the macOS app:
- Running the exported Illustrator script in Illustrator (it compiles as JavaScript only).
- Trackpad pinch, two-finger pan and twist (tested with the mouse only).
- Keyboard shortcuts (H, E, B, Space, Esc, Delete) and the number fields' arrow keys.
- Building through `xcodebuild`: the Xcode project file was edited by hand and has only been built with `swiftc`.
- Rendering speed on a Retina display (measured on a 1× display only).

The macOS app has no automated tests.

The web rebuild has completed milestones M0–M5. The Electron shell and browser editor open `.nolli` and legacy `.mapcraft` projects, save `.nolli`, draw the project and its curved road, area and point labels over OpenStreetMap tiles through one camera transform, and implement the redesigned Style phase: layer list, Map inspector, road type chips with per-field overrides, collapsible style and label inspectors, colour panel (HEX/RGB/HSB/CMYK, swatches, whole-map colour schemes), Fonts library and undo/redo. Label placement has been verified against native macOS `LabelLayoutEngine` dumps and in Electron on the real 3,275-feature project. The Export tab writes an SVG (outlined or live text, any artboard size); it has been checked in a browser but not opened in Illustrator, and it is not compared with a macOS-written SVG. PDF and the Illustrator script (M9), area fetching (M6), interactive edit mode (M7) and signs (M8) are still ahead.

## Data and licences

- Map data © OpenStreetMap contributors, under the [ODbL](https://www.openstreetmap.org/copyright). The app shows the credit on the map; keep it in anything you publish.
- The app fetches tiles from `tile.openstreetmap.org` and queries the public Overpass API. Both have [usage policies](https://operations.osmfoundation.org/policies/tiles/) that rule out heavy or commercial-scale use. A public web app needs its own tile provider.
- **No licence has been chosen for this code yet.** Add a `LICENSE` file before making the repository public.
