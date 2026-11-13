import CoreGraphics
import Foundation

struct BoundingBox: Equatable, Codable, Sendable {
    var minLat: Double
    var minLon: Double
    var maxLat: Double
    var maxLon: Double

    var center: (lat: Double, lon: Double) { ((minLat + maxLat) / 2, (minLon + maxLon) / 2) }

    var overpassString: String { "\(minLat),\(minLon),\(maxLat),\(maxLon)" }

    // Aspect ratio in Mercator space
    var mercatorAspect: Double {
        let w = (maxLon - minLon) * .pi / 180   // radians, like mercY
        let h = mercY(maxLat) - mercY(minLat)
        return w / max(h, 1e-10)
    }

    // Web Mercator projection: map (lat,lon) → unit point (0…1, 0…1) within this bbox
    func unitPoint(lat: Double, lon: Double) -> CGPoint {
        let x = (lon - minLon) / (maxLon - minLon)
        let yCoord = mercY(lat)
        let yMin = mercY(minLat)
        let yMax = mercY(maxLat)
        let y = (yMax - yCoord) / (yMax - yMin)
        return CGPoint(x: x, y: y)
    }

    // Pixel point within a given canvas size
    func pixelPoint(lat: Double, lon: Double, size: CGSize) -> CGPoint {
        let u = unitPoint(lat: lat, lon: lon)
        return CGPoint(x: u.x * size.width, y: u.y * size.height)
    }
}

private func mercY(_ lat: Double) -> Double {
    let latRad = lat * .pi / 180
    return log(tan(.pi / 4 + latRad / 2))
}
