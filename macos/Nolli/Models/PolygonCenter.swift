import Foundation

// MARK: - Polygon anchor points

/// Computes anchor points for symbol placement on polygon rings.
/// Rings are arrays of `[lon, lat]`; results are returned as `[lat, lon]`
/// for Leaflet.
enum PolygonCenter {

    /// Plain average of the ring vertices.
    static func vertexMean(_ ring: [[Double]]) -> [Double] {
        let lon = ring.map { $0[0] }.reduce(0, +) / Double(ring.count)
        let lat = ring.map { $0[1] }.reduce(0, +) / Double(ring.count)
        return [lat, lon]
    }

    /// True area centroid (shoelace). Differs from the vertex mean whenever the
    /// vertices are unevenly distributed around the perimeter.
    static func areaCentroid(_ ring: [[Double]]) -> [Double] {
        let n = ring.count
        guard n >= 3 else { return vertexMean(ring) }
        var a = 0.0, cx = 0.0, cy = 0.0
        for i in 0..<n {
            let p0 = ring[i], p1 = ring[(i + 1) % n]
            let cross = p0[0] * p1[1] - p1[0] * p0[1]
            a  += cross
            cx += (p0[0] + p1[0]) * cross
            cy += (p0[1] + p1[1]) * cross
        }
        a *= 0.5
        guard abs(a) > 1e-12 else { return vertexMean(ring) }
        return [cy / (6 * a), cx / (6 * a)]   // [lat, lon]
    }

    /// Approximate "pole of inaccessibility" — the interior point farthest from
    /// any edge — found via a coarse grid search over the bounding box. Always
    /// lands inside the polygon (unlike a centroid of a concave shape).
    static func visualCenter(_ ring: [[Double]]) -> [Double] {
        let n = ring.count
        guard n >= 3 else { return vertexMean(ring) }
        let xs = ring.map { $0[0] }, ys = ring.map { $0[1] }
        let minX = xs.min()!, maxX = xs.max()!
        let minY = ys.min()!, maxY = ys.max()!
        let steps = 18
        var best: (d: Double, x: Double, y: Double)? = nil
        for i in 0...steps {
            for j in 0...steps {
                let x = minX + (maxX - minX) * Double(i) / Double(steps)
                let y = minY + (maxY - minY) * Double(j) / Double(steps)
                guard pointInside(x, y, ring) else { continue }
                let d = minEdgeDistance(x, y, ring)
                if best == nil || d > best!.d { best = (d, x, y) }
            }
        }
        if let b = best { return [b.y, b.x] }
        return areaCentroid(ring)
    }

    private static func pointInside(_ px: Double, _ py: Double, _ ring: [[Double]]) -> Bool {
        var inside = false
        let n = ring.count
        var j = n - 1
        for i in 0..<n {
            let xi = ring[i][0], yi = ring[i][1]
            let xj = ring[j][0], yj = ring[j][1]
            if (yi > py) != (yj > py),
               px < (xj - xi) * (py - yi) / (yj - yi) + xi {
                inside.toggle()
            }
            j = i
        }
        return inside
    }

    private static func minEdgeDistance(_ px: Double, _ py: Double, _ ring: [[Double]]) -> Double {
        var best = Double.greatestFiniteMagnitude
        let n = ring.count
        for i in 0..<n {
            let a = ring[i], b = ring[(i + 1) % n]
            best = min(best, pointSegmentDistance(px, py, a[0], a[1], b[0], b[1]))
        }
        return best
    }

    private static func pointSegmentDistance(_ px: Double, _ py: Double,
                                             _ ax: Double, _ ay: Double,
                                             _ bx: Double, _ by: Double) -> Double {
        let dx = bx - ax, dy = by - ay
        let len2 = dx * dx + dy * dy
        guard len2 > 0 else { return hypot(px - ax, py - ay) }
        var t = ((px - ax) * dx + (py - ay) * dy) / len2
        t = max(0, min(1, t))
        return hypot(px - (ax + t * dx), py - (ay + t * dy))
    }
}
