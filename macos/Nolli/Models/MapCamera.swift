import Foundation
import CoreGraphics
import Combine

/// The single source of truth for what the map view is looking at. Tiles,
/// vectors, labels, icons, edit handles and sign markers are all derived from
/// this one object, so they can never disagree.
///
/// Deliberately separate from `AppState`: the camera changes on every frame of
/// a pan/zoom/rotate gesture, and only a couple of tiny HUD views observe it —
/// the panels are not re-evaluated while the map moves.
@MainActor
final class MapCamera: ObservableObject {
    static let minZoom = 2.0
    static let maxZoom = 22.0

    @Published var centerLat: Double = 51.505
    @Published var centerLon: Double = -0.09
    @Published var zoom: Double = 14
    /// Heading-up rotation in degrees: the compass heading shown at the top of
    /// the view. The same convention signs use.
    @Published var rotation: Double = 0
    @Published var viewSize: CGSize = .zero
    @Published var mouse: (lat: Double, lon: Double)? = nil

    /// Fired after any camera change; the map surface uses it to stay in step
    /// with changes made from outside the surface (inspector, buttons…).
    let changed = PassthroughSubject<Void, Never>()
    /// Requests an animated move (handled by the surface's display link).
    let animate = PassthroughSubject<CameraTarget, Never>()

    var projection: MapProjection {
        MapProjection(centerLat: centerLat, centerLon: centerLon, zoom: zoom,
                      viewportSize: viewSize, rotation: rotation)
    }

    func set(lat: Double, lon: Double, zoom: Double? = nil, rotation: Double? = nil) {
        centerLat = max(-85, min(85, lat))
        centerLon = lon
        if let zoom { self.zoom = max(Self.minZoom, min(Self.maxZoom, zoom)) }
        if let rotation { self.rotation = Self.normalized(rotation) }
        changed.send()
    }

    /// Changes zoom while keeping the geographic point under `anchor` fixed.
    func zoom(to newZoom: Double, around anchor: CGPoint) {
        let z = max(Self.minZoom, min(Self.maxZoom, newZoom))
        let before = projection.fromScreen(anchor)
        zoom = z
        let after = projection.fromScreen(anchor)
        centerLat = max(-85, min(85, centerLat + before.lat - after.lat))
        centerLon += before.lon - after.lon
        changed.send()
    }

    /// Moves the map's content by a screen-space delta (it follows the cursor).
    func pan(by delta: CGVector) {
        let proj = projection
        let c = CGPoint(x: viewSize.width / 2 - delta.dx, y: viewSize.height / 2 - delta.dy)
        let g = proj.fromScreen(c)
        centerLat = max(-85, min(85, g.lat))
        centerLon = g.lon
        changed.send()
    }

    /// Rotates around an arbitrary screen point (view centre by default).
    func rotate(by degrees: Double, around anchor: CGPoint? = nil) {
        guard let anchor else {
            rotation = Self.normalized(rotation + degrees)
            changed.send()
            return
        }
        let before = projection.fromScreen(anchor)
        rotation = Self.normalized(rotation + degrees)
        let after = projection.fromScreen(anchor)
        centerLat = max(-85, min(85, centerLat + before.lat - after.lat))
        centerLon += before.lon - after.lon
        changed.send()
    }

    func fit(_ bbox: BoundingBox, padding: CGFloat = 24, animated: Bool = true) {
        guard viewSize.width > 0, viewSize.height > 0 else {
            centerLat = bbox.center.lat; centerLon = bbox.center.lon
            return
        }
        // Rotated extent of the bbox at zoom 0, then the zoom at which it fits.
        let corners = [(bbox.minLat, bbox.minLon), (bbox.minLat, bbox.maxLon),
                       (bbox.maxLat, bbox.minLon), (bbox.maxLat, bbox.maxLon)]
            .map { MapProjection.world(lat: $0.0, lon: $0.1, zoom: 0) }
        let rad = rotation * .pi / 180
        let xs = corners.map { Double($0.x) * cos(rad) + Double($0.y) * sin(rad) }
        let ys = corners.map { -Double($0.x) * sin(rad) + Double($0.y) * cos(rad) }
        let w = max(xs.max()! - xs.min()!, 1e-9), h = max(ys.max()! - ys.min()!, 1e-9)
        let availW = Double(viewSize.width - padding * 2), availH = Double(viewSize.height - padding * 2)
        let z = log2(min(availW / w, availH / h))
        // Geographic centre in Mercator space.
        let cw = CGPoint(x: (corners[0].x + corners[3].x) / 2, y: (corners[0].y + corners[3].y) / 2)
        let c = MapProjection.latLon(world: cw, zoom: 0)
        let target = CameraTarget(lat: c.lat, lon: c.lon,
                                  zoom: max(Self.minZoom, min(Self.maxZoom, z)), rotation: nil)
        if animated { animate.send(target) } else {
            set(lat: target.lat, lon: target.lon, zoom: target.zoom)
        }
    }

    static func normalized(_ d: Double) -> Double {
        var v = d.truncatingRemainder(dividingBy: 360)
        if v > 180 { v -= 360 }
        if v <= -180 { v += 360 }
        return v
    }
}

struct CameraTarget {
    var lat: Double
    var lon: Double
    var zoom: Double
    var rotation: Double?
}
