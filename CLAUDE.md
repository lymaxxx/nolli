# Nolli: notes for Claude Code

A wayfinding-map design tool. Read `README.md` first, then `docs/WEB_REBUILD.md` if the task is the web rebuild, or `docs/DESIGN.md` if it is the macOS app.

## Layout

- `macos/` is the working SwiftUI app. `web/` is where the rebuild goes. `docs/` holds the plans and references.
- Build the Mac app with `macos/scripts/build.sh`. It falls back to `swiftc` when the Xcode licence is not accepted.

## Rules that matter

- **Say what was actually run.** Compiling is not verification for a UI or rendering app. Run it, look at it, and report what was and was not checked. The README lists what has never been checked; keep it honest as that changes.
- **The `.nolli` format is a contract.** The web app must open files saved by the macOS app (`docs/PROJECT_FORMAT.md`). Never rename or remove a field without a migration. New fields need a default, because the loader fills missing keys (`ProjectManager.upgraded` in Swift).
- **Mac project file is hand-maintained.** A new `.swift` file must also be added to `macos/Nolli.xcodeproj/project.pbxproj` (four places: build file, file reference, group, sources phase).
- **Use test copies of user projects.** Never edit or commit `.nolli` files from a user's folder; they are gitignored on purpose.
- Don't recreate another product's name, art or code. This is an original tool that happens to follow Figma-like interaction conventions.

## Architecture in five lines (macOS; the web app should keep the same shape)

1. One camera (centre, zoom, rotation) drives everything.
2. Artwork space is Web Mercator pixels at the project's base zoom; line widths, text and icons scale with it like vector artwork.
3. Label and icon placement is computed once in artwork space, so it never depends on the current zoom or rotation, and exports match the screen.
4. The scene is compiled into drawable chunks; tiles and vectors are drawn into one bitmap, which is moved by the GPU during gestures and redrawn when it runs out.
5. Every edit goes through one function (`documentChanged`) that redraws, marks the document dirty and records an undo step.

## Where things are

`docs/DESIGN.md` has the full tour. The hardest file to port is `macos/Nolli/Views/LabelRendering.swift` (text on a path with bend, repeat and overlap rules).
