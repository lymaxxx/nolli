# Roadmap beyond parity

Nolli aims to be an accessible alternative to ArcGIS Maps and MAPublisher for graphic and wayfinding designers. The focus is urban areas and small public spaces, so this list takes the parts of MAPublisher that serve that work and leaves the rest. Everything here comes after the web app matches the macOS app (`WEB_REBUILD.md`, milestones M0 to M10). None of it is built.

## Features

In suggested order.

| Feature | MAPublisher equivalent | In Nolli |
|---|---|---|
| Your own data | Import | Import GeoJSON, KML, GPX and CSV with coordinates. Draw lines, areas and points that are not in OpenStreetMap, such as a client's new building |
| Feature details | MAP Attributes | Click a feature to see its tags, override its label text, hide it, or mark it a landmark |
| Style by attribute | MAP Themes | Sub-styles on any layer chosen by tag, generalising today's road types (for example, civic buildings in another fill) |
| Label rules | LabelPro | The existing engine, plus abbreviation rules (Street → St) and two-language labels |
| Map furniture | Scale bar, north arrow, legend | Scale bar, a legend built from the layers and icons in use, a "you are here" marker, walking-time circles |
| True scale | MAP Views | Export at 1:N, corrected for latitude. A measure tool giving distance and walking time |
| Simplifying | Simplify, buffer, join | Simplify lines, merge adjoining buildings, draw roads as areas, clip to the artboard |
| Reference image | Georeferenced image | Place an architect's site plan under the map to trace |
| Street index | Index | Grid references and a generated index. Optional, and last |

Left out on purpose: projection and coordinate-system editors, WMS/WFS and geodatabase connections, chart themes, graticules, terrain, geospatial PDF.

## Illustrator integration

Designers finish maps in Illustrator, so the hand-off should lose as little as possible. In order of effort:

1. **Verify and upgrade the script export.** The current script has never been run in Illustrator. Once it works, add global swatches (recolour once, everywhere), a character style per label class, symbols for icons, named layers, a real-size artboard, and the feature id stored on each item.
2. **Send to Illustrator.** In the desktop app, one button runs the script in the installed Illustrator (AppleScript on Mac, COM on Windows). The web app downloads the script.
3. **Update from Nolli.** Exporting again replaces only the layers the designer has not marked as hand-edited, matching items by the stored feature id.
4. **Style round trip.** A script reads swatch, stroke and character-style changes made in Illustrator back into the `.nolli` file.
5. **A panel inside Illustrator.** Later. Check which plugin platform Illustrator supports at that point before choosing one.

Steps 1 to 3 need testing in Illustrator by someone who has it.
