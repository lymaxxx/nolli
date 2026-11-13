# web/

The web rebuild of Nolli. Plan and milestones: `../docs/WEB_REBUILD.md`.

```
packages/core   Everything that decides what the map looks like. No DOM and no Node APIs,
                so it runs in the page, in a worker, in tests and from a command line.
apps/editor     The React app and the canvas.
apps/desktop    The Electron shell. Not started (milestone M2).
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

`npm run build` type-checks all packages, then builds the editor into `apps/editor/dist`.

## What exists (milestone M0)

- `core/text`: fonts parsed from their bytes, lines shaped with HarfBuzz, mixed left-to-right and right-to-left text ordered with the Unicode bidirectional algorithm, a fallback font chain, and placement of the shaped text along a path.
- `core/geo/polyline`: sampling a line by distance.
- `core/tiles`: the tile-source description, with OpenStreetMap as the only built-in source.
- `apps/editor`: a page that draws three sample roads with names set along them. There is no editor yet.

The fonts used by the tests and the sample page (Noto Sans, Noto Sans Arabic; SIL Open Font License) come from npm as dev dependencies. No font files are committed.
