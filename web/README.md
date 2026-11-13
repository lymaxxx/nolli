# web/

The web rebuild of Nolli. Plan and milestones: `../docs/WEB_REBUILD.md`.

```
packages/core   Everything that decides what the map looks like. No DOM and no Node APIs,
                so it runs in the page, in a worker, in tests and from a command line.
apps/editor     The React app and the canvas.
apps/desktop    The Electron shell: project open and save (milestone M2).
```

## Commands

Needs Node 22 or newer. Run these in `web/`:

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run lint
```

```bash
npm run build
```

`npm run build` type-checks all packages, then builds the editor into `apps/editor/dist` and the Electron main and preload scripts into `apps/desktop/dist`.

Run the desktop shell after building:

```bash
npm run desktop
```

For development, run `npm run dev` in one terminal and `npm run desktop:dev` in another. The shell can also open a project from the command line:

```bash
npm run start -w @nolli/desktop -- /path/to/Map.mapcraft
```

## What exists

Milestone M0:

- `core/text`: fonts parsed from their bytes, lines shaped with HarfBuzz, mixed left-to-right and right-to-left text ordered with the Unicode bidirectional algorithm, a fallback font chain, and placement of the shaped text along a path.
- `core/geo/polyline`: sampling a line by distance.
- `core/tiles`: the tile-source description, with OpenStreetMap as the only built-in source.
- `apps/editor`: the text engine sample drawing three roads with names set along them, now reachable from the project shell.

Milestone M1:

- `core/model`: Zod-backed project, layer, feature, style, library and sign types for the complete version 7 snapshot contract.
- `core/project`: `loadProject(json)` performs the native shallow default fill and v7 label-margin migration; `serializeProject(project)` returns compact `.nolli` JSON at version 7. Swift's flat Int64 dictionaries become JavaScript `Map`s, and override lists become `Set`s.
- JSONEncoder-generated current and sparse legacy fixtures test round-trips, geometry, edits, defaults, migration and validation. A real version 6 `.mapcraft` project also loaded, saved and re-opened successfully, and the native Swift decoder accepted the web-saved output. Files are parsed by content, so the old extension needs no special handling in `core`.

Milestone M2:

- `apps/desktop`: an Electron main process with context isolation and no Node access in the renderer. Its Open dialog accepts `.nolli` and `.mapcraft`; Save always writes `.nolli`. An opened `.nolli` is rewritten in place, while a legacy file gets a `.nolli` sibling.
- `apps/editor`: a small project-file shell shows the loaded version, layer count, feature counts and bounds, and hands saving back to the platform. The full editor still waits for the later milestones.
- The shell was checked on macOS by launching it with a real `.mapcraft` and with a saved `.nolli`, then saving: both showed 7 layers and 3,275 features, and the save produced version 7 JSON. Packaging and signed installers are later work.

Milestone M3:

- `core/projection`, `core/camera`, `core/tiles` and `core/render/scene`: Web Mercator maths, one camera, tile coverage with parent-tile fallback, and a pure compiler that turns layers into artwork-space geometry.
- `apps/editor`: a render worker draws tiles and vectors through one transform into an `OffscreenCanvas`. During gestures the finished bitmap follows the pointer with a CSS matrix until the next frame arrives. The workspace adds zoom, fit and reset-north controls, and saving writes the live camera back into the `.nolli`.
- Checked in the built Electron app with the real project: 3,275 features drew over OpenStreetMap tiles, wheel zoom, drag pan, Option-drag rotation, fit and reset north worked, and tiles stayed aligned with vectors through rotation. Labels are M4; layer and style editing are still later work.

The fonts used by the tests and the sample page (Noto Sans, Noto Sans Arabic; SIL Open Font License) come from npm as dev dependencies. No font files are committed.
