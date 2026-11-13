import Foundation

struct GeocoderResult: Sendable {
    let displayName: String
    let lat: Double
    let lon: Double
    let boundingBox: BoundingBox?
}

actor GeocoderService {
    static let shared = GeocoderService()

    func search(_ query: String) async throws -> [GeocoderResult] {
        guard !query.isEmpty else { return [] }
        let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        let urlStr = "https://nominatim.openstreetmap.org/search?q=\(encoded)&format=json&limit=5&addressdetails=1"
        guard let url = URL(string: urlStr) else { throw URLError(.badURL) }

        var req = URLRequest(url: url)
        req.setValue("Nolli/0.1 (wayfinding tool)", forHTTPHeaderField: "User-Agent")

        let (data, _) = try await URLSession.shared.data(for: req)
        guard let arr = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            return []
        }

        return arr.compactMap { item -> GeocoderResult? in
            guard let name = item["display_name"] as? String,
                  let latStr = item["lat"] as? String,
                  let lonStr = item["lon"] as? String,
                  let lat = Double(latStr),
                  let lon = Double(lonStr) else { return nil }

            var bbox: BoundingBox? = nil
            if let bb = item["boundingbox"] as? [String],
               bb.count == 4,
               let s = Double(bb[0]), let n = Double(bb[1]),
               let w = Double(bb[2]), let e = Double(bb[3]) {
                bbox = BoundingBox(minLat: s, minLon: w, maxLat: n, maxLon: e)
            }

            return GeocoderResult(displayName: name, lat: lat, lon: lon, boundingBox: bbox)
        }
    }
}
