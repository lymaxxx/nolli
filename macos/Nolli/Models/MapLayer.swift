import SwiftUI

// MARK: - Layer kind

enum LayerKind: String, CaseIterable, Codable, Identifiable, Sendable {
    // Roads
    case roads = "roads"
    // Areas
    case parks = "parks"
    case water = "water"
    case buildings = "buildings"
    case pedestrianZones = "pedestrian_zones"
    case plazas = "plazas"
    // POIs — existing
    case landmarks = "landmarks"
    case transport = "transport"
    // POIs — city services
    case dining = "dining"
    case accommodation = "accommodation"
    case healthcare = "healthcare"
    case parking = "parking"
    case shopping = "shopping"
    case education = "education"
    // Special
    case background = "background"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .roads: "Roads"
        case .parks: "Parks & Green Space"
        case .water: "Water"
        case .buildings: "Buildings"
        case .pedestrianZones: "Pedestrian Zones"
        case .plazas: "Plazas & Squares"
        case .landmarks: "Landmarks"
        case .transport: "Transport"
        case .dining: "Dining"
        case .accommodation: "Accommodation"
        case .healthcare: "Healthcare"
        case .parking: "Parking"
        case .shopping: "Shopping"
        case .education: "Education"
        case .background: "Background"
        }
    }

    var icon: String {
        switch self {
        case .roads: "road.lanes"
        case .parks: "leaf"
        case .water: "drop"
        case .buildings: "building.2"
        case .pedestrianZones: "figure.walk"
        case .plazas: "square.fill"
        case .landmarks: "mappin"
        case .transport: "tram"
        case .dining: "fork.knife"
        case .accommodation: "bed.double"
        case .healthcare: "cross.case"
        case .parking: "parkingsign"
        case .shopping: "cart"
        case .education: "graduationcap"
        case .background: "rectangle.fill"
        }
    }

    var defaultColor: CodableColor {
        switch self {
        case .roads: .init(r: 0.2, g: 0.2, b: 0.2)
        case .parks: .init(r: 0.6, g: 0.8, b: 0.6)
        case .water: .init(r: 0.5, g: 0.7, b: 0.9)
        case .buildings: .init(r: 0.85, g: 0.82, b: 0.78)
        case .pedestrianZones: .init(r: 0.95, g: 0.9, b: 0.8)
        case .plazas: .init(r: 0.9, g: 0.87, b: 0.83)
        case .landmarks: .init(r: 0.9, g: 0.22, b: 0.21)
        case .transport: .init(r: 0.1, g: 0.5, b: 0.9)
        case .dining: .init(r: 0.95, g: 0.45, b: 0.1)
        case .accommodation: .init(r: 0.5, g: 0.2, b: 0.8)
        case .healthcare: .init(r: 0.9, g: 0.1, b: 0.3)
        case .parking: .init(r: 0.4, g: 0.6, b: 0.8)
        case .shopping: .init(r: 0.1, g: 0.6, b: 0.6)
        case .education: .init(r: 0.2, g: 0.5, b: 0.3)
        case .background: .init(r: 0.97, g: 0.95, b: 0.90)
        }
    }

    var featureType: FeatureKind {
        switch self {
        case .roads: .line
        case .landmarks, .transport, .dining, .accommodation, .healthcare, .shopping, .education: .point
        case .background, .parking, .parks, .water, .buildings, .pedestrianZones, .plazas: .polygon
        }
    }

    /// Returns false for layers that need no Overpass fetch
    var requiresFetch: Bool { self != .background }

    var overpassQuery: String {
        switch self {
        case .roads:
            return #"way["highway"]({bbox})"#
        case .parks:
            return #"(way["leisure"~"park|garden|recreation_ground"]({bbox});way["landuse"~"grass|park|recreation_ground|meadow|allotments"]({bbox});relation["leisure"~"park|garden"]({bbox});relation["landuse"~"grass|park|recreation_ground|meadow"]({bbox});)"#
        case .water:
            return #"(way["natural"="water"]({bbox});way["waterway"~"river|canal|stream"]({bbox});relation["natural"="water"]({bbox});relation["waterway"="riverbank"]({bbox});)"#
        case .buildings:
            return #"(way["building"]({bbox});relation["building"]({bbox});)"#
        case .pedestrianZones:
            return #"(way["highway"="pedestrian"]({bbox});way["highway"="pedestrian"]["area"="yes"]({bbox});)"#
        case .plazas:
            return #"(way["place"="square"]({bbox});way["leisure"="plaza"]({bbox});)"#
        case .landmarks:
            return #"(node["tourism"~"museum|gallery|artwork|attraction|viewpoint|zoo"]({bbox});node["amenity"~"theatre|library|place_of_worship|arts_centre|cinema"]({bbox});node["historic"]({bbox});)"#
        case .transport:
            return #"(node["public_transport"="station"]({bbox});node["railway"~"station|halt"]({bbox});node["amenity"~"bus_station|ferry_terminal"]({bbox});way["public_transport"="station"]({bbox});way["railway"="station"]({bbox});way["amenity"~"bus_station|ferry_terminal"]({bbox});)"#
        case .dining:
            return #"(node["amenity"~"restaurant|cafe|bar|pub|fast_food|food_court|ice_cream"]({bbox});)"#
        case .accommodation:
            return #"(node["tourism"~"hotel|hostel|motel|guest_house|bed_and_breakfast|apartment"]({bbox});)"#
        case .healthcare:
            return #"(node["amenity"~"hospital|clinic|pharmacy|doctors|dentist|veterinary"]({bbox});way["amenity"~"hospital|clinic"]({bbox});)"#
        case .parking:
            return #"(way["amenity"="parking"]({bbox});node["amenity"="parking"]({bbox});)"#
        case .shopping:
            return #"(node["shop"]({bbox});node["amenity"~"marketplace|supermarket"]({bbox});)"#
        case .education:
            return #"(node["amenity"~"school|university|college|kindergarten|library"]({bbox});way["amenity"~"school|university|college"]({bbox});)"#
        case .background:
            return ""
        }
    }
}

enum FeatureKind { case line, polygon, point }

// MARK: - Road sub-layer

struct RoadSubLayer: Identifiable, Codable, Equatable {
    var id: UUID = UUID()
    var name: String
    var roadTypes: [String]        // highway tag values included in this sub-layer
    var isVisible: Bool = true
    var useCustomStyle: Bool = false
    var customStyle: RoadStyle = RoadStyle()
    // Per-subtype label style. After migration this is always materialized from
    // the master; `labelOverrides` lists the coding keys the user has pinned so
    // master edits propagate to every NON-pinned field (Figma-style inheritance).
    var labelStyle: LabelStyle? = nil
    var labelOverrides: Set<String>? = nil
    // Same per-field inheritance for the line style: `customStyle` is always
    // materialized once this is non-nil, and only the keys listed here are the
    // subtype's own — everything else follows the layer's master line style.
    var lineOverrides: Set<String>? = nil
    /// Width given to brand-new subtypes (materialized into an override).
    var defaultWidth: Double? = nil
    // Deprecated: kept only so old project files decode + migrate. No longer
    // gates rendering — a subtype's own labelStyle.enabled controls labelling.
    var useCustomLabelStyle: Bool = false
}

extension RoadSubLayer {
    /// One row per kind of road people actually want to treat differently, with
    /// a sensible width hierarchy. Index 0 is the top row and renders on top.
    static var defaults: [RoadSubLayer] {
        func make(_ name: String, _ types: [String], width: Double) -> RoadSubLayer {
            var s = RoadSubLayer(name: name, roadTypes: types)
            s.defaultWidth = width
            return s
        }
        return [
            make("Motorway",   ["motorway", "motorway_link"], width: 3.5),
            make("Trunk",      ["trunk", "trunk_link"], width: 3.2),
            make("Primary",    ["primary", "primary_link"], width: 3),
            make("Secondary",  ["secondary", "secondary_link"], width: 2.6),
            make("Tertiary",   ["tertiary", "tertiary_link"], width: 2.2),
            make("Residential", ["residential", "unclassified", "living_street", "road"], width: 1.8),
            make("Pedestrian", ["pedestrian"], width: 1.4),
            make("Service",    ["service", "busway"], width: 1),
            make("Paths",      ["footway", "path", "steps", "corridor", "bridleway", "track"], width: 0.6),
            make("Cycleways",  ["cycleway"], width: 0.6),
        ]
    }

    /// The line style this subtype renders with.
    func resolvedLineStyle(master: RoadStyle) -> RoadStyle {
        if lineOverrides != nil { return customStyle }
        return useCustomStyle ? customStyle : master
    }
}

// MARK: - Map layer (one entry in the layer panel)

@MainActor
class MapLayer: ObservableObject, Identifiable {
    let id: UUID
    @Published var name: String
    @Published var kind: LayerKind
    @Published var isVisible: Bool = true
    @Published var fetchStatus: FetchStatus = .idle

    // Style — only the relevant one is used depending on kind
    @Published var roadStyle: RoadStyle
    @Published var areaStyle: AreaStyle
    @Published var poiStyle: POIStyle
    @Published var labelStyle: LabelStyle
    @Published var symbolStyle: SymbolStyle

    // Road sub-layers (only used when kind == .roads)
    @Published var roadSubLayers: [RoadSubLayer]

    // Fetched features (transient — not saved in project by default)
    var lineFeatures: [LineFeature] = [] { didSet { geometryVersion &+= 1 } }
    var polygonFeatures: [PolygonFeature] = [] { didSet { geometryVersion &+= 1 } }
    var pointFeatures: [PointFeature] = [] { didSet { geometryVersion &+= 1 } }
    /// Bumped on any feature change; lets the scene compiler reuse built paths
    /// when only a style changed.
    private(set) var geometryVersion = 0

    // ── Manual edit-mode overrides ──────────────────────────────────────────
    // All keyed by OSM feature id (Int64), in ARTWORK units (base-zoom px) so
    // they mean the same thing at any view zoom and in every export. Reset on
    // re-fetch. Not @Published — callers bump appState.labelsVersion.

    /// Free label offsets (non-curved labels, points, polygons).
    var labelOffsets: [Int64: CGVector] = [:]
    /// Curved line labels: shift ALONG the road (arc distance, artwork units).
    /// Keyed by the merged chain's id (first way of the stitched street).
    var labelAlongOffsets: [Int64: Double] = [:]
    /// Curved line labels placed by hand: exact arc distances along the stitched
    /// street (keyed by chain id). A pinned chain shows exactly these labels and
    /// no automatic ones; an empty array hides the street's name altogether.
    var labelPins: [Int64: [Double]] = [:]
    /// Symbol icon centre offsets.
    var symbolOffsets: [Int64: CGVector] = [:]
    /// Originals of manually reshaped geometry, captured on first vertex edit
    /// so "Reset edits" can restore the fetched shape.
    var originalLineGeometry: [Int64: [[Double]]] = [:]
    var originalPolygonGeometry: [Int64: [[[Double]]]] = [:]
    var originalPointGeometry: [Int64: [Double]] = [:]

    /// True when the layer carries any manual edit-mode change.
    var hasManualEdits: Bool {
        !labelOffsets.isEmpty || !labelAlongOffsets.isEmpty || !labelPins.isEmpty || !symbolOffsets.isEmpty
            || !originalLineGeometry.isEmpty || !originalPolygonGeometry.isEmpty
            || !originalPointGeometry.isEmpty
    }

    /// Discards every manual edit: restores fetched geometry and clears all
    /// label/icon offsets, so the layer renders purely from its settings.
    func resetManualEdits() {
        for (fid, coords) in originalLineGeometry {
            if let i = lineFeatures.firstIndex(where: { $0.id == fid }) {
                lineFeatures[i].coordinates = coords
            }
        }
        for (fid, rings) in originalPolygonGeometry {
            if let i = polygonFeatures.firstIndex(where: { $0.id == fid }) {
                polygonFeatures[i].rings = rings
            }
        }
        for (fid, coord) in originalPointGeometry {
            if let i = pointFeatures.firstIndex(where: { $0.id == fid }) {
                pointFeatures[i].coordinate = coord
            }
        }
        labelOffsets = [:]
        labelAlongOffsets = [:]
        labelPins = [:]
        symbolOffsets = [:]
        originalLineGeometry = [:]
        originalPolygonGeometry = [:]
        originalPointGeometry = [:]
    }

    init(kind: LayerKind, name: String? = nil, id: UUID = UUID()) {
        self.id = id
        self.kind = kind
        self.name = name ?? kind.displayName

        var rs = RoadStyle()
        rs.color = kind.defaultColor
        self.roadStyle = rs

        var as_ = AreaStyle()
        as_.fillColor = kind.defaultColor
        self.areaStyle = as_

        var ps = POIStyle()
        ps.fillColor = kind.defaultColor
        self.poiStyle = ps

        // A new layer shows its names; buildings are too many to label by default.
        var ls = LabelStyle()
        ls.enabled = kind != .buildings && kind != .background
        if kind.featureType == .point { ls.placement = .top }   // Beside its marker, not over it.
        self.labelStyle = ls
        self.symbolStyle = SymbolStyle()
        self.roadSubLayers = kind == .roads ? RoadSubLayer.defaults : []
        materializeSubLabelStyles(migrateOverrides: false)
    }

    /// Propagates the master label style into every road subtype: each subtype
    /// inherits all fields it hasn't pinned in `labelOverrides`. Call after any
    /// master-label edit so unpinned fields (font, colour…) stay in sync while
    /// pinned ones (e.g. a smaller size on Secondary) survive.
    func syncSubLineStyles() {
        guard kind == .roads else { return }
        for i in roadSubLayers.indices {
            let pinned = roadSubLayers[i].lineOverrides ?? []
            roadSubLayers[i].customStyle = Inheritance.merge(roadSubLayers[i].customStyle,
                                                             from: roadStyle, pinned: pinned)
        }
    }

    func syncSubLabelStyles() {
        guard kind == .roads else { return }
        for i in roadSubLayers.indices {
            let pinned = roadSubLayers[i].labelOverrides ?? []
            let base = roadSubLayers[i].labelStyle ?? labelStyle
            roadSubLayers[i].labelStyle = base.inheriting(from: labelStyle, pinned: pinned)
        }
    }

    /// Ensures every road subtype has a materialized label style (used on init
    /// and project load). `migrateOverrides` converts a legacy deep-copied
    /// custom style into a pinned-key set so its appearance is preserved.
    func materializeSubLabelStyles(migrateOverrides: Bool) {
        guard kind == .roads else { return }
        for i in roadSubLayers.indices where roadSubLayers[i].lineOverrides == nil {
            if roadSubLayers[i].useCustomStyle {
                roadSubLayers[i].lineOverrides = Inheritance.changedKeys(roadStyle, roadSubLayers[i].customStyle)
            } else {
                var style = roadStyle
                var pinned = Set<String>()
                if let w = roadSubLayers[i].defaultWidth { style.width = w; pinned.insert("width") }
                roadSubLayers[i].customStyle = style
                roadSubLayers[i].lineOverrides = pinned
            }
        }
        for i in roadSubLayers.indices {
            if roadSubLayers[i].labelOverrides != nil { continue }   // already migrated
            if migrateOverrides,
               roadSubLayers[i].useCustomLabelStyle,
               let custom = roadSubLayers[i].labelStyle {
                roadSubLayers[i].labelOverrides = LabelStyle.changedKeys(from: labelStyle, to: custom)
                // Keep the custom style as-is (appearance unchanged).
            } else {
                roadSubLayers[i].labelStyle = labelStyle
                roadSubLayers[i].labelOverrides = []
            }
        }
    }
}

enum FetchStatus: Equatable {
    case idle, fetching, loaded, error(String)
}
