import SwiftUI
import Combine

enum CanvasMode: Equatable { case pan, selectArea, edit }
enum RightPanelTab: Equatable { case design, signs }

enum SelectedItem: Equatable {
    case layer(UUID)
    case labelChild(parentId: UUID)
    case symbolChild(parentId: UUID)
    case roadSubLayer(parentId: UUID, subId: UUID)
    /// A road subtype's LABEL style (full inspector), reached from the rows
    /// nested under the layer's Labels child.
    case subtypeLabel(parentId: UUID, subId: UUID)
}

@MainActor
class AppState: ObservableObject {
    // Canvas
    @Published var canvasMode: CanvasMode = .pan
    @Published var boundingBox: BoundingBox? = nil
    /// What the map is looking at. Separate object: it changes every frame of a
    /// gesture, and panels must not re-render while the map moves.
    let camera = MapCamera()

    /// Document version: bumped on every change that affects what's drawn. Use
    /// `documentChanged()` rather than touching this directly.
    @Published var labelsVersion: Int = 0

    // Panels
    @Published var panelsHidden = false
    @Published var rightTab: RightPanelTab = .design
    @Published var showExportSheet = false
    @Published var showSettingsSheet = false
    @Published var geocodeResults: [GeocoderResult] = []
    var currentFetchTask: Task<Void, Never>? = nil

    /// Project-wide design/output zoom. All size properties (line weight, font
    /// size, halo, icon size, label repeat/spacing distances) are authored at
    /// this zoom. The live editor map then scales everything proportionally by
    /// `scale(forViewZoom:)` so the user sees a true WYSIWYG zoom of the final
    /// artwork while stored values stay fixed to the base scale.
    @Published var baseZoom: Double = 15

    /// Global "overall artwork scale" for sign output — zooms every sign's
    /// artwork in/out proportionally (like a vector artboard) on top of the
    /// project base scale. 1.0 = render at base scale.
    @Published var signArtworkScale: Double = 1.0

    /// Frame background fill (Figma-style): when enabled, an opaque fill drawn
    /// behind every layer (covers the tile basemap). Off by default so the
    /// tiles / Leaflet background show through.
    @Published var artboardBackgroundEnabled: Bool = false
    @Published var artboardBackground: CodableColor = .init(r: 0.973, g: 0.961, b: 0.941) // #f8f5f0

    /// Effective frame background, or nil when disabled (transparent).
    var effectiveBackground: CodableColor? { artboardBackgroundEnabled ? artboardBackground : nil }

    /// Proportional scale factor for rendering at a given live view zoom.
    /// 1.0 at the base zoom; doubles per zoom level in, halves per level out.
    func scale(forViewZoom z: Double) -> Double { pow(2, z - baseZoom) }

    // Layers (ordered — first in list = bottom render layer)
    @Published var layers: [MapLayer] = []
    @Published var selectedItem: SelectedItem? = nil

    // Components library
    @Published var iconLibrary: [SVGIcon] = []
    @Published var textStyles: [TextStyle] = []

    // Color library (custom color panel)
    @Published var colorSwatches: [CodableColor] = []
    @Published var colorSchemes: [MapColorScheme] = []

    /// The app's single live instance, so deeply-nested controls (color wells)
    /// can reach the swatch/scheme library without plumbing it everywhere.
    static weak var active: AppState?

    init() { AppState.active = self }

    // MARK: Undo

    private struct LayerValue {
        let id: UUID, name: String, kind: LayerKind, isVisible: Bool
        let roadStyle: RoadStyle, areaStyle: AreaStyle, poiStyle: POIStyle
        let labelStyle: LabelStyle, symbolStyle: SymbolStyle
        let roadSubLayers: [RoadSubLayer]
        let lines: [LineFeature], polygons: [PolygonFeature], points: [PointFeature]
        let labelOffsets: [Int64: CGVector], along: [Int64: Double], pins: [Int64: [Double]]
        let symbolOffsets: [Int64: CGVector]
        let origLines: [Int64: [[Double]]], origPolys: [Int64: [[[Double]]]], origPoints: [Int64: [Double]]
    }
    private struct DocState {
        let layers: [LayerValue]
        let signs: [SignOutput]
        let bgEnabled: Bool, bg: CodableColor, baseZoom: Double
    }
    private var undoStack: [DocState] = []
    private var redoStack: [DocState] = []
    private var lastState: DocState?
    private var captureWork: DispatchWorkItem?
    private var restoring = false

    private func currentDocState() -> DocState {
        DocState(layers: layers.map { l in
            LayerValue(id: l.id, name: l.name, kind: l.kind, isVisible: l.isVisible,
                       roadStyle: l.roadStyle, areaStyle: l.areaStyle, poiStyle: l.poiStyle,
                       labelStyle: l.labelStyle, symbolStyle: l.symbolStyle, roadSubLayers: l.roadSubLayers,
                       lines: l.lineFeatures, polygons: l.polygonFeatures, points: l.pointFeatures,
                       labelOffsets: l.labelOffsets, along: l.labelAlongOffsets, pins: l.labelPins,
                       symbolOffsets: l.symbolOffsets, origLines: l.originalLineGeometry,
                       origPolys: l.originalPolygonGeometry, origPoints: l.originalPointGeometry)
        }, signs: signOutputs, bgEnabled: artboardBackgroundEnabled, bg: artboardBackground, baseZoom: baseZoom)
    }

    private func restore(_ st: DocState) {
        restoring = true
        var existing: [UUID: MapLayer] = [:]
        for l in layers { existing[l.id] = l }
        layers = st.layers.map { v in
            let l = existing[v.id] ?? MapLayer(kind: v.kind, name: v.name, id: v.id)
            l.name = v.name; l.isVisible = v.isVisible
            l.roadStyle = v.roadStyle; l.areaStyle = v.areaStyle; l.poiStyle = v.poiStyle
            l.labelStyle = v.labelStyle; l.symbolStyle = v.symbolStyle; l.roadSubLayers = v.roadSubLayers
            l.lineFeatures = v.lines; l.polygonFeatures = v.polygons; l.pointFeatures = v.points
            l.labelOffsets = v.labelOffsets; l.labelAlongOffsets = v.along; l.labelPins = v.pins
            l.symbolOffsets = v.symbolOffsets; l.originalLineGeometry = v.origLines
            l.originalPolygonGeometry = v.origPolys; l.originalPointGeometry = v.origPoints
            if !(v.lines.isEmpty && v.polygons.isEmpty && v.points.isEmpty) { l.fetchStatus = .loaded }
            return l
        }
        signOutputs = st.signs
        artboardBackgroundEnabled = st.bgEnabled
        artboardBackground = st.bg
        baseZoom = st.baseZoom
        if let id = selectedLayerId, !layers.contains(where: { $0.id == id }) { selectedItem = nil }
        labelsVersion += 1
        isDirty = true
        restoring = false
    }

    /// Call after ANY change to the document. Redraws the map, marks the project
    /// edited and records an undo step (rapid changes such as a slider drag
    /// coalesce into a single step).
    func documentChanged() {
        labelsVersion += 1
        isDirty = true
        guard !restoring else { return }
        captureWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            MainActor.assumeIsolated {
                self?.captureWork = nil
                self?.captureUndoStep()
            }
        }
        captureWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35, execute: work)
    }

    private func captureUndoStep() {
        if let last = lastState {
            undoStack.append(last)
            if undoStack.count > 100 { undoStack.removeFirst() }
            redoStack.removeAll()
        }
        lastState = currentDocState()
    }

    func resetUndoHistory() {
        captureWork?.cancel()
        undoStack.removeAll(); redoStack.removeAll()
        lastState = currentDocState()
    }

    func undo() {
        if let work = captureWork { work.cancel(); captureWork = nil; captureUndoStep() }
        guard let st = undoStack.popLast() else { return }
        if let last = lastState { redoStack.append(last) }
        lastState = st
        restore(st)
    }

    func redo() {
        if let work = captureWork { work.cancel(); captureWork = nil; captureUndoStep() }
        guard let st = redoStack.popLast() else { return }
        if let last = lastState { undoStack.append(last) }
        lastState = st
        restore(st)
    }

    // MARK: Edit-mode session (staged changes with Save / Revert)

    struct LayerEditBackup {
        var labelOffsets: [Int64: CGVector]
        var labelAlongOffsets: [Int64: Double]
        var labelPins: [Int64: [Double]]
        var symbolOffsets: [Int64: CGVector]
        var lineFeatures: [LineFeature]
        var polygonFeatures: [PolygonFeature]
        var pointFeatures: [PointFeature]
        var originalLineGeometry: [Int64: [[Double]]]
        var originalPolygonGeometry: [Int64: [[[Double]]]]
        var originalPointGeometry: [Int64: [Double]]
    }

    /// Baseline taken when entering edit mode; Revert restores it.
    var editBackups: [UUID: LayerEditBackup] = [:]
    @Published var editSessionDirty = false

    func beginEditSession() {
        editBackups = [:]
        for layer in layers {
            editBackups[layer.id] = LayerEditBackup(
                labelOffsets: layer.labelOffsets,
                labelAlongOffsets: layer.labelAlongOffsets,
                labelPins: layer.labelPins,
                symbolOffsets: layer.symbolOffsets,
                lineFeatures: layer.lineFeatures,
                polygonFeatures: layer.polygonFeatures,
                pointFeatures: layer.pointFeatures,
                originalLineGeometry: layer.originalLineGeometry,
                originalPolygonGeometry: layer.originalPolygonGeometry,
                originalPointGeometry: layer.originalPointGeometry)
        }
        editSessionDirty = false
    }

    /// Keeps the staged edits and re-baselines the session.
    func commitEditSession() {
        beginEditSession()
        isDirty = true
        statusMessage = "Edits saved"
    }

    /// Restores every layer to the state captured when edit mode started.
    func revertEditSession() {
        for layer in layers {
            guard let b = editBackups[layer.id] else { continue }
            layer.labelOffsets = b.labelOffsets
            layer.labelAlongOffsets = b.labelAlongOffsets
            layer.labelPins = b.labelPins
            layer.symbolOffsets = b.symbolOffsets
            layer.lineFeatures = b.lineFeatures
            layer.polygonFeatures = b.polygonFeatures
            layer.pointFeatures = b.pointFeatures
            layer.originalLineGeometry = b.originalLineGeometry
            layer.originalPolygonGeometry = b.originalPolygonGeometry
            layer.originalPointGeometry = b.originalPointGeometry
        }
        editSessionDirty = false
        documentChanged()
        statusMessage = "Edits reverted"
    }

    // MARK: Color schemes

    /// Captures every color slot of every layer into a named scheme.
    func captureColorScheme(named name: String) -> MapColorScheme {
        var out: [String: CodableColor] = ["frame|background": artboardBackground]
        for layer in layers {
            let base = "\(layer.kind.rawValue)|\(layer.name)"
            out["\(base)|road.color"]  = layer.roadStyle.color
            out["\(base)|road.casing"] = layer.roadStyle.casingColor
            out["\(base)|area.fill"]   = layer.areaStyle.fillColor
            out["\(base)|area.stroke"] = layer.areaStyle.strokeColor
            out["\(base)|poi.fill"]    = layer.poiStyle.fillColor
            out["\(base)|poi.stroke"]  = layer.poiStyle.strokeColor
            out["\(base)|label.color"] = layer.labelStyle.color
            out["\(base)|label.halo"]  = layer.labelStyle.haloColor
            for sub in layer.roadSubLayers {
                let sb = "\(base)|sub:\(sub.name)"
                out["\(sb)|road.color"]  = sub.customStyle.color
                out["\(sb)|road.casing"] = sub.customStyle.casingColor
                if let ls = sub.labelStyle {
                    out["\(sb)|label.color"] = ls.color
                    out["\(sb)|label.halo"]  = ls.haloColor
                }
            }
        }
        return MapColorScheme(name: name, colors: out)
    }

    /// Applies a saved scheme to all layers whose kind+name match.
    func applyColorScheme(_ scheme: MapColorScheme) {
        func c(_ key: String) -> CodableColor? { scheme.colors[key] }
        if let bg = c("frame|background") { artboardBackground = bg }
        for layer in layers {
            let base = "\(layer.kind.rawValue)|\(layer.name)"
            if let v = c("\(base)|road.color")  { layer.roadStyle.color = v }
            if let v = c("\(base)|road.casing") { layer.roadStyle.casingColor = v }
            if let v = c("\(base)|area.fill")   { layer.areaStyle.fillColor = v }
            if let v = c("\(base)|area.stroke") { layer.areaStyle.strokeColor = v }
            if let v = c("\(base)|poi.fill")    { layer.poiStyle.fillColor = v }
            if let v = c("\(base)|poi.stroke")  { layer.poiStyle.strokeColor = v }
            if let v = c("\(base)|label.color") { layer.labelStyle.color = v }
            if let v = c("\(base)|label.halo")  { layer.labelStyle.haloColor = v }
            for i in layer.roadSubLayers.indices {
                let sb = "\(base)|sub:\(layer.roadSubLayers[i].name)"
                if let v = c("\(sb)|road.color")  { layer.roadSubLayers[i].customStyle.color = v }
                if let v = c("\(sb)|road.casing") { layer.roadSubLayers[i].customStyle.casingColor = v }
                if let v = c("\(sb)|label.color") { layer.roadSubLayers[i].labelStyle?.color = v }
                if let v = c("\(sb)|label.halo")  { layer.roadSubLayers[i].labelStyle?.haloColor = v }
            }
        }
        documentChanged()
    }

    // Artboard
    /// View/artboard rotation lives on the camera (single source of truth).
    var artboardRotation: Double {
        get { camera.rotation }
        set { camera.set(lat: camera.centerLat, lon: camera.centerLon, rotation: newValue) }
    }
    @Published var showNorthArrow: Bool = false
    @Published var northArrowPosition: NorthArrowPosition = .topRight

    // Settings
    @Published var settings: AppSettings = AppSettings()

    // Status
    @Published var statusMessage: String = "Ready"
    @Published var searchText: String = ""

    // Signs
    @Published var signOutputs: [SignOutput] = []
    @Published var selectedSignId: UUID? = nil
    @Published var isPlacingSign: Bool = false
    /// Which sign side (if any) is currently shown in the main viewport.
    /// nil = show the live map; changes otherwise only update the panel thumbnails.
    @Published var viewportSignSide: SignSide? = nil

    // Project
    @Published var projectURL: URL? = nil
    @Published var isDirty: Bool = false
    @Published var isFetchingAll: Bool = false

    // Backward-compat computed layer ID (read: returns whichever layer is relevant)
    var selectedLayerId: UUID? {
        get {
            switch selectedItem {
            case .layer(let id): return id
            case .labelChild(let parentId): return parentId
            case .symbolChild(let parentId): return parentId
            case .roadSubLayer(let parentId, _): return parentId
            case .subtypeLabel(let parentId, _): return parentId
            case .none: return nil
            }
        }
        set { selectedItem = newValue.map { .layer($0) } }
    }

    var selectedLayer: MapLayer? {
        guard let item = selectedItem else { return nil }
        switch item {
        case .layer(let id): return layers.first { $0.id == id }
        case .labelChild(let parentId): return layers.first { $0.id == parentId }
        case .symbolChild(let parentId): return layers.first { $0.id == parentId }
        case .roadSubLayer(let parentId, _): return layers.first { $0.id == parentId }
        case .subtypeLabel(let parentId, _): return layers.first { $0.id == parentId }
        }
    }

    func addLayer(_ kind: LayerKind) {
        let layer = MapLayer(kind: kind)
        layers.insert(layer, at: 0)
        selectedItem = .layer(layer.id)
        documentChanged()
    }

    func removeLayer(_ id: UUID) {
        layers.removeAll { $0.id == id }
        if selectedLayerId == id {
            selectedItem = nil
        }
        documentChanged()
    }

    func moveLayer(from source: IndexSet, to dest: Int) {
        layers.move(fromOffsets: source, toOffset: dest)
        documentChanged()
    }
}

struct AppSettings: Codable, Equatable {
    var cacheDurationDays: Int = 7
    var defaultExportFormat: ExportFormat = .svg
    var defaultWidthMM: Double = 400
    var defaultHeightMM: Double = 400
    var defaultDPI: Double = 300
    var defaultFont: String = "Helvetica Neue"
    var overpassEndpoint: String = "https://overpass.openstreetmap.fr/api/interpreter"
    var showTileBackground: Bool = true
    var tileOpacity: Double = 1.0
}

enum ExportFormat: String, CaseIterable, Identifiable, Codable {
    case svg = "SVG"
    case pdf = "PDF"
    case jsx = "Illustrator"
    var id: String { rawValue }
    var fileExtension: String {
        switch self { case .svg: "svg"; case .pdf: "pdf"; case .jsx: "jsx" }
    }
}

// MARK: - SVG Icon model

struct SVGIcon: Identifiable, Codable {
    var id: UUID = UUID()
    var name: String
    var svgData: Data
    var width: Double = 24
    var height: Double = 24
    var lockAspect: Bool = true
    var opacity: Double = 1.0
    var blendMode: String = "normal"
}
