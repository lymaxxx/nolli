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

## Installers (milestone M10)

Packaged with [electron-builder](https://www.electron.build/); the settings are the `build` field of `package.json`.

```bash
npm run build
```

```bash
npm run dist -w @nolli/desktop
```

That builds for the system it runs on and writes to `release/` (git-ignored): a `.zip` and `.dmg` on macOS, an installer and `.zip` on Windows, an `AppImage` and `.deb` on Linux. `npm run pack -w @nolli/desktop` writes the unpacked app folder only. The GitHub Actions workflow `desktop.yml` builds all three on real machines: run it from the Actions tab, or push a tag such as `v0.1.0` for a draft release with the files attached.

Installed apps register `.nolli` and the old `.mapcraft` extension, so double-clicking a project opens it.

### These builds are not signed with a developer identity

- **macOS** builds get an *ad-hoc* signature, which lets the app start on Apple Silicon but is not a Developer ID. Gatekeeper will say the developer is unidentified. Open it once with right-click, then Open, or run `xattr -dr com.apple.quarantine /Applications/Nolli.app`. If macOS reports the app as "damaged", it was built without the ad-hoc signature: run `codesign --force --deep --sign - /Applications/Nolli.app` as well.
- **Windows** builds are unsigned, so SmartScreen warns on first run (More info, then Run anyway).
- **Linux** AppImages need `chmod +x` before they run.

For real signing and notarisation you need an Apple Developer account (macOS) and a code-signing certificate (Windows). Give electron-builder the certificate through its usual `CSC_LINK` and `CSC_KEY_PASSWORD` variables (and `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` for notarisation), and remove `"identity": null` from the `mac` settings. The ad-hoc step in `scripts/adhoc-sign.cjs` steps aside when `CSC_LINK` is set.

The icon in `build/icon.png` is a placeholder.
