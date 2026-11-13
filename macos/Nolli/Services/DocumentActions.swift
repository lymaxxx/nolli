import SwiftUI
import AppKit
import UniformTypeIdentifiers

/// Project, fetch and search actions, reachable from the top bar, panels and the
/// app menus alike.
@MainActor
extension AppState {

    // MARK: Project

    private static var projectType: UTType { UTType(filenameExtension: "nolli") ?? .json }
    /// Projects saved before the app was renamed use `.mapcraft`. The contents are
    /// the same format, so they must always open; new files are saved as `.nolli`.
    static let projectExtensions = ["nolli", "mapcraft"]
    private static var openableTypes: [UTType] {
        projectExtensions.map { UTType(filenameExtension: $0) ?? .json }
    }

    /// Returns false if the user cancelled. Asks only when there's unsaved work.
    func confirmDiscardChanges(_ message: String) -> Bool {
        guard isDirty, !layers.isEmpty else { return true }
        let alert = NSAlert()
        alert.messageText = message
        alert.informativeText = "Your changes will be lost if you don't save them."
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Cancel")
        alert.addButton(withTitle: "Don't Save")
        switch alert.runModal() {
        case .alertFirstButtonReturn: return saveProjectBlocking()
        case .alertSecondButtonReturn: return false
        default: return true
        }
    }

    func newProject() {
        guard confirmDiscardChanges("Save changes before creating a new project?") else { return }
        layers = []
        boundingBox = nil
        signOutputs = []
        selectedSignId = nil
        selectedItem = nil
        projectURL = nil
        artboardBackgroundEnabled = false
        SceneStore.shared.invalidateAll()
        labelsVersion += 1
        isDirty = false
        resetUndoHistory()
        statusMessage = "New project"
    }

    func openProject() {
        guard confirmDiscardChanges("Save changes before opening another project?") else { return }
        let panel = NSOpenPanel()
        panel.allowedContentTypes = Self.openableTypes
        guard panel.runModal() == .OK, let url = panel.url else { return }
        open(url: url)
    }

    func open(url: URL) {
        do {
            SceneStore.shared.invalidateAll()
            try ProjectManager.shared.load(from: url, into: self)
            statusMessage = "Opened \(url.lastPathComponent)"
        } catch {
            let alert = NSAlert()
            alert.messageText = "Couldn't open \(url.lastPathComponent)"
            alert.informativeText = error.localizedDescription
            alert.runModal()
        }
    }

    func saveProject() { _ = saveProjectBlocking() }

    @discardableResult
    func saveProjectBlocking() -> Bool {
        guard let url = projectURL else { return saveProjectAs() }
        do {
            try ProjectManager.shared.save(appState: self, to: url)
            statusMessage = "Saved \(url.lastPathComponent)"
            return true
        } catch {
            statusMessage = "Save failed: \(error.localizedDescription)"
            return false
        }
    }

    @discardableResult
    func saveProjectAs() -> Bool {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [Self.projectType]
        // A project opened from a `.mapcraft` file is offered under the new extension.
        let baseName = projectURL?.deletingPathExtension().lastPathComponent ?? "Untitled"
        panel.nameFieldStringValue = baseName + ".nolli"
        guard panel.runModal() == .OK, let url = panel.url else { return false }
        do {
            try ProjectManager.shared.save(appState: self, to: url)
            statusMessage = "Saved \(url.lastPathComponent)"
            return true
        } catch {
            statusMessage = "Save failed: \(error.localizedDescription)"
            return false
        }
    }

    // MARK: Fetch

    func fetchAll() {
        guard let bbox = boundingBox else { return }
        startFetch(layers: layers, bbox: bbox)
    }

    func startFetch(layers targets: [MapLayer], bbox: BoundingBox) {
        currentFetchTask?.cancel()
        currentFetchTask = Task { @MainActor in
            isFetchingAll = true
            for (i, layer) in targets.enumerated() {
                guard !Task.isCancelled else { break }
                statusMessage = "Fetching \(layer.name)… (\(i + 1)/\(targets.count))"
                await doFetch(layer: layer, bbox: bbox)
            }
            isFetchingAll = false
            if Task.isCancelled {
                statusMessage = "Fetch cancelled"
            } else {
                let total = targets.map {
                    $0.lineFeatures.count + $0.polygonFeatures.count + $0.pointFeatures.count
                }.reduce(0, +)
                statusMessage = "Loaded \(total) features"
            }
            documentChanged()
        }
    }

    func fetchSingleLayer(_ layer: MapLayer) {
        guard let bbox = boundingBox else { return }
        Task { @MainActor in
            await doFetch(layer: layer, bbox: bbox)
            let n = layer.lineFeatures.count + layer.polygonFeatures.count + layer.pointFeatures.count
            statusMessage = "Loaded \(n) features for \(layer.name)"
            documentChanged()
        }
    }

    private func doFetch(layer: MapLayer, bbox: BoundingBox) async {
        if layer.kind == .background {
            let ring: [[Double]] = [
                [bbox.minLon, bbox.minLat], [bbox.maxLon, bbox.minLat],
                [bbox.maxLon, bbox.maxLat], [bbox.minLon, bbox.maxLat],
                [bbox.minLon, bbox.minLat]
            ]
            layer.polygonFeatures = [PolygonFeature(id: 0, tags: [:], rings: [ring])]
            layer.fetchStatus = .loaded
            labelsVersion += 1
            return
        }
        layer.fetchStatus = .fetching
        await OSMFetcher.shared.configure(cacheDays: settings.cacheDurationDays,
                                          endpoint: settings.overpassEndpoint)
        do {
            let result = try await OSMFetcher.shared.fetch(kind: layer.kind, bbox: bbox)
            layer.resetManualEdits()      // fresh data invalidates manual edits
            layer.lineFeatures    = result.lines
            layer.polygonFeatures = result.polygons
            layer.pointFeatures   = result.points
            layer.fetchStatus     = .loaded
            labelsVersion += 1
        } catch {
            layer.fetchStatus = .error(error.localizedDescription)
            statusMessage = "Couldn't fetch \(layer.name): \(error.localizedDescription)"
        }
    }

    /// A new selection re-downloads loaded layers, which replaces their data. If
    /// that would throw away hand edits, ask first.
    func boundingBoxChanged() {
        guard let bbox = boundingBox else { return }
        // A fresh project is designed at the scale it's being looked at.
        if layers.isEmpty { baseZoom = camera.zoom.rounded() }
        let loaded = layers.filter { $0.fetchStatus == .loaded }
        guard !loaded.isEmpty else { return }
        if loaded.contains(where: \.hasManualEdits) {
            let alert = NSAlert()
            alert.messageText = "Re-download data for the new area?"
            alert.informativeText = "Layers with manual edits will lose them."
            alert.addButton(withTitle: "Re-download")
            alert.addButton(withTitle: "Keep Current Data")
            guard alert.runModal() == .alertFirstButtonReturn else { return }
        }
        startFetch(layers: loaded, bbox: bbox)
    }

    // MARK: Search

    func geocode() {
        let q = searchText.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return }
        statusMessage = "Searching for “\(q)”…"
        Task { @MainActor in
            do {
                let results = try await GeocoderService.shared.search(q)
                geocodeResults = results
                statusMessage = results.isEmpty ? "No results for “\(q)”" : "Ready"
            } catch {
                statusMessage = "Search error: \(error.localizedDescription)"
            }
        }
    }

    func choose(_ result: GeocoderResult) {
        geocodeResults = []
        searchText = result.displayName.components(separatedBy: ",").first ?? result.displayName
        if let b = result.boundingBox {
            camera.fit(b)
        } else {
            camera.animate.send(CameraTarget(lat: result.lat, lon: result.lon, zoom: 15, rotation: nil))
        }
    }

}
