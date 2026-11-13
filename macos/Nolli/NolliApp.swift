import SwiftUI
import AppKit

final class NolliAppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    /// Finder double-click / "Open With". The window may not exist yet at launch.
    @MainActor
    func application(_ application: NSApplication, open urls: [URL]) {
        guard let url = urls.first(where: { $0.pathExtension == "nolli" }) else { return }
        func attempt(_ tries: Int) {
            if let state = AppState.active {
                if state.confirmDiscardChanges("Save changes before opening another project?") { state.open(url: url) }
            } else if tries > 0 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { MainActor.assumeIsolated { attempt(tries - 1) } }
            }
        }
        attempt(25)
    }

    @MainActor
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let state = AppState.active else { return .terminateNow }
        return state.confirmDiscardChanges("Save changes before quitting?") ? .terminateNow : .terminateCancel
    }
}

@main
struct NolliApp: App {
    @NSApplicationDelegateAdaptor(NolliAppDelegate.self) private var delegate

    var body: some Scene {
        Window("Nolli", id: "main") {
            ContentView()
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1360, height: 860)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Project") { AppState.active?.newProject() }
                    .keyboardShortcut("n")
                Button("Open…") { AppState.active?.openProject() }
                    .keyboardShortcut("o")
            }
            CommandGroup(replacing: .saveItem) {
                Button("Save") { AppState.active?.saveProject() }
                    .keyboardShortcut("s")
                Button("Save As…") { AppState.active?.saveProjectAs() }
                    .keyboardShortcut("s", modifiers: [.command, .shift])
                Divider()
                Button("Export…") { AppState.active?.showExportSheet = true }
                    .keyboardShortcut("e", modifiers: [.command, .shift])
            }
            CommandGroup(replacing: .undoRedo) {
                // Text fields keep their own undo while one is being edited.
                Button("Undo") {
                    if NSApp.keyWindow?.firstResponder is NSText {
                        NSApp.sendAction(Selector(("undo:")), to: nil, from: nil)
                    } else { AppState.active?.undo() }
                }
                .keyboardShortcut("z")
                Button("Redo") {
                    if NSApp.keyWindow?.firstResponder is NSText {
                        NSApp.sendAction(Selector(("redo:")), to: nil, from: nil)
                    } else { AppState.active?.redo() }
                }
                .keyboardShortcut("z", modifiers: [.command, .shift])
            }
            CommandGroup(after: .toolbar) {
                Button("Zoom In") { AppState.active.map { zoom($0, +1) } }
                    .keyboardShortcut("=")
                Button("Zoom Out") { AppState.active.map { zoom($0, -1) } }
                    .keyboardShortcut("-")
                Button("Zoom to Selected Area") {
                    if let s = AppState.active, let b = s.boundingBox { s.camera.fit(b) }
                }
                .keyboardShortcut("1")
                Button("Reset North") {
                    if let s = AppState.active {
                        s.camera.animate.send(CameraTarget(lat: s.camera.centerLat, lon: s.camera.centerLon,
                                                           zoom: s.camera.zoom, rotation: 0))
                    }
                }
                .keyboardShortcut("0")
                Divider()
                Button("Show / Hide Panels") {
                    if let s = AppState.active {
                        withAnimation(.easeInOut(duration: 0.2)) { s.panelsHidden.toggle() }
                    }
                }
                .keyboardShortcut("\\")
            }
        }
    }

    @MainActor private func zoom(_ s: AppState, _ d: Double) {
        s.camera.animate.send(CameraTarget(lat: s.camera.centerLat, lon: s.camera.centerLon,
                                           zoom: max(MapCamera.minZoom, min(MapCamera.maxZoom, s.camera.zoom + d)),
                                           rotation: nil))
    }
}
