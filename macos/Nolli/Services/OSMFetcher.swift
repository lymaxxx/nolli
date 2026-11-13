import Foundation

actor OSMFetcher {
    static let shared = OSMFetcher()

    private var cache: [String: (date: Date, data: Data)] = [:]
    private var cacheDurationDays: Int = 7

    func configure(cacheDays: Int, endpoint: String) {
        self.cacheDurationDays = cacheDays
        self.overpassEndpoint = endpoint
    }

    private var overpassEndpoint = "https://overpass.openstreetmap.fr/api/interpreter"

    // Fetch all features for a layer kind within a bounding box
    func fetch(kind: LayerKind, bbox: BoundingBox) async throws -> FetchResult {
        let query = buildQuery(kind: kind, bbox: bbox)
        let data = try await fetchOverpass(query: query)
        return try parse(data: data, kind: kind)
    }

    // MARK: - Query building

    private func buildQuery(kind: LayerKind, bbox: BoundingBox) -> String {
        let b = bbox.overpassString
        let inner = kind.overpassQuery.replacingOccurrences(of: "{bbox}", with: b)
        return "[out:json][timeout:90];\n(\(inner);\n);\nout body;\n>;\nout skel qt;"
    }

    // MARK: - Network

    private func fetchOverpass(query: String) async throws -> Data {
        let key = overpassEndpoint + "|" + query
        if let cached = cache[key], Date().timeIntervalSince(cached.date) < Double(cacheDurationDays) * 86400 {
            return cached.data
        }

        // Public Overpass servers are often busy: fall back before giving up.
        var endpoints = [overpassEndpoint]
        for mirror in ["https://overpass-api.de/api/interpreter",
                       "https://overpass.kumi.systems/api/interpreter"]
        where mirror != overpassEndpoint { endpoints.append(mirror) }

        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        let body = "data=" + (query.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")

        var lastError: Error = URLError(.badServerResponse)
        for endpoint in endpoints {
            try Task.checkCancellation()
            guard let url = URL(string: endpoint) else { continue }
            var req = URLRequest(url: url, timeoutInterval: 120)
            req.httpMethod = "POST"
            req.httpBody = body.data(using: .utf8)
            req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            req.setValue("Nolli/1.0 (macOS wayfinding map editor)", forHTTPHeaderField: "User-Agent")
            do {
                let (data, response) = try await URLSession.shared.data(for: req)
                guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                    lastError = URLError(.badServerResponse)
                    continue
                }
                cache[key] = (date: Date(), data: data)
                return data
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                lastError = error
            }
        }
        throw lastError
    }

    // MARK: - Parsing

    struct FetchResult: Sendable {
        var lines: [LineFeature] = []
        var polygons: [PolygonFeature] = []
        var points: [PointFeature] = []
    }

    private func parse(data: Data, kind: LayerKind) throws -> FetchResult {
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let elements = json["elements"] as? [[String: Any]] else {
            throw URLError(.cannotParseResponse)
        }

        // JSONSerialization returns NSNumber for all numbers; use int64Value to extract safely
        func toID(_ v: Any?) -> Int64? { (v as? NSNumber).map { $0.int64Value } }
        func toDouble(_ v: Any?) -> Double? { (v as? NSNumber).map { $0.doubleValue } }
        func toIDs(_ v: Any?) -> [Int64]? {
            (v as? [Any]).map { $0.compactMap { toID($0) } }
        }

        var nodeCoords: [Int64: [Double]] = [:]
        for el in elements {
            guard (el["type"] as? String) == "node",
                  let id = toID(el["id"]),
                  let lat = toDouble(el["lat"]),
                  let lon = toDouble(el["lon"]) else { continue }
            nodeCoords[id] = [lon, lat]
        }

        var result = FetchResult()

        // Way geometry by id, for assembling multipolygon relations (large water
        // bodies and parks are relations: the Thames would otherwise be missing).
        var wayCoords: [Int64: [[Double]]] = [:]
        var relationMemberWays = Set<Int64>()
        for el in elements where (el["type"] as? String) == "way" {
            guard let id = toID(el["id"]), let nodeIds = toIDs(el["nodes"]) else { continue }
            wayCoords[id] = nodeIds.compactMap { nodeCoords[$0] }
        }

        for el in elements where (el["type"] as? String) == "relation" {
            guard kind.featureType == .polygon,
                  let id = toID(el["id"]),
                  let members = el["members"] as? [[String: Any]] else { continue }
            let tags = el["tags"] as? [String: String] ?? [:]
            guard tags["type"] == "multipolygon" || tags["type"] == "boundary" else { continue }
            var outers: [[[Double]]] = [], inners: [[[Double]]] = []
            for m in members where (m["type"] as? String) == "way" {
                guard let ref = toID(m["ref"]), let coords = wayCoords[ref], coords.count >= 2 else { continue }
                relationMemberWays.insert(ref)
                if (m["role"] as? String) == "inner" { inners.append(coords) } else { outers.append(coords) }
            }
            let outerRings = Self.assembleRings(outers), innerRings = Self.assembleRings(inners)
            for (i, ring) in outerRings.enumerated() {
                // Holes go with the first outer (the common single-outer case
                // renders correctly; even-odd fill handles nesting).
                let rings = i == 0 ? [ring] + innerRings : [ring]
                let fid = i == 0 ? -id : -(id * 1000 + Int64(i))
                result.polygons.append(PolygonFeature(id: fid, tags: tags, rings: rings))
            }
        }

        for el in elements {
            guard let type = el["type"] as? String,
                  let id = toID(el["id"]) else { continue }

            let tags = el["tags"] as? [String: String] ?? [:]

            switch type {
            case "node":
                guard !tags.isEmpty else { continue }
                guard let coord = nodeCoords[id] else { continue }
                result.points.append(PointFeature(id: id, tags: tags, coordinate: coord))

            case "way":
                guard let coords = wayCoords[id], coords.count >= 2 else { continue }
                // Untagged relation members are parts of an assembled polygon.
                if relationMemberWays.contains(id) && tags.isEmpty { continue }

                let isClosed = coords.first == coords.last && coords.count >= 4
                let isAreaTag = tags["area"] == "yes" || tags["building"] != nil
                    || tags["leisure"] != nil || tags["landuse"] != nil
                    || tags["natural"] != nil || tags["place"] != nil

                if kind.featureType == .point, isClosed {
                    // A station or hospital mapped as an outline is one place.
                    let c = PolygonCenter.areaCentroid(coords)   // [lat, lon]
                    result.points.append(PointFeature(id: id, tags: tags, coordinate: [c[1], c[0]]))
                } else if kind.featureType == .line {
                    result.lines.append(LineFeature(id: id, tags: tags, coordinates: coords))
                } else if isClosed && (kind.featureType == .polygon || isAreaTag) {
                    result.polygons.append(PolygonFeature(id: id, tags: tags, rings: [coords]))
                } else {
                    result.lines.append(LineFeature(id: id, tags: tags, coordinates: coords))
                }

            default: break
            }
        }

        // Dedup: polygons named both on a member way and its relation are rare,
        // but a way must never produce two identical features.
        print("[Nolli] parsed \(result.lines.count) lines, \(result.polygons.count) polygons, \(result.points.count) points for \(kind)")
        return result
    }

    /// Joins open way segments into closed rings (OSM multipolygon members are
    /// frequently split into many ways in arbitrary order and direction).
    static func assembleRings(_ segments: [[[Double]]]) -> [[[Double]]] {
        var open = segments
        var rings: [[[Double]]] = []
        while var ring = open.popLast() {
            var extended = true
            while ring.first != ring.last, extended {
                extended = false
                for i in open.indices {
                    let s = open[i]
                    if s.first == ring.last { ring += s.dropFirst(); open.remove(at: i); extended = true; break }
                    if s.last == ring.last { ring += s.reversed().dropFirst(); open.remove(at: i); extended = true; break }
                    if s.last == ring.first { ring = s + ring.dropFirst(); open.remove(at: i); extended = true; break }
                    if s.first == ring.first { ring = s.reversed() + ring.dropFirst(); open.remove(at: i); extended = true; break }
                }
            }
            // A ring cut by the bbox can stay open: close it so it still fills.
            if ring.first != ring.last, ring.count >= 3, let f = ring.first { ring.append(f) }
            if ring.count >= 4 { rings.append(ring) }
        }
        return rings
    }
}
