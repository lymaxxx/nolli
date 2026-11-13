# apps/desktop

The thin Electron shell for milestone M2. It owns the window, the Open and Save dialogs, and disk access. Parsing and serialising stay in `@nolli/core` inside the renderer.

## Run it

From `web/`:

```bash
npm run build
npm run desktop
```

`npm run build` builds the editor page and the Electron main and preload scripts first. To work on the interface, run a Vite server in one terminal and the shell against it in another:

```bash
npm run dev
```

```bash
npm run desktop:dev
```

Open a project from the command line by passing its path after `--`:

```bash
npm run start -w @nolli/desktop -- /path/to/Map.mapcraft
```

## Behaviour

- Open accepts `.nolli` and legacy `.mapcraft`; both go through the same loader.
- Save always writes a `.nolli` file. An opened `.nolli` is overwritten in place. An opened `.mapcraft` suggests a `.nolli` sibling so the legacy file is never modified.
- A macOS `open-file` event, or a path in `process.argv`, opens the project once the renderer is ready.
- The renderer runs with context isolation and no Node integration. Only the four functions on `window.nolliDesktop` cross the bridge.
- The browser build keeps the same file shell. Chromium uses the File System Access API where available; other browsers use an upload field and a download.

## Not in M2

Packaging, code signing, installer file associations and custom per-OS window chrome come later. Until M10, launch the app with npm as shown above.
