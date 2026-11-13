import Foundation

// MARK: - Base protocol

protocol OSMFeature: Identifiable, Sendable {
    var id: Int64 { get }
    var tags: [String: String] { get }
}

extension OSMFeature {
    var name: String? { tags["name"] ?? tags["name:en"] }
    var ref: String? { tags["ref"] }
}

// MARK: - Concrete types

struct LineFeature: OSMFeature, Codable, Sendable {
    let id: Int64
    let tags: [String: String]
    var coordinates: [[Double]]   // [lon, lat] pairs (var: edit mode can reshape)

    var geoJSONProperties: [String: String] {
        var p = tags
        p["_osmId"] = String(id)
        return p
    }
}

struct PolygonFeature: OSMFeature, Codable, Sendable {
    let id: Int64
    let tags: [String: String]
    var rings: [[[Double]]]       // outer ring first; each ring = [lon, lat] pairs (var: edit mode)

    var outerRing: [[Double]] { rings.first ?? [] }

    var centroid: [Double] {
        let ring = outerRing
        guard !ring.isEmpty else { return [0, 0] }
        return [ring.map { $0[0] }.reduce(0, +) / Double(ring.count),
                ring.map { $0[1] }.reduce(0, +) / Double(ring.count)]
    }
}

struct PointFeature: OSMFeature, Codable, Sendable {
    let id: Int64
    let tags: [String: String]
    var coordinate: [Double]      // [lon, lat] (var: edit mode can move)
}

// MARK: - Road type classification

enum RoadType: String, CaseIterable, Sendable {
    case motorway, trunk, primary, secondary
    case tertiary, residential, unclassified, service, living_street
    case footway, path, pedestrian, steps
    case cycleway
    case other

    static func from(_ highway: String) -> RoadType { RoadType(rawValue: highway) ?? .other }

    var displayName: String {
        switch self {
        case .motorway: "Motorway"
        case .trunk: "Trunk"
        case .primary: "Primary"
        case .secondary: "Secondary"
        case .tertiary: "Tertiary"
        case .residential: "Residential"
        case .unclassified: "Unclassified"
        case .service: "Service"
        case .living_street: "Living Street"
        case .footway: "Footway"
        case .path: "Path"
        case .pedestrian: "Pedestrian"
        case .steps: "Steps"
        case .cycleway: "Cycleway"
        case .other: "Other"
        }
    }

    static let majorGroup: Set<RoadType> = [.motorway, .trunk, .primary, .secondary]
    static let minorGroup: Set<RoadType> = [.tertiary, .residential, .unclassified, .service, .living_street]
    static let pathGroup: Set<RoadType> = [.footway, .path, .pedestrian, .steps]
    static let cycleGroup: Set<RoadType> = [.cycleway]
}

// MARK: - GeoJSON serialisation

extension LineFeature {
    func toGeoJSON() -> [String: Any] {
        ["type": "Feature",
         "id": Int(id),                          // Int64 → Int for plist compat
         "geometry": ["type": "LineString",
                      "coordinates": coordinates] as [String: Any],
         "properties": tags as [String: Any]]
    }
}

extension PolygonFeature {
    func toGeoJSON() -> [String: Any] {
        ["type": "Feature",
         "id": Int(id),
         "geometry": ["type": "Polygon",
                      "coordinates": rings] as [String: Any],
         "properties": tags as [String: Any]]
    }
}

extension PointFeature {
    func toGeoJSON() -> [String: Any] {
        ["type": "Feature",
         "id": Int(id),
         "geometry": ["type": "Point",
                      "coordinates": coordinate] as [String: Any],
         "properties": tags as [String: Any]]
    }
}

func makeFeatureCollection(_ features: [[String: Any]]) -> [String: Any] {
    ["type": "FeatureCollection", "features": features]
}
