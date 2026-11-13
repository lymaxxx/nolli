# Nolli

A design tool for **wayfinding maps**: the maps on physical signs and boards. Pick an area, fetch OpenStreetMap data as layers, style it like vector artwork, set road names on a path along the road, place signs and export SVG, PDF or an Illustrator script.

Today it exists as a native macOS app. The plan is to rebuild it as a web app (Figma-style) with desktop wrappers for Mac, Windows and Linux. See [docs/WEB_REBUILD.md](docs/WEB_REBUILD.md).

## Repository layout

```
macos/        The current native app (SwiftUI, ~10,000 lines of Swift). Works today.
  Nolli/       Source
  scripts/build.sh  Builds Nolli.app
web/          The web rebuild. Empty; start here (see docs/WEB_REBUILD.md)
docs/
  DESIGN.md         How the macOS app is built: architecture, label system, export
  WEB_REBUILD.md    Plan for the web + desktop rebuild
  PROJECT_FORMAT.md The .nolli file format (the web app must open these)
  design/           Interface description, screenshots, design tokens, HTML copy of the UI
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

What has **not** been checked:
- Running the exported Illustrator script in Illustrator (it compiles as JavaScript only).
- Trackpad pinch, two-finger pan and twist (tested with the mouse only).
- Keyboard shortcuts (H, E, B, Space, Esc, Delete) and the number fields' arrow keys.
- Building through `xcodebuild`: the Xcode project file was edited by hand and has only been built with `swiftc`.
- Rendering speed on a Retina display (measured on a 1× display only).

There are no automated tests yet.

## Data and licences

- Map data © OpenStreetMap contributors, under the [ODbL](https://www.openstreetmap.org/copyright). The app shows the credit on the map; keep it in anything you publish.
- The app fetches tiles from `tile.openstreetmap.org` and queries the public Overpass API. Both have [usage policies](https://operations.osmfoundation.org/policies/tiles/) that rule out heavy or commercial-scale use. A public web app needs its own tile provider.
- **No licence has been chosen for this code yet.** Add a `LICENSE` file before making the repository public.
