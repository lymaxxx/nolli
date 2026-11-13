import Foundation

struct ProjectSnapshot: Codable {
    var version: Int = 7
    var boundingBox: BoundingBox?
    var settings: AppSettings
    var layers: [LayerSnapshot]
    var iconLibrary: [SVGIcon] = []
    var textStyles: [TextStyle] = []
    // Artboard
    var artboardRotation: Double = 0.0
    var showNorthArrow: Bool = false
    var northArrowPosition: NorthArrowPosition = .topRight
    // Project-wide design/output zoom (defaults keep old files working).
    var baseZoom: Double = 15
    // Global overall artwork scale for sign output.
    var signArtworkScale: Double = 1.0
    // Color library (optional so files saved before this feature still open).
    var colorSwatches: [CodableColor]? = nil
    var colorSchemes: [MapColorScheme]? = nil
    // Frame background (optional for old-file decode).
    var artboardBackgroundEnabled: Bool? = nil
    var artboardBackground: CodableColor? = nil
    var signOutputs: [SignOutput]? = nil
    var cameraLat: Double? = nil
    var cameraLon: Double? = nil
    var cameraZoom: Double? = nil
}

struct LayerSnapshot: Codable {
    var id: String
    var name: String
    var kind: LayerKind
    var isVisible: Bool
    var roadStyle: RoadStyle
    var areaStyle: AreaStyle
    var poiStyle: POIStyle
    var labelStyle: LabelStyle
    var symbolStyle: SymbolStyle
    var roadSubLayers: [RoadSubLayer]
    var lineFeatures: [LineFeature]
    var polygonFeatures: [PolygonFeature]
    var pointFeatures: [PointFeature]
    // Manual edit-mode overrides (optional so older files still decode).
    var labelOffsets: [Int64: CGVector]? = nil
    var labelAlongOffsets: [Int64: Double]? = nil
    var labelPins: [Int64: [Double]]? = nil
    var symbolOffsets: [Int64: CGVector]? = nil
    var originalLineGeometry: [Int64: [[Double]]]? = nil
    var originalPolygonGeometry: [Int64: [[[Double]]]]? = nil
    var originalPointGeometry: [Int64: [Double]]? = nil
}

@MainActor
class ProjectManager {
    static let shared = ProjectManager()

    func snapshot(from appState: AppState) -> ProjectSnapshot {
        ProjectSnapshot(
            boundingBox: appState.boundingBox,
            settings: appState.settings,
            layers: appState.layers.map { layer in
                LayerSnapshot(
                    id: layer.id.uuidString,
                    name: layer.name,
                    kind: layer.kind,
                    isVisible: layer.isVisible,
                    roadStyle: layer.roadStyle,
                    areaStyle: layer.areaStyle,
                    poiStyle: layer.poiStyle,
                    labelStyle: layer.labelStyle,
                    symbolStyle: layer.symbolStyle,
                    roadSubLayers: layer.roadSubLayers,
                    lineFeatures: layer.lineFeatures,
                    polygonFeatures: layer.polygonFeatures,
                    pointFeatures: layer.pointFeatures,
                    labelOffsets: layer.labelOffsets.isEmpty ? nil : layer.labelOffsets,
                    labelAlongOffsets: layer.labelAlongOffsets.isEmpty ? nil : layer.labelAlongOffsets,
                    labelPins: layer.labelPins.isEmpty ? nil : layer.labelPins,
                    symbolOffsets: layer.symbolOffsets.isEmpty ? nil : layer.symbolOffsets,
                    originalLineGeometry: layer.originalLineGeometry.isEmpty ? nil : layer.originalLineGeometry,
                    originalPolygonGeometry: layer.originalPolygonGeometry.isEmpty ? nil : layer.originalPolygonGeometry,
                    originalPointGeometry: layer.originalPointGeometry.isEmpty ? nil : layer.originalPointGeometry
                )
            },
            iconLibrary: appState.iconLibrary,
            textStyles: appState.textStyles,
            artboardRotation: appState.artboardRotation,
            showNorthArrow: appState.showNorthArrow,
            northArrowPosition: appState.northArrowPosition,
            baseZoom: appState.baseZoom,
            signArtworkScale: appState.signArtworkScale,
            colorSwatches: appState.colorSwatches,
            colorSchemes: appState.colorSchemes,
            artboardBackgroundEnabled: appState.artboardBackgroundEnabled,
            artboardBackground: appState.artboardBackground,
            signOutputs: appState.signOutputs,
            cameraLat: appState.camera.centerLat,
            cameraLon: appState.camera.centerLon,
            cameraZoom: appState.camera.zoom
        )
    }

    func apply(snapshot: ProjectSnapshot, to appState: AppState) {
        appState.boundingBox = snapshot.boundingBox
        appState.settings = snapshot.settings
        appState.iconLibrary = snapshot.iconLibrary
        appState.textStyles = snapshot.textStyles
        appState.layers = snapshot.layers.compactMap { s in
            let layer = MapLayer(kind: s.kind, name: s.name, id: UUID(uuidString: s.id) ?? UUID())
            layer.isVisible = s.isVisible
            layer.roadStyle = s.roadStyle
            layer.areaStyle = s.areaStyle
            layer.poiStyle = s.poiStyle
            layer.labelStyle = s.labelStyle
            layer.symbolStyle = s.symbolStyle
            layer.roadSubLayers = s.roadSubLayers
            layer.lineFeatures = s.lineFeatures
            layer.polygonFeatures = s.polygonFeatures
            layer.pointFeatures = s.pointFeatures
            layer.labelOffsets = s.labelOffsets ?? [:]
            layer.labelAlongOffsets = s.labelAlongOffsets ?? [:]
            layer.labelPins = s.labelPins ?? [:]
            layer.symbolOffsets = s.symbolOffsets ?? [:]
            layer.originalLineGeometry = s.originalLineGeometry ?? [:]
            layer.originalPolygonGeometry = s.originalPolygonGeometry ?? [:]
            layer.originalPointGeometry = s.originalPointGeometry ?? [:]
            // Materialize subtype label styles + migrate legacy custom styles
            // into a pinned-override set (appearance preserved).
            layer.materializeSubLabelStyles(migrateOverrides: true)
            if !layer.lineFeatures.isEmpty || !layer.polygonFeatures.isEmpty || !layer.pointFeatures.isEmpty {
                layer.fetchStatus = .loaded
            }
            return layer
        }
        appState.showNorthArrow = snapshot.showNorthArrow
        appState.northArrowPosition = snapshot.northArrowPosition
        appState.baseZoom = snapshot.baseZoom
        appState.signArtworkScale = snapshot.signArtworkScale
        appState.colorSwatches = snapshot.colorSwatches ?? []
        appState.colorSchemes = snapshot.colorSchemes ?? []
        appState.artboardBackgroundEnabled = snapshot.artboardBackgroundEnabled ?? false
        if let bg = snapshot.artboardBackground { appState.artboardBackground = bg }
        appState.signOutputs = snapshot.signOutputs ?? []
        appState.selectedSignId = nil
        appState.selectedItem = nil
        appState.camera.set(lat: snapshot.cameraLat ?? snapshot.boundingBox?.center.lat ?? appState.camera.centerLat,
                            lon: snapshot.cameraLon ?? snapshot.boundingBox?.center.lon ?? appState.camera.centerLon,
                            zoom: snapshot.cameraZoom ?? appState.baseZoom,
                            rotation: snapshot.artboardRotation)
        appState.labelsVersion += 1
        appState.isDirty = false
    }

    func save(appState: AppState, to url: URL) throws {
        let snap = snapshot(from: appState)
        let encoder = JSONEncoder()
        let data = try encoder.encode(snap)
        try data.write(to: url)
        appState.projectURL = url
        appState.isDirty = false
    }

    func load(from url: URL, into appState: AppState) throws {
        let raw = try Data(contentsOf: url)
        // Swift's synthesized decoding fails on any key missing from the file,
        // even for properties with default values, so fill anything an older
        // version of the app didn't write with its current default.
        let data = Self.upgraded(raw) ?? raw
        let snap = try JSONDecoder().decode(ProjectSnapshot.self, from: data)
        apply(snapshot: snap, to: appState)
        appState.projectURL = url
        appState.resetUndoHistory()
    }

    private static func upgraded(_ data: Data) -> Data? {
        guard var root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        func fill<T: Encodable>(_ d: inout [String: Any], _ def: T) {
            for (k, v) in Inheritance.dict(def) where d[k] == nil { d[k] = v }
        }
        func fillChild<T: Encodable>(_ d: inout [String: Any], _ key: String, _ def: T) {
            if var c = d[key] as? [String: Any] { fill(&c, def); d[key] = c }
        }
        // Before version 7 every layer carried 80 by default. `minSpacing` is now a
        // full clear margin, and 80 would hide most labels, so that old default
        // moves to the current one. Values the user picked are kept.
        let fileVersion = root["version"] as? Int ?? 0
        func migrateMargin(_ d: inout [String: Any]) {
            guard fileVersion < 7, var ls = d["labelStyle"] as? [String: Any],
                  (ls["minSpacing"] as? Double) == 80 else { return }
            ls["minSpacing"] = LabelStyle().minSpacing
            d["labelStyle"] = ls
        }
        fill(&root, ProjectSnapshot(settings: AppSettings(), layers: []))
        fillChild(&root, "settings", AppSettings())
        if var layers = root["layers"] as? [[String: Any]] {
            for i in layers.indices {
                migrateMargin(&layers[i])
                fillChild(&layers[i], "roadStyle", RoadStyle())
                fillChild(&layers[i], "areaStyle", AreaStyle())
                fillChild(&layers[i], "poiStyle", POIStyle())
                fillChild(&layers[i], "labelStyle", LabelStyle())
                fillChild(&layers[i], "symbolStyle", SymbolStyle())
                if layers[i]["lineFeatures"] == nil { layers[i]["lineFeatures"] = [Any]() }
                if layers[i]["polygonFeatures"] == nil { layers[i]["polygonFeatures"] = [Any]() }
                if layers[i]["pointFeatures"] == nil { layers[i]["pointFeatures"] = [Any]() }
                if var subs = layers[i]["roadSubLayers"] as? [[String: Any]] {
                    for j in subs.indices {
                        migrateMargin(&subs[j])
                        fill(&subs[j], RoadSubLayer(name: "", roadTypes: []))
                        fillChild(&subs[j], "customStyle", RoadStyle())
                        fillChild(&subs[j], "labelStyle", LabelStyle())
                    }
                    layers[i]["roadSubLayers"] = subs
                } else {
                    layers[i]["roadSubLayers"] = [Any]()
                }
            }
            root["layers"] = layers
        }
        if var signs = root["signOutputs"] as? [[String: Any]] {
            for i in signs.indices { fill(&signs[i], SignOutput(lat: 0, lon: 0)) }
            root["signOutputs"] = signs
        }
        return try? JSONSerialization.data(withJSONObject: root)
    }
}
