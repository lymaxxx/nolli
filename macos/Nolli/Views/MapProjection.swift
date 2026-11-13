import CoreGraphics
import Foundation

/// Converts geographic coordinates (WGS-84 lat/lon) to screen pixels
/// using the Web Mercator projection that Leaflet uses internally.
struct MapProjection {
    let centerLat: Double
    let centerLon: Double
    let zoom: Double
    let viewportSize: CGSize
    /// Artboard rotation in degrees — rotates the projected point around
    /// the viewport centre so the native overlay matches the rotated map.
    let rotation: Double

    var isValid: Bool {
        zoom > 0 && viewportSize.width > 0 && viewportSize.height > 0
    }

    // MARK: - Core projection

    /// Leaflet tile size (256 px at zoom 0)
    static let tileSize: Double = 256.0

    private func worldX(_ lon: Double) -> Double {
        (lon + 180.0) / 360.0 * MapProjection.tileSize * pow(2.0, zoom)
    }

    private func worldY(_ lat: Double) -> Double {
        // Clamp to avoid poles blowing up
        let φ = max(-89.9, min(89.9, lat))
        let sinφ = sin(φ * .pi / 180.0)
        return (0.5 - log((1.0 + sinφ) / (1.0 - sinφ)) / (4.0 * .pi))
               * MapProjection.tileSize * pow(2.0, zoom)
    }

    /// Convert a lat/lon to a screen CGPoint.
    func toScreen(lat: Double, lon: Double) -> CGPoint {
        let cx = worldX(centerLon),  cy = worldY(centerLat)
        let px = worldX(lon),        py = worldY(lat)
        var dx = px - cx,            dy = py - cy   // dy positive = further south

        // Apply artboard rotation around viewport centre
        if rotation != 0 {
            // Negative because screen Y increases downward (already handled by worldY)
            let rad = rotation * .pi / 180.0
            let cosR = cos(rad), sinR = sin(rad)
            let newDx =  dx * cosR + dy * sinR
            let newDy = -dx * sinR + dy * cosR
            dx = newDx; dy = newDy
        }

        return CGPoint(
            x: viewportSize.width  / 2.0 + dx,
            y: viewportSize.height / 2.0 + dy
        )
    }

    // MARK: - Inverse projection (screen → geo)

    /// Converts a screen CGPoint back to (lat, lon).
    func fromScreen(_ pt: CGPoint) -> (lat: Double, lon: Double) {
        var dx = Double(pt.x) - viewportSize.width  / 2.0
        var dy = Double(pt.y) - viewportSize.height / 2.0

        // Undo artboard rotation
        if rotation != 0 {
            let rad  = -rotation * .pi / 180.0
            let cosR = cos(rad), sinR = sin(rad)
            let nx   =  dx * cosR + dy * sinR
            let ny   = -dx * sinR + dy * cosR
            dx = nx; dy = ny
        }

        let tileTotal = MapProjection.tileSize * pow(2.0, zoom)
        let px  = worldX(centerLon) + dx
        let py  = worldY(centerLat) + dy
        let lon = px / tileTotal * 360.0 - 180.0
        let lat = (2.0 * atan(exp((0.5 - py / tileTotal) * 2.0 * .pi)) - .pi / 2.0)
                  * 180.0 / .pi
        return (lat: lat, lon: lon)
    }

    // MARK: - Artwork (world-pixel) space

    /// Absolute Web-Mercator world pixel for a lat/lon at an arbitrary zoom.
    /// This is the zoom-independent "artwork space" the label layout engine
    /// works in (computed once at base zoom; valid at every view zoom because
    /// uniform scaling preserves along-path ratios).
    static func world(lat: Double, lon: Double, zoom: Double) -> CGPoint {
        let n = tileSize * pow(2.0, zoom)
        let x = (lon + 180.0) / 360.0 * n
        let φ = max(-89.9, min(89.9, lat))
        let sinφ = sin(φ * .pi / 180.0)
        let y = (0.5 - log((1.0 + sinφ) / (1.0 - sinφ)) / (4.0 * .pi)) * n
        return CGPoint(x: x, y: y)
    }

    /// Inverse of `world(lat:lon:zoom:)`.
    static func latLon(world: CGPoint, zoom: Double) -> (lat: Double, lon: Double) {
        let n = tileSize * pow(2.0, zoom)
        let lon = Double(world.x) / n * 360.0 - 180.0
        let lat = (2.0 * atan(exp((0.5 - Double(world.y) / n) * 2.0 * .pi)) - .pi / 2.0) * 180.0 / .pi
        return (lat, lon)
    }

    /// Projects an artwork-space world pixel (computed at `worldZoom`) to screen.
    func toScreen(world: CGPoint, worldZoom: Double) -> CGPoint {
        let f = pow(2.0, zoom - worldZoom)
        let px = Double(world.x) * f, py = Double(world.y) * f
        var dx = px - worldX(centerLon), dy = py - worldY(centerLat)
        if rotation != 0 {
            let rad = rotation * .pi / 180.0
            let cosR = cos(rad), sinR = sin(rad)
            let nx =  dx * cosR + dy * sinR
            let ny = -dx * sinR + dy * cosR
            dx = nx; dy = ny
        }
        return CGPoint(x: viewportSize.width / 2.0 + dx,
                       y: viewportSize.height / 2.0 + dy)
    }

    /// Converts a screen-space delta (e.g. a drag translation) into an
    /// artwork-space delta at `worldZoom` (inverse rotate + inverse scale).
    func worldDelta(fromScreenDelta d: CGVector, worldZoom: Double) -> CGVector {
        var dx = Double(d.dx), dy = Double(d.dy)
        if rotation != 0 {
            let rad = -rotation * .pi / 180.0
            let cosR = cos(rad), sinR = sin(rad)
            let nx =  dx * cosR + dy * sinR
            let ny = -dx * sinR + dy * cosR
            dx = nx; dy = ny
        }
        let f = pow(2.0, zoom - worldZoom)
        return CGVector(dx: dx / f, dy: dy / f)
    }

    /// Affine transform from scene-local artwork space (world px at `baseZoom`,
    /// relative to `origin`) to screen. Everything drawn on the map goes through
    /// this: scale and rotation are pure CTM operations, so zooming and rotating
    /// never re-lay anything out and vectors can't drift from each other.
    func artworkTransform(baseZoom: Double, origin: CGPoint) -> CGAffineTransform {
        let s = pow(2.0, zoom - baseZoom)
        let rad = rotation * .pi / 180.0
        var t = CGAffineTransform(translationX: viewportSize.width / 2, y: viewportSize.height / 2)
        t = t.rotated(by: -rad)
        t = t.translatedBy(x: -worldX(centerLon), y: -worldY(centerLat))
        t = t.scaledBy(x: s, y: s)
        t = t.translatedBy(x: origin.x, y: origin.y)
        return t
    }

    // MARK: - Geometry helpers

    /// Angle (degrees) of the segment from p1 to p2, adjusted so text is never
    /// upside-down (range −90…+90).
    static func segmentAngle(from p1: CGPoint, to p2: CGPoint) -> Double {
        let dx = p2.x - p1.x, dy = p2.y - p1.y
        var angle = atan2(dy, dx) * 180.0 / .pi
        if angle >  90 { angle -= 180 }
        if angle < -90 { angle += 180 }
        return angle
    }

    /// Screen points for an array of [lon, lat] coordinate pairs.
    func screenPoints(from coords: [[Double]]) -> [CGPoint] {
        coords.map { toScreen(lat: $0[1], lon: $0[0]) }
    }

    /// Total pixel length of a polyline.
    static func polylineLength(_ pts: [CGPoint]) -> Double {
        guard pts.count >= 2 else { return 0 }
        return zip(pts, pts.dropFirst()).reduce(0.0) { acc, pair in
            let dx = pair.1.x - pair.0.x, dy = pair.1.y - pair.0.y
            return acc + sqrt(dx*dx + dy*dy)
        }
    }
}
