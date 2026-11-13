# The `.nolli` file format

A `.nolli` file is plain JSON written by Swift's `JSONEncoder`. Existing `.mapcraft` projects are the legacy filename for the same document family: the loader parses their contents and does not branch on the extension. Saving migrated projects produces `.nolli`. The macOS app writes this format and the web app must read it, so this is a contract. The authoritative definitions are the `Codable` types in `macos/Nolli/Models/` and `macos/Nolli/Services/ProjectManager.swift` (`ProjectSnapshot`, `LayerSnapshot`).

## Things that will trip up a port

1. **Dictionaries with `Int64` keys are written as flat arrays**, not objects: `[key, value, key, value, …]`. This applies to `labelOffsets`, `labelAlongOffsets`, `labelPins`, `symbolOffsets`, `originalLineGeometry`, `originalPolygonGeometry` and `originalPointGeometry`. Checked by encoding a sample and by a real file: `"labelAlongOffsets": [65410291, 6.129…]`.
2. **A vector (`CGVector`) is written as a two-element array `[dx, dy]`**, not `{dx, dy}`. So `labelOffsets` looks like `[5, [1.5, -2], 9, [0, 4]]`.
3. **Coordinates are `[longitude, latitude]`** (GeoJSON order) in `coordinates`, `rings` and `coordinate`. Some helpers in the Swift code return `[latitude, longitude]` (for example `PolygonCenter`), so check each call.
4. **Colours are `{r, g, b, a}` with each channel 0 to 1.** Hex strings are only used in the UI.
5. **Enum values are snake_case strings** (`pedestrian_zones`, `top_left`, `simple_line`). The list below shows the values seen in real files only; the Swift enums are the full set.
6. **Missing keys must get defaults.** Swift's synthesized decoder fails on a missing key even when the property has a default, so the app fills missing keys from defaults *before* decoding (`ProjectManager.upgraded`). Files from older versions lack newer keys, so the web loader must do the same.
7. **Feature ids can be negative.** Ways assembled from multipolygon relations use the negated relation id.
8. Feature `tags` are the raw OpenStreetMap tags (`[String: String]`).

## Versions

| `version` | Change |
|---|---|
| 5, 6 | Seen in saved files so far |
| 7 | Written by the current app. Label `minSpacing` became a real clear margin: files older than 7 that still hold the old default of exactly `80` are moved to the new default (`6`) on open. Values the user chose are kept. |

## Top-level fields written by the current app

`version`, `boundingBox`, `settings`, `layers`, `iconLibrary`, `textStyles`, `artboardRotation`, `showNorthArrow`, `northArrowPosition`, `baseZoom`, `signArtworkScale`, `colorSwatches?`, `colorSchemes?`, `artboardBackgroundEnabled?`, `artboardBackground?`, `signOutputs?`, `cameraLat?`, `cameraLon?`, `cameraZoom?` (`?` = may be absent).

Per layer: `id` (UUID string), `name`, `kind`, `isVisible`, `roadStyle`, `areaStyle`, `poiStyle`, `labelStyle`, `symbolStyle`, `roadSubLayers`, `lineFeatures`, `polygonFeatures`, `pointFeatures`, and the optional manual-edit fields `labelOffsets`, `labelAlongOffsets`, `labelPins`, `symbolOffsets`, `originalLineGeometry`, `originalPolygonGeometry`, `originalPointGeometry`.

Per road type (`roadSubLayers[]`): `id`, `name`, `roadTypes` (OSM `highway` values it covers), `isVisible`, `useCustomStyle`, `customStyle`, `useCustomLabelStyle`, `labelStyle`, and the optional `lineOverrides` and `labelOverrides` (lists of field names the type has overridden; every other field inherits from the layer's master).

## Structure seen in real files

Generated from four real project files (versions 5 and 6), so it shows what exists in practice, not every field the current app can write. Optional means the key was missing from at least one item. Sign data, pins and the camera are not shown because none of those files were saved by the current app.

- `version`: number — seen 5 … 6
- `iconLibrary`: array
- `baseZoom`: number *(optional)* — seen 15 … 17
- `textStyles`: array
- `showNorthArrow`: boolean
- `settings`: object
  - `defaultHeightMM`: number — seen 400
  - `overpassEndpoint`: string
  - `defaultDPI`: number — seen 300
  - `showTileBackground`: boolean
  - `defaultFont`: string — one of: `Helvetica Neue`
  - `defaultWidthMM`: number — seen 400
  - `defaultExportFormat`: string — one of: `SVG`
  - `cacheDurationDays`: number — seen 7
- `signArtworkScale`: number *(optional)* — seen 1
- `artboardBackgroundEnabled`: boolean *(optional)*
- `colorSwatches`: array *(optional)*
  - each item:
    - `b`: number — seen 0.180392 … 1
    - `a`: number — seen 1
    - `r`: number — seen 0.0901107 … 1
    - `g`: number — seen 0.0509804 … 1
- `artboardRotation`: number — seen 0
- `northArrowPosition`: string — one of: `top_right`
- `layers`: array
  - each item:
    - `areaStyle`: object
      - `strokeWidth`: number — seen 0.1 … 1
      - `strokeColor`: object
        - `r`: number — seen 0.329412 … 0.647
        - `g`: number — seen 0.0745098 … 0.839
        - `a`: number — seen 1
        - `b`: number — seen 0.243137 … 0.647
      - `fillOpacity`: number — seen 0.8 … 1
      - `fillColor`: object
        - `r`: number — seen 0.1 … 1
        - `g`: number — seen 0.2 … 1
        - `a`: number — seen 1
        - `b`: number — seen 0.2 … 1
      - `strokeEnabled`: boolean
    - `kind`: string — one of: `background`, `buildings`, `parks`, `pedestrian_zones`, `roads`, `transport`, `water`
    - `pointFeatures`: array
      - items: see "Features" below
    - `labelStyle`: object
      - `fontSize`: number — seen 5.36719 … 10.4181
      - `shadowBlur`: number — seen 2
      - `minSpacing`: number — seen 15.2653 … 80
      - `offsetX`: number — seen 0
      - `haloWidth`: number — seen 1.5
      - `bufferEnabled`: boolean
      - `shadowOpacity`: number — seen 0.3
      - `distanceFromLine`: number — seen 2
      - `placement`: string — one of: `center`, `top_left`
      - `isVisible`: boolean
      - `priority`: number — seen 5
      - `calloutStyle`: string — one of: `simple_line`
      - `calloutColor`: object
        - `r`: number — seen 0.533
        - `g`: number — seen 0.533
        - `a`: number — seen 1
        - `b`: number — seen 0.533
      - `uppercase`: boolean
      - `calloutsEnabled`: boolean
      - `calloutMinDistance`: number — seen 4
      - `enabled`: boolean
      - `fontName`: string — one of: `Helvetica Neue`, `Onsite Condensed TRIAL`, `Onsite Standard TRIAL`
      - `repeatInterval`: number — seen 110 … 400
      - `tagKey`: string — one of: `name`
      - `calloutWidth`: number — seen 0.5
      - `opacity`: number — seen 1
      - `haloColor`: object
        - `r`: number — seen 1
        - `g`: number — seen 1
        - `a`: number — seen 1
        - `b`: number — seen 1
      - `color`: object
        - `r`: number — seen 0.2
        - `g`: number — seen 0.2
        - `a`: number — seen 1
        - `b`: number — seen 0.2
      - `typeCase`: string — one of: `as_stored`, `uppercase`
      - `lineLabelMode`: string — one of: `curved`
      - `maxCharAngle`: number — seen 10 … 25
      - `bufferOpacity`: number — seen 1
      - `fallbackTagKey`: string — one of: `name:en`
      - `fontWeight`: string — one of: `Bold`, `Regular`
      - `bufferJoinStyle`: string — one of: `round`
      - `shadowEnabled`: boolean
      - `overlapMode`: string — one of: `never`
      - `linePosition`: string — one of: `above`, `on`
      - `tracking`: number — seen 0 … 21
      - `shadowColor`: object
        - `r`: number — seen 0
        - `g`: number — seen 0
        - `a`: number — seen 1
        - `b`: number — seen 0
      - `shadowOffsetY`: number — seen 1
      - `wordSpacing`: number — seen 0 … 1
      - `showAllLabels`: boolean
      - `offsetY`: number — seen 0 … 6
      - `shadowOffsetX`: number — seen 1
    - `polygonFeatures`: array
      - items: see "Features" below
    - `isVisible`: boolean
    - `lineFeatures`: array
      - items: see "Features" below
    - `roadSubLayers`: array
      - each item:
        - `roadTypes`: array
          - items: string
        - `labelOverrides`: array *(optional)*
          - items: string
        - `useCustomLabelStyle`: boolean *(optional)*
        - `isVisible`: boolean
        - `name`: string — one of: `Cycling`, `Local`, `Pedestrian & Paths`, `Primary`, `Secondary`
        - `customStyle`: object
          - `lineCap`: string — one of: `round`
          - `lineJoin`: string — one of: `round`
          - `casingEnabled`: boolean
          - `dashEnabled`: boolean
          - `casingColor`: object
            - `r`: number — seen 1
            - `a`: number — seen 1
            - `b`: number — seen 1
            - `g`: number — seen 1
          - `casingWidth`: number — seen 4
          - `color`: object
            - `b`: number — seen 0.2 … 1
            - `r`: number — seen 0.2 … 1
            - `g`: number — seen 0.187334 … 1
            - `a`: number — seen 1
          - `width`: number — seen 1.27167 … 5.90864
          - `opacity`: number — seen 1
        - `labelStyle`: object *(optional)*
          - `shadowEnabled`: boolean
          - `overlapMode`: string — one of: `allow_if_required`, `never`
          - `maxCharAngle`: number — seen 25
          - `bufferOpacity`: number — seen 1
          - `fontWeight`: string — one of: `Medium`, `Regular`
          - `shadowBlur`: number — seen 2
          - `shadowColor`: object
            - `r`: number — seen 0
            - `a`: number — seen 1
            - `b`: number — seen 0
            - `g`: number — seen 0
          - `color`: object
            - `r`: number — seen 0.2 … 0.847059
            - `a`: number — seen 1
            - `b`: number — seen 0.2 … 0.996078
            - `g`: number — seen 0.2 … 0.517647
          - `calloutColor`: object
            - `r`: number — seen 0.533
            - `a`: number — seen 1
            - `b`: number — seen 0.533
            - `g`: number — seen 0.533
          - `linePosition`: string — one of: `above`, `on`
          - `enabled`: boolean
          - `tagKey`: string — one of: `name`
          - `minSpacing`: number — seen 38.1177 … 80
          - `calloutStyle`: string — one of: `simple_line`
          - `uppercase`: boolean
          - `offsetY`: number — seen 6
          - `haloColor`: object
            - `r`: number — seen 1
            - `a`: number — seen 1
            - `b`: number — seen 1
            - `g`: number — seen 1
          - `opacity`: number — seen 1
          - `priority`: number — seen 5
          - `lineLabelMode`: string — one of: `curved`
          - `repeatInterval`: number — seen 86.8417 … 200
          - `tracking`: number — seen 20 … 90.3061
          - `fontName`: string — one of: `Fira Sans`, `Helvetica Neue`
          - `bufferEnabled`: boolean
          - `wordSpacing`: number — seen 0
          - `calloutWidth`: number — seen 0.5
          - `distanceFromLine`: number — seen 2
          - `shadowOffsetY`: number — seen 1
          - `shadowOffsetX`: number — seen 1
          - `shadowOpacity`: number — seen 0.3
          - `fallbackTagKey`: string — one of: `name:en`
          - `isVisible`: boolean
          - `typeCase`: string — one of: `as_stored`, `uppercase`
          - `placement`: string — one of: `center`
          - `haloWidth`: number — seen 1.5
          - `bufferJoinStyle`: string — one of: `round`
          - `calloutsEnabled`: boolean
          - `calloutMinDistance`: number — seen 4
          - `showAllLabels`: boolean
          - `offsetX`: number — seen 0
          - `fontSize`: number — seen 3.37969 … 9
        - `useCustomStyle`: boolean
        - `id`: string
    - `id`: string
    - `name`: string — one of: `Background`, `Buildings`, `Parks & Green Space`, `Pedestrian Zones`, `Roads`, `Transport`, `Water`
    - `symbolStyle`: object
      - `enabled`: boolean
      - `labelLayout`: string — one of: `icon_left`
      - `rotation`: number — seen 0
      - `opacity`: number — seen 1
      - `iconTextGap`: number — seen 4
      - `width`: number — seen 15 … 24
      - `height`: number — seen 15 … 24
      - `blendMode`: string — one of: `normal`
      - `collisionMargin`: number — seen 8
      - `anchorPoint`: string — one of: `geometric_center`, `visual_center`
      - `bindToLabels`: boolean
      - `textAlignment`: string — one of: `vertical_center`
      - `isVisible`: boolean
      - `allowOverlapWithOtherLayers`: boolean
      - `lockAspect`: boolean
      - `inlineSVGData`: string *(optional)*
    - `roadStyle`: object
      - `lineJoin`: string — one of: `round`
      - `lineCap`: string — one of: `round`
      - `width`: number — seen 0.1 … 5.72249
      - `color`: object
        - `b`: number — seen 0.2 … 1
        - `a`: number — seen 1
        - `r`: number — seen 0.1 … 1
        - `g`: number — seen 0.2 … 1
      - `casingColor`: object
        - `b`: number — seen 1
        - `a`: number — seen 1
        - `g`: number — seen 1
        - `r`: number — seen 1
      - `dashEnabled`: boolean
      - `opacity`: number — seen 1
      - `casingWidth`: number — seen 4
      - `casingEnabled`: boolean
    - `poiStyle`: object
      - `strokeWidth`: number — seen 1.5
      - `size`: number — seen 8
      - `strokeColor`: object
        - `g`: number — seen 1
        - `r`: number — seen 1
        - `a`: number — seen 1
        - `b`: number — seen 1
      - `shape`: string — one of: `circle`
      - `fillColor`: object
        - `g`: number — seen 0.2 … 0.95
        - `r`: number — seen 0.0901107 … 0.97
        - `a`: number — seen 1
        - `b`: number — seen 0.2 … 0.9
    - `labelAlongOffsets`: array *(optional)*
      - items: number
- `artboardBackground`: object *(optional)*
  - `b`: number — seen 0.283297
  - `a`: number — seen 1
  - `r`: number — seen 0.200381
  - `g`: number — seen 0.0449128
- `colorSchemes`: array *(optional)*
- `boundingBox`: object
  - `minLon`: number — seen -2.87978 … -2.7616
  - `minLat`: number — seen 53.5549 … 54.6586
  - `maxLat`: number — seen 53.5633 … 54.6688
  - `maxLon`: number — seen -2.86552 … -2.74169

### `lineFeatures` items

- `coordinates`: array
- `tags`: object
- `id`: number

### `polygonFeatures` items

- `tags`: object
- `rings`: array
- `id`: number

### `pointFeatures` items

- `coordinate`: array
- `tags`: object
- `id`: number

## Current web loader

`web/packages/core/src/project/project.ts` exposes `loadProject(json)` and `serializeProject(project)`. Loading follows `ProjectManager.upgraded`: missing keys are filled only at the same shallow paths, optional nulls are accepted, and pre-v7 margins migrate as described above. Saving creates a version 7 snapshot. Keys the web app does not know are kept at every level and written back, so passing a file through it loses nothing a newer macOS build wrote (the macOS decoder itself ignores unknown keys). Manual-edit dictionaries are exposed as `Map`s and override sets as `Set`s in TypeScript, then encoded back to the Swift wire forms.

The current runtime rejects Int64 values outside JavaScript's exact integer range (`Number.MIN_SAFE_INTEGER` … `Number.MAX_SAFE_INTEGER`) rather than silently rounding them. OSM ids in real projects are expected to fit, but full-Int64 lossless parsing remains a compatibility edge case.

A real version 6 `.mapcraft` project has been loaded and saved as version 7 by this implementation, and the native Swift `JSONDecoder` accepted the result. That check used the user's own file and is not a committed fixture.

The desktop shell reads either extension and always writes `.nolli`. Opening a `.mapcraft` file and saving leaves the original untouched and creates a `.nolli` sibling.

## Checking a port

Open each real project in the web app and compare against the macOS app: layer list and order, styles, label text, and the exported SVG. The macOS app's exports are the reference output for parity tests (see `WEB_REBUILD.md`).
